# Спека: трёхъярусное хранение телеметрии в PostgreSQL

**Дата:** 2026-07-07
**Основание:** `docs/architecture/2026-07-07-telemetry-pipeline-adr.md` (Решение 2)
**Статус:** утверждено к реализации; фазы независимы от MQTT-контура (Решение 1)
и могут идти до появления реальных контроллеров.

Номера миграций 038/039 — плейсхолдеры: брать следующие свободные на момент
реализации. Обе миграции обязаны соответствовать AUD-043: транзакционные,
expand-совместимые (контракт приложения — `INSERT INTO metrics` /
`SELECT ... FROM metrics` — не меняется), катятся runner'ом до переключения
приложения.

---

## Фаза 1 — миграция 038: конверсия `metrics` в партиционированную таблицу

### Предусловия (пре-флайт, вписать в миграцию проверками)

- `SELECT max(timestamp) FROM metrics` < границы первой новой месячной
  партиции (легаси-партиция получает bounds `(MINVALUE → <первое число
  следующего месяца>)`; строка с future-timestamp сорвёт ATTACH).
- Оценить объём: на проде ~1–2 млн строк (генератор с весны 2026) — ATTACH с
  построением индекса укладывается в секунды; окно деплоя обычное.

### Шаги (одна транзакция)

1. `ALTER TABLE metrics RENAME TO metrics_hist;` — легаси становится будущей
   исторической партицией. Sequence `metrics_metric_id_seq` не трогаем.
2. `CREATE TABLE metrics (… те же колонки …, PRIMARY KEY (metric_id, timestamp))
   PARTITION BY RANGE ("timestamp");` c
   `metric_id bigint NOT NULL DEFAULT nextval('metrics_metric_id_seq')`;
   `ALTER SEQUENCE … OWNED BY metrics.metric_id;`
   **PK составной** — ограничение партиционирования (ключ обязан входить в
   уникальный индекс). Глобальную уникальность даёт sequence; старый PK
   `(metric_id)` на легаси-партиции остаётся (более строгий — не мешает).
3. **Снять FK 021**: `ALTER TABLE alerts DROP CONSTRAINT IF EXISTS
   fk_alerts_metric;` — FK на партиционированную таблицу по `(metric_id)`
   невозможен. `alerts.metric_id` далее — soft-reference (комментарий на
   колонку). Заодно уходит неочевидный `ON DELETE CASCADE` и разблокируется
   `DROP PARTITION` для retention.
4. **Триггер heartbeat** — порядок против двойного срабатывания:
   `DROP TRIGGER trig_update_heartbeat ON metrics_hist;` → после шага 5
   `CREATE TRIGGER trig_update_heartbeat AFTER INSERT ON metrics FOR EACH ROW
   EXECUTE FUNCTION update_controller_heartbeat();` — на parent'е; PG сам
   клонирует его на все партиции, включая легаси.
5. `ALTER TABLE metrics ATTACH PARTITION metrics_hist FOR VALUES FROM
   (MINVALUE) TO ('<YYYY-MM-01>');` — недостающий индекс под составной PK
   партиция получит автоматически при ATTACH.
6. Создать месячные партиции: текущий месяц + 2 вперёд
   (`metrics_yYYYYmMM PARTITION OF metrics FOR VALUES FROM … TO …`).
7. `CREATE TABLE metrics_default PARTITION OF metrics DEFAULT;` — предохранитель
   от кривых device-timestamps (clock skew). Должна быть ПУСТОЙ в норме:
   строка в default = сигнал мониторингу (см. Фазу 4). Держать её пустой
   важно и технически: создание новых месячных партиций сканирует default.
8. Индексы parent-уровня (партиционированные): `(controller_id, timestamp DESC)`,
   `(timestamp)`, partial `(leak_sensor) WHERE leak_sensor = true` — зеркало
   текущих `idx_metrics_*`; существующие индексы легаси совпадающей структуры
   присоединятся, недостающие достроятся.
9. SECURITY DEFINER обёртка для maintenance (паттерн миграции 020 — runtime-роль
   не владеет таблицами):
   `maintain_metrics_partitions(premake_months int, retain_raw_days int)` —
   создаёт партиции вперёд и `DROP PARTITION` старше retention (только
   `metrics_y*`-партиции; `metrics_hist` дропается ТОЛЬКО когда её верхняя
   граница выйдет за retention — первые ~3 месяца она в окне). Владелец —
   bootstrap-роль, `EXECUTE` — только `infrasafe_runtime`.
   ⚠️ После `up` runner делает REVOKE-cleanup по 017 default privileges —
   проверить, что grant на функцию сохраняется (ACL-инвариант `status`).

### Тесты Фазы 1

- `npm run migrate:test` (`tests/migrate/`): up на канонической схеме;
  вставка в прошлое (легаси-партиция), в текущий месяц, в default (кривой
  timestamp); `RETURNING metric_id`; heartbeat-триггер сработал ровно один раз
  на INSERT (регресс двойного срабатывания); FK снят; pruning
  (`EXPLAIN … WHERE controller_id=$1 AND timestamp > now()-interval '600 s'`
  не трогает старые партиции).
- Юнит/интеграционные без изменений — контракт `metrics` не менялся; прогнать
  полный suite как регресс (особенно `alertService.persistenceGate.test.js`).

## Фаза 2 — миграция 039 + rollup/maintenance worker

### Миграция 039

- `metrics_hourly`: `PK (controller_id, hour)`; `samples int`; для каждого из
  14 числовых полей — `<f>_avg/_min/_max numeric`; `leak_samples int`
  (счётчик true). Обычная таблица, без партиций (1.75 млн строк/год при
  200 ctrl — не требует).
- `metrics_daily`: то же с `PK (controller_id, day)`.
- Runtime-роль получает DML автоматически (017 default privileges) — рефреш
  идёт обычными INSERT под runtime, обёртка не нужна.

### `rollupService` (новый, `src/services/rollupService.js`)

Точно по образцу `mvRefreshService`: singleton, `start()/stop()`, in-process
`_running`-mutex, per-tick `pg_try_advisory_lock` на выделенном клиенте
(взять СВОБОДНЫЙ константный lock-id; занят: 849608648 —
alertVerificationService; проверить остальные grep'ом), graceful shutdown в
`server.js` рядом с существующими воркерами.

Тик (`ROLLUP_TICK_MS`, default 300 000, clamp [60 000, 3 600 000]):
1. Hourly: пересчитать окно последних `ROLLUP_RECOMPUTE_HOURS` (default 2)
   часов + все закрытые часы позже `max(hour)` в `metrics_hourly` —
   `INSERT … SELECT date_trunc('hour', timestamp), … FROM metrics …
   ON CONFLICT (controller_id, hour) DO UPDATE` — идемпотентно, поздние
   данные от буферизующих контроллеров дольются пересчётом.
2. Daily: то же по `metrics_hourly` (не по raw — дёшево), окно 2 суток.
3. Maintenance (раз в сутки внутри тика по watermark):
   `SELECT maintain_metrics_partitions($PREMAKE, $RETAIN)`.

ENV (в `env.js` + CLAUDE.md):
```
ROLLUP_ENABLED=true            # false в тестах; мастер-гейт как MV_REFRESH_ENABLED
ROLLUP_TICK_MS=300000
ROLLUP_RECOMPUTE_HOURS=2
METRICS_RETENTION_RAW_DAYS=90      # рычаг диска: 60 при давлении
METRICS_RETENTION_HOURLY_DAYS=1095
METRICS_PARTITION_PREMAKE_MONTHS=2
```

### Тесты Фазы 2 (TDD)

Юниты по образцу `mvRefreshService.test.js`: гейт выключен → нет тиков;
advisory lock занят → quiet no-op; upsert-идемпотентность (два тика — одна
строка); поздний сэмпл в пересчитываемом окне меняет avg; min/max корректны;
leak_samples считает только true. E2e в `tests/migrate/`: 039 up + прогон
одного цикла агрегации на фикстуре.

## Фаза 3 — read-path: роутинг графиков по ярусам

- Единая точка выбора яруса (например `src/utils/metricsTierRouter.js`):
  `range ≤ 48h → metrics; ≤ 60d → metrics_hourly; else → metrics_daily`.
- Переписать интервал-запросы графиков в `analyticsService` (в т.ч.
  `DATE_TRUNC('hour') … INTERVAL '7 days'`, analyticsService.js:287 — при
  200 ctrl это скан ~2 млн raw-строк на график; после — прямое чтение
  hourly) и исторические выборки `Metric.js`.
- **Форма ответов API не меняется** (avg-серии как сейчас; min/max-лента —
  опциональное расширение фронта потом). Гейты/верификация/`buildingMetricsService`
  (последние значения) остаются на raw — не трогать.
- Тесты: юниты роутера (граничные 48h/60d); регресс контрактов ответов
  (существующие контроллер-тесты); интеграционный на выбор яруса.

## Фаза 4 — ops

1. Деплой обычный (`update-production.sh`): 038 → рестарт (heartbeat-триггер
   пере-вешан миграцией, приложение не заметило) → 039 + образ с воркером,
   `ROLLUP_ENABLED=true`; бэкфилл hourly/daily за историю raw произойдёт
   первым тиком (окно пересчёта на первом запуске — от `min(timestamp)` raw,
   учесть в watermark-логике).
2. Мониторинг: диск ≥ 80 % → алерт; `SELECT count(*) FROM metrics_default`
   > 0 → алерт (кривые device-timestamps); свежесть rollup'ов
   (`max(hour)` отстаёт > 3 ч → алерт) — повесить на существующий `/health`
   расширением, как договорено в дебате 2026-04-02 (Grafana не вводим).
3. Roll-forward-only: отката 038 нет (как у всех миграций); контракт
   не менялся, деградаций для старого кода приложения нет. Rollback образа
   приложения безопасен на любом шаге.
4. Runbook-пункты верификации на проде: pruning-EXPLAIN, одиночный heartbeat,
   пустой default, первая партиция дропнута через 90 дней (календарная
   отметка), объём `\dt+ metrics*` после месяца работы против прогноза
   (~330 байт/замер).

## Приложение: sizing

| Масштаб (1/мин) | raw 90д | hourly/год | daily/год |
|---|---|---|---|
| 17 ctrl | ~0.7 ГБ | ~50 МБ | ~2 МБ |
| 50 ctrl | ~2.1 ГБ | ~150 МБ | ~6 МБ |
| 200 ctrl | ~8.5 ГБ | ~0.6 ГБ | ~25 МБ |

(строка `metrics` ≈ 220 Б heap + ~110 Б индексы; hourly-строка шире (~44
колонки), но объём мал.)

## Открытые вопросы

1. Где живут pg_dump-бэкапы — на том же 40 ГБ диске? Если да, учесть в бюджете
   и исключить raw-партиции из полного дампа (дампить hourly/daily + свежую
   партицию, либо бэкапить на внешний storage).
2. Точный retention hourly (принято 3 года) — подтвердить с продуктом, когда
   появятся требования к отчётам.
3. UK-стек на том же диске — снять фактический объём при реализации Фазы 4.
