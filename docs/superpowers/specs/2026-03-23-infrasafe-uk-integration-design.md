# InfraSafe ↔ UK Integration Design

> **Status:** APPROVED (2026-03-23)

**Goal:** Full bidirectional integration between InfraSafe (IoT monitoring) and UK (ticket management) — shared building identity, automatic ticket creation from alerts, status feedback, and request visualization on InfraSafe map.

**Systems:**
- **InfraSafe** — Node.js/Express, PostgreSQL/PostGIS, Leaflet map, port 3000
- **UK** — Python/FastAPI + aiogram Telegram bot, PostgreSQL, Redis, port 8085
- **Integration Bridge** — Node.js/Express, PostgreSQL, port 3100 (new)

---

## 1. Architecture

### High-Level Diagram

```
┌─────────────┐     webhooks      ┌──────────────────┐     webhooks      ┌─────────────┐
│  InfraSafe  │ ──────────────►  │  Integration      │ ──────────────►  │     UK      │
│  (Node.js)  │ ◄──────────────  │  Bridge           │ ◄──────────────  │  (FastAPI)  │
│  port 3000  │                  │  (Node.js/Express) │                  │  port 8085  │
└──────┬──────┘                  │  port 3100         │                  └──────┬──────┘
       │                         └────────┬───────────┘                         │
       │                                  │                                     │
   PostgreSQL                        PostgreSQL                            PostgreSQL
   (InfraSafe DB)                   (Bridge DB)                           (UK DB)
```

### Key Principles

- **Bridge as sole integration point** — InfraSafe and UK do not know about each other directly, only about the Bridge
- **Event-driven sync** — webhooks on entity changes, no polling
- **External UUID** — shared `external_id` field in both systems' `buildings` tables for cross-referencing
- **Configurable rules** — admin-managed mapping of alert types to request categories/urgencies
- **Service-to-service auth** — Bridge authenticates to InfraSafe and UK via dedicated service accounts with JWT tokens
- **Idempotent webhooks** — every webhook includes `event_id` (UUID); Bridge deduplicates via sync_log before processing
- **Webhook versioning** — all payloads include `"version": "1.0"` for future contract evolution

### Data Flows

1. **Building sync (UK → InfraSafe)** — building CRUD in UK → webhook to Bridge → Bridge creates/updates building in InfraSafe with external_id
2. **Alert → Request (InfraSafe → UK)** — alert created in InfraSafe → webhook to Bridge → Bridge checks rules → creates request in UK
3. **Request → Alert (UK → InfraSafe)** — request status change in UK → webhook to Bridge → Bridge updates alert status in InfraSafe
4. **Request counts (Bridge → InfraSafe)** — InfraSafe queries Bridge for request aggregates per building for map layer display

---

## 2. Building Sync

### Direction

**UK is the source of truth for buildings.** Buildings are created/managed in UK and synced to InfraSafe through the Bridge. InfraSafe does not create buildings — it receives them.

### External ID Strategy

Both systems add an `external_id UUID` column to their `buildings` table. The Bridge generates this UUID on first sync and maintains the mapping.

```sql
-- InfraSafe migration
ALTER TABLE buildings ADD COLUMN external_id UUID UNIQUE;

-- UK migration (Alembic)
-- ALTER TABLE buildings ADD COLUMN external_id UUID UNIQUE;
```

### Bridge DB — building_map

```sql
CREATE TABLE building_map (
    id                    SERIAL PRIMARY KEY,
    external_id           UUID NOT NULL UNIQUE,
    uk_building_id        INTEGER NOT NULL UNIQUE,   -- 1:1 mapping, prevents duplicate rows per UK building
    infrasafe_building_id INTEGER UNIQUE,             -- NULL until created in InfraSafe; UNIQUE prevents duplicate rows
    synced_at             TIMESTAMPTZ,
    sync_status           VARCHAR(20) DEFAULT 'pending'  -- pending | synced | error | deleted
);
```

### Webhook Contract (UK → Bridge)

```json
POST /webhooks/uk/building
{
  "version": "1.0",
  "event_id": "uuid-v4",
  "event": "building.created | building.updated | building.deleted",
  "building": {
    "id": 15,
    "name": "Дом 42",
    "address": "ул. Навои, 42",
    "town": "Ташкент",
    "contacts": "...",
    "yard_id": 3,
    "yard_name": "Двор Навои"
  },
  "timestamp": "2026-03-23T14:30:00Z"
}
```

**Signature:** Sent in `X-Webhook-Signature` header (HMAC-SHA256 of raw JSON body), never in the payload itself.

**Note:** `town` is required by InfraSafe schema. `latitude`/`longitude` are optional — if not provided by UK, Bridge creates building without coordinates; admin can set them later in InfraSafe. InfraSafe migration relaxes `latitude`/`longitude` NOT NULL constraints.

**Buildings without coordinates on the map:** Frontend must skip buildings with NULL lat/lng when rendering markers (`L.circleMarker` with `parseFloat(null)` = NaN would crash). The map layer rendering code must add a guard: `if (!latitude || !longitude) skip`. Such buildings appear only in admin panel list, not on the map, until coordinates are set.

### Handling `building.deleted`

When Bridge receives `building.deleted`:
1. Bridge sets `sync_status = 'deleted'` in building_map (soft delete)
2. Bridge does NOT delete the building in InfraSafe (it may have controllers, metrics, alerts)
3. Bridge logs the event in sync_log
4. Future: admin can manually remove orphaned buildings in InfraSafe

### Building Field Ownership

When a building is synced from UK, certain fields are managed by UK (read-only in InfraSafe), while others are InfraSafe-only:

| Field | Owner | Notes |
| --- | --- | --- |
| `name`, `address`, `town` | UK | Overwritten on each sync from UK |
| `latitude`, `longitude` | InfraSafe | Set by admin in InfraSafe after sync; UK does not provide geo |
| `external_id` | Bridge | Generated by Bridge, set in both systems |
| `region`, `management_company` | InfraSafe | InfraSafe-specific metadata |
| `has_hot_water` | InfraSafe | Infrastructure-specific, set by InfraSafe admin |
| `controllers`, `metrics`, `alerts` | InfraSafe | InfraSafe-only entities, never synced |

**Note:** `floors`, `entrances`, `apartments`, `construction_year` appear in `queryValidation.js` whitelist but do NOT exist in the actual database schema. These phantom fields should be cleaned up during Phase 2 migration but are NOT part of the sync contract.

**On `building.updated` from UK:** Bridge updates only UK-owned fields in InfraSafe via `PUT /api/buildings/:id` (no PATCH route exists). Bridge first reads current building data via `GET /api/buildings/:id`, merges UK-owned fields over it, then sends full PUT. This GET-merge-PUT pattern preserves InfraSafe-owned fields (coordinates, region, etc.).

### Sync Flow

1. UK creates building → sends webhook to Bridge
2. Bridge checks idempotency: lookup `event_id` in sync_log, skip if exists
3. Bridge generates external_id (UUID v4)
4. Bridge calls InfraSafe `POST /api/buildings` with building data + external_id
5. Bridge stores mapping in building_map
6. Bridge sends external_id back to UK via `PUT /api/v2/addresses/buildings/{id}` (updates external_id field)

---

## 3. Alert → Request Pipeline

### Configurable Rules

Admin configures which alerts create requests and how they map:

```sql
CREATE TABLE alert_rules (
    id              SERIAL PRIMARY KEY,
    alert_type      VARCHAR(100) NOT NULL,    -- TRANSFORMER_OVERLOAD, LEAK_DETECTED, etc.
    severity        VARCHAR(20) NOT NULL,      -- WARNING, CRITICAL
    enabled         BOOLEAN DEFAULT true,
    uk_category     VARCHAR(50) NOT NULL,      -- Электрика, Сантехника, Отопление...
    uk_urgency      VARCHAR(50) NOT NULL,      -- Обычная, Средняя, Срочная, Критическая
    auto_create     BOOLEAN DEFAULT true,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Alert-Request Mapping

```sql
CREATE TABLE alert_request_map (
    id                    SERIAL PRIMARY KEY,
    infrasafe_alert_id    INTEGER NOT NULL,
    uk_request_number     VARCHAR(20),         -- "YYMMDD-NNN" format
    external_id           UUID,                -- building external_id
    idempotency_key       UUID UNIQUE,         -- prevents duplicate request creation on retry
    status                VARCHAR(20) DEFAULT 'active',  -- active | resolved | closed
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(infrasafe_alert_id, external_id)    -- one request per alert per building
);
```

### Webhook Contract (InfraSafe → Bridge)

```json
POST /webhooks/infrasafe/alert
{
  "version": "1.0",
  "event_id": "uuid-v4",
  "event": "alert.created | alert.acknowledged | alert.resolved",
  "alert": {
    "alert_id": 42,
    "type": "TRANSFORMER_OVERLOAD",
    "severity": "CRITICAL",
    "infrastructure_type": "transformer",
    "infrastructure_id": 5,
    "message": "Трансформатор перегружен на 95%",
    "building_ids": [3, 7, 12],
    "data": { "load_percent": 95.2 }
  },
  "timestamp": "2026-03-23T14:30:00Z"
}
```

**Signature:** Sent in `X-Webhook-Signature` header (HMAC-SHA256 of raw JSON body), never in the payload itself.

**Resolving `building_ids`:** The current `infrastructure_alerts` table stores only `affected_buildings` (integer count), not specific IDs. The webhook sender in `alertService.sendNotifications()` must resolve building IDs by querying the infrastructure relationship. Concrete resolution per `infrastructure_type`:

| infrastructure_type | Query path | Notes |
| --- | --- | --- |
| `transformer` | `SELECT building_id FROM buildings WHERE power_transformer_id = :id` | `infrastructure_id` is `power_transformers.id` (VARCHAR). The only safe FK to match is `power_transformer_id VARCHAR(50)` — same type, same ID space, used by analytics (`b.power_transformer_id = pt.id`). The INTEGER columns `primary_transformer_id`/`backup_transformer_id` reference a different ID space and cannot be safely cast from varchar IDs like `'TR-001'`. If integer-FK buildings also need resolution, that requires a separate join through a mapping or normalization — **out of scope for v1**, flag for Phase 3 implementation. |
| `controller` | `SELECT building_id FROM controllers WHERE controller_id = :id` | FK column is `building_id`, PK is `controller_id` (not `id`) |
| `water_source` | `SELECT building_id FROM buildings WHERE cold_water_source_id = :id` | Buildings have `cold_water_source_id` varchar FK |
| `heat_source` | `SELECT building_id FROM buildings WHERE heat_source_id = :id` | Buildings have `heat_source_id` varchar FK |

**Schema clarification:** The `power_transformers` table (used by `analyticsService.js` and alerts) has `id VARCHAR(50)` as PK. Buildings reference them through THREE columns: `power_transformer_id VARCHAR(50)` (legacy, used by analytics), `primary_transformer_id INTEGER`, `backup_transformer_id INTEGER`. The integer columns reference a different ID space (possibly a separate `transformers` table or denormalized integer IDs). **v1 resolution uses only `power_transformer_id` (varchar-to-varchar match).** Extending to integer FK columns requires schema investigation during Phase 3 implementation.

The resolved array is included in the webhook payload, not stored in the alerts table.

### Alert-to-Request Cardinality

When an alert affects multiple buildings (`building_ids: [3, 7, 12]`):
- Bridge creates **one UK request per building** — each building may need separate maintenance
- `alert_request_map` supports multiple rows per `infrasafe_alert_id`
- Alert is resolved only when **all** related requests reach terminal status (Принято/Отменена)

### Pipeline Flow

1. InfraSafe creates alert → `alertService.sendNotifications()` resolves building IDs and sends webhook to Bridge
2. Bridge checks idempotency: lookup `event_id` in sync_log, skip if exists
3. Bridge looks up alert_rules for matching `alert_type` + `severity`
4. If rule found and enabled:
   a. Resolve building external_ids from building_ids via building_map
   b. For each building: generate `idempotency_key` (UUID), insert row in alert_request_map, call UK `POST /api/v2/requests/create` with mapped category + urgency + idempotency_key in `X-Idempotency-Key` header
   c. On success: update alert_request_map with `uk_request_number` from response
   d. On retry: same idempotency_key prevents duplicate request creation in UK
5. If no rule or disabled — log and skip

### Default Rules (seeded)

| Alert Type | Severity | UK Category | UK Urgency |
|---|---|---|---|
| TRANSFORMER_OVERLOAD | WARNING | Электрика | Средняя |
| TRANSFORMER_OVERLOAD | CRITICAL | Электрика | Критическая |
| TRANSFORMER_CRITICAL_OVERLOAD | CRITICAL | Электрика | Критическая |
| LEAK_DETECTED | WARNING | Сантехника | Срочная |
| LEAK_DETECTED | CRITICAL | Сантехника | Критическая |
| VOLTAGE_ANOMALY | WARNING | Электрика | Обычная |
| HEATING_FAILURE | CRITICAL | Отопление | Критическая |

---

## 4. Request → Alert Feedback

### Status Mapping

```
UK Request Status    →   Bridge Action           →   InfraSafe Alert
─────────────────────────────────────────────────────────────────────
В работе             →   log status              →   (no change)
Закуп                →   log status              →   (no change)
Уточнение            →   log status              →   (no change)
Выполнена            →   log status              →   (no change)
Исполнено            →   log status              →   (no change)
Принято              →   resolve alert           →   resolved
Отменена             →   resolve alert           →   resolved
```

**Note:** "Исполнено" (verified by manager) does NOT map to `acknowledged` — it's still in review by the requester and may be returned. Alert is only resolved on final states (Принято/Отменена). This avoids premature status changes.

### Webhook Contract (UK → Bridge)

```json
POST /webhooks/uk/request
{
  "version": "1.0",
  "event_id": "uuid-v4",
  "event": "request.created | request.status_changed",
  "request": {
    "request_number": "260323-015",
    "status": "Принято",
    "building_id": 15,
    "category": "Электрика",
    "urgency": "Срочная"
  },
  "previous_status": "Исполнено",
  "timestamp": "2026-03-23T14:30:00Z"
}
```

**Signature:** Sent in `X-Webhook-Signature` header (HMAC-SHA256 of raw JSON body), never in the payload itself.

**Note:** `request.created` event is also sent — Bridge uses it to invalidate request-counts cache (Section 5) even for manually created requests.

### Feedback Flow

1. UK changes request status → sends webhook to Bridge
2. Bridge checks idempotency: lookup `event_id` in sync_log, skip if exists
3. Bridge looks up alert_request_map by uk_request_number
4. If no mapping exists (manually created request) — log, invalidate cache, skip alert update
5. If mapping exists and status is terminal (Принято/Отменена):
   a. Update alert_request_map status to "resolved"
   b. Check if ALL alert_request_map rows for this `infrasafe_alert_id` are resolved
   c. If all resolved → call InfraSafe `PATCH /api/alerts/{alertId}/resolve`
   d. If not all resolved → log, wait for remaining requests
6. On `request.created` or `request.status_changed` → invalidate request-counts cache

---

## 5. UI — Request Layer on InfraSafe Map

### Map Layer Toggle

New toggle in push-panel "СЛОИ" tab:

```
☑ Здания
☑ Трансформаторы
☑ Линии электропередач
☐ Заявки UK              ← new layer
```

### Badge Markers

When layer enabled, buildings with active requests show a badge:

- **Blue badge** [N] — only Обычная/Средняя urgency
- **Orange badge** [N] — has Срочная requests
- **Red badge** [N] — has Критическая requests

Badge color = max urgency among active requests.

### Building Popup — Requests Section

Added below existing metrics in building popup:

```
📋 ЗАЯВКИ (5 активных)

  🔴 260323-015 Электрика
     Срочная · В работе
  🟡 260322-008 Сантехника
     Средняя · Новая
  🔵 260321-003 Отопление
     Обычная · В работе

  + ещё 2 заявки

  [Открыть в UK →]
```

- Max 3 requests shown (sorted by urgency desc)
- "Открыть в UK" links to UK Kanban filtered by building
- Urgency indicators: 🔴 Критическая, 🟠 Срочная, 🟡 Средняя, 🔵 Обычная

### Bridge API for Map Data

**Aggregated counts (for layer rendering):**

```
GET /api/request-counts?external_ids=uuid1,uuid2,uuid3

{
  "buildings": {
    "ext-uuid-1": {
      "total": 5,
      "max_urgency": "Срочная",
      "by_status": { "Новая": 1, "В работе": 3, "Выполнена": 1 }
    },
    "ext-uuid-2": { "total": 0 }
  },
  "cached_at": "2026-03-23T14:30:00Z"
}
```

**Detailed requests (for popup, on click):**

```
GET /api/building-requests/{external_id}?limit=3&sort=urgency

{
  "requests": [
    {
      "request_number": "260323-015",
      "category": "Электрика",
      "urgency": "Срочная",
      "status": "В работе",
      "created_at": "2026-03-23T10:15:00Z"
    }
  ],
  "total": 5,
  "uk_url": "https://uk.domain.com/kanban?building=15"
}
```

**Caching:** Bridge caches request-counts with 60s TTL. Invalidated on `request.created` and `request.status_changed` webhooks from UK.

**Frontend external_id access:** InfraSafe frontend receives `external_id` as part of building data from `GET /buildings-metrics`. The field is included in the API response after the migration adds it to the buildings table.

**Bridge API access from frontend:** The frontend uses a single `apiBaseUrl = window.BACKEND_URL || '/api'` for all requests (`map-layers-control.js:9`). Bridge API runs on a different port (3100). Two options:

- **Chosen: Nginx proxy** — add `/bridge/*` location in Nginx config that proxies to `bridge:3100`. Frontend calls `/bridge/api/request-counts` etc. No second base URL needed, no CORS issues.
- Rejected: separate `window.BRIDGE_URL` — would require CORS config and duplicate auth logic.

**Browser → Bridge auth:** Bridge map-data endpoints (`/api/request-counts`, `/api/building-requests/:id`) are public (no auth required) — they return only aggregate counts and request summaries, no sensitive data. The Bridge CRUD endpoints (`/api/alert-rules`) require the InfraSafe JWT token passed in `Authorization` header — Nginx proxies it through transparently. Bridge validates the JWT by calling InfraSafe's `/api/auth/verify` (or by sharing the same `JWT_SECRET` env var for local verification).

Nginx config addition:
```nginx
location /bridge/ {
    proxy_pass http://bridge:3100/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## 6. Service-to-Service Authentication

### Bridge → InfraSafe

Bridge uses a dedicated service account (`bridge-service`) with `admin` role, created during Phase 1 setup:
- Bridge calls `POST /api/auth/login` on startup to obtain JWT
- Caches token, refreshes via `POST /api/auth/refresh` before expiry
- Uses JWT in `Authorization: Bearer <token>` header for all InfraSafe API calls

### Bridge → UK

Bridge uses a dedicated service account with `manager` role in UK:
- Bridge calls `POST /api/v2/auth/password` on startup to obtain JWT
- Same caching/refresh pattern
- Uses JWT for all UK API calls (creating requests, updating buildings)

### Webhook Signature (both directions)

All webhooks use HMAC-SHA256 signature verification:

- Shared secret per system pair (Bridge↔InfraSafe, Bridge↔UK)
- Signature in `X-Webhook-Signature` header
- Payload = raw JSON body
- Bridge verifies signature before processing
- Replay protection: `timestamp` field, reject if >5 minutes old

---

## 7. Error Handling & Retry Policy

### Webhook Delivery Failures

When Bridge fails to call InfraSafe or UK API:
1. Log error in sync_log with `status = 'error'`
2. Retry up to 3 times with exponential backoff (1s, 5s, 25s)
3. After 3 failures: mark sync_log as `status = 'failed'`, log warning
4. No dead letter queue in v1 — admin can query sync_log for failed entries and trigger manual retry

### Race Condition: alert.resolved before request created

If `alert.resolved` arrives while `alert.created` is still being processed:
- Bridge processes webhooks sequentially per `infrasafe_alert_id` (in-memory queue)
- `alert.resolved` waits until `alert.created` completes
- If no mapping exists for `alert.resolved` — log and skip (alert was transient, no request needed)

**v1 limitation:** In-memory queue works only with a single Bridge instance. This is an intentional v1 constraint — Bridge is deployed as a single container. Horizontal scaling would require a database-level advisory lock or external job queue (e.g., BullMQ + Redis).

### Rate Limiting on Bridge

- Webhook endpoints: 100 req/min per source IP
- API endpoints (request-counts, building-requests): 60 req/min per client
- Rate limit headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## 8. Sync Log

All Bridge operations logged for debugging and audit:

```sql
CREATE TABLE sync_log (
    id              SERIAL PRIMARY KEY,
    event_id        UUID UNIQUE,             -- webhook event_id for idempotency dedup
    direction       VARCHAR(30) NOT NULL,    -- uk_to_infrasafe | infrasafe_to_uk
    entity_type     VARCHAR(20) NOT NULL,    -- building | alert | request
    entity_id       VARCHAR(50),
    action          VARCHAR(20) NOT NULL,    -- create | update | status_change
    payload         JSONB,
    status          VARCHAR(20) DEFAULT 'success',  -- success | error | retry | failed
    error_message   TEXT,
    retry_count     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_log_event_id ON sync_log(event_id);
CREATE INDEX idx_sync_log_status ON sync_log(status) WHERE status IN ('error', 'failed');
```

**Idempotency check:** Before processing any webhook, Bridge does `SELECT 1 FROM sync_log WHERE event_id = :event_id AND status = 'success'`. If found — return 200 OK without reprocessing.

---

## 9. Changes Required in Existing Systems

### InfraSafe (this repo)

1. **DB migration:** Add `external_id UUID UNIQUE` column to `buildings` table; relax `latitude`/`longitude` NOT NULL constraints to allow buildings synced from UK without coordinates
2. **validators.js:** Update building validation — `latitude`/`longitude` become optional; add `external_id` as optional UUID field
3. **Building model (`src/models/Building.js`):** Add `external_id` to SELECT/INSERT/UPDATE queries (currently not read/written)
4. **Nginx config:** Add `/bridge/` proxy location pointing to bridge:3100
5. **alertService.js:** Implement `sendWebhookNotification()` — resolve building IDs from infrastructure relationships (see Section 3 table), POST alert events to Bridge with HMAC signature
6. **buildingMetricsService.js:** Include `external_id` in response so frontend can pass it to Bridge API
7. **Frontend (script.js):** New "Заявки UK" layer with badge markers and popup section; deduplicate buildings by `building_id` (current map renders one marker per controller row — buildings with multiple controllers would get duplicate badges); skip buildings with NULL lat/lng
8. **Frontend (map-layers-control.js):** Add layer toggle
9. **Docker Compose:** Add bridge service container
10. **Note:** No PATCH route needed — Bridge uses GET-merge-PUT pattern with existing `PUT /api/buildings/:id`

### UK (~/Code/UK)

1. **DB migration (Alembic):** Add `external_id UUID` column to `buildings` table
2. **Webhook sender:** On building CRUD → POST to Bridge
3. **Webhook sender:** On request status change → POST to Bridge
4. **Webhook endpoint:** Receive external_id update from Bridge
5. **Config:** Add BRIDGE_URL, BRIDGE_WEBHOOK_SECRET environment variables

### Integration Bridge (new service)

- Full new Node.js/Express service (see Phases below)

### Bridge Environment Variables

```bash
# Required
PORT=3100
NODE_ENV=development|production
DB_HOST=bridge-postgres
DB_PORT=5432
DB_NAME=integration_bridge
DB_USER=bridge
DB_PASSWORD=<strong_password>

# InfraSafe connection
INFRASAFE_API_URL=http://app:3000/api
INFRASAFE_SERVICE_USER=bridge-service
INFRASAFE_SERVICE_PASSWORD=<strong_password>
INFRASAFE_WEBHOOK_SECRET=<shared_secret_1>

# UK connection
UK_API_URL=http://uk-api:8085/api/v2
UK_SERVICE_USER=bridge-service
UK_SERVICE_PASSWORD=<strong_password>
UK_WEBHOOK_SECRET=<shared_secret_2>

# UK frontend (for generating links in popups)
UK_FRONTEND_URL=https://uk.domain.com

# Optional
LOG_LEVEL=info|debug|warn|error
CACHE_TTL=60                    # seconds, for request-counts
WEBHOOK_RETRY_MAX=3
WEBHOOK_RETRY_BASE_DELAY=1000   # ms
```

---

## 10. Phased Implementation

### Phase 1: Integration Bridge — Service Scaffold
- Express app, Docker container, Bridge DB (PostgreSQL)
- Webhook receiver with HMAC verification
- Service-to-service JWT auth client (login + refresh caching)
- Healthcheck (`GET /health`), logging (Winston), correlation ID
- Rate limiting middleware
- Docker Compose integration with InfraSafe
- Bridge service account creation in InfraSafe (admin role) and UK (manager role)
- **Deliverable:** Running empty service with infrastructure

### Phase 2: Building Sync (UK → InfraSafe)
- InfraSafe DB migration: add `external_id UUID` to buildings, relax lat/lng NOT NULL
- UK DB migration (Alembic): add `external_id UUID` to buildings
- Webhook endpoint: `POST /webhooks/uk/building`
- building_map table, external_id generation
- Idempotent webhook processing (event_id dedup)
- InfraSafe API client: create/update buildings
- UK webhook sender (building CRUD events)
- UK webhook receiver (external_id update)
- building.deleted handling (soft delete in mapping)
- Sync log, retry on errors (3 retries, exponential backoff)
- **Deliverable:** Buildings from UK auto-appear in InfraSafe
- **Note:** This phase spans 3 repos (Bridge, InfraSafe, UK)

### Phase 3: Alert → Request Pipeline
- Webhook endpoint: `POST /webhooks/infrasafe/alert`
- alert_rules table with CRUD API (`GET/POST/PUT/DELETE /api/alert-rules`)
- Default rules seeded (see Section 3)
- Alert type → category/urgency mapping engine
- Building ID resolution from infrastructure relationships
- One request per affected building (multi-building alerts)
- UK API client: create requests
- alert_request_map tracking (multiple rows per alert)
- InfraSafe webhook sender in alertService.sendNotifications()
- Sequential processing per alert_id (race condition prevention)
- **Deliverable:** InfraSafe alerts auto-create UK requests

### Phase 4: Request → Alert Feedback
- Webhook endpoint: `POST /webhooks/uk/request`
- Status mapping (Принято/Отменена → resolved)
- InfraSafe API client: acknowledge/resolve alerts
- UK webhook sender on request status change
- **Deliverable:** Closing request in UK closes alert in InfraSafe

### Phase 5: UI — Request Layer on Map
- Bridge API: request-counts (by external_ids), building-requests (with caching)
- Cache invalidation on request.created and request.status_changed
- Leaflet layer "Заявки UK" in push-panel
- Badge markers on buildings (color by max urgency)
- Requests section in building popup (top 3 by urgency)
- Link to UK Kanban (configurable base URL via `UK_FRONTEND_URL` env var)
- **Deliverable:** Requests visible on InfraSafe map

### Dependencies

```
Phase 1 ← Phase 2 ← Phase 3 ← Phase 4
                  ↖ Phase 5 (can start after Phase 2)
```

---

## 11. Out of Scope (Future)

- Shared user authentication (SSO) between systems
- UK Kanban embedding inside InfraSafe admin panel
- Heat map visualization of request density
- Push notifications (Telegram) from InfraSafe alerts
- Bulk historical sync of existing buildings
- Admin UI for alert_rules management (Phase 3 provides API only)
