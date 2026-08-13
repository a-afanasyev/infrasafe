---
name: env-reference
description: Справочник переменных окружения InfraSafe — обязательные (БД, JWT, TOTP), необязательные, флаги интеграции с УК и ротации секретов, шлюзы подсистемы верификации алертов, переменные раннера миграций, плюс ручной чек-лист перед выкаткой PR-6. Вызывать при правке .env, src/config/env.js, при добавлении новой переменной, при разборе краш-петли на старте из-за отсутствующего секрета и перед выкаткой, меняющей набор обязательных переменных.
---

# Переменные окружения

Перенесено из корневого `CLAUDE.md` (2026-08-13) — справочник нужен при работе с
конфигурацией, а не в каждой сессии. Актуальный список обязательных проверок —
`src/config/env.js`, здесь то, чего в коде не написано: почему переменная есть и
что сломается без неё.

```bash
# Обязательные
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_REFRESH_SECRET

# Шифрование 2FA (TOTP) — обязательно (сгенерировать: openssl rand -base64 32)
TOTP_ENCRYPTION_KEY

# Необязательные
NODE_ENV=development|production
PORT=3000
CORS_ORIGINS=http://localhost:8088,http://localhost:3000
LOG_LEVEL=info|debug|warn|error
LOG_FILE=logs/app.log
LOG_CONSOLE_ONLY=false   # [R2-37] true|1 → только stdout (снять два транспорта
                         # DailyRotateFile). Для 12-факторных развёртываний, где
                         # логи уже собирает агрегатор. По умолчанию false —
                         # консоль + ротируемые файлы (одиночный прод-хост).

# Планировщик материализованных представлений (Sprint 6 / P0-6)
MV_REFRESH_ENABLED=true                  # в тестах false; иначе не трогать
MV_REFRESH_INTERVAL_SECONDS=60           # по умолчанию 60, зажат в [10, 3600]

# Интеграция с УК — секреты только в ENV (Sprint 9 / FIX-007, разделение по O5):
INFRASAFE_WEBHOOK_SECRET   # Проверка УК→InfraSafe (подписывает УК, проверяем мы).
                           # ОБЯЗАТЕЛЕН для входящих; R2-18 убрал запасной
                           # UK_WEBHOOK_SECRET → без секрета вход закрывается.
UK_WEBHOOK_SECRET          # Отправитель InfraSafe→УК (подписываем мы, проверяет УК).
                           # Для проверки входящих больше НЕ используется.
UK_WEBHOOK_SECRET_NEXT     # Необязательно: НОВОЕ значение на время ротации.
UK_USE_NEXT_SECRET=false   # 'true' → отправитель переключается на _NEXT.
UK_API_URL                 # Голый хост — клиент сам добавит
                           # /api/v2/webhooks/infrasafe/alert.
                           # Канон для прода (2026-05-24): https://infrasafe.uz/uk
                           # nginx `location ^~ /uk/api/`
                           # (nginx-config/nginx.production.conf:192) переписывает
                           # /uk/api/* → http://uk-management-api:8080/api/* по
                           # существующему мосту uk-network. Симметрично входящим
                           # от УК: оба направления идут через наш публичный
                           # HTTPS-периметр (TLS + HMAC), внутреннего
                           # http://uk-management-api со стороны InfraSafe нет
                           # (infrasafe-app-1 НЕ в uk-network — см. обоснование
                           # PR #51 и топологию в скилле uk-integration).
UK_USE_WEBHOOK_SENDER=false # Главный шлюз нового исходящего HMAC-канала.
                           # По умолчанию выключен до фазы 2 у УК и завершения
                           # ротации секретов.
UK_OUTBOX_DRAIN_INTERVAL_MS=2000  # Тик слива (зажат в [500, 60000]). ≈30/мин.
UK_API_ALLOWED_HOSTS       # [R2-19] Защита от SSRF только через allowlist для
                           # исходящей цели УК. РЕКОМЕНДУЕТСЯ всегда, когда задан
                           # UK_API_URL (env.js предупреждает); [PR-6]
                           # ОБЯЗАТЕЛЕН (жёсткий отказ), как только
                           # UK_USE_WEBHOOK_SENDER=true — выставить в хост из
                           # UK_API_URL (например, `infrasafe.uz`).
                           # validateUKApiUrl проверяет, когда задан (отвергает
                           # любой другой хост); несколько — через запятую.

# AUD-006 — уведомление УК об эскалации напряжения на месте (выкачено 2026-06-12)
UK_ESCALATION_NOTIFY=false # Главный шлюз события alert.escalated в УК (алерт по
                           # напряжению уровня WARNING, эскалирующий на месте до
                           # CRITICAL). Выключен, пока УК не подтвердит, что
                           # трактует alert.escalated как повышение срочности
                           # существующей заявки (по alert_id). При включении
                           # нужен и UK_USE_WEBHOOK_SENDER=true, иначе слив не
                           # доставит. Сама логика эскалации на месте работает
                           # независимо от этого флага.

# Устранение замечаний аудита безопасности (2026-07-11,
# docs/audit/2026-07-11-security-audit.md)
AUTH_BLACKLIST_FAIL_OPEN=false  # [H-5] Аварийный выход для оператора: на проде
                           # отказ БД или размыкание предохранителя на чёрном
                           # списке токенов теперь закрывает вход (503 +
                           # Retry-After), а не открывает его молча. Поставить
                           # 'true' во время инцидента, чтобы вернуть старое
                           # поведение. Dev и test не затронуты — там всегда
                           # fail-open независимо от переменной.
TELEMETRY_HMAC_SECRET      # [H-3] Сервисный HMAC-ключ для POST /metrics/telemetry
                           # (заголовок x-telemetry-signature, схема
                           # t=<unix>,v1=<hex> — та же, что у вебхуков УК).
                           # [PR-6] теперь ОБЯЗАТЕЛЕН на проде
                           # (PRODUCTION_REQUIRED_VARS в src/config/env.js) —
                           # переключение H-3 должно быть уже сделано ДО выкатки
                           # этого изменения (см. чек-лист ниже).
                           # src/middleware/telemetryHmac.js
UK_INVENTORY_TOKEN         # [H-4] Общий секрет, который УК шлёт в заголовке
                           # x-service-token при вызове GET /uk-requests-metrics
                           # (src/middleware/serviceToken.js). [PR-6] теперь
                           # ОБЯЗАТЕЛЕН на проде — НЕ задавать и не выкатывать,
                           # пока УК не подтвердит, что шлёт заголовок
                           # (согласовать вне системы; см.
                           # docs/audit/2026-05-24-ARCH-114-uk-requests-inventory-spec.md).

# Раннер миграций (AUD-002, LIVE с 2026-06-12) — окружение оператора и выкатки,
# НЕ рантайм приложения:
# MIGRATE_WIRING_ENABLED=true (update-production.sh гоняет status+up до
#   переключения приложения),
# MIGRATE_COMPOSE_FILE, MIGRATE_PG_USER=infrasafe_app, MIGRATE_TARGET_COMMIT,
# MIGRATE_NODE_MODE=auto|host|image (на прод-хосте нет node → image),
# MIGRATE_NODE_SERVICE=app.

# Sprint 10 — подсистема верификации и повторного открытия алертов
ALERT_VERIFICATION_ENABLED=false       # Главный шлюз. false = воркер создаётся,
                                       # но никогда не тикает. Переключать на
                                       # true только по регламенту CR-окна после
                                       # предполётной проверки §0 в
                                       # docs/audit/2026-05-24-sprint-10-rollout-runbook.md
ALERT_VERIFICATION_TICK_MS=15000       # Интервал слива (зажат в [5000, 60000])

# Интеграция с УК — хранится в БД (integration_config), переключается в админке
# uk_integration_enabled, uk_api_url, uk_frontend_url
```

## Ручной чек-лист перед выкаткой (PR-6)

Требуется на прод-хосте ПЕРЕД выкаткой коммита, который переводит
`TELEMETRY_HMAC_SECRET` / `UK_INVENTORY_TOKEN` / `INFRASAFE_WEBHOOK_SECRET` в
`PRODUCTION_REQUIRED_VARS` в `src/config/env.js`.

Предполётная проверка окружения в `update-production.sh` (добавлена тем же PR)
защищает только выкатки ПОСЛЕ этой: для самой этой выкатки исполняется СТАРЫЙ
текст скрипта (fetch и merge происходят в его середине), поэтому свой собственный
пробел она поймать не может.

1. `TELEMETRY_HMAC_SECRET` задан в `.env.prod` (переключение H-3 уже сделано).
2. `UK_INVENTORY_TOKEN` задан в `.env.prod` (переключение H-4 сделано **и** УК
   подтвердила, что её воркер сверки шлёт `x-service-token`).
3. `INFRASAFE_WEBHOOK_SECRET` задан (по R2-18 должно быть верно и так).
4. Если `UK_USE_WEBHOOK_SENDER=true` — задан `UK_API_ALLOWED_HOSTS` (теперь
   жёсткое требование, а не предупреждение).
5. То же самое для `.env.staging` перед выкаткой на staging.

Пропуск чек-листа превращает обычную выкатку в краш-петлю на старте.
