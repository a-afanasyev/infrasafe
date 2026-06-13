# FIX-007 Phase 2 — UK status response (2026-05-23)

> Response to `2026-05-23-FIX-007-uk-phase2-readiness-prompt.md`.
> **TL;DR:** UK Phase 2 готова, ждём наших операторских решений (network
> mode + cutover window). Все 9 AC + ARCH-113 status + smoke + secret
> channel — закрыты или с понятным ETA.

## Phase 2 implementation — 9/9 ✅

| # | AC | Status | UK refs |
|---|---|---|---|
| 1.1 | Handler creates UK request from `alert.created` | ✅ | `services/inbound_alert.py:45`, PR #24 `1a95c00`, commit `4cd0cea`, 17/17 tests + live-smoke (req `260522-001`) |
| 1.2 | `external_id` → building resolve | ✅ обратный матч через `_expected_external_id` (O9 вариант A) | `inbound_alert.py:130`, dict-scan 17 buildings, no persist column |
| 1.3 | Unknown building → 422 `{"detail": "unknown building external_id"}` | ✅ | `inbound_alert.py:82-85` |
| 1.4 | `type → category` mapping (5+5+COMMUNICATION_LOST+fallback "Другое") | ✅ | `api/webhooks/mappings.py` TYPE_TO_CATEGORY, 11 types |
| 1.5 | `severity → urgency`: `WARNING→Обычная, CRITICAL→Срочная` | ✅ | SEVERITY_TO_URGENCY in mappings.py |
| 1.6 | Persistent dedup `webhook_inbox` | ✅ migration 008 applied; Redis = fast-path concurrency guard; webhook_inbox = source of truth | `database/models/webhook_inbox.py` UNIQUE on event_id |
| 1.7 | 409 returns previous `request_number` | ✅ | `inbound_alert.py:57-60` SELECT path + `:117-123` IntegrityError race; `test_duplicate_event_returns_409` |
| 1.8 | Emit `request.created` with our `event_id` (as `source_event_id`) | ✅ | `inbound_alert.py:96-106` queue_webhook + `webhook_sender.py:82-83` payload `source_event_id` |
| 1.9 | Optional payload fields preserved | ✅ full envelope в `webhook_inbox.payload` JSON. ⚠️ Нет отдельных колонок в `requests` — для UI нужен JOIN или отдельный ticket | — |

## ARCH-113

- **2.1** ❌ NOT YET — в их P1 backlog, ETA не зафиксировано
- **2.2** ✅ **Cutover можно делать без ARCH-113.** Влияет только на полноту наших локальных счётчиков для бот-инициированных заявок (не нашего pipeline)

## Deploy + smoke

- **3.1** Phase 2 в DEV, контейнеры пересобраны, миграции 008/009 применены. На прод **выкатится синхронно с cutover-окном** (UK ждёт нас)
- **3.2** Dev endpoint live: `POST /api/v2/webhooks/infrasafe/alert` (uk-management-api:8080). Внешняя exposure dev — нужно подтвердить со стороны их оператора
- **3.3** ✅ 17/17 tests покрывают все негативные кейсы (401 ×4, 422 ×3, 409, 503, 429, 202 dual-secret) + 8 handler тестов
- **3.4** Rate-limit 60/мин per IP. **Совместимо** с нашим drain ≤30/мин. Готовы поднять при необходимости

## Secret channel

- **4.1** `age` на их dev-машине — нужно подтвердить их оператору (ETA <5 мин если install нужен)
- **4.2** Секрет UK сгенерит в день cutover'а до окна smoke. **Наш pubkey** `age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm` зафиксирован у них

## Runbook acknowledgment

Наши 6 шагов cutover приняты без замечаний. UK уточнили один нюанс по шагу 4 (synthetic smoke):
- При insert в `uk_outbox` с реальным `external_id` UK → `webhook_inbox.outcome="accepted"` + `request.created` обратно к нам с `source_event_id=<наш event_id>`
- При не-`alert.created` event → `outcome="ignored"`
- Готовы синхронно смотреть `webhook_outbox` (мы) ↔ `webhook_inbox` (UK) на dev

## UK_API_URL + network mode

- **6.1** Decision pending @us:
  - **Public**: `https://uk.infrasafe.uz` через nginx/Caddy edge (TLS termination на их Caddy уже есть)
  - **Internal**: shared docker network между compose-проектами, hostname = `uk-management-api:8080`
- **6.2** Зависит от 6.1. Для internal нужно создать shared external docker network
- Стрипание `/api/v1` суффикса подтверждено — их endpoint независим от REST

## Что осталось на нашей стороне

| # | Решение | Когда |
|---|---|---|
| A | Network mode: public ИЛИ internal? | прямо сейчас |
| B | Cutover окно: дата + время + длительность ≥30 мин (UK on-call + наш оператор синхронно) | прямо сейчас |
| C | Optional поля в UK UI (1.9 caveat) — открывать ticket к UK сейчас или после cutover? | можно отложить |

## Reference

- UK PR #24 merged: https://github.com/a-afanasyev/Infrasafe_bot/pull/24
- UK commits: Phase 1 `1ea71dc`, Phase 2 `4cd0cea`, post-merge `abb8c58`, audit-cleanup `9c304d2`
- UK operator handoff: `~/Code/UK/docs/audit/2026-05-22-FIX-007-infrasafe-operator-handoff.md`
- UK backlog: `~/Code/UK/docs/audit/2026-05-20-backlog.md § FIX-007`
- Our contract: `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
- Our readiness prompt: `docs/audit/2026-05-23-FIX-007-uk-phase2-readiness-prompt.md`
