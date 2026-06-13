# FIX-007 Phase 2 readiness check — prompt for UK session

> **Назначение.** Готовый промпт для UK-сессии Claude (или для UK-команды
> любым каналом) — запрос статуса Phase 2 на стороне UK + полный go/no-go
> чеклист перед cutover на InfraSafe-проде.
>
> **Контекст у InfraSafe-стороны:** Sprint 9 уже отгружен и задеплоен
> dormant на проде (PR #39 + #40 в `main`, флаг `UK_USE_WEBHOOK_SENDER=false`).
> Inbound verifier работает с обоими именами секрета. Operator готов
> принять зашифрованный новый секрет через `age`.

---

# Промпт для UK

Привет. Это запрос статуса по UK Phase 2 (FIX-007) — мы со стороны
InfraSafe готовы к cutover'у и проверяем, можем ли начинать.

## Что у нас готово

✅ Sprint 9 InfraSafe-сторона отгружена в main и задеплоена dormant на прод:
- `POST /api/v2/webhooks/infrasafe/alert` sender реализован
  (`src/clients/ukWebhookClient.js`, mirror вашего verifier'а)
- Persistent outbox `uk_outbox` + drain worker (≤30/мин,
  `pg_try_advisory_lock` для multi-replica)
- L1 reference vector pin-test проходит — наша подпись побайтово совпадает
  с вашим алгоритмом
- Inbound verifier читает `INFRASAFE_WEBHOOK_SECRET ?? UK_WEBHOOK_SECRET`
  (с backward-compat fallback)
- Sender за флагом `UK_USE_WEBHOOK_SENDER=false` — никаких реальных
  событий пока не шлём
- `age` keypair сгенерирован, наш публичный ключ ниже в § «Канал
  передачи секрета»

Контракт целиком: `~/Code/Infrasafe/docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
(раунды A-Q + наши ответы P).

## Что нам нужно знать от вас

### 1. Phase 2 implementation — status check

Подтвердите, реализованы ли следующие пункты, со ссылками на код /
коммиты / тесты на вашей стороне:

| # | Acceptance criterion | Откуда: контракт | Status |
|---|---|---|---|
| 1.1 | `POST /api/v2/webhooks/infrasafe/alert` Phase 2 handler парсит `alert.created` event и **создаёт заявку UK** (не только 202) | A1, Q4 | ? |
| 1.2 | `external_id` (UUID) → building резолв. По O9: либо обратный матч через `reconciliation._expected_external_id`, либо persist `external_id` отдельным полем — какой подход выбрали? | A1, O9 | ? |
| 1.3 | Если building по `external_id` не найден — какой код возвращаете? (мы ожидали 422 или 409 по M3) | M3 | ? |
| 1.4 | Маппинг `type` → `category`: 5 активных + 5 будущих типов + `COMMUNICATION_LOST → Безопасность` + fallback `Другое` | O1, P1 | ? |
| 1.5 | Маппинг `severity ∈ {WARNING, CRITICAL}` → urgency (вашими словами): закодирован? | O0, P2 | ? |
| 1.6 | `webhook_inbox` персистентный dedup table вместо Redis TTL 600s (Phase 1) | D2, O9 | ? |
| 1.7 | На 409 (duplicate `event_id`) Phase 2 возвращает **`request_number`** ранее созданной заявки — для восстановления маппинга | D1 | ? |
| 1.8 | После создания заявки emit `request.created` webhook на InfraSafe с **нашим `event_id` в payload** — для матчинга через `AlertRequestMap.findByIdempotencyKey` | C2 | ? |
| 1.9 | Optional поля из payload (`alert_id`, `created_at`, `correlation_id`, `infrastructure_*`, `metric_*`) — сохраняются в `raw` для отображения, не для логики | A1 | ? |

### 2. ARCH-113

| # | Item | Status |
|---|---|---|
| 2.1 | `request.*` events эмитятся из **бот-пути** (создание заявки через Telegram), не только REST API | ? |
| 2.2 | Можно ли cutover'ить InfraSafe Sprint 9 **без** ARCH-113? (наши locale counters будут под-считывать бот-заявки, но это не блокер для основного flow) | ? |

### 3. Деплой и smoke

| # | Item | Status |
|---|---|---|
| 3.1 | Phase 2 уже задеплоена в production? Или ещё в dev/staging? | ? |
| 3.2 | Есть ли dev/staging endpoint на котором мы можем прогнать ~10 синтетических `alert.created` событий (с тестовым секретом) — Phase 2 их обработает и создаст заявки? | L2 | ? |
| 3.3 | Какие негативные кейсы тестировали (401 stale signature / 422 unknown external_id / 409 duplicate)? Нам нужно покрытие на нашей стороне симметричным | L3 | ? |
| 3.4 | На какой rate ваш rate-limiter настроен — те же 60/мин per IP что и для Phase 1, или подняли? | H1, H4 | ? |

### 4. Канал передачи секрета (`UK_WEBHOOK_SECRET`)

InfraSafe `age` public key:

```
age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm
```

Когда Phase 2 готова к боевой работе:

```bash
# UK side:
NEW_UK_WEBHOOK_SECRET="$(openssl rand -hex 32)"
echo -n "$NEW_UK_WEBHOOK_SECRET" | age -r age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm -o uk-webhook-secret.age
# Отправить uk-webhook-secret.age любым каналом — артефакт уже зашифрован.
# Параллельно в вашем .env: UK_WEBHOOK_SECRET=<тот же $NEW_UK_WEBHOOK_SECRET>
```

Подтвердите:
- [ ] `age` установлен / готовы установить?
- [ ] Знаете когда сможете передать?

### 5. Что мы сделаем после получения

| Шаг | Действие |
|---|---|
| 1 | `age -d -i <our-private-key> uk-webhook-secret.age` — расшифровка |
| 2 | На прод `.env`: `UK_WEBHOOK_SECRET=<value>` + `UK_API_URL=<host>` + `UK_USE_WEBHOOK_SENDER=true` |
| 3 | Restart app → drain worker активируется |
| 4 | Synthetic smoke (insert тестовой row в `uk_outbox`) → проверить что вы получили 202 + создали заявку |
| 5 | Проверить что `request.created` от вас пришёл к нам с правильным `event_id` |
| 6 | Подтвердить boevoy mode |

Окно cutover'а — нужно ~30 мин совместного присутствия on-call для smoke
и подтверждения end-to-end. Удобные слоты с вашей стороны?

### 6. UK_API_URL для outbound

В нашем прод `.env` сейчас `UK_API_URL=https://...` (legacy от никогда
не работавшего JWT-пути). Sender строит endpoint через
`base.replace(/\/api\/v\d+$/, '') + '/api/v2/webhooks/infrasafe/alert'`,
так что суффикс `/api/v1` стрипается автоматически.

Подтвердите:
- [ ] Какой production hostname использовать? Bare host
      (`https://uk.infrasafe.uz`) — или другой?
- [ ] internal через docker network или public через nginx/Caddy edge?
      Если internal — какой DNS-name контейнера / network alias?

## Что мы ждём от вас в ответе

- Заполните 1.1-1.9 (yes/no + ссылка/коммит) — для пункта где ещё не
  done, дайте ETA
- 2.1-2.2 — статус ARCH-113 и можем ли без него
- 3.1-3.4 — текущая среда деплоя + готовность принять синтетический трафик
- 4 — готовность к secret exchange + ETA
- 5 — окна для совместного cutover'а
- 6 — финальное значение `UK_API_URL` + network mode

## Reference

- InfraSafe Sprint 9 PR: https://github.com/a-afanasyev/infrasafe/pull/39 (merged)
- Полный контракт: `~/Code/Infrasafe/docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
- Deployment plan: `~/Code/Infrasafe/docs/audit/2026-05-22-sprint-9-deployment-plan.md`
- Pubkey handoff: `~/Code/Infrasafe/docs/audit/2026-05-23-FIX-007-uk-secret-exchange-pubkey.md`
- UK Phase 1 commit: `1ea71dc` on `fix/fix-007-inbound-webhook-hmac`
