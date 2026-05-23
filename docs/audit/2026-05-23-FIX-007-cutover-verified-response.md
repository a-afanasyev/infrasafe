# FIX-007 — InfraSafe cutover verification response (для UK)

> Ответ на UK подтверждение PROD-VERIFIED (commit 0b96fc3).

---

# Промпт для UK

Подтверждаем end-to-end на нашей стороне:

## ✅ Что работает

| Check | Status |
|---|---|
| `request.created` пришёл в `integration_log` | ✅ id=32, action=request.created, payload содержал `source_event_id=0cc39b9c-014b-47de-8522-db1ae4030cc2` и `request_number=260523-001` |
| Sender → outbox → drain → POST 202 → marked sent | ✅ E2E 6 секунд (UK side показал 7s с retry) |
| `UK_USE_WEBHOOK_SENDER=true` в проде | ✅ |
| `UK_API_URL=http://uk-management-api:8080` | ✅ |
| HMAC через `UK_WEBHOOK_SECRET` (shared с вашим .env) | ✅ |

## ⚠️ Gap, который мы немедленно фиксим (Sprint 9.1 hotfix)

`AlertRequestMap.uk_request_number` **не заполнился** для нашего synthetic
теста по двум причинам:

1. **Synthetic smoke шёл в обход `alertForwarder.sendAlertToUK`** — я
   INSERT'нул в `uk_outbox` напрямую, без создания AlertRequestMap row.
   Для реальных алертов через alertEvents этого не случится, mapping
   будет.

2. **Existing gap в `requestProcessor.handleRequestWebhook`** (Sprint 8
   код, не Sprint 9): на event=`request.created` мы просто `logger.info`
   и `return` без матчинга `source_event_id` → AlertRequestMap. Это было
   спроектировано как Sprint 10 follow-up в нашем deployment plan, но
   теперь когда ваша Phase 2 в проде и `source_event_id` приходит как
   обещано (контракт C2/O9) — гэп **критичен** для status feedback loop:

   Без fix'а: ваш `request.status_changed` (Принято/Отменена) → наш
   `requestProcessor.findByRequestNumber('260523-001')` → NULL (потому
   что `uk_request_number` пуст) → "no mapping" → return. Наш алерт
   никогда не resolve'ится автоматически.

   Fix (~15 LoC + тесты): в `request.created` handler'е дополнительно
   `AlertRequestMap.findByIdempotencyKey(source_event_id) →
   markSent(mapping.id, request_number)`. Симметрично существующему
   markSent в alertForwarder, только теперь с настоящим `request_number`
   вместо NULL.

   ETA: ближайшие 1-2 часа, отдельным PR. По окончанию — повторный
   smoke с настоящим алертом (через `alertEvents.emit`), чтобы
   проверить полный цикл AlertRequestMap → outbox → UK → request.created
   → AlertRequestMap.uk_request_number заполнен → alert eventually
   resolved.

## Финальный статус cutover

✅ **Boevoy mode** на нашей стороне — outbound flow работает.

⚠️ **Status feedback loop** требует hotfix Sprint 9.1 (~1-2ч) — но это
не блокирует приём боевых алертов, только их автозакрытие после UK
обработки. До fix'а статус надо закрывать вручную через
`POST /api/alerts/:id/resolve` или UI оператора.

🙏 **Не удаляйте** request `260523-001` пока — мы его повторно
используем для verification после Sprint 9.1 hotfix'а (UK закроет
заявку → status_changed Принято → наш alert ожидает resolve).
Альтернативно — отдельным smoke создадим новый.

## ARCH-113

✅ Принято, ETA 1-2 дня ок, не блокер. Когда зальёте — наши локальные
counters (`configProxy.getRequestCounts`) станут полными для бот-заявок.

## Гордость момента

Request `260523-001` — первая UK заявка через автоматическую интеграцию
InfraSafe→UK. Историческое (даже если technically "smoke test" в
описании). Спасибо за тесную координацию!

---

## Reference

- UK confirmation: PROD-VERIFIED, commit `0b96fc3`
- Our deployment plan: `docs/audit/2026-05-22-sprint-9-deployment-plan.md` (Phase 5 marked done)
- Existing code gap: `src/services/uk/requestProcessor.js:72-74`
- Out-of-scope note (now in scope): deployment plan § "Out of scope → UK Phase 2 integration"
