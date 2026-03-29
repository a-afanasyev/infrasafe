# UK Integration Phase 2: Building Sync (UK → InfraSafe) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When UK sends a building webhook (created/updated/deleted), InfraSafe processes it — creating new buildings with `external_id`, merging UK fields on update (preserving InfraSafe-only fields like lat/lng), and soft-deleting on removal. Plus P2 security hardening (rate limiting, input validation, enum whitelists).

**Architecture:** Extend `ukIntegrationService.js` with `handleBuildingWebhook(payload)` method. Add `Building.findByExternalId()` and `Building.updateFromUK()` to the Building model. Update `webhookRoutes.js` `/building` handler to call the service method instead of just logging. Add security hardening (rate limiting on webhooks, UUID validation, enum whitelists).

**Tech Stack:** Node.js/Express, PostgreSQL, Jest, crypto (UUID validation).

**Spec:** `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md` — Section 4 "Building Sync"

---

## File Structure

### Files to modify
| File | Changes |
| --- | --- |
| `src/models/Building.js` | Add `findByExternalId(uuid)`, `createFromUK(data)`, `updateFromUK(id, data)`, `softDelete(id)` |
| `src/services/ukIntegrationService.js` | Add `handleBuildingWebhook(payload)` with create/update/delete logic |
| `src/routes/webhookRoutes.js` | Replace log-only handler with real `handleBuildingWebhook` call |
| `src/routes/integrationRoutes.js` | Add rate limiter, enum whitelist validation for filters |
| `src/routes/index.js` | No changes needed (routes already mounted) |

### Files to create
| File | Responsibility |
| --- | --- |
| `src/utils/webhookValidation.js` | UUID format validation, enum whitelists for webhook/filter params |
| `tests/jest/unit/buildingSync.test.js` | Tests for Building model UK methods + ukIntegrationService.handleBuildingWebhook |
| `tests/jest/unit/webhookValidation.test.js` | Tests for UUID validation and enum whitelists |

---

## Task 1: Webhook Input Validation Utilities

**Files:**
- Create: `src/utils/webhookValidation.js`
- Create: `tests/jest/unit/webhookValidation.test.js`

- [ ] **Step 1: Write failing tests for UUID validation and enum whitelists**

```javascript
// tests/jest/unit/webhookValidation.test.js
'use strict';

const { isValidUUID, isValidDirection, isValidStatus, isValidEntityType, isValidBuildingEvent } = require('../../../src/utils/webhookValidation');

describe('webhookValidation', () => {
    describe('isValidUUID', () => {
        it('accepts valid v4 UUID', () => {
            expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
        });
        it('rejects empty string', () => {
            expect(isValidUUID('')).toBe(false);
        });
        it('rejects non-UUID string', () => {
            expect(isValidUUID('not-a-uuid')).toBe(false);
        });
        it('rejects null/undefined', () => {
            expect(isValidUUID(null)).toBe(false);
            expect(isValidUUID(undefined)).toBe(false);
        });
        it('rejects UUID with wrong length', () => {
            expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
        });
    });

    describe('isValidDirection', () => {
        it('accepts from_uk', () => {
            expect(isValidDirection('from_uk')).toBe(true);
        });
        it('accepts to_uk', () => {
            expect(isValidDirection('to_uk')).toBe(true);
        });
        it('rejects unknown direction', () => {
            expect(isValidDirection('incoming')).toBe(false);
        });
    });

    describe('isValidStatus', () => {
        it('accepts all valid statuses', () => {
            ['pending', 'success', 'error', 'failed'].forEach(s =>
                expect(isValidStatus(s)).toBe(true)
            );
        });
        it('rejects unknown status', () => {
            expect(isValidStatus('unknown')).toBe(false);
        });
    });

    describe('isValidEntityType', () => {
        it('accepts all valid entity types', () => {
            ['building', 'alert', 'request'].forEach(t =>
                expect(isValidEntityType(t)).toBe(true)
            );
        });
        it('rejects unknown type', () => {
            expect(isValidEntityType('user')).toBe(false);
        });
    });

    describe('isValidBuildingEvent', () => {
        it('accepts building.created', () => {
            expect(isValidBuildingEvent('building.created')).toBe(true);
        });
        it('accepts building.updated', () => {
            expect(isValidBuildingEvent('building.updated')).toBe(true);
        });
        it('accepts building.deleted', () => {
            expect(isValidBuildingEvent('building.deleted')).toBe(true);
        });
        it('rejects unknown event', () => {
            expect(isValidBuildingEvent('building.unknown')).toBe(false);
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=webhookValidation`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement webhookValidation.js**

```javascript
// src/utils/webhookValidation.js
'use strict';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DIRECTIONS = ['from_uk', 'to_uk'];
const VALID_STATUSES = ['pending', 'success', 'error', 'failed'];
const VALID_ENTITY_TYPES = ['building', 'alert', 'request'];
const VALID_BUILDING_EVENTS = ['building.created', 'building.updated', 'building.deleted'];
const VALID_REQUEST_EVENTS = ['request.created', 'request.status_changed'];

function isValidUUID(value) {
    if (!value || typeof value !== 'string') return false;
    return UUID_REGEX.test(value);
}

function isValidDirection(value) {
    return VALID_DIRECTIONS.includes(value);
}

function isValidStatus(value) {
    return VALID_STATUSES.includes(value);
}

function isValidEntityType(value) {
    return VALID_ENTITY_TYPES.includes(value);
}

function isValidBuildingEvent(value) {
    return VALID_BUILDING_EVENTS.includes(value);
}

function isValidRequestEvent(value) {
    return VALID_REQUEST_EVENTS.includes(value);
}

module.exports = {
    isValidUUID,
    isValidDirection,
    isValidStatus,
    isValidEntityType,
    isValidBuildingEvent,
    isValidRequestEvent,
    UUID_REGEX,
    VALID_DIRECTIONS,
    VALID_STATUSES,
    VALID_ENTITY_TYPES,
    VALID_BUILDING_EVENTS,
    VALID_REQUEST_EVENTS
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=webhookValidation`
Expected: PASS (all tests in webhookValidation suite)

- [ ] **Step 5: Commit**

```bash
git add src/utils/webhookValidation.js tests/jest/unit/webhookValidation.test.js
git commit -m "feat: add webhook validation utilities (UUID, enum whitelists)"
```

---

## Task 2: Building Model — UK Sync Methods

**Files:**
- Modify: `src/models/Building.js`
- Create: `tests/jest/unit/buildingSync.test.js`

**Context:** The Building model currently has standard CRUD. We need 3 new methods for UK sync:
- `findByExternalId(uuid)` — lookup by `external_id` column (added in migration 011)
- `createFromUK(data)` — create building with `external_id`, only UK-owned fields (name, address, town, contacts), lat/lng NULL
- `updateFromUK(id, ukFields)` — update ONLY UK-owned fields (name, address, town), preserve InfraSafe fields (lat, lng, region, management_company, infrastructure FKs)
- `softDelete(id)` — set `uk_deleted_at = NOW()` instead of deleting

- [ ] **Step 1: Write failing tests for Building UK methods**

```javascript
// tests/jest/unit/buildingSync.test.js
'use strict';

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn(() => ({
        connect: jest.fn()
    }))
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');

describe('Building UK Sync Methods', () => {
    beforeEach(() => jest.clearAllMocks());

    // ---------------------------------------------------------------
    // findByExternalId
    // ---------------------------------------------------------------
    describe('findByExternalId()', () => {
        it('returns building when found', async () => {
            const mockBuilding = { building_id: 5, external_id: 'aaaa-bbbb', name: 'Test' };
            db.query.mockResolvedValue({ rows: [mockBuilding] });

            const result = await Building.findByExternalId('aaaa-bbbb');
            expect(result).toEqual(mockBuilding);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('external_id = $1'),
                ['aaaa-bbbb']
            );
        });

        it('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.findByExternalId('nonexistent');
            expect(result).toBeNull();
        });
    });

    // ---------------------------------------------------------------
    // createFromUK
    // ---------------------------------------------------------------
    describe('createFromUK()', () => {
        it('creates building with external_id and UK fields, lat/lng NULL', async () => {
            const ukData = {
                external_id: 'ext-uuid-123',
                name: 'Дом 42',
                address: 'ул. Навои, 42',
                town: 'Ташкент'
            };
            const created = { building_id: 18, ...ukData, latitude: null, longitude: null };
            db.query.mockResolvedValue({ rows: [created] });

            const result = await Building.createFromUK(ukData);
            expect(result).toEqual(created);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO buildings'),
                expect.arrayContaining(['ext-uuid-123', 'Дом 42', 'ул. Навои, 42', 'Ташкент'])
            );
        });

        it('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate key'));
            await expect(Building.createFromUK({ external_id: 'x' }))
                .rejects.toThrow();
        });
    });

    // ---------------------------------------------------------------
    // updateFromUK
    // ---------------------------------------------------------------
    describe('updateFromUK()', () => {
        it('updates only UK-owned fields (name, address, town)', async () => {
            const updated = { building_id: 5, name: 'New Name', address: 'New Addr', town: 'Ташкент' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Building.updateFromUK(5, {
                name: 'New Name',
                address: 'New Addr',
                town: 'Ташкент'
            });
            expect(result).toEqual(updated);
            // Should NOT include lat/lng/region/management_company in the SET clause
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('name = $1');
            expect(sql).toContain('address = $2');
            expect(sql).toContain('town = $3');
            expect(sql).not.toContain('latitude');
            expect(sql).not.toContain('longitude');
            expect(sql).not.toContain('management_company');
        });

        it('clears uk_deleted_at on update (un-soft-delete)', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5 }] });
            await Building.updateFromUK(5, { name: 'X', address: 'Y', town: 'Z' });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('uk_deleted_at = NULL');
        });

        it('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.updateFromUK(999, { name: 'X' });
            expect(result).toBeNull();
        });
    });

    // ---------------------------------------------------------------
    // softDelete
    // ---------------------------------------------------------------
    describe('softDelete()', () => {
        it('sets uk_deleted_at to current timestamp', async () => {
            const deleted = { building_id: 5, uk_deleted_at: '2026-03-25T10:00:00Z' };
            db.query.mockResolvedValue({ rows: [deleted] });

            const result = await Building.softDelete(5);
            expect(result).toEqual(deleted);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('uk_deleted_at = NOW()'),
                [5]
            );
        });

        it('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.softDelete(999);
            expect(result).toBeNull();
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=buildingSync`
Expected: FAIL (findByExternalId/createFromUK/updateFromUK/softDelete are not defined)

- [ ] **Step 3: Implement Building UK methods**

Add the following methods to `src/models/Building.js` (before `module.exports`):

```javascript
    /**
     * Find a building by external_id (UUID from UK system)
     * @param {string} externalId - UUID external_id
     * @returns {Object|null}
     */
    static async findByExternalId(externalId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM buildings WHERE external_id = $1',
                [externalId]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Building.findByExternalId: ${error.message}`);
            throw createError(`Failed to find building by external_id: ${error.message}`, 500);
        }
    }

    /**
     * Create a building from UK webhook data.
     * Only sets UK-owned fields + external_id. Lat/lng default to NULL.
     * @param {Object} data - { external_id, name, address, town }
     * @returns {Object} Created building
     */
    static async createFromUK(data) {
        try {
            const { external_id, name, address, town } = data;
            const { rows } = await db.query(
                `INSERT INTO buildings (external_id, name, address, town)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [external_id, name, address, town]
            );
            logger.info(`Created building from UK with ID: ${rows[0].building_id}, external_id: ${external_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.createFromUK: ${error.message}`);
            throw createError(`Failed to create building from UK: ${error.message}`, 500);
        }
    }

    /**
     * Update only UK-owned fields on a building. Preserves InfraSafe fields
     * (lat, lng, region, management_company, infrastructure FKs).
     * Also clears uk_deleted_at (un-soft-delete if building was previously removed).
     * @param {number} id - building_id
     * @param {Object} ukFields - { name, address, town }
     * @returns {Object|null} Updated building or null
     */
    static async updateFromUK(id, ukFields) {
        try {
            const { name, address, town } = ukFields;
            const { rows } = await db.query(
                `UPDATE buildings
                 SET name = $1, address = $2, town = $3, uk_deleted_at = NULL
                 WHERE building_id = $4
                 RETURNING *`,
                [name, address, town, id]
            );
            if (!rows.length) return null;
            logger.info(`Updated building ${id} from UK sync`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.updateFromUK: ${error.message}`);
            throw createError(`Failed to update building from UK: ${error.message}`, 500);
        }
    }

    /**
     * Soft-delete a building (set uk_deleted_at = NOW()).
     * Preserves data for historical lookups (controllers, alerts, metrics).
     * @param {number} id - building_id
     * @returns {Object|null} Updated building or null
     */
    static async softDelete(id) {
        try {
            const { rows } = await db.query(
                `UPDATE buildings SET uk_deleted_at = NOW()
                 WHERE building_id = $1
                 RETURNING *`,
                [id]
            );
            if (!rows.length) return null;
            logger.info(`Soft-deleted building ${id} (UK removal)`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.softDelete: ${error.message}`);
            throw createError(`Failed to soft-delete building: ${error.message}`, 500);
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=buildingSync`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/models/Building.js tests/jest/unit/buildingSync.test.js
git commit -m "feat: add Building model UK sync methods (findByExternalId, createFromUK, updateFromUK, softDelete)"
```

---

## Task 3: ukIntegrationService — handleBuildingWebhook

**Files:**
- Modify: `src/services/ukIntegrationService.js`
- Modify: `tests/jest/unit/ukIntegrationService.test.js`

**Context:** The webhook route currently just logs the event. `handleBuildingWebhook` needs to:
1. Validate the building event type
2. Generate `external_id` UUID from UK building.id (deterministic: `uk-building-{id}` namespace)
3. On `building.created`: find by external_id → if not exists, create; if exists, update (idempotent)
4. On `building.updated`: find by external_id → update UK fields; if not exists, create (late-arriving create)
5. On `building.deleted`: find by external_id → soft-delete; if not found, log and ignore
6. Log the integration event

- [ ] **Step 1: Write failing tests for handleBuildingWebhook**

Add to `tests/jest/unit/ukIntegrationService.test.js`. The file already mocks `IntegrationConfig`, `IntegrationLog`, and `logger`. We need to add `Building` mock.

Add after the existing mocks (near top of file):

```javascript
jest.mock('../../../src/models/Building', () => ({
    findByExternalId: jest.fn(),
    createFromUK: jest.fn(),
    updateFromUK: jest.fn(),
    softDelete: jest.fn()
}));

const Building = require('../../../src/models/Building');
```

Add the following describe block inside the main `describe('UKIntegrationService')`:

```javascript
    // ---------------------------------------------------------------
    // handleBuildingWebhook
    // ---------------------------------------------------------------
    describe('handleBuildingWebhook()', () => {
        const basePayload = {
            event_id: '550e8400-e29b-41d4-a716-446655440000',
            event: 'building.created',
            building: { id: 15, name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' },
            timestamp: '2026-03-24T14:30:00Z'
        };

        beforeEach(() => {
            IntegrationLog.create.mockResolvedValue({ id: 1 });
        });

        it('creates a new building on building.created when not exists', async () => {
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(basePayload);

            expect(Building.findByExternalId).toHaveBeenCalled();
            expect(Building.createFromUK).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' })
            );
        });

        it('updates existing building on building.created (idempotent)', async () => {
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.updateFromUK.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(basePayload);

            expect(Building.updateFromUK).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Дом 42' }));
            expect(Building.createFromUK).not.toHaveBeenCalled();
        });

        it('updates building on building.updated', async () => {
            const payload = { ...basePayload, event: 'building.updated' };
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.updateFromUK.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(payload);

            expect(Building.updateFromUK).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Дом 42' }));
        });

        it('creates building on building.updated if not exists (late-arriving create)', async () => {
            const payload = { ...basePayload, event: 'building.updated' };
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(payload);

            expect(Building.createFromUK).toHaveBeenCalled();
        });

        it('soft-deletes building on building.deleted', async () => {
            const payload = { ...basePayload, event: 'building.deleted' };
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.softDelete.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(payload);

            expect(Building.softDelete).toHaveBeenCalledWith(5);
        });

        it('ignores building.deleted when building not found', async () => {
            const payload = { ...basePayload, event: 'building.deleted' };
            Building.findByExternalId.mockResolvedValue(null);

            await service.handleBuildingWebhook(payload);

            expect(Building.softDelete).not.toHaveBeenCalled();
        });

        it('logs integration event on success', async () => {
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(basePayload);

            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    direction: 'from_uk',
                    entity_type: 'building',
                    action: 'building.created',
                    status: 'success'
                })
            );
        });

        it('logs error status and re-throws when processing fails', async () => {
            Building.findByExternalId.mockRejectedValue(new Error('DB down'));

            await expect(service.handleBuildingWebhook(basePayload)).rejects.toThrow('DB down');

            // Verify error was logged to integration_log
            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'error',
                    error_message: 'DB down'
                })
            );
        });

        it('throws on invalid event type', async () => {
            const payload = { ...basePayload, event: 'building.migrated' };

            await expect(service.handleBuildingWebhook(payload))
                .rejects.toThrow('Unknown building event');
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=ukIntegrationService`
Expected: FAIL (handleBuildingWebhook is not a function)

- [ ] **Step 3: Implement handleBuildingWebhook in ukIntegrationService.js**

Add to `src/services/ukIntegrationService.js`:

1. Add requires at top (after existing requires):
```javascript
const Building = require('../models/Building');
const { isValidBuildingEvent } = require('../utils/webhookValidation');
```

2. Add method inside the class (after `isDuplicateEvent`):

```javascript
    /**
     * Generate a deterministic external_id for a UK building.
     * Uses SHA-256 hash of "uk-building-{id}" truncated to UUID format.
     * This is NOT a standard UUID v4/v5 — it is a deterministic hash-based ID
     * used solely for deduplication. The same UK building.id always produces
     * the same external_id, enabling idempotent create/update operations.
     * @param {number} ukBuildingId
     * @returns {string} UUID-formatted string (accepted by PostgreSQL UUID type)
     */
    _generateExternalId(ukBuildingId) {
        const hash = crypto.createHash('sha256').update(`uk-building-${ukBuildingId}`).digest('hex');
        // Format as UUID: 8-4-4-4-12 hex characters
        return [
            hash.substring(0, 8),
            hash.substring(8, 12),
            hash.substring(12, 16),
            hash.substring(16, 20),
            hash.substring(20, 32)
        ].join('-');
    }

    /**
     * Process a building webhook from UK system.
     * Handles building.created, building.updated, building.deleted events.
     * @param {Object} payload - Webhook payload with event, building, event_id
     * @returns {Promise<void>}
     */
    async handleBuildingWebhook(payload) {
        const { event, building: ukBuilding, event_id } = payload;

        if (!isValidBuildingEvent(event)) {
            throw new Error(`Unknown building event: ${event}`);
        }

        const externalId = this._generateExternalId(ukBuilding.id);

        try {
            const existing = await Building.findByExternalId(externalId);

            if (event === 'building.deleted') {
                if (existing) {
                    await Building.softDelete(existing.building_id);
                    logger.info(`Soft-deleted building ${existing.building_id} (UK building ${ukBuilding.id})`);
                } else {
                    logger.warn(`Building with external_id ${externalId} not found for deletion, ignoring`);
                }
            } else {
                // building.created or building.updated — upsert logic
                // Note: UK webhook also sends `contacts` but InfraSafe's buildings table
                // does not have a contacts column — contacts are managed via management_company.
                // The contacts field is intentionally not stored.
                const ukFields = {
                    name: ukBuilding.name,
                    address: ukBuilding.address,
                    town: ukBuilding.town
                };

                if (existing) {
                    await Building.updateFromUK(existing.building_id, ukFields);
                    logger.info(`Updated building ${existing.building_id} from UK (event: ${event})`);
                } else {
                    await Building.createFromUK({ external_id: externalId, ...ukFields });
                    logger.info(`Created building from UK building ${ukBuilding.id} (event: ${event})`);
                }
            }

            await IntegrationLog.create({
                event_id,
                direction: 'from_uk',
                entity_type: 'building',
                entity_id: ukBuilding.id?.toString(),
                action: event,
                payload,
                status: 'success'
            });
        } catch (error) {
            logger.error(`handleBuildingWebhook error: ${error.message}`);
            // Log the failure
            try {
                await IntegrationLog.create({
                    event_id,
                    direction: 'from_uk',
                    entity_type: 'building',
                    entity_id: ukBuilding.id?.toString(),
                    action: event,
                    payload,
                    status: 'error',
                    error_message: error.message
                });
            } catch (logError) {
                logger.error(`Failed to log integration error: ${logError.message}`);
            }
            throw error;
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=ukIntegrationService`
Expected: PASS (all existing tests + 8 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/ukIntegrationService.js tests/jest/unit/ukIntegrationService.test.js
git commit -m "feat: implement handleBuildingWebhook in ukIntegrationService (create/update/delete)"
```

---

## Task 4: Wire Webhook Route to handleBuildingWebhook

**Files:**
- Modify: `src/routes/webhookRoutes.js`
- Modify: `tests/jest/unit/webhookRoutes.test.js` (if exists, else create test)

**Context:** The `/building` route handler currently just calls `logEvent()`. Replace it with `handleBuildingWebhook()` which does the actual building sync.

- [ ] **Step 1: Write failing test for the updated building route**

The existing `tests/jest/unit/webhookRoutes.test.js` mocks `ukIntegrationService` at the top. **First**, add `handleBuildingWebhook` to the mock factory (line 3-8 in the existing file):

```javascript
// Update the existing mock to include handleBuildingWebhook
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    isDuplicateEvent: jest.fn(),
    logEvent: jest.fn(),
    handleBuildingWebhook: jest.fn()  // ← ADD THIS
}));
```

**Then**, add this describe block inside the main `describe('webhookRoutes')`, after the existing `verifyWebhook middleware` describe block. The existing file uses a `createMockReqRes(body, headers)` helper and tests the middleware directly. For the route handler, we use supertest since the route is an Express router:

```javascript
const request = require('supertest');
const express = require('express');

describe('POST /building — Phase 2 building sync', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json({
            verify: (req, res, buf) => { req.rawBody = buf.toString(); }
        }));
        app.use('/', webhookRoutes);
    });

    it('calls handleBuildingWebhook for building events', async () => {
        ukIntegrationService.isEnabled.mockResolvedValue(true);
        ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleBuildingWebhook.mockResolvedValue();

        const body = {
            event_id: '550e8400-e29b-41d4-a716-446655440000',
            event: 'building.created',
            building: { id: 15, name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' }
        };

        const res = await request(app)
            .post('/building')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(ukIntegrationService.handleBuildingWebhook).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'building.created' })
        );
    });

    it('returns 500 when handleBuildingWebhook throws', async () => {
        ukIntegrationService.isEnabled.mockResolvedValue(true);
        ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleBuildingWebhook.mockRejectedValue(new Error('DB error'));

        const body = {
            event_id: '550e8400-e29b-41d4-a716-446655440000',
            event: 'building.created',
            building: { id: 15, name: 'Дом 42' }
        };

        const res = await request(app)
            .post('/building')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });

    it('returns 200 for duplicate event_id', async () => {
        ukIntegrationService.isEnabled.mockResolvedValue(true);
        ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(true);

        const body = { event_id: '550e8400-e29b-41d4-a716-446655440000', event: 'building.created', building: { id: 15 } };

        const res = await request(app)
            .post('/building')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Already processed');
        expect(ukIntegrationService.handleBuildingWebhook).not.toHaveBeenCalled();
    });
});
```

**Note:** `supertest` is already a dev dependency. If the rate limiter (Task 7) is applied before this task, the supertest tests may hit rate limits — either disable it in test or create the app without the limiter middleware.

- [ ] **Step 2: Update the webhook route handler**

Replace the `router.post('/building', ...)` handler in `src/routes/webhookRoutes.js`:

```javascript
router.post('/building', verifyWebhook, async (req, res) => {
    try {
        const { event_id } = req.body;

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.handleBuildingWebhook(req.body);

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`POST /webhooks/uk/building error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: ALL tests pass (existing + new)

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhookRoutes.js tests/jest/unit/webhookRoutes.test.js
git commit -m "feat: wire building webhook route to handleBuildingWebhook (actual sync instead of log-only)"
```

---

## Task 5: event_id UUID Validation on Webhooks

**Files:**
- Modify: `src/routes/webhookRoutes.js`
- Modify: `tests/jest/unit/webhookRoutes.test.js`

**Context:** P2 security fix — validate that `event_id` is a proper UUID format before processing. Reject malformed event_ids with 400.

- [ ] **Step 1: Write failing test**

```javascript
it('rejects non-UUID event_id with 400', async () => {
    // After verifyWebhook passes, body has invalid event_id
    // Expect 400 { success: false, message: 'Invalid event_id format' }
});
```

- [ ] **Step 2: Add validation to both webhook handlers**

In `src/routes/webhookRoutes.js`, add at top:
```javascript
const { isValidUUID } = require('../utils/webhookValidation');
```

In both `/building` and `/request` handlers, add **BEFORE** the duplicate check (UUID must be validated before it reaches PostgreSQL UUID column):
```javascript
        if (event_id && !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid event_id format' });
        }

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }
```
Remove the old duplicate check — the above replaces it.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: ALL pass

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhookRoutes.js tests/jest/unit/webhookRoutes.test.js
git commit -m "fix(security): validate event_id UUID format on webhook endpoints"
```

---

## Task 6: Enum Whitelist Validation on Integration Log Filters

**Files:**
- Modify: `src/routes/integrationRoutes.js`
- Modify: `tests/jest/unit/integrationRoutes.test.js`

**Context:** P2 security fix — the `getLogs` handler passes user-supplied `direction`, `status`, `entity_type` directly to SQL via the model. Add whitelist validation to reject invalid enum values with 400 instead of passing them to the DB.

- [ ] **Step 1: Write failing test**

```javascript
describe('GET /logs — enum validation', () => {
    it('rejects invalid direction with 400', async () => {
        // req.query.direction = 'INVALID'
        // expect 400 with message about invalid direction
    });
    it('rejects invalid status with 400', async () => {
        // req.query.status = 'hacked'
    });
    it('rejects invalid entity_type with 400', async () => {
        // req.query.entity_type = 'user'
    });
    it('accepts valid filter combinations', async () => {
        // direction=from_uk, status=success, entity_type=building
        // expect success
    });
});
```

- [ ] **Step 2: Add validation to getLogs handler**

In `src/routes/integrationRoutes.js`, add at top:
```javascript
const { isValidDirection, isValidStatus, isValidEntityType } = require('../utils/webhookValidation');
```

In `getLogs` handler, add validation after destructuring query params:
```javascript
        if (direction !== undefined && !isValidDirection(direction)) {
            return res.status(400).json({ success: false, message: 'Invalid direction filter' });
        }
        if (status !== undefined && !isValidStatus(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status filter' });
        }
        if (entity_type !== undefined && !isValidEntityType(entity_type)) {
            return res.status(400).json({ success: false, message: 'Invalid entity_type filter' });
        }
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: ALL pass

- [ ] **Step 4: Commit**

```bash
git add src/routes/integrationRoutes.js tests/jest/unit/integrationRoutes.test.js
git commit -m "fix(security): add enum whitelist validation for integration log filters"
```

---

## Task 7: Rate Limiting on Webhook Endpoints

**Files:**
- Modify: `src/routes/webhookRoutes.js`
- Modify: `tests/jest/unit/webhookRoutes.test.js`

**Context:** P2 security fix — webhook endpoints need rate limiting to prevent abuse. Use the existing `rateLimiter.js` pattern or express-rate-limit.

- [ ] **Step 1: Check existing rate limiter pattern**

Read: `src/middleware/rateLimiter.js` — understand how rate limiting is implemented in the project.

- [ ] **Step 2: Write test for rate limit behavior**

```javascript
describe('webhook rate limiting', () => {
    it('applies rate limiter to webhook routes', () => {
        // Verify that the router has rate limiting middleware applied
        // This may be a structural test checking the middleware stack
    });
});
```

- [ ] **Step 3: Add rate limiter to webhook routes**

In `src/routes/webhookRoutes.js`, import the project's custom `SimpleRateLimiter` (from `src/middleware/rateLimiter.js` — do NOT use express-rate-limit, it's not in package.json):

```javascript
const { SimpleRateLimiter } = require('../middleware/rateLimiter');

// Webhook-specific rate limiter: 60 requests per minute per IP
const webhookLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Слишком много запросов к webhook. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false
});

// Apply to all webhook routes
router.use(webhookLimiter.middleware());
```

This follows the same pattern as `telemetryLimiter`, `authLimiter`, etc. defined in `src/middleware/rateLimiter.js`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/webhookRoutes.js tests/jest/unit/webhookRoutes.test.js
git commit -m "fix(security): add rate limiting to webhook endpoints (60 req/min)"
```

---

## Task 8: Integration Verification & Full Test Run

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL tests pass (existing + new Phase 2 tests)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Verify building sync flow end-to-end (manual)**

If Docker environment is available:
```bash
docker compose -f docker-compose.dev.yml up --build -d
```

Test the building webhook with curl:
```bash
# Generate a valid HMAC signature (use UK_WEBHOOK_SECRET from .env)
SECRET="your-webhook-secret"
TIMESTAMP=$(date +%s)
BODY='{"event_id":"550e8400-e29b-41d4-a716-446655440000","event":"building.created","building":{"id":99,"name":"Тест Дом","address":"ул. Тестовая, 1","town":"Ташкент"},"timestamp":"2026-03-25T10:00:00Z"}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -X POST http://localhost:3000/api/webhooks/uk/building \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: t=${TIMESTAMP},v1=${SIGNATURE}" \
  -d "$BODY"
```

Expected: `{"success":true}` and a new building in the database with `external_id` set.

- [ ] **Step 4: Commit final state (if any fixes needed)**

```bash
git add -A
git commit -m "test: Phase 2 verification — building sync working"
```
