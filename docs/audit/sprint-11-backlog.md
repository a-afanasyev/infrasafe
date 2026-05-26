# Sprint 11 Backlog

> Carry-overs из Sprint 10, накопленные мелкие проблемы, UX/tech-debt пункты.
> Каждый пункт: **что** + **почему** + **trigger to ship** (когда становится приоритетным).
> Создан 2026-05-25 после закрытия Sprint 10 + INT-120.

---

## P1 — UI ports после INT-120 ship

### B-001 — Admin-UI «Открыть в УК» link на alert details

**Что**. На странице деталей алерта в `admin.html` добавить кнопку/ссылку «Открыть заявку в УК», которая:
- Читает `previous_uk_request_number` (или `related_request_number` из связанного payload'а) из нашей БД.
- Линкует на UK dashboard через их `onOpenRelated` prop (opt-in pluggable, уже live UK side с #4).
- Для reopen-chain: показывает подсказку «Повторное обращение №N · связана с XXX».
- Для engineer_required: подсказка «⚠ Эскалация на инженера».

**Почему**. Поля уже есть в `infrastructure_alerts` с Sprint 10 PR-3 (reopen_chain_id, reopen_sequence, previous_uk_request_number). Backend контракт закрыт обеих сторон 2026-05-25. Не хватает только UI-проброса — оператор не может из карточки алерта попасть на соответствующий тикет в УК без копипасты номера.

**Trigger**. Когда оператор начнёт жаловаться на ручное копирование request_number из админки в УК — или превентивно перед первой большой нагрузкой reopen-chain'ов в проде.

**Estimate**. ~3-4 часа: 1 endpoint (`GET /api/alerts/:id/uk-link`) + frontend кнопка + ссылочный handler. UK API URL уже в config (`uk_frontend_url`).

---

## P2 — Tech debt

### B-002 — Nginx individual HTML mounts → directory mount

**Что**. `docker-compose.prod.yml` сейчас bind-mount'ит каждый HTML файл индивидуально (`admin.html`, `index.html`, `login.html`, etc.). `git pull` создаёт новые inodes — nginx продолжает читать старый inode пока контейнер не рестартнут. Переделать на directory mount с nginx `try_files` whitelist.

**Почему**. Любой Sprint, который тушит HTML, требует ручной `docker restart infrasafe-nginx-1`. Это рискованно — забыли = деплоят старую страницу. Sprint 10 PR-5 наступил на эти грабли, потеряли ~15 минут на диагностику.

**Trigger**. Перед следующим major frontend touch (например, перед `feature/frontend-redesign` merge), чтобы новый CI не наследовал ту же проблему.

**Estimate**. ~2 часа: compose change + nginx config update + manual test перед deploy.

### B-003 — Rate-limiter и in-memory cache → Redis для multi-replica

**Что**. `src/middleware/rateLimiter.js` и `src/services/cacheService.js` хранят state в памяти процесса. Для горизонтального scale-out (несколько реплик app) нужен общий Redis.

**Почему**. Уже отмечено как known issue в CLAUDE.md «Known Architecture Issues». Sprint 9 outbox + Sprint 10 verification queue уже multi-replica-safe (DB + advisory_lock). Rate-limiter не safe — DDoS / brute-force с обходом одной реплики через round-robin LB.

**Trigger**. Когда появится решение масштабировать app (текущий single-replica setup это не требует).

**Estimate**. ~6-8 часов: Redis Docker service + два модуля переписать на ioredis + tests.

### B-004 — Monolithic `public/admin.js` (~3,429 LoC) + `public/script.js` (~2,335 LoC) split

**Что**. Phase 12B.4 (Sprint 10-era) активировал esbuild bundling, но НЕ разделил entry points. Оба файла остались монолитами с разнородной логикой.

**Почему**. Уже отмечено в CLAUDE.md «Known Architecture Issues». Каждая новая фича добавляет ещё ~50-200 LoC в эти файлы. Дальше будет хуже — рост код-базы линейно повышает время review + onboarding cost.

**Trigger**. Когда `admin.js` перевалит за 4500 LoC ИЛИ когда `feature/frontend-redesign` merge даст естественный повод переписать.

**Estimate**. ~1-2 дня: разделить на ~6-8 feature-scoped модулей, миграция через esbuild multi-entry config.

---

## P3 — UX / observability

### B-005 — VOLTAGE + HEATING auto-trigger checkers (LEAK done 2026-05-26, см. Closed)

**Что**. Continuous checker для VOLTAGE_ANOMALY и HEATING_FAILURE — auto-trigger от telemetry, аналогично только что выкаченному `checkLeak`. Нужен:
- Источник метрики (для VOLTAGE — `metrics.voltage` за окном; для HEATING — temperature delta из water/heat metrics)
- Threshold logic (для VOLTAGE — outside [200, 250]; для HEATING — `temp_delta_*` из `src/config/thresholds.js`)
- `VOLTAGE_CHECK` / `HEATING_CHECK` events в `src/events/alertEvents.js`
- `checkVoltage(controllerId)` / `checkHeating(sourceId)` методы в alertService
- emit из metricService.createMetric когда соотв. поле выходит за норму
- persistence-gate расширение в `_checkPersistenceGate` (сейчас только LEAK path; для других fail-open) — SQL aggregation для последних N сек

**Почему**. После `checkLeak` ship LEAK покрытие auto-trigger'а полное. VOLTAGE и HEATING остались manual-only — ложно "тихие" в UI, реальные аварии не эскалируются. Также persistence-gate для них fail-open (нет защиты от flash false alarms).

**Trigger**. Когда появится реальный controller VOLTAGE/HEATING incident в проде без эскалации — будет очевидно что чего-то не хватает. Альтернативно — превентивно, как с LEAK.

**Estimate**. ~3-4 ч на тип (VOLTAGE проще — `metrics.voltage` уже есть; HEATING требует понять какие именно поля и threshold для temp delta).

### B-006 — Engineering Kanban column в УК

**Что**. UK сейчас рендерит engineer_required-тикеты в обычной board-view рядом с другими категориями, отмечая amber «⚠ Эскалация» плашкой. Если operator wants отдельную Engineering колонку — это отдельный ticket с их стороны.

**Почему**. Не блокер. Текущее решение функционально (category-filter работает, dispatcher видит плашку). Cosmetic UX иmprovement.

**Trigger**. Если оператор УК запросит — отправить ticket в UK side (НЕ наш PR).

**Owner**. UK side, не InfraSafe.

---

## P3 — Sprint 9.X дольки

### B-007 — `integration_log` cosmetic gap в ukOutboxService

**Что**. `ukOutboxService` (drain worker для outbox) сейчас не обновляет integration_log при retry/dead transitions. Только final success/dead landing в логах.

**Почему**. Уже отмечено в Sprint 10 plan «Out of scope». Cosmetic — debug чуть сложнее когда нужно проследить путь конкретного event_id через retries. Не влияет на correctness.

**Trigger**. Первый случай когда нужно дебажить retry-pattern в проде → станет очевидно что лог разорван.

**Estimate**. ~1-2 часа: добавить `IntegrationLog.upsert` calls в `_drainOne` retry/dead paths.

---

## P4 — Будущие планы

### B-008 — `feature/frontend-redesign` merge

**Что**. Параллельная ветка с полным редизайном фронтенда (Inter font, design tokens, dark/light themes, sidebar layout, новые dashboard pages). Не merge'нута в main с момента основной работы Sprint'ов 7-10.

**Почему**. UX долго отставал от backend feature growth. Sprint 11/12 candidate для merge.

**Trigger**. Когда Sprint 10 stabilization window закроется (нет regressions в течение 2 недель) + B-001/B-004 split admin.js в main, чтобы было что merge'ить без conflict storm.

**Estimate**. ~1 week effort (conflict resolution, regression testing, gradual page-by-page rollout).

### B-009 — Seasonal HEATING rules (active_from/_to in alert_rules)

**Что**. HEATING_FAILURE alert rule должен быть active только в отопительный сезон (~Oct-Apr). Сейчас активен круглый год — летом fires на ремонтных работах.

**Почему**. Sprint 10 plan «Out of scope: Q4 2026». Минорный, но реальный noise источник.

**Trigger**. Q3 2026 (август-сентябрь), чтобы успеть до start отопительного сезона.

**Estimate**. ~4-6 часов: миграция (`active_from`, `active_to` columns) + AlertRule filter + admin UI.

---

## Closed / removed

### ✅ B-005-LEAK — LEAK auto-trigger (closed 2026-05-26)

**Shipped**: commits `cb31e71` (initial) + `e15436f` (cooldown bugfix). Live на проде 2026-05-26 ~03:30 МСК.

**Что сделано**:
- `LEAK_CHECK` event добавлен в `src/events/alertEvents.js`
- `metricService.createMetric` эмитит `LEAK_CHECK` после успешного insert'а метрики с `leak_sensor=true`
- `alertService.checkLeak(controllerId)` — listener: cooldown + in-memory dedup + delegate в `createAlert`, который дальше через существующий persistence-gate (≥2 samples за 10 мин, span ≥10 сек для CRITICAL)
- Severity hardcoded CRITICAL в v1 (реальная протечка по определению критическая)

**Verified end-to-end в проде** (двумя независимыми run'ами):

1. **2026-05-24 22:31 UTC — alert 25 → ticket `260524-005`** — initial smoke сразу после deploy. 4 telemetry сэмпла id=6,7,8,9 для controller_id=1. End-to-end ~5 сек до УК HTTP 202.
   - Также подтверждена downstream lifecycle через Sprint 10: УК выпустила `Отменена` → auto-resolve → verification chain `fe83b418` sequence→2 → markPassed (no reopen в window). Все state transitions автономно, без ручного вмешательства.

2. **2026-05-26 10:54 UTC — alert 26 → ticket `260526-001`** — repeat verification по запросу УК после расхождения (они не видели inbound 24h+, что было ожидаемо: real-world telemetry с `leak_sensor=true` не поступала с момента 22:31 UTC 24 мая). 3 telemetry сэмпла с интервалом 7s. Persistence-gate сработал чётко — первые 2 sample'а отсечены ("only 1 sample" + "condition 8s, need 10s"), 3-й прошёл (span 15s). End-to-end от 3-го sample'а до УК HTTP 202: ~0.3 сек; до их `request.created` callback: ~6 сек. УК подтвердили payload byte-for-byte match с их `webhook_inbox`.

**Lesson learned / cooldown bugfix**:
В первой ревизии `lastChecks.set(checkKey, now)` стоял безусловно ПОСЛЕ `createAlert` — это значит persistence-gate denial (вернулся null потому что недостаточно samples в окне) тут же ставил 15-мин cooldown, маскируя дальнейшие telemetry. Фикс: bump cooldown ТОЛЬКО на success. Sensor-spam protection остаётся через in-memory dedup + DB partial unique index.

Этот же паттерн нужно перенести в `checkVoltage` / `checkHeating` когда будем делать B-005 (VOLTAGE + HEATING).

