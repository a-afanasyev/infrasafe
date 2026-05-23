# Sprint 9 / FIX-007 — Deployment plan

> **Цель.** Раскатать Sprint 9 (HMAC webhook sender + outbox) на прод как
> dormant (без отправки) сейчас, и активировать в момент готовности UK
> Phase 2 + получения нового секрета.
>
> **Merge state.** Код в `main` (PR #39, commit `58fe0fc`), CI 6/6 ✅.
>
> **Артефакты.**
> - Runbook: `docs/audit/2026-05-22-secret-split-runbook.md` (детальный
>   операторский процесс, включая `age` keypair flow).
> - Контракт: `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
>   (раунды A-Q).
> - Этот файл: pacing + chronology, кто блокирует кого, что верифицируем.

---

## Фазы

```
[1. dormant deploy]  ──► [2. inbound rename]  ──► [3. age pubkey to UK]
                                                          │
                                          ┌───────────────┘  (передаём ключ)
                                          │
                                          ▼
                              [4. ждём UK Phase 2 + secret]
                                          │
                                          │  (UK сообщает готовность)
                                          ▼
                              [5. activate sender]  ──► [6. monitor + cleanup]
```

| Фаза | Что делаем | На ком блок | Окно |
|---|---|---|---|
| 1 | Прод-деплой кода + миграций dormant | мы | ~30 мин |
| 2 | Переименовать inbound секрет (без поведенческих изменений) | мы | ~15 мин |
| 3 | Сгенерить `age` keypair, отдать pubkey UK | мы | ~10 мин |
| 4 | Ждать UK | UK | ? (UK Phase 2 ETA не назначен) |
| 5 | Cutover: получить секрет UK, прописать, флипнуть флаг | мы + UK | ~30 мин |
| 6 | Мониторинг 48ч + drop fallback в верификаторе | мы | follow-up PR |

---

## Фаза 1 — Прод-деплой dormant (≈30 мин)

**Цель:** код в проде, миграции применены, sender выключен. **Behavior delta = 0**
(никаких изменений в исходящих/входящих webhook потоках).

### 1.1 Pull main

```bash
ssh root@infrasafe.uz                    # (или через connect.sh)
cd /opt/infrasafe
git fetch origin main
git log --oneline HEAD..origin/main      # ожидаем 4 commits (Sprint 9)
git pull --ff-only origin main
```

**Verify:** `git log --oneline -5` показывает `58fe0fc` merge commit на HEAD.

### 1.2 Rebuild app образа

```bash
docker compose -f docker-compose.unified.yml build app
```

**Verify:** build успешен, нет ошибок postinstall (esbuild frontend bundles
собираются автоматически через `npm ci` postinstall hook).

### 1.3 Apply migration 022 (uk_outbox table)

```bash
docker cp database/migrations/022_uk_outbox.sql infrasafe-postgres-1:/tmp/m022.sql
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -f /tmp/m022.sql
```

**Verify:**
```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "\d uk_outbox"
```
- 10 колонок: id, event_id, payload_body, status, attempt_count,
  next_attempt_at, last_error, last_response_code, created_at, sent_at
- 4 индекса: pkey, event_id UNIQUE, drain partial (WHERE status='pending'),
  created_at DESC
- CHECK constraint на status ∈ {pending, sent, dead}

### 1.4 Apply migration 023 (counter partial index)

```bash
docker cp database/migrations/023_alert_request_map_counter_idx.sql infrasafe-postgres-1:/tmp/m023.sql
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -f /tmp/m023.sql
```

**Verify:**
```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "\d alert_request_map" | grep idx_arm_building_status_partial
```
Должен показать строку с partial index на `(building_external_id)`
WHERE status IN (pending, sent, active).

### 1.5 Restart app

```bash
docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

`--force-recreate` важен: bind-mount inode invalidation после `git pull`
(тот же трап, что в Sprint 4/6).

### 1.6 Verify dormant state

```bash
docker compose -f docker-compose.unified.yml logs --tail=50 app | grep -iE 'ukOutbox|MV refresh'
```

**Ожидаем:**
```
MV refresh scheduler starting (interval=60s)
ukOutboxService disabled via UK_USE_WEBHOOK_SENDER (dormant)
```

**Verify health:**
```bash
curl -fsS http://localhost:3000/health
# → {"status":"healthy"}
```

**Verify inbound webhook не сломался:** проверить логи `app` за последний час
на `handleRequestWebhook` / `handleBuildingWebhook`. Если за последний час
никаких событий от UK не приходило — ждём первого естественного события и
смотрим что оно отрабатывает. Альтернатива — запросить у UK тестовый
`request.status_changed`.

### Rollback Фаза 1

```bash
git reset --hard 3768eae          # last pre-Sprint-9 commit
docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

Миграции **не откатываем** — таблица `uk_outbox` остаётся пустой и
неиспользуемой; индекс на `alert_request_map` не вредит.

---

## Фаза 2 — Secret rename (≈15 мин)

**Цель:** ввести env `INFRASAFE_WEBHOOK_SECRET` параллельно к
существующему `UK_WEBHOOK_SECRET` (ОДНО И ТО ЖЕ ЗНАЧЕНИЕ). Verifier код
читает оба, picks `INFRASAFE_WEBHOOK_SECRET` first. Поведение не меняется.

### 2.1 Backup .env

```bash
cp /opt/infrasafe/.env /opt/infrasafe/.env.pre-sprint-9-secret-split
```

### 2.2 Добавить INFRASAFE_WEBHOOK_SECRET

```bash
sudoedit /opt/infrasafe/.env
```

Найти строку `UK_WEBHOOK_SECRET=<value>`. Под ней добавить:
```
INFRASAFE_WEBHOOK_SECRET=<тот же самый value, что и UK_WEBHOOK_SECRET>
```

**НЕ удалять** `UK_WEBHOOK_SECRET` пока что — нужен как fallback.

### 2.3 Restart + verify

```bash
docker compose -f docker-compose.unified.yml up -d --force-recreate app
docker compose logs --tail=30 app | grep -iE 'webhook'
```

**Verify:**
- Нет warn-лога `UK integration inbound verifier secret not configured`
- При первом входящем webhook от UK — signature verification passes (HTTP 202)

### 2.4 Smoke inbound

Если UK сейчас не шлёт ничего, запросить тестовый webhook у UK-команды
ИЛИ дождаться естественного события. Логи должны показать обычную обработку:
```
handleRequestWebhook: updated mapping for request REQ-... → status: ...
```

### Rollback Фаза 2

```bash
sudoedit /opt/infrasafe/.env
# удалить строку INFRASAFE_WEBHOOK_SECRET=...
docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

Verifier откатится на `UK_WEBHOOK_SECRET` через fallback.

---

## Фаза 3 — `age` keypair (≈10 мин)

**Цель:** Подготовить InfraSafe-сторону к получению нового
`UK_WEBHOOK_SECRET` от UK через зашифрованный канал.

### 3.1 Установить age

```bash
# На прод-хосте ИЛИ на машине оператора (рекомендую оператора)
brew install age            # macOS
# или: apt install age      # Debian/Ubuntu
```

### 3.2 Сгенерить keypair

```bash
# Лучше на машине оператора, не на проде (приватный ключ остаётся локально)
mkdir -p ~/.infrasafe-secrets
chmod 700 ~/.infrasafe-secrets
age-keygen -o ~/.infrasafe-secrets/uk-secret-exchange.key
# Создаёт файл с приватным ключом + public в комментарии # public key:

# Backup приватного — например в 1Password/Bitwarden vault как "InfraSafe age key — UK secret exchange"
```

### 3.3 Извлечь и отправить публичный ключ UK

```bash
grep '^# public key:' ~/.infrasafe-secrets/uk-secret-exchange.key
# Пример: # public key: age1xy7uwpqvfap5kpglq...
```

Отправить ТОЛЬКО публичный ключ UK-команде (любым каналом — он публичный,
шифровать ничего не надо). UK потом использует его для шифрования
`UK_WEBHOOK_SECRET`.

### Rollback Фаза 3

N/A — keypair не влияет на прод. Если ключ скомпрометирован — генерим новый
и переотправляем pubkey UK.

---

## Фаза 4 — Wait for UK (?, blocks on UK)

### 4.1 На стороне UK

UK должны (см. `~/Code/UK/docs/audit/2026-05-22-FIX-007-uk-integration-answers.md` § O9, Q4, Q5):
- [ ] Implement Phase 2 handler (`alert.created` → создание заявки UK)
- [ ] Resolve `external_id` → building (`reconciliation._expected_external_id`
      обратный матч)
- [ ] Внедрить `webhook_inbox` персистентный dedup
- [ ] Зафиксировать `severity ∈ {WARNING, CRITICAL}` в Phase 2 schema (Q3 ✅)
- [ ] Зафиксировать `COMMUNICATION_LOST → Безопасность` mapping (Q2 ✅)
- [ ] ARCH-113: emit `request.*` events из bot-пути (нужен для полноты
      наших counters; не блокер для cutover но блокер для дашборда)

### 4.2 На нашей стороне (mini-loop)

Опционально каждые 1-2 недели:
- [ ] Спросить UK ETA для Phase 2
- [ ] Спросить ETA для ARCH-113

Когда UK ready:
- UK выполняет `openssl rand -hex 32` → новый секрет
- UK шифрует под наш pubkey: `age -R <pubkey> -o secret.age`
- Шлёт нам `secret.age` файл

---

## Фаза 5 — Cutover: activate sender (≈30 мин, с UK on-call)

**Предусловия:**
- [ ] Фазы 1, 2, 3 выполнены
- [ ] UK подтвердили Phase 2 deployed
- [ ] Получен `secret.age` от UK

### 5.1 Расшифровать секрет

```bash
# На машине оператора
age -d -i ~/.infrasafe-secrets/uk-secret-exchange.key secret.age
# → выводит новый UK_WEBHOOK_SECRET значение в stdout
```

Скопировать значение, **не сохранять в файл/git/clipboard manager**.

### 5.2 Прописать в прод .env

```bash
ssh root@infrasafe.uz
sudoedit /opt/infrasafe/.env
```

Изменить:
- `UK_WEBHOOK_SECRET=<new value from UK>` (был — старое значение,
  теперь становится outbound-секретом)
- Добавить: `UK_API_URL=https://uk.infrasafe.uz` (или какой UK укажет —
  **bare host без /api/v1 суффикса**; см. R2 в плане)
- Добавить: `UK_USE_WEBHOOK_SENDER=true`

**`INFRASAFE_WEBHOOK_SECRET` оставляем как было** — это inbound секрет
(старое значение).

### 5.3 Restart + verify start

```bash
docker compose -f docker-compose.unified.yml up -d --force-recreate app
docker compose -f docker-compose.unified.yml logs -f app | grep -iE 'ukOutbox|ukWebhook'
```

**Ожидаем при старте:**
```
ukOutboxService starting (interval=2000ms, ≈30/мин)
```

### 5.4 Создать тестовый алерт

Опции (по убыванию реалистичности):
1. **Реальный** алерт через прод-метрику (ждать пика нагрузки трансформатора).
2. **Полу-синтетический**: SQL-инжект тестового metrics row, который
   триггернёт `TRANSFORMER_OVERLOAD`. Согласовать с UK on-call что они
   получили заявку.
3. **Полностью синтетический**: вручную вставить row в `uk_outbox`
   ```sql
   INSERT INTO uk_outbox (event_id, payload_body, status, next_attempt_at)
   VALUES (
       gen_random_uuid()::text,
       '{"event_id":"...","event":"alert.created","timestamp":"2026-05-22T...","alert":{"external_id":"<real-ext-id>","type":"TRANSFORMER_OVERLOAD","severity":"WARNING","message":"smoke test"}}',
       'pending',
       NOW()
   );
   ```

### 5.5 Verify end-to-end

После 2-3 секунд:

```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "
  SELECT event_id, status, attempt_count, last_response_code, last_error
  FROM uk_outbox
  ORDER BY created_at DESC LIMIT 5;
"
```

**Ожидаем:**
- `status = 'sent'`
- `last_response_code = 202` (или 409 на повторе)
- `last_error IS NULL`

Если `status = 'pending'` после 10+ секунд — что-то с drain'ом, смотрим
логи `ukOutboxService`.

Если `status = 'dead'` — смотрим `last_error` и `last_response_code`:
- 401 → подпись/таймстемп/секрет — проверить значения секрета
- 422 → схема payload — проверить что UK Phase 2 разобрал
- 503 → UK не сконфигурирован

### 5.6 Verify UK side

Запросить UK on-call:
- Видят ли они на своей стороне приём события?
- Создана ли заявка?
- Если да — получим ли `request.created` webhook от них с нашим
  `event_id`?

После получения `request.created` от UK:
```sql
SELECT id, status, uk_request_number, idempotency_key, infrasafe_alert_id
FROM alert_request_map
WHERE idempotency_key = '<наш event_id>';
```
- `uk_request_number` должен быть заполнен значением от UK
- `status = 'sent'` или `'active'`

### Rollback Фаза 5

Если что-то идёт не так:
```bash
sudoedit /opt/infrasafe/.env
# UK_USE_WEBHOOK_SENDER=false
docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

Очередь в `uk_outbox` остаётся; перезапустится когда флаг снова `true`.

При необходимости очистить очередь:
```sql
UPDATE uk_outbox SET status = 'dead', last_error = 'manual rollback'
WHERE status = 'pending';
```

---

## Фаза 6 — Monitor + cleanup (48-72ч после Фазы 5)

### 6.1 Мониторинг

В течение 48ч после cutover, каждый день:

```bash
# Состояние очереди
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "
  SELECT status, COUNT(*), MIN(created_at), MAX(created_at)
  FROM uk_outbox GROUP BY status;
"

# Dead-letters за последние 24ч
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "
  SELECT id, event_id, attempt_count, last_response_code, last_error, created_at
  FROM uk_outbox
  WHERE status = 'dead' AND created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC;
"

# Drain pacing проверка (sent rate ≤30/мин)
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "
  SELECT date_trunc('minute', sent_at) AS minute, COUNT(*) AS sent
  FROM uk_outbox
  WHERE sent_at > NOW() - INTERVAL '1 hour' AND status = 'sent'
  GROUP BY 1 ORDER BY 1 DESC LIMIT 60;
"
```

Если dead-letters стабильно >0/час — open incident.

### 6.2 Drop verifier fallback (follow-up PR)

После ≥1 недели стабильной работы Фазы 5:
- `src/services/uk/webhookVerifier.js:58` — убрать
  `|| process.env.UK_WEBHOOK_SECRET` fallback, оставить только
  `INFRASAFE_WEBHOOK_SECRET`
- Прод `.env` — можно удалить старый `UK_WEBHOOK_SECRET` если он совпадал
  со значением `INFRASAFE_WEBHOOK_SECRET`. **Или** оставить — он теперь
  играет роль outbound-секрета.

### 6.3 Backlog hygiene

Открыть PR для:
- [ ] Update `docs/audit-backlog-2026-05-20.md` — закрыть FIX-007 items
- [ ] CLAUDE.md status update Sprint 9 → DONE in prod (не только in main)
- [ ] Possibly close `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
      переместив в `docs/audit/archive/` если контракт стабилен

---

## Risk register

| # | Risk | Когда | Mitigation |
|---|---|---|---|
| R1 | `UK_API_URL` в проде содержит `/api/v1` суффикс от старого dead-кода | Фаза 5 | Sender строит endpoint через `_getEndpoint()` который strip'ает `/api/vN`. Безопасно. |
| R2 | UK Phase 2 крашится на наших payload фичах (например `correlation_id`) | Фаза 5 | Phase 2 принимает `alert` как dict; неизвестные поля сохраняются в raw (см. контракт A1). Не должно. |
| R3 | Cooldown 15 мин в alertService подавляет тест-алерт | Фаза 5 | Для тестового алерта использовать новый `{type, entity}` или фейковый row сразу в `uk_outbox` (Фаза 5.4 опция 3). |
| R4 | Multi-replica drain ускорит rate выше 60/мин | Фаза 5 (если на проде >1 replic) | `pg_try_advisory_lock` гарантирует один replic drain'ит за раз. Безопасно. |
| R5 | Backfill: события накопленные за время Phase 4 драйнятся storm'ом после флипа | Фаза 5 | Drain ≤30/мин enforce'ит pacing. UK не упрётся. Но логи могут "забить" события за неделю — приоритизировать новые? Сейчас FIFO. |
| R6 | `INFRASAFE_WEBHOOK_SECRET` и `UK_WEBHOOK_SECRET` случайно поменяли местами | Фаза 5 | Verify в Фазе 2 что inbound работает. Verify в Фазе 5 что outbound 202 на L1 reference vector — обе стороны симметричны. |

---

## Decision points для оператора

| Decision | Когда | Опции |
|---|---|---|
| Применить миграции **до** или **после** restart? | Фаза 1 | Сейчас в плане: **до**. Безопасно так как код Sprint 9 миграции уже ожидает (не ломается без них в dormant state). |
| Где хранить `age` приватный ключ? | Фаза 3 | Recommend: ~/.infrasafe-secrets на машине оператора + backup в password manager. **НЕ** в репо, **НЕ** на прод-хосте. |
| Реальный или синтетический алерт для smoke в Фазе 5? | Фаза 5 | **Recommend синтетический** (опция 3) — контроль над `event_id`/timing, не загрязняем реальные метрики. |
| Когда удалять fallback в верификаторе (Фаза 6.2)? | После 48-72ч | Когда оператор уверен что `INFRASAFE_WEBHOOK_SECRET` стабильно работает. Не критично — fallback безвреден. |

---

## Timeline (примерная)

| День | Что |
|---|---|
| День 0 (сегодня) | Фаза 1 + 2 + 3 (1.5ч на нас) |
| День 0-N | Wait for UK Phase 2 (UK ETA не назначен) |
| День N (UK ready) | Фаза 5 cutover (~30 мин + UK on-call) |
| День N+2 | Фаза 6.1 (monitoring пройден без incident) |
| День N+7+ | Фаза 6.2 (drop fallback PR) |

**Critical path:** UK Phase 2 deploy. Все остальное — рутина на нашей стороне.
