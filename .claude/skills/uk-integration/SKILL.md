---
name: uk-integration
description: Устройство интеграции с ботом УК (Управляющая Компания) — топология сети между InfraSafe и УК, файлы бэкенда (ukIntegrationService и 5 модулей под src/services/uk/), outbox и drain-воркер, HMAC-подписи вебхуков в обе стороны, расширения модели Building, эндпоинты /integration. Вызывать при работе с вебхуками УК, исходящей отправкой алертов в УК, alert_request_map, uk_outbox, uk_requests, при отладке подписей и при вопросах «почему заявка не доехала до УК».
---

# Интеграция с УК

Перенесено из корневого `CLAUDE.md` (2026-08-13): раздел грузился в каждую
сессию, хотя нужен только при работе с интеграцией.

Двусторонняя интеграция с UK Management Bot. Все 5 фаз завершены + отправитель
Sprint 9 (FIX-007) + ARCH-114 reconcile из Sprint 10 (2026-05-24).

## Топология сети (2026-05-24, после Sprint 9.x)

**Оба направления** канала УК идут через **публичный HTTPS-периметр**, а НЕ
через внутреннюю docker-сеть `uk-network`. Изменения compose в Sprint 9.x (и
последующий PR #51 с фиксом compose) вывели `infrasafe-app-1` из `uk-network`;
публичный периметр стал каноническим для входящих, а после e2e-прогона
2026-05-24 (алерт 24 → тикет 260524-001) то же подтвердилось для исходящих:

- **УК→InfraSafe** (входящие): `https://infrasafe.uz/webhooks/uk/*` и
  `/api/uk-requests-metrics` → nginx → `infrasafe-app-1:3000` по мосту `leaflet-network`.
- **InfraSafe→УК** (исходящие): `UK_API_URL=https://infrasafe.uz/uk` → nginx
  `location ^~ /uk/api/` (`nginx-config/nginx.production.conf:192`) → rewrite
  `/uk/api/*` → `http://uk-management-api:8080/api/*` по мосту `uk-network`
  (в этой сети только `infrasafe-nginx-1`, приложения там нет).

Эшелонированная защита: TLS на nginx + подписи HMAC-SHA256 в обе стороны + лимит
60/мин.

**НЕ возвращайте `infrasafe-app-1` в `uk-network`** — это вернёт коллизию
алиасов B-011: у `uk-postgres` алиас `postgres` в `uk-network`, и приложение
может отрезолвить хостнейм БД в чужой контейнер с другим паролем (петля
auth-fail, разбиралось 2026-05-28; фикс B-010 закрепил
`docker-compose.unified.yml` так, чтобы app сидел только в
`infrasafe-network + leaflet-network`). Если когда-нибудь понадобится
альтернативный внутренний docker-путь УК↔InfraSafe — сперва переименуйте
общие алиасы (`postgres`/`redis`/`frontend`/`app`) в обоих compose-проектах на
уникальные (`uk-postgres`/`infrasafe-postgres`), задокументируйте в закрытии
B-011, и только потом обсуждайте общую сеть.

## Файлы бэкенда

- `src/services/ukIntegrationService.js` — фасад, реэкспортирует 5 модулей ниже
  (разделение Sprint 8 ради P1-14). Поверхность из связанных методов + прокси
  свойств для обратной совместимости.
- `src/services/uk/configProxy.js` — `isEnabled` / `getConfig` / `updateConfig`
  + кэш счётчиков (`getRequestCounts`, `getBuildingRequests`, TTL 60 с,
  `invalidateRequestCache`). **Sprint 9**: счётчики теперь строятся SQL-агрегацией
  по `alert_request_map` (УК не будет реализовывать `/requests/counts-by-building`, см. O4).
- `src/services/uk/webhookVerifier.js` — проверка HMAC-SHA256 + защита от
  повторов по nonce (через Redis, если настроен, иначе Map). Плюс хелперы
  `logEvent` / `isDuplicateEvent`. **R2-18 (2026-07-03)**: читает
  `INFRASAFE_WEBHOOK_SECRET` **и только его** — запасной вариант на
  `UK_WEBHOOK_SECRET` из окна переименования удалён. Отсутствие секрета теперь
  закрывает вход (отвергает каждый вебхук), а не подставляет молча секрет
  исходящего направления.
- `src/services/uk/buildingSync.js` — `handleBuildingWebhook`
  (created/updated/deleted) + детерминированный `_generateExternalId`.
- `src/services/uk/alertForwarder.js` — `sendAlertToUK` + `resolveBuildingIds`.
  Владеет слушателем `alertEvents.ALERT_CREATED`. **Sprint 9**: кладёт в
  `uk_outbox` (под флагом `UK_USE_WEBHOOK_SENDER`) вместо синхронного JWT-вызова.
- `src/services/uk/requestProcessor.js` — `handleRequestWebhook` (обратная связь
  по статусу заявки от УК). Эмитит `alertEvents.UK_REQUEST_RESOLVED` для
  авторезолва.
- `src/services/uk/ukOutboxService.js` — **Sprint 9** синглтон drain-воркера;
  за тик сливает одну строку под `pg_try_advisory_lock` (безопасно при нескольких
  репликах); backoff 2/4/8/16/32 с, потолок 5 попыток → dead.
- `src/clients/ukWebhookClient.js` — **Sprint 9** отправитель HMAC-SHA256;
  зеркалит алгоритм verifier'а; подписывает **в момент отправки**, а не при
  постановке в очередь (окно 300 с); поддерживает ротацию двух секретов
  (`UK_USE_NEXT_SECRET`).
- `src/routes/webhookRoutes.js` — POST `/webhooks/uk/building` и
  `/webhooks/uk/request` (полная валидация, TOCTOU-безопасно).
- `src/routes/integrationRoutes.js` — админский API + эндпоинты для любого
  авторизованного: config, logs, rules, request-counts, building-requests.
- `src/utils/webhookValidation.js` — хелперы валидации входа.
- `src/models/IntegrationConfig.js` — key-value конфиг в БД.
- `src/models/IntegrationLog.js` — журнал событий синхронизации с пагинацией и фильтрами.
- `src/models/AlertRule.js` — правила сопоставления алерт→заявка УК + `findByTypeAndSeverity()`.
- `src/models/AlertRequestMap.js` — связки алерт→заявка: create,
  findByAlertAndBuilding, markSent, findByRequestNumber, findByIdempotencyKey,
  updateStatus, areAllTerminal.
- `src/models/UkOutbox.js` — **Sprint 9** устойчивый outbox: `enqueue`
  (ON CONFLICT DO NOTHING), `pickNext` (FOR UPDATE SKIP LOCKED), `markSent` /
  `markFailed` / `markDead` / `resetForSkip`.

## Ключевые методы

- `alertForwarder.sendAlertToUK(alertData)` — подбирает правила, резолвит здания,
  **Sprint 9**: собирает каноническое тело события и делает `UkOutbox.enqueue`
  на каждое здание (POST в УК — забота drain-воркера).
- `requestProcessor.handleRequestWebhook(payload)` — определяет терминальный
  статус (Принято/Отменена), авторезолвит алерт, когда все связки терминальны.
- `alertForwarder.resolveBuildingIds(id, type)` — резолвит через
  primary/backup_transformer_id, controller_id, cold_water_source_id, heat_source_id.
- `configProxy.getRequestCounts()` / `.getBuildingRequests()` — **Sprint 9**:
  локальная SQL-агрегация, кэш 60 с, деградирует мягко. **2026-07-23**:
  агрегирует ARM ∪ `uk_requests` (дедуп по номеру через NOT EXISTS; терминальные
  для uk_requests — 'Принято'/'Отменена') — закрывает старый недосчёт ARCH-113
  для заявок из бота, у которых есть здание.
- `requestProcessor` `request.reconcile` (контракт УК от 2026-07-23): строка ARM
  есть → путь status_changed (обновление + терминальный статус лечит
  пропущенный авторезолв); строки ARM нет → `UkRequest.reconcile`, атомарный
  upsert по `uk_request_number` (свежий event_id на каждый цикл УК — так и
  задумано: сходимость через ключ upsert, а не через дедуп событий).
  `src/models/UkRequest.js`, миграция 038.
- `webhookVerifier.verifyWebhookSignature(rawBody, sigHeader)` — HMAC + защита от повторов.
- `buildingSync.handleBuildingWebhook(payload)` — building.created / .updated / .deleted.
- `ukWebhookClient.send(payloadBody)` — **Sprint 9** подписывает в момент
  отправки, POST'ит в УК `/api/v2/webhooks/infrasafe/alert`, возвращает
  `{outcome: success|dead|retry|skip, code, error}`.
- `ukOutboxService.start()` / `.stop()` — **Sprint 9** жизненный цикл
  drain-воркера; `_drainOne` за тик переводит исход отправки в переходы outbox и
  AlertRequestMap.

## Расширения модели Building (`src/models/Building.js`)

- `external_id` (UUID) — ссылка на здание в системе УК.
- `uk_deleted_at` — мягкое удаление со стороны УК.
- Методы: `findByExternalId()`, `createFromUK()`, `syncFromUK()`, `softDeleteFromUK()`.

## Безопасность

Подписи HMAC-SHA256 в обе стороны, защита от повторов, guard на UNIQUE по
принципу insert-first (TOCTOU-безопасно), идемпотентная связка алерт→заявка
через `ON CONFLICT` в outbox, лимиты (60 запросов/мин на вход + 30/мин на
исходящий drain), сравнение за постоянное время. Секреты только в ENV:

- `INFRASAFE_WEBHOOK_SECRET` — подписывает УК, проверяет InfraSafe (входящие).
  **Обязателен**; запасной вариант на `UK_WEBHOOK_SECRET` убран (R2-18) —
  отсутствие → fail-close.
- `UK_WEBHOOK_SECRET` — подписывает InfraSafe, проверяет УК (исходящие). Sprint 9.
- `UK_WEBHOOK_SECRET_NEXT` + `UK_USE_NEXT_SECRET` — поддержка ротации двух секретов.

**Заголовок подписи для входящих от УК — `x-webhook-signature: t=<ts>,v1=<hex>`**
(НЕ `X-Signature`: он где-то по пути срезается или приводится к нижнему регистру
и даёт `401 signature no_header`). Пригодится при любой ручной синтетике.

## Эндпоинты (фаза 5)

- `GET /integration/request-counts` — любой авторизованный (не только админ),
  кэш 60 с, Sprint 9: SQL из `alert_request_map`.
- `GET /integration/building-requests/:externalId` — любой авторизованный,
  UUID валидируется, Sprint 9: SQL из `alert_request_map`.
- Оба смонтированы ДО `router.use(isAdmin)` в `integrationRoutes.js`.

## Состояние фаз

1. Основание (БД, модели, маршруты, админка, журналирование) — **ГОТОВО**
2. Синхронизация зданий (УК → InfraSafe) — **ГОТОВО**
3. Конвейер алерт → заявка (InfraSafe → УК) — **ГОТОВО** (переделано в Sprint 9:
   HMAC-вебхук через outbox вместо мёртвого JWT-пути)
4. Обратная связь заявка → алерт (УК → InfraSafe) — **ГОТОВО**
5. Бэкенд слоя карты (счётчики заявок, кэш, external_id) — **ГОТОВО**
   (Sprint 9: локальные SQL-счётчики)
6. **Sprint 9 / FIX-007**: отправитель HMAC-вебхуков + устойчивый outbox +
   разделение секретов — **ГОТОВО** под флагом `UK_USE_WEBHOOK_SENDER`
   (по умолчанию выключен до фазы 2 у УК и завершения ротации секретов).

## Спецификации и регламенты

- `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md` — исходный дизайн фаз 1-5
- `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md` — согласование контракта Sprint 9 (раунды A-Q)
- `docs/audit/2026-05-22-secret-split-runbook.md` — регламент оператора по переименованию секретов и обмену age-ключами
