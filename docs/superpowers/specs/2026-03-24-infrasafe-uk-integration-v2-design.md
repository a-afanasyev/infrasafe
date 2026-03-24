# InfraSafe ↔ UK Integration Design (v2 — Embedded)

> **Status:** APPROVED (2026-03-24)
> **Supersedes:** `2026-03-23-infrasafe-uk-integration-design.md` (separate Bridge approach abandoned as over-engineering)

**Goal:** Bidirectional integration between InfraSafe (IoT monitoring) and UK (ticket management) — embedded directly in InfraSafe. Admin can enable/disable integration and view sync logs from admin panel.

**Key change from v1:** No separate Bridge microservice. All integration logic lives inside InfraSafe as a new module (`src/services/ukIntegrationService.js`). One less service, one less DB, direct access to all InfraSafe data.

---

## 1. Architecture

```
┌──────────────────────────────────────────┐          ┌─────────────┐
│               InfraSafe                   │          │     UK      │
│                                          │ webhooks │  (FastAPI)  │
│  alertService ──► ukIntegrationService ──┼────────► │  port 8085  │
│                       ▲                  │          │             │
│  webhookRoutes ◄──────┼──────────────────┼◄──────── │             │
│                       │                  │          └─────────────┘
│  Admin UI: toggle, logs, rules           │
│                                          │
│  Tables: integration_config,             │
│          alert_rules, alert_request_map, │
│          integration_log                 │
└──────────────────────────────────────────┘
```

### Key Principles

- **Embedded integration** — no separate service, all logic in InfraSafe
- **Feature flag** — integration disabled by default, admin enables via UI
- **Event-driven** — webhooks on entity changes between systems
- **External UUID** — shared `external_id` in both `buildings` tables
- **Configurable rules** — admin-managed alert→request mapping
- **Idempotent webhooks** — `event_id` UUID deduplication via integration_log
- **Graceful degradation** — if UK is unreachable, InfraSafe works normally, errors logged

### Data Flows

1. **Building sync (UK → InfraSafe)** — UK sends webhook → InfraSafe creates/updates building with external_id
2. **Alert → Request (InfraSafe → UK)** — alert created → ukIntegrationService checks rules → creates request in UK via API
3. **Request → Alert (UK → InfraSafe)** — UK sends status webhook → InfraSafe resolves alert
4. **Request counts** — frontend calls InfraSafe API → ukIntegrationService queries UK API → cached response

---

## 2. Database Changes (InfraSafe DB)

### Existing table changes

```sql
-- Add external_id to buildings
ALTER TABLE buildings ADD COLUMN external_id UUID UNIQUE;

-- Relax lat/lng for buildings synced from UK without coordinates
ALTER TABLE buildings ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE buildings ALTER COLUMN longitude DROP NOT NULL;

-- Soft-delete flag for buildings removed in UK
ALTER TABLE buildings ADD COLUMN uk_deleted_at TIMESTAMPTZ;
```

### New tables

```sql
-- Integration on/off + UK connection settings
CREATE TABLE integration_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults (non-sensitive settings only)
INSERT INTO integration_config (key, value) VALUES
    ('uk_integration_enabled', 'false'),
    ('uk_api_url', ''),
    ('uk_frontend_url', '');

-- SENSITIVE values (uk_webhook_secret, uk_service_user, uk_service_password)
-- are ENV-ONLY: read from process.env, never stored in DB or exposed via API.
-- Admin UI shows masked "●●●●●●" for these fields (write-only: can set new value,
-- cannot read current). This prevents plaintext secrets in the database.

-- Alert-to-request mapping rules
CREATE TABLE alert_rules (
    id          SERIAL PRIMARY KEY,
    alert_type  VARCHAR(100) NOT NULL,
    severity    VARCHAR(20) NOT NULL,
    enabled     BOOLEAN DEFAULT true,
    uk_category VARCHAR(50) NOT NULL,
    uk_urgency  VARCHAR(50) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(alert_type, severity)
);

-- Track which alerts created which UK requests
CREATE TABLE alert_request_map (
    id                  SERIAL PRIMARY KEY,
    infrasafe_alert_id  INTEGER NOT NULL,
    uk_request_number   VARCHAR(20),
    building_external_id UUID,
    idempotency_key     UUID UNIQUE,
    status              VARCHAR(20) DEFAULT 'active',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(infrasafe_alert_id, building_external_id)
);

-- Unified sync/integration log (replaces Bridge's sync_log)
CREATE TABLE integration_log (
    id            SERIAL PRIMARY KEY,
    event_id      UUID UNIQUE,
    direction     VARCHAR(30) NOT NULL,   -- to_uk | from_uk
    entity_type   VARCHAR(20) NOT NULL,   -- building | alert | request
    entity_id     VARCHAR(50),
    action        VARCHAR(30) NOT NULL,   -- building.created | alert.created | request.status_changed | ...
    payload       JSONB,
    status        VARCHAR(20) DEFAULT 'pending',   -- pending | success | error | failed
    error_message TEXT,
    retry_count   INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_integration_log_event_id ON integration_log(event_id);
CREATE INDEX idx_integration_log_status ON integration_log(status) WHERE status IN ('error', 'failed');
CREATE INDEX idx_integration_log_created ON integration_log(created_at DESC);
```

---

## 3. Backend — New Files

### `src/services/ukIntegrationService.js`

Central integration module. All UK communication goes through here.

**Responsibilities:**
- Check if integration is enabled (reads `integration_config`)
- Authenticate to UK API (JWT login + token caching + refresh)
- Send alerts to UK as requests (alert→request pipeline)
- Receive building sync webhooks from UK
- Receive request status webhooks from UK
- Query UK for request counts (with local caching, 60s TTL)
- Resolve building IDs from infrastructure relationships (direct SQL)
- Retry failed webhook deliveries (3 retries, exponential backoff: 1s/5s/25s)
- Log all operations to `integration_log`

**Key methods:**
```
isEnabled() → boolean
handleBuildingWebhook(payload) → void
handleRequestWebhook(payload) → void
sendAlertToUK(alertData) → void
getRequestCounts(externalIds) → { buildings: {...} }
getBuildingRequests(externalId, limit) → { requests: [...] }
getIntegrationLogs(filters) → { logs: [...], total }
getConfig() → { enabled, uk_api_url, ... }
updateConfig(settings) → void
```

### `src/routes/webhookRoutes.js`

Incoming webhooks from UK. Mounted at `/api/webhooks/uk/`.

```
POST /api/webhooks/uk/building   — building.created/updated/deleted
POST /api/webhooks/uk/request    — request.created/status_changed
```

- HMAC-SHA256 signature verification via `X-Webhook-Signature` header
- Replay protection: reject if timestamp >5 minutes old
- Idempotency: check `event_id` in integration_log before processing
- **Synchronous processing** — webhook is fully processed before returning 200. If processing fails, return 500 so UK retries. This avoids lost events without needing a durable queue.
- **No JWT auth** — webhook endpoints use HMAC signature instead

### `src/routes/integrationRoutes.js`

Admin-facing integration management API. Mounted at `/api/integration/`.

```
GET    /api/integration/config          — get current config (admin)
PUT    /api/integration/config          — update config + toggle (admin)
GET    /api/integration/logs            — list logs with filters (admin)
GET    /api/integration/logs/:id        — single log detail (admin)
POST   /api/integration/logs/retry/:id  — retry a failed operation (admin)
GET    /api/integration/rules           — list alert rules (admin)
POST   /api/integration/rules           — create rule (admin)
PUT    /api/integration/rules/:id       — update rule (admin)
DELETE /api/integration/rules/:id       — delete rule (admin)
GET    /api/integration/status          — health check: UK API reachable? (admin)
GET    /api/integration/request-counts  — request counts for map layer (auth)
GET    /api/integration/building-requests/:externalId — requests for popup (auth)
```

### `src/models/IntegrationConfig.js`

Simple key-value CRUD for `integration_config` table.

### `src/models/AlertRule.js`

CRUD for `alert_rules` table.

### `src/models/AlertRequestMap.js`

CRUD for `alert_request_map` table.

### `src/models/IntegrationLog.js`

CRUD + filtered queries for `integration_log` table.

---

## 4. Building Sync (UK → InfraSafe)

### Direction

UK is source of truth for buildings. UK sends webhooks, InfraSafe receives.

### Webhook Contract (UK → InfraSafe)

```json
POST /api/webhooks/uk/building
{
  "version": "1.0",
  "event_id": "uuid-v4",
  "event": "building.created",
  "building": {
    "id": 15,
    "name": "Дом 42",
    "address": "ул. Навои, 42",
    "town": "Ташкент",
    "contacts": "..."
  },
  "timestamp": "2026-03-24T14:30:00Z"
}
```

Signature in `X-Webhook-Signature` header.

### Field Ownership

| Field | Owner | Notes |
| --- | --- | --- |
| `name`, `address`, `town` | UK | Overwritten on sync |
| `latitude`, `longitude` | InfraSafe | Set by admin after sync; NULL until set |
| `external_id` | Generated | UUID created on first sync |
| `region`, `management_company`, `has_hot_water` | InfraSafe | InfraSafe-specific metadata |

**On update:** ukIntegrationService reads current building, merges UK fields, calls existing `PUT /buildings/:id` internally (service-level call, not HTTP).

**On delete:** Soft — preserve `external_id` (needed for historical alert_request_map lookups), set `uk_deleted_at = NOW()` on the building. Building stays in InfraSafe (may have controllers/alerts/metrics). Frontend and alert pipeline skip buildings with non-NULL `uk_deleted_at`.

**Buildings without coordinates:** Frontend skips buildings with NULL lat/lng for map markers. They appear only in admin list.

---

## 5. Alert → Request Pipeline

### Trigger

In `alertService.sendNotifications()` (already has a placeholder for webhook):

```javascript
if (await ukIntegrationService.isEnabled()) {
    await ukIntegrationService.sendAlertToUK(alertData);
}
```

### Building ID Resolution (direct SQL)

| infrastructure_type | Query | Notes |
| --- | --- | --- |
| `transformer` | `SELECT building_id FROM buildings WHERE power_transformer_id = :id` | varchar FK match |
| `controller` | `SELECT building_id FROM controllers WHERE controller_id = :id` | direct FK |
| `water_source` | `SELECT building_id FROM buildings WHERE cold_water_source_id = :id` | varchar FK |
| `heat_source` | `SELECT building_id FROM buildings WHERE heat_source_id = :id` | varchar FK |

All queries are direct SQL in ukIntegrationService — no HTTP round-trips.

**v1 transformer limitation:** Resolution uses only `power_transformer_id` (varchar FK, same ID space as `power_transformers.id` used by analytics/alerts). Buildings linked via integer FKs `primary_transformer_id`/`backup_transformer_id` (different ID space, possibly referencing a separate `transformers` table) are NOT covered. This means v1 alerts cover only buildings linked through legacy `power_transformer_id`. Extending to integer FK columns requires schema investigation and is tracked in Out of Scope (Section 13).

### Cardinality

One UK request per affected building. `alert_request_map` tracks each mapping. Alert resolves when ALL related requests reach terminal status.

### Idempotency

Before creating UK request: insert `alert_request_map` row with `idempotency_key` UUID. Pass key in `X-Idempotency-Key` header to UK API. On retry — same key, UK deduplicates.

### Default Rules (seeded in migration)

| Alert Type | Severity | UK Category | UK Urgency |
| --- | --- | --- | --- |
| TRANSFORMER_OVERLOAD | WARNING | Электрика | Средняя |
| TRANSFORMER_OVERLOAD | CRITICAL | Электрика | Критическая |
| TRANSFORMER_CRITICAL_OVERLOAD | CRITICAL | Электрика | Критическая |
| LEAK_DETECTED | WARNING | Сантехника | Срочная |
| LEAK_DETECTED | CRITICAL | Сантехника | Критическая |
| VOLTAGE_ANOMALY | WARNING | Электрика | Обычная |
| HEATING_FAILURE | CRITICAL | Отопление | Критическая |

---

## 6. Request → Alert Feedback

### Status Mapping

```
UK Status       →  InfraSafe Action
────────────────────────────────────
В работе        →  log only
Закуп           →  log only
Уточнение       →  log only
Выполнена       →  log only
Исполнено       →  log only
Принято         →  resolve alert (if all requests for alert are terminal)
Отменена        →  resolve alert (if all requests for alert are terminal)
```

### Webhook Contract (UK → InfraSafe)

```json
POST /api/webhooks/uk/request
{
  "version": "1.0",
  "event_id": "uuid-v4",
  "event": "request.status_changed",
  "request": {
    "request_number": "260324-015",
    "status": "Принято",
    "building_id": 15,
    "category": "Электрика",
    "urgency": "Срочная"
  },
  "previous_status": "Исполнено",
  "timestamp": "2026-03-24T14:30:00Z"
}
```

`request.created` event also sent — used to invalidate request-counts cache.

Manually created UK requests (no alert mapping) — logged, cache invalidated, no alert update.

---

## 7. UI — Map Layer + Admin Panel

### Map: Request Layer

Toggle in push-panel "СЛОИ":
```
☐ Заявки UK
```

Badge markers on buildings with active requests:
- **Blue** [N] — Обычная/Средняя
- **Orange** [N] — Срочная
- **Red** [N] — Критическая

Building popup — "ЗАЯВКИ" section (top 3 by urgency, link to UK).

Data from: `GET /api/integration/request-counts` and `GET /api/integration/building-requests/:externalId`

### Admin Panel: Integration Tab

New tab in admin.html — "Интеграция UK"

**Section 1: Toggle + Status**
```
┌─────────────────────────────────────┐
│ Интеграция с UK                     │
│                                     │
│ [  ● ВКЛ  /  ○ ВЫКЛ  ]            │
│                                     │
│ Статус: ● Подключено                │
│ UK API: http://uk-api:8085/api/v2   │
│ Последняя синхронизация: 2 мин назад│
└─────────────────────────────────────┘
```

**Section 2: Настройки**
```
┌─────────────────────────────────────┐
│ UK API URL:    [________________]   │  ← editable, saved to DB
│ UK Frontend URL:[_______________]   │  ← editable, saved to DB
│                                     │
│ Секреты (из переменных окружения):  │
│ Webhook Secret: ●●●●●●●● [✎]      │  ← masked, write-only
│ Логин сервиса:  ●●●●●●●● [✎]      │  ← masked, write-only
│ Пароль сервиса: ●●●●●●●● [✎]      │  ← masked, write-only
│                                     │
│ [Проверить подключение] [Сохранить] │
└─────────────────────────────────────┘
```

**Note on secrets:** Webhook secret and service credentials are read from env vars (`UK_WEBHOOK_SECRET`, `UK_SERVICE_USER`, `UK_SERVICE_PASSWORD`). Admin UI shows masked values and cannot read them. The [✎] button opens a modal to set a new value — this updates the env var at runtime (in-memory override only, persists until restart; for permanent change, update `.env` file).

**Section 3: Правила маппинга**
```
┌──────────────────────────────────────────────────┐
│ Правила: Алерт → Заявка                          │
│                                                  │
│ ☑ TRANSFORMER_OVERLOAD / WARNING → Электрика/Средняя    │
│ ☑ TRANSFORMER_OVERLOAD / CRITICAL → Электрика/Критическая│
│ ☐ VOLTAGE_ANOMALY / WARNING → Электрика/Обычная         │
│ ...                                              │
│ [+ Добавить правило]                             │
└──────────────────────────────────────────────────┘
```

**Section 4: Лог интеграции**
```
┌──────────────────────────────────────────────────────────┐
│ Лог интеграции                     [Фильтры ▼]          │
│                                                          │
│ Время          Направление  Тип       Действие   Статус  │
│ 14:30:05       → UK        alert     create      ✅      │
│ 14:29:58       ← UK        request   status      ✅      │
│ 14:25:12       ← UK        building  created     ✅      │
│ 14:20:03       → UK        alert     create      ❌      │
│                                      [↻ Повторить]       │
│                                                          │
│ Показано 20 из 156  [← Пред] [След →]                    │
│                                                          │
│ Фильтры: направление, тип, статус, период                │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Webhook Security

- HMAC-SHA256 signature in `X-Webhook-Signature` header
- Shared secret read from env var `UK_WEBHOOK_SECRET` (never stored in DB)
- Replay protection: reject timestamp >5 minutes old
- Webhook routes added to public allowlist in `src/routes/index.js` (no JWT, HMAC instead)

---

## 9. Error Handling

- Retry: 3 attempts, exponential backoff (1s, 5s, 25s)
- After 3 failures: `status = 'failed'` in integration_log
- Admin can retry failed entries from log UI
- If UK unreachable: InfraSafe works normally, alert created without request, logged as error
- v1 single-instance: sequential processing per alert_id (in-memory). Horizontal scaling needs DB locks.

---

## 10. Changes to UK (~/Code/UK)

1. **DB migration (Alembic):** Add `external_id UUID UNIQUE` to `buildings`
2. **Webhook sender:** On building CRUD → POST to InfraSafe `/api/webhooks/uk/building`
3. **Webhook sender:** On request create/status change → POST to InfraSafe `/api/webhooks/uk/request`
4. **Webhook endpoint:** `PUT /api/v2/addresses/buildings/{id}` — accept external_id from InfraSafe
5. **Idempotency:** Support `X-Idempotency-Key` header on `POST /api/v2/requests/create`
6. **Config:** `INFRASAFE_WEBHOOK_URL`, `INFRASAFE_WEBHOOK_SECRET` env vars

---

## 11. Environment Variables (InfraSafe additions)

```bash
# Non-sensitive (also editable via admin UI, DB overrides env)
UK_API_URL=http://uk-api:8085/api/v2
UK_FRONTEND_URL=https://uk.domain.com
UK_INTEGRATION_ENABLED=false          # initial state, toggleable via admin

# Sensitive (env-only, never stored in DB, masked in admin UI)
UK_WEBHOOK_SECRET=<shared_secret>
UK_SERVICE_USER=bridge-service
UK_SERVICE_PASSWORD=<strong_password>
```

**Priority:** For non-sensitive settings, admin UI (integration_config table) overrides env vars. Sensitive settings are always from env vars only.

---

## 12. Phased Implementation

### Phase 1: Integration Foundation
- DB migration (external_id, new tables)
- IntegrationConfig, IntegrationLog models
- ukIntegrationService scaffold (isEnabled, config CRUD, logging)
- Webhook routes with HMAC verification
- Integration routes (config, logs)
- Admin UI: integration tab with toggle + settings + log viewer
- **Deliverable:** Admin can enable/disable integration, view logs

### Phase 2: Building Sync (UK → InfraSafe)
- Building webhook handler in ukIntegrationService
- External ID generation and storage
- Field ownership logic (merge UK fields, preserve InfraSafe fields)
- UK changes: webhook sender on building CRUD, external_id endpoint
- **Deliverable:** Buildings from UK auto-appear in InfraSafe

### Phase 3: Alert → Request Pipeline
- AlertRule model + CRUD API + admin UI section
- Alert-to-request mapping engine in ukIntegrationService
- Building ID resolution (direct SQL queries)
- UK API client (JWT auth, request creation, idempotency)
- Hook into alertService.sendNotifications()
- alert_request_map tracking
- **Deliverable:** Alerts auto-create UK requests

### Phase 4: Request → Alert Feedback
- Request webhook handler in ukIntegrationService
- Status mapping logic
- Alert resolution (all-requests-terminal check)
- UK changes: webhook sender on request status change
- **Deliverable:** Closing request in UK closes alert in InfraSafe

### Phase 5: Map Layer
- Request counts + building requests endpoints in integrationRoutes
- Caching (60s TTL, invalidated on webhooks)
- Leaflet layer "Заявки UK" with badge markers
- Building popup requests section
- Building dedup by building_id for markers
- **Deliverable:** Requests visible on InfraSafe map

### Dependencies
```
Phase 1 ← Phase 2 ← Phase 3 ← Phase 4
                  ↖ Phase 5 (after Phase 2)
```

---

## 13. Out of Scope (Future)

- SSO between systems
- UK Kanban embedding in InfraSafe admin
- Heat map of request density
- Telegram notifications from InfraSafe alerts
- Bulk historical building sync
- Integer FK transformer resolution (primary_transformer_id/backup_transformer_id)
