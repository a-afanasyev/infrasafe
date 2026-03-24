# UK Integration Phase 1: Integration Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the integration foundation — DB schema, models, webhook/integration routes, ukIntegrationService scaffold, and admin UI tab — so admin can enable/disable integration, configure settings, and view integration logs.

**Architecture:** New integration module embedded in InfraSafe. Four new DB tables + buildings column additions via migration 011. Four new models (IntegrationConfig, IntegrationLog, AlertRule, AlertRequestMap). Service scaffold with isEnabled/config/logging. Two new route files (webhookRoutes + integrationRoutes) mounted in main router. Admin panel gets a new "Интеграция UK" tab.

**Tech Stack:** Node.js/Express, PostgreSQL, Jest, vanilla JS admin panel.

**Spec:** `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md`

---

## File Structure

### New files to create
| File | Responsibility |
| --- | --- |
| `database/migrations/011_uk_integration.sql` | Schema: buildings columns + 4 new tables + indexes + seed data |
| `src/models/IntegrationConfig.js` | Key-value CRUD for `integration_config` table |
| `src/models/IntegrationLog.js` | CRUD + filtered/paginated queries for `integration_log` table |
| `src/models/AlertRule.js` | CRUD for `alert_rules` table |
| `src/models/AlertRequestMap.js` | CRUD for `alert_request_map` table |
| `src/services/ukIntegrationService.js` | Central integration service: isEnabled, config, logging, HMAC verification |
| `src/routes/webhookRoutes.js` | Incoming UK webhooks at `/api/webhooks/uk/` with HMAC auth |
| `src/routes/integrationRoutes.js` | Admin integration API at `/api/integration/` |
| `tests/jest/unit/integrationConfig.test.js` | Unit tests for IntegrationConfig model |
| `tests/jest/unit/integrationLog.test.js` | Unit tests for IntegrationLog model |
| `tests/jest/unit/ukIntegrationService.test.js` | Unit tests for ukIntegrationService |
| `tests/jest/unit/webhookRoutes.test.js` | Unit tests for webhook HMAC verification |
| `tests/jest/unit/integrationRoutes.test.js` | Unit tests for integration admin API |

### Files to modify
| File | Change |
| --- | --- |
| `src/server.js:49` | Add `verify` callback to `express.json()` to preserve `rawBody` for HMAC |
| `src/routes/index.js` | Import + mount webhookRoutes and integrationRoutes, add webhook paths to PUBLIC_ROUTES |
| `admin.html` | Add "Интеграция UK" tab button + section HTML |
| `public/admin.js` | Add integration tab logic: toggle, settings, log viewer |

---

## Task 1: Database Migration 011

**Files:**
- Create: `database/migrations/011_uk_integration.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration 011: UK Integration Foundation
-- Adds external_id to buildings, creates integration tables

-- 1. Buildings table changes
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS external_id UUID UNIQUE;
ALTER TABLE buildings ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE buildings ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS uk_deleted_at TIMESTAMPTZ;

-- 2. Integration config (key-value store for non-sensitive settings)
CREATE TABLE IF NOT EXISTS integration_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults (non-sensitive only; secrets are ENV-ONLY)
INSERT INTO integration_config (key, value) VALUES
    ('uk_integration_enabled', 'false'),
    ('uk_api_url', ''),
    ('uk_frontend_url', '')
ON CONFLICT (key) DO NOTHING;

-- 3. Alert-to-request mapping rules
CREATE TABLE IF NOT EXISTS alert_rules (
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

-- Seed default rules
INSERT INTO alert_rules (alert_type, severity, uk_category, uk_urgency, description) VALUES
    ('TRANSFORMER_OVERLOAD', 'WARNING', 'Электрика', 'Средняя', 'Перегрузка трансформатора (предупреждение)'),
    ('TRANSFORMER_OVERLOAD', 'CRITICAL', 'Электрика', 'Критическая', 'Перегрузка трансформатора (критическая)'),
    ('TRANSFORMER_CRITICAL_OVERLOAD', 'CRITICAL', 'Электрика', 'Критическая', 'Критическая перегрузка трансформатора'),
    ('LEAK_DETECTED', 'WARNING', 'Сантехника', 'Срочная', 'Обнаружена утечка (предупреждение)'),
    ('LEAK_DETECTED', 'CRITICAL', 'Сантехника', 'Критическая', 'Обнаружена утечка (критическая)'),
    ('VOLTAGE_ANOMALY', 'WARNING', 'Электрика', 'Обычная', 'Аномалия напряжения'),
    ('HEATING_FAILURE', 'CRITICAL', 'Отопление', 'Критическая', 'Отказ отопления')
ON CONFLICT (alert_type, severity) DO NOTHING;

-- 4. Alert-request mapping tracker
CREATE TABLE IF NOT EXISTS alert_request_map (
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

-- 5. Integration log (event log for all sync operations)
CREATE TABLE IF NOT EXISTS integration_log (
    id            SERIAL PRIMARY KEY,
    event_id      UUID UNIQUE,
    direction     VARCHAR(30) NOT NULL,
    entity_type   VARCHAR(20) NOT NULL,
    entity_id     VARCHAR(50),
    action        VARCHAR(30) NOT NULL,
    payload       JSONB,
    status        VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    retry_count   INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_log_event_id ON integration_log(event_id);
CREATE INDEX IF NOT EXISTS idx_integration_log_status ON integration_log(status) WHERE status IN ('error', 'failed');
CREATE INDEX IF NOT EXISTS idx_integration_log_created ON integration_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buildings_external_id ON buildings(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_uk_deleted ON buildings(uk_deleted_at) WHERE uk_deleted_at IS NOT NULL;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run (requires running PostgreSQL):
```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe -f /dev/stdin < database/migrations/011_uk_integration.sql
```

Expected: All statements succeed, no errors.

- [ ] **Step 3: Verify tables exist**

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe -c "\dt integration_*" -c "\dt alert_r*" -c "\d buildings" | head -40
```

Expected: `integration_config`, `integration_log`, `alert_rules`, `alert_request_map` tables listed. `buildings` shows `external_id`, `uk_deleted_at` columns, `latitude`/`longitude` nullable.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/011_uk_integration.sql
git commit -m "feat(db): add migration 011 for UK integration foundation

Adds external_id/uk_deleted_at to buildings, relaxes lat/lng NOT NULL,
creates integration_config, alert_rules, alert_request_map, integration_log
tables with indexes and seed data."
```

---

## Task 2: IntegrationConfig Model

**Files:**
- Create: `src/models/IntegrationConfig.js`
- Test: `tests/jest/unit/integrationConfig.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/jest/unit/integrationConfig.test.js

jest.mock('../../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const db = require('../../../src/config/database');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');

describe('IntegrationConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    test('returns value for existing key', async () => {
      db.query.mockResolvedValue({ rows: [{ value: 'http://uk:8085' }] });

      const result = await IntegrationConfig.get('uk_api_url');

      expect(result).toBe('http://uk:8085');
      expect(db.query).toHaveBeenCalledWith(
        'SELECT value FROM integration_config WHERE key = $1',
        ['uk_api_url']
      );
    });

    test('returns defaultValue when key not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await IntegrationConfig.get('missing_key', 'fallback');

      expect(result).toBe('fallback');
    });

    test('returns null when key not found and no default', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await IntegrationConfig.get('missing_key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    test('upserts key-value pair', async () => {
      db.query.mockResolvedValue({ rows: [{ key: 'uk_api_url', value: 'http://uk:8085', updated_at: new Date() }] });

      const result = await IntegrationConfig.set('uk_api_url', 'http://uk:8085');

      expect(result.key).toBe('uk_api_url');
      expect(db.query.mock.calls[0][0]).toContain('INSERT INTO integration_config');
      expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT');
      expect(db.query.mock.calls[0][1]).toEqual(['uk_api_url', 'http://uk:8085']);
    });
  });

  describe('getAll', () => {
    test('returns all config as object', async () => {
      db.query.mockResolvedValue({
        rows: [
          { key: 'uk_integration_enabled', value: 'false' },
          { key: 'uk_api_url', value: '' },
          { key: 'uk_frontend_url', value: '' }
        ]
      });

      const result = await IntegrationConfig.getAll();

      expect(result).toEqual({
        uk_integration_enabled: 'false',
        uk_api_url: '',
        uk_frontend_url: ''
      });
    });
  });

  describe('isEnabled', () => {
    test('returns true when enabled', async () => {
      db.query.mockResolvedValue({ rows: [{ value: 'true' }] });

      const result = await IntegrationConfig.isEnabled();

      expect(result).toBe(true);
    });

    test('returns false when disabled', async () => {
      db.query.mockResolvedValue({ rows: [{ value: 'false' }] });

      const result = await IntegrationConfig.isEnabled();

      expect(result).toBe(false);
    });

    test('returns false when key missing', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await IntegrationConfig.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    test('deletes key and returns true', async () => {
      db.query.mockResolvedValue({ rowCount: 1 });

      const result = await IntegrationConfig.delete('uk_api_url');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM integration_config WHERE key = $1',
        ['uk_api_url']
      );
    });

    test('returns false when key not found', async () => {
      db.query.mockResolvedValue({ rowCount: 0 });

      const result = await IntegrationConfig.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    test('get throws and logs on DB error', async () => {
      db.query.mockRejectedValue(new Error('DB error'));

      await expect(IntegrationConfig.get('key')).rejects.toThrow('DB error');
    });

    test('set throws and logs on DB error', async () => {
      db.query.mockRejectedValue(new Error('DB error'));

      await expect(IntegrationConfig.set('key', 'val')).rejects.toThrow('DB error');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/jest/unit/integrationConfig.test.js
```

Expected: FAIL — `Cannot find module '../../../src/models/IntegrationConfig'`

- [ ] **Step 3: Write IntegrationConfig model**

```javascript
// src/models/IntegrationConfig.js

const db = require('../config/database');
const logger = require('../utils/logger');

class IntegrationConfig {
    /**
     * Get a config value by key
     * @param {string} key
     * @param {string|null} defaultValue
     * @returns {Promise<string|null>}
     */
    static async get(key, defaultValue = null) {
        try {
            const result = await db.query(
                'SELECT value FROM integration_config WHERE key = $1',
                [key]
            );
            return result.rows.length > 0 ? result.rows[0].value : defaultValue;
        } catch (error) {
            logger.error(`IntegrationConfig.get error for key=${key}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Set (upsert) a config value
     * @param {string} key
     * @param {string} value
     * @returns {Promise<Object>}
     */
    static async set(key, value) {
        try {
            const result = await db.query(
                `INSERT INTO integration_config (key, value, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
                 RETURNING *`,
                [key, value]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`IntegrationConfig.set error for key=${key}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all config as key-value object
     * @returns {Promise<Object>}
     */
    static async getAll() {
        try {
            const result = await db.query('SELECT key, value FROM integration_config ORDER BY key');
            const config = {};
            for (const row of result.rows) {
                config[row.key] = row.value;
            }
            return config;
        } catch (error) {
            logger.error(`IntegrationConfig.getAll error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if UK integration is enabled
     * @returns {Promise<boolean>}
     */
    static async isEnabled() {
        const value = await this.get('uk_integration_enabled', 'false');
        return value === 'true';
    }

    /**
     * Delete a config key
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    static async delete(key) {
        try {
            const result = await db.query(
                'DELETE FROM integration_config WHERE key = $1',
                [key]
            );
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`IntegrationConfig.delete error for key=${key}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = IntegrationConfig;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/jest/unit/integrationConfig.test.js
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models/IntegrationConfig.js tests/jest/unit/integrationConfig.test.js
git commit -m "feat: add IntegrationConfig model with key-value CRUD

Provides get/set/getAll/isEnabled/delete for integration_config table.
9 unit tests."
```

---

## Task 3: IntegrationLog Model

**Files:**
- Create: `src/models/IntegrationLog.js`
- Test: `tests/jest/unit/integrationLog.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/jest/unit/integrationLog.test.js

jest.mock('../../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const db = require('../../../src/config/database');
const IntegrationLog = require('../../../src/models/IntegrationLog');

describe('IntegrationLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('inserts a log entry with all fields', async () => {
      const logData = {
        event_id: '550e8400-e29b-41d4-a716-446655440000',
        direction: 'to_uk',
        entity_type: 'alert',
        entity_id: '42',
        action: 'alert.created',
        payload: { alert_id: 42 },
        status: 'pending'
      };
      db.query.mockResolvedValue({ rows: [{ id: 1, ...logData }] });

      const result = await IntegrationLog.create(logData);

      expect(result.id).toBe(1);
      expect(db.query.mock.calls[0][1]).toEqual([
        logData.event_id,
        logData.direction,
        logData.entity_type,
        logData.entity_id,
        logData.action,
        JSON.stringify(logData.payload),
        logData.status
      ]);
    });
  });

  describe('findByEventId', () => {
    test('returns log entry when found', async () => {
      const eventId = '550e8400-e29b-41d4-a716-446655440000';
      db.query.mockResolvedValue({ rows: [{ id: 1, event_id: eventId }] });

      const result = await IntegrationLog.findByEventId(eventId);

      expect(result.event_id).toBe(eventId);
      expect(db.query.mock.calls[0][1]).toEqual([eventId]);
    });

    test('returns null when not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await IntegrationLog.findByEventId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    test('updates status and error_message', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 1, status: 'error', error_message: 'timeout' }] });

      const result = await IntegrationLog.updateStatus(1, 'error', 'timeout');

      expect(result.status).toBe('error');
      expect(db.query.mock.calls[0][1]).toEqual(['error', 'timeout', 1]);
    });
  });

  describe('incrementRetry', () => {
    test('increments retry_count by 1', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 1, retry_count: 2 }] });

      const result = await IntegrationLog.incrementRetry(1);

      expect(result.retry_count).toBe(2);
      expect(db.query.mock.calls[0][0]).toContain('retry_count + 1');
    });
  });

  describe('findAll', () => {
    test('returns paginated results with default params', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '25' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });

      const result = await IntegrationLog.findAll({});

      expect(result.total).toBe(25);
      expect(result.logs).toHaveLength(2);
      // Default: page 1, limit 20
      const queryParams = db.query.mock.calls[1][1];
      expect(queryParams).toContain(20); // limit
      expect(queryParams).toContain(0);  // offset
    });

    test('applies direction filter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      await IntegrationLog.findAll({ direction: 'to_uk' });

      const countQuery = db.query.mock.calls[0][0];
      expect(countQuery).toContain('direction = $');
    });

    test('applies status filter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      await IntegrationLog.findAll({ status: 'error' });

      const countQuery = db.query.mock.calls[0][0];
      expect(countQuery).toContain('status = $');
    });

    test('applies entity_type filter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })
        .mockResolvedValueOnce({ rows: [] });

      await IntegrationLog.findAll({ entity_type: 'building' });

      const countQuery = db.query.mock.calls[0][0];
      expect(countQuery).toContain('entity_type = $');
    });

    test('applies date range filter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [] });

      await IntegrationLog.findAll({
        date_from: '2026-03-01',
        date_to: '2026-03-24'
      });

      const countQuery = db.query.mock.calls[0][0];
      expect(countQuery).toContain('created_at >= $');
      expect(countQuery).toContain('created_at <= $');
    });
  });

  describe('findById', () => {
    test('returns single log entry', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 5, action: 'building.created' }] });

      const result = await IntegrationLog.findById(5);

      expect(result.id).toBe(5);
      expect(db.query.mock.calls[0][1]).toEqual([5]);
    });

    test('returns null when not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await IntegrationLog.findById(999);

      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/jest/unit/integrationLog.test.js
```

Expected: FAIL — `Cannot find module '../../../src/models/IntegrationLog'`

- [ ] **Step 3: Write IntegrationLog model**

```javascript
// src/models/IntegrationLog.js

const db = require('../config/database');
const logger = require('../utils/logger');

class IntegrationLog {
    /**
     * Create a new log entry
     * @param {Object} data - { event_id, direction, entity_type, entity_id, action, payload, status }
     * @returns {Promise<Object>}
     */
    static async create(data) {
        try {
            const result = await db.query(
                `INSERT INTO integration_log
                    (event_id, direction, entity_type, entity_id, action, payload, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [
                    data.event_id,
                    data.direction,
                    data.entity_type,
                    data.entity_id,
                    data.action,
                    JSON.stringify(data.payload),
                    data.status || 'pending'
                ]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`IntegrationLog.create error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find log entry by event_id (for idempotency check)
     * @param {string} eventId
     * @returns {Promise<Object|null>}
     */
    static async findByEventId(eventId) {
        try {
            const result = await db.query(
                'SELECT * FROM integration_log WHERE event_id = $1',
                [eventId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`IntegrationLog.findByEventId error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find log entry by id
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        try {
            const result = await db.query(
                'SELECT * FROM integration_log WHERE id = $1',
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`IntegrationLog.findById error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update log entry status
     * @param {number} id
     * @param {string} status - pending | success | error | failed
     * @param {string|null} errorMessage
     * @returns {Promise<Object>}
     */
    static async updateStatus(id, status, errorMessage = null) {
        try {
            const result = await db.query(
                `UPDATE integration_log
                 SET status = $1, error_message = $2
                 WHERE id = $3
                 RETURNING *`,
                [status, errorMessage, id]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`IntegrationLog.updateStatus error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Increment retry count
     * @param {number} id
     * @returns {Promise<Object>}
     */
    static async incrementRetry(id) {
        try {
            const result = await db.query(
                `UPDATE integration_log
                 SET retry_count = retry_count + 1
                 WHERE id = $1
                 RETURNING *`,
                [id]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`IntegrationLog.incrementRetry error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find all logs with pagination and filters
     * @param {Object} filters - { direction, status, entity_type, date_from, date_to, page, limit }
     * @returns {Promise<{ logs: Array, total: number }>}
     */
    static async findAll(filters = {}) {
        try {
            const {
                direction,
                status,
                entity_type,
                date_from,
                date_to,
                page = 1,
                limit = 20
            } = filters;

            const conditions = [];
            const params = [];
            let paramIdx = 1;

            if (direction) {
                conditions.push(`direction = $${paramIdx++}`);
                params.push(direction);
            }
            if (status) {
                conditions.push(`status = $${paramIdx++}`);
                params.push(status);
            }
            if (entity_type) {
                conditions.push(`entity_type = $${paramIdx++}`);
                params.push(entity_type);
            }
            if (date_from) {
                conditions.push(`created_at >= $${paramIdx++}`);
                params.push(date_from);
            }
            if (date_to) {
                conditions.push(`created_at <= $${paramIdx++}`);
                params.push(date_to);
            }

            const whereClause = conditions.length > 0
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            // Count query
            const countResult = await db.query(
                `SELECT COUNT(*) as count FROM integration_log ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].count, 10);

            // Data query
            const offset = (page - 1) * limit;
            const dataParams = [...params, limit, offset];
            const dataResult = await db.query(
                `SELECT * FROM integration_log ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
                dataParams
            );

            return { logs: dataResult.rows, total };
        } catch (error) {
            logger.error(`IntegrationLog.findAll error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = IntegrationLog;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/jest/unit/integrationLog.test.js
```

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models/IntegrationLog.js tests/jest/unit/integrationLog.test.js
git commit -m "feat: add IntegrationLog model with filtered pagination

Provides create/findByEventId/findById/updateStatus/incrementRetry/findAll
for integration_log table. Supports direction/status/entity_type/date
filters. 10 unit tests."
```

---

## Task 4: AlertRule and AlertRequestMap Models (Stub)

Phase 1 needs these models as stubs (table exists, full CRUD is Phase 3). Minimal: findAll for admin display.

**Files:**
- Create: `src/models/AlertRule.js`
- Create: `src/models/AlertRequestMap.js`

- [ ] **Step 1: Write AlertRule model**

```javascript
// src/models/AlertRule.js

const db = require('../config/database');
const logger = require('../utils/logger');

class AlertRule {
    static async findAll() {
        try {
            const result = await db.query(
                'SELECT * FROM alert_rules ORDER BY alert_type, severity'
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRule.findAll error: ${error.message}`);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_rules WHERE id = $1',
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.findById error: ${error.message}`);
            throw error;
        }
    }

    static async toggleEnabled(id, enabled) {
        try {
            const result = await db.query(
                `UPDATE alert_rules SET enabled = $1, updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [enabled, id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.toggleEnabled error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertRule;
```

- [ ] **Step 2: Write AlertRequestMap model**

```javascript
// src/models/AlertRequestMap.js

const db = require('../config/database');
const logger = require('../utils/logger');

class AlertRequestMap {
    static async findByAlertId(alertId) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 ORDER BY created_at',
                [alertId]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRequestMap.findByAlertId error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertRequestMap;
```

- [ ] **Step 3: Commit**

```bash
git add src/models/AlertRule.js src/models/AlertRequestMap.js
git commit -m "feat: add AlertRule and AlertRequestMap model stubs

Minimal models for Phase 1 admin display. Full CRUD added in Phase 3."
```

---

## Task 5: ukIntegrationService Scaffold

**Files:**
- Create: `src/services/ukIntegrationService.js`
- Test: `tests/jest/unit/ukIntegrationService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/jest/unit/ukIntegrationService.test.js

jest.mock('../../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/models/IntegrationConfig', () => ({
  isEnabled: jest.fn(),
  getAll: jest.fn(),
  set: jest.fn()
}));

jest.mock('../../../src/models/IntegrationLog', () => ({
  create: jest.fn(),
  findByEventId: jest.fn(),
  updateStatus: jest.fn()
}));

const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');

describe('ukIntegrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    test('returns true when integration is enabled', async () => {
      IntegrationConfig.isEnabled.mockResolvedValue(true);

      const result = await ukIntegrationService.isEnabled();

      expect(result).toBe(true);
    });

    test('returns false when integration is disabled', async () => {
      IntegrationConfig.isEnabled.mockResolvedValue(false);

      const result = await ukIntegrationService.isEnabled();

      expect(result).toBe(false);
    });

    test('returns false on error (graceful degradation)', async () => {
      IntegrationConfig.isEnabled.mockRejectedValue(new Error('DB error'));

      const result = await ukIntegrationService.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('getConfig', () => {
    test('returns DB config merged with masked secrets', async () => {
      IntegrationConfig.getAll.mockResolvedValue({
        uk_integration_enabled: 'true',
        uk_api_url: 'http://uk:8085',
        uk_frontend_url: 'https://uk.domain.com'
      });

      const result = await ukIntegrationService.getConfig();

      expect(result.uk_integration_enabled).toBe('true');
      expect(result.uk_api_url).toBe('http://uk:8085');
      expect(result.uk_webhook_secret).toContain('●');
      expect(result.uk_service_user).toContain('●');
      expect(result.uk_service_password).toContain('●');
    });
  });

  describe('updateConfig', () => {
    test('updates only allowed non-sensitive keys', async () => {
      IntegrationConfig.set.mockResolvedValue({});

      await ukIntegrationService.updateConfig({
        uk_integration_enabled: 'true',
        uk_api_url: 'http://new-uk:8085'
      });

      expect(IntegrationConfig.set).toHaveBeenCalledWith('uk_integration_enabled', 'true');
      expect(IntegrationConfig.set).toHaveBeenCalledWith('uk_api_url', 'http://new-uk:8085');
    });

    test('rejects sensitive keys', async () => {
      await expect(
        ukIntegrationService.updateConfig({ uk_webhook_secret: 'hack' })
      ).rejects.toThrow('Cannot update this setting via API');
    });
  });

  describe('verifyWebhookSignature', () => {
    test('returns true for valid signature', () => {
      const crypto = require('crypto');
      const secret = 'test-secret';
      const body = '{"test": true}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = `${timestamp}.${body}`;
      const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const signature = `t=${timestamp},v1=${expectedSig}`;

      const origSecret = process.env.UK_WEBHOOK_SECRET;
      process.env.UK_WEBHOOK_SECRET = secret;

      const result = ukIntegrationService.verifyWebhookSignature(body, signature);

      process.env.UK_WEBHOOK_SECRET = origSecret;
      expect(result).toBe(true);
    });

    test('returns false for invalid signature', () => {
      const origSecret = process.env.UK_WEBHOOK_SECRET;
      process.env.UK_WEBHOOK_SECRET = 'test-secret';

      const result = ukIntegrationService.verifyWebhookSignature(
        '{"test": true}',
        't=1234567890,v1=invalidsignature'
      );

      process.env.UK_WEBHOOK_SECRET = origSecret;
      expect(result).toBe(false);
    });

    test('returns false for expired timestamp (>5 min)', () => {
      const crypto = require('crypto');
      const secret = 'test-secret';
      const body = '{"test": true}';
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
      const payload = `${oldTimestamp}.${body}`;
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const signature = `t=${oldTimestamp},v1=${sig}`;

      const origSecret = process.env.UK_WEBHOOK_SECRET;
      process.env.UK_WEBHOOK_SECRET = secret;

      const result = ukIntegrationService.verifyWebhookSignature(body, signature);

      process.env.UK_WEBHOOK_SECRET = origSecret;
      expect(result).toBe(false);
    });

    test('returns false when no secret configured', () => {
      const origSecret = process.env.UK_WEBHOOK_SECRET;
      delete process.env.UK_WEBHOOK_SECRET;

      const result = ukIntegrationService.verifyWebhookSignature('body', 'sig');

      process.env.UK_WEBHOOK_SECRET = origSecret;
      expect(result).toBe(false);
    });
  });

  describe('logEvent', () => {
    test('creates log entry via IntegrationLog', async () => {
      IntegrationLog.create.mockResolvedValue({ id: 1 });

      await ukIntegrationService.logEvent({
        event_id: 'uuid-1',
        direction: 'from_uk',
        entity_type: 'building',
        entity_id: '5',
        action: 'building.created',
        payload: { building: {} },
        status: 'success'
      });

      expect(IntegrationLog.create).toHaveBeenCalledWith({
        event_id: 'uuid-1',
        direction: 'from_uk',
        entity_type: 'building',
        entity_id: '5',
        action: 'building.created',
        payload: { building: {} },
        status: 'success'
      });
    });
  });

  describe('isDuplicateEvent', () => {
    test('returns true if event_id already exists', async () => {
      IntegrationLog.findByEventId.mockResolvedValue({ id: 1 });

      const result = await ukIntegrationService.isDuplicateEvent('existing-uuid');

      expect(result).toBe(true);
    });

    test('returns false if event_id is new', async () => {
      IntegrationLog.findByEventId.mockResolvedValue(null);

      const result = await ukIntegrationService.isDuplicateEvent('new-uuid');

      expect(result).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/jest/unit/ukIntegrationService.test.js
```

Expected: FAIL — `Cannot find module '../../../src/services/ukIntegrationService'`

- [ ] **Step 3: Write ukIntegrationService**

```javascript
// src/services/ukIntegrationService.js

const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const IntegrationLog = require('../models/IntegrationLog');
const logger = require('../utils/logger');

// Keys that can be set via admin API (non-sensitive, stored in DB)
const ALLOWED_CONFIG_KEYS = ['uk_integration_enabled', 'uk_api_url', 'uk_frontend_url'];

// Keys that are env-only (never stored in DB, never exposed via API)
const SENSITIVE_KEYS = ['uk_webhook_secret', 'uk_service_user', 'uk_service_password'];

// Replay protection: reject webhooks older than 5 minutes
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;

class UKIntegrationService {
    /**
     * Check if integration is enabled (graceful degradation: false on error)
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        try {
            return await IntegrationConfig.isEnabled();
        } catch (error) {
            logger.error(`ukIntegrationService.isEnabled error: ${error.message}`);
            return false;
        }
    }

    /**
     * Get integration config (DB values + masked secrets)
     * @returns {Promise<Object>}
     */
    async getConfig() {
        const dbConfig = await IntegrationConfig.getAll();
        return {
            ...dbConfig,
            uk_webhook_secret: '●●●●●●●●',
            uk_service_user: '●●●●●●●●',
            uk_service_password: '●●●●●●●●'
        };
    }

    /**
     * Update non-sensitive config values
     * @param {Object} settings - key-value pairs to update
     * @throws {Error} if trying to set a sensitive key
     */
    async updateConfig(settings) {
        for (const [key, value] of Object.entries(settings)) {
            if (SENSITIVE_KEYS.includes(key)) {
                throw new Error('Cannot update this setting via API');
            }
            if (ALLOWED_CONFIG_KEYS.includes(key)) {
                await IntegrationConfig.set(key, value);
            } else {
                logger.warn(`ukIntegrationService.updateConfig: ignoring unknown key ${key}`);
            }
        }
    }

    /**
     * Verify HMAC-SHA256 webhook signature with replay protection
     * Format: X-Webhook-Signature: t=<unix_timestamp>,v1=<hex_signature>
     * @param {string} rawBody - raw request body string
     * @param {string} signatureHeader - X-Webhook-Signature header value
     * @returns {boolean}
     */
    verifyWebhookSignature(rawBody, signatureHeader) {
        const secret = process.env.UK_WEBHOOK_SECRET;
        if (!secret) {
            logger.error('UK_WEBHOOK_SECRET not configured');
            return false;
        }

        try {
            const parts = {};
            for (const part of signatureHeader.split(',')) {
                const [key, val] = part.split('=', 2);
                parts[key] = val;
            }

            const timestamp = parts['t'];
            const signature = parts['v1'];

            if (!timestamp || !signature) {
                logger.warn('Webhook signature missing timestamp or signature');
                return false;
            }

            // Replay protection
            const now = Math.floor(Date.now() / 1000);
            if (Math.abs(now - parseInt(timestamp, 10)) > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) {
                logger.warn(`Webhook timestamp too old: ${timestamp}`);
                return false;
            }

            // Compute expected signature
            const payload = `${timestamp}.${rawBody}`;
            const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

            // Length check before constant-time comparison (timingSafeEqual throws on mismatch)
            const sigBuf = Buffer.from(signature, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length) {
                logger.warn('Webhook signature length mismatch');
                return false;
            }

            return crypto.timingSafeEqual(sigBuf, expBuf);
        } catch (error) {
            logger.error(`Webhook signature verification error: ${error.message}`);
            return false;
        }
    }

    /**
     * Log an integration event
     * @param {Object} data - { event_id, direction, entity_type, entity_id, action, payload, status }
     * @returns {Promise<Object>}
     */
    async logEvent(data) {
        return IntegrationLog.create(data);
    }

    /**
     * Check if an event_id has already been processed (idempotency)
     * @param {string} eventId
     * @returns {Promise<boolean>}
     */
    async isDuplicateEvent(eventId) {
        const existing = await IntegrationLog.findByEventId(eventId);
        return existing !== null;
    }
}

module.exports = new UKIntegrationService();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/jest/unit/ukIntegrationService.test.js
```

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/ukIntegrationService.js tests/jest/unit/ukIntegrationService.test.js
git commit -m "feat: add ukIntegrationService scaffold

Provides isEnabled (graceful degradation), getConfig (masked secrets),
updateConfig (rejects sensitive keys), verifyWebhookSignature (HMAC-SHA256
+ replay protection), logEvent, isDuplicateEvent. 11 unit tests."
```

---

## Task 6: Webhook Routes

**Files:**
- Create: `src/routes/webhookRoutes.js`
- Test: `tests/jest/unit/webhookRoutes.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/jest/unit/webhookRoutes.test.js

jest.mock('../../../src/services/ukIntegrationService', () => ({
  isEnabled: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  isDuplicateEvent: jest.fn(),
  logEvent: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const ukIntegrationService = require('../../../src/services/ukIntegrationService');

function createMockReqRes(body = {}, headers = {}) {
  const req = {
    body,
    headers,
    rawBody: JSON.stringify(body),
    get: jest.fn((name) => headers[name.toLowerCase()])
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  const next = jest.fn();
  return { req, res, next };
}

const webhookRoutes = require('../../../src/routes/webhookRoutes');

describe('webhookRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('module exports an Express router', () => {
    expect(webhookRoutes).toBeDefined();
    expect(typeof webhookRoutes).toBe('function');
  });

  describe('verifyWebhook middleware', () => {
    const { verifyWebhook } = require('../../../src/routes/webhookRoutes');

    test('returns 503 when integration is disabled', async () => {
      ukIntegrationService.isEnabled.mockResolvedValue(false);
      const { req, res, next } = createMockReqRes();

      await verifyWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    test('returns 401 when signature is missing', async () => {
      ukIntegrationService.isEnabled.mockResolvedValue(true);
      const { req, res, next } = createMockReqRes({}, {});

      await verifyWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('returns 401 when signature is invalid', async () => {
      ukIntegrationService.isEnabled.mockResolvedValue(true);
      ukIntegrationService.verifyWebhookSignature.mockReturnValue(false);
      const { req, res, next } = createMockReqRes(
        {},
        { 'x-webhook-signature': 't=123,v1=bad' }
      );

      await verifyWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('calls next() when signature is valid', async () => {
      ukIntegrationService.isEnabled.mockResolvedValue(true);
      ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
      const { req, res, next } = createMockReqRes(
        { event_id: 'uuid-1' },
        { 'x-webhook-signature': 't=123,v1=valid' }
      );

      await verifyWebhook(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/jest/unit/webhookRoutes.test.js
```

Expected: FAIL — `Cannot find module '../../../src/routes/webhookRoutes'`

- [ ] **Step 3: Write webhookRoutes**

```javascript
// src/routes/webhookRoutes.js

const express = require('express');
const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Middleware: verify webhook HMAC signature and integration enabled
 */
async function verifyWebhook(req, res, next) {
    try {
        const enabled = await ukIntegrationService.isEnabled();
        if (!enabled) {
            return res.status(503).json({
                success: false,
                message: 'UK integration is disabled'
            });
        }

        const signature = req.headers['x-webhook-signature'] || req.get('X-Webhook-Signature');
        if (!signature) {
            logger.warn('Webhook received without signature');
            return res.status(401).json({
                success: false,
                message: 'Missing webhook signature'
            });
        }

        const rawBody = req.rawBody || JSON.stringify(req.body);
        const valid = ukIntegrationService.verifyWebhookSignature(rawBody, signature);
        if (!valid) {
            logger.warn('Webhook received with invalid signature');
            return res.status(401).json({
                success: false,
                message: 'Invalid webhook signature'
            });
        }

        next();
    } catch (error) {
        logger.error(`Webhook verification error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
}

/**
 * POST /api/webhooks/uk/building
 * Phase 1: log-only handler (real processing in Phase 2)
 */
router.post('/building', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event } = req.body;

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            logger.info(`Duplicate webhook event: ${event_id}`);
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.logEvent({
            event_id,
            direction: 'from_uk',
            entity_type: 'building',
            entity_id: req.body.building?.id?.toString(),
            action: event || 'building.unknown',
            payload: req.body,
            status: 'success'
        });

        logger.info(`Building webhook received: ${event} (event_id: ${event_id})`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`Building webhook error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Processing failed' });
    }
});

/**
 * POST /api/webhooks/uk/request
 * Phase 1: log-only handler (real processing in Phase 4)
 */
router.post('/request', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event } = req.body;

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            logger.info(`Duplicate webhook event: ${event_id}`);
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.logEvent({
            event_id,
            direction: 'from_uk',
            entity_type: 'request',
            entity_id: req.body.request?.request_number,
            action: event || 'request.unknown',
            payload: req.body,
            status: 'success'
        });

        logger.info(`Request webhook received: ${event} (event_id: ${event_id})`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`Request webhook error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Processing failed' });
    }
});

router.verifyWebhook = verifyWebhook;
module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/jest/unit/webhookRoutes.test.js
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/webhookRoutes.js tests/jest/unit/webhookRoutes.test.js
git commit -m "feat: add webhookRoutes with HMAC verification

POST /building and /request endpoints with signature verification,
replay protection, idempotency check, and event logging.
Phase 1: log-only handlers. 5 tests."
```

---

## Task 7: Integration Routes (Admin API)

**Files:**
- Create: `src/routes/integrationRoutes.js`
- Test: `tests/jest/unit/integrationRoutes.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/jest/unit/integrationRoutes.test.js

jest.mock('../../../src/services/ukIntegrationService', () => ({
  getConfig: jest.fn(),
  updateConfig: jest.fn(),
  isEnabled: jest.fn()
}));

jest.mock('../../../src/models/IntegrationLog', () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  updateStatus: jest.fn(),
  incrementRetry: jest.fn()
}));

jest.mock('../../../src/models/AlertRule', () => ({
  findAll: jest.fn()
}));

jest.mock('../../../src/middleware/auth', () => ({
  isAdmin: (req, res, next) => next()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const AlertRule = require('../../../src/models/AlertRule');

const { handlers } = require('../../../src/routes/integrationRoutes');

function createMockReqRes(body = {}, query = {}, params = {}) {
  const req = { body, query, params, user: { role: 'admin' } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return { req, res };
}

describe('integrationRoutes handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    test('returns config', async () => {
      const config = { uk_integration_enabled: 'true', uk_api_url: 'http://uk' };
      ukIntegrationService.getConfig.mockResolvedValue(config);
      const { req, res } = createMockReqRes();

      await handlers.getConfig(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: config });
    });
  });

  describe('updateConfig', () => {
    test('updates config and returns success', async () => {
      ukIntegrationService.updateConfig.mockResolvedValue();
      ukIntegrationService.getConfig.mockResolvedValue({ uk_integration_enabled: 'true' });
      const { req, res } = createMockReqRes({ uk_integration_enabled: 'true' });

      await handlers.updateConfig(req, res);

      expect(ukIntegrationService.updateConfig).toHaveBeenCalledWith({ uk_integration_enabled: 'true' });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('returns 400 when sensitive key is rejected', async () => {
      ukIntegrationService.updateConfig.mockRejectedValue(new Error('Cannot set sensitive key via API: uk_webhook_secret'));
      const { req, res } = createMockReqRes({ uk_webhook_secret: 'hack' });

      await handlers.updateConfig(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getLogs', () => {
    test('returns paginated logs', async () => {
      IntegrationLog.findAll.mockResolvedValue({ logs: [{ id: 1 }], total: 1 });
      const { req, res } = createMockReqRes({}, { page: '1', limit: '20' });

      await handlers.getLogs(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ logs: [{ id: 1 }], total: 1 })
      }));
    });
  });

  describe('getLogById', () => {
    test('returns single log', async () => {
      IntegrationLog.findById.mockResolvedValue({ id: 5 });
      const { req, res } = createMockReqRes({}, {}, { id: '5' });

      await handlers.getLogById(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 5 } });
    });

    test('returns 404 when not found', async () => {
      IntegrationLog.findById.mockResolvedValue(null);
      const { req, res } = createMockReqRes({}, {}, { id: '999' });

      await handlers.getLogById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('retryLog', () => {
    test('retries failed log entry', async () => {
      IntegrationLog.findById.mockResolvedValue({ id: 1, status: 'failed' });
      IntegrationLog.updateStatus.mockResolvedValue({ id: 1, status: 'pending' });
      IntegrationLog.incrementRetry.mockResolvedValue({ id: 1, retry_count: 1 });
      const { req, res } = createMockReqRes({}, {}, { id: '1' });

      await handlers.retryLog(req, res);

      expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(1, 'pending', null);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('returns 400 for non-failed entry', async () => {
      IntegrationLog.findById.mockResolvedValue({ id: 1, status: 'success' });
      const { req, res } = createMockReqRes({}, {}, { id: '1' });

      await handlers.retryLog(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getRules', () => {
    test('returns all alert rules', async () => {
      AlertRule.findAll.mockResolvedValue([{ id: 1, alert_type: 'LEAK_DETECTED' }]);
      const { req, res } = createMockReqRes();

      await handlers.getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 1, alert_type: 'LEAK_DETECTED' }]
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/jest/unit/integrationRoutes.test.js
```

Expected: FAIL — `Cannot find module '../../../src/routes/integrationRoutes'`

- [ ] **Step 3: Write integrationRoutes**

```javascript
// src/routes/integrationRoutes.js

const express = require('express');
const { isAdmin } = require('../middleware/auth');
const ukIntegrationService = require('../services/ukIntegrationService');
const IntegrationLog = require('../models/IntegrationLog');
const AlertRule = require('../models/AlertRule');
const logger = require('../utils/logger');

const router = express.Router();

// All integration routes require admin
router.use(isAdmin);

const handlers = {
    async getConfig(req, res) {
        try {
            const config = await ukIntegrationService.getConfig();
            res.json({ success: true, data: config });
        } catch (error) {
            logger.error(`getConfig error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to get config' });
        }
    },

    async updateConfig(req, res) {
        try {
            await ukIntegrationService.updateConfig(req.body);
            const config = await ukIntegrationService.getConfig();
            res.json({ success: true, data: config, message: 'Config updated' });
        } catch (error) {
            if (error.message.includes('Cannot set sensitive key')) {
                return res.status(400).json({ success: false, message: error.message });
            }
            logger.error(`updateConfig error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to update config' });
        }
    },

    async getLogs(req, res) {
        try {
            const { page, limit, direction, status, entity_type, date_from, date_to } = req.query;
            const result = await IntegrationLog.findAll({
                page: parseInt(page, 10) || 1,
                limit: parseInt(limit, 10) || 20,
                direction,
                status,
                entity_type,
                date_from,
                date_to
            });
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error(`getLogs error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to get logs' });
        }
    },

    async getLogById(req, res) {
        try {
            const log = await IntegrationLog.findById(parseInt(req.params.id, 10));
            if (!log) {
                return res.status(404).json({ success: false, message: 'Log not found' });
            }
            res.json({ success: true, data: log });
        } catch (error) {
            logger.error(`getLogById error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to get log' });
        }
    },

    async retryLog(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            const log = await IntegrationLog.findById(id);
            if (!log) {
                return res.status(404).json({ success: false, message: 'Log not found' });
            }
            if (log.status !== 'error' && log.status !== 'failed') {
                return res.status(400).json({
                    success: false,
                    message: 'Can only retry failed or error entries'
                });
            }

            await IntegrationLog.updateStatus(id, 'pending', null);
            await IntegrationLog.incrementRetry(id);

            // Phase 1: only resets status. Actual re-execution of the operation
            // (re-sending webhook, re-creating request) is implemented in Phase 2+.
            logger.info(`Integration log ${id} marked for retry`);
            res.json({ success: true, message: 'Marked for retry' });
        } catch (error) {
            logger.error(`retryLog error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to retry' });
        }
    },

    async getRules(req, res) {
        try {
            const rules = await AlertRule.findAll();
            res.json({ success: true, data: rules });
        } catch (error) {
            logger.error(`getRules error: ${error.message}`);
            res.status(500).json({ success: false, message: 'Failed to get rules' });
        }
    }
};

router.get('/config', handlers.getConfig);
router.put('/config', handlers.updateConfig);
router.get('/logs', handlers.getLogs);
router.get('/logs/:id', handlers.getLogById);
router.post('/logs/retry/:id', handlers.retryLog);
router.get('/rules', handlers.getRules);

module.exports = router;
module.exports.handlers = handlers;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/jest/unit/integrationRoutes.test.js
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/integrationRoutes.js tests/jest/unit/integrationRoutes.test.js
git commit -m "feat: add integrationRoutes for admin config/logs/rules API

GET/PUT config, GET/GET:id/POST retry logs, GET rules.
All routes require isAdmin. 8 unit tests."
```

---

## Task 8: Mount Routes + Raw Body Middleware

**Files:**
- Modify: `src/server.js:49` — preserve rawBody for HMAC verification
- Modify: `src/routes/index.js:1-170`

- [ ] **Step 0: Add rawBody preservation to express.json (CRITICAL for HMAC)**

In `src/server.js`, change line 49 from:
```javascript
app.use(express.json({ limit: '1mb' })); // Парсинг JSON
```
to:
```javascript
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
})); // Парсинг JSON + rawBody для HMAC верификации вебхуков
```

Without this, `req.rawBody` is undefined and HMAC verification falls back to `JSON.stringify(req.body)`, which may produce different byte sequences than what UK signed — breaking all webhook authentication.

- [ ] **Step 1: Add imports**

After line 16 (`const powerAnalyticsRoutes = require('./powerAnalyticsRoutes');`), add:

```javascript
const webhookRoutes = require('./webhookRoutes');
const integrationRoutes = require('./integrationRoutes');
```

- [ ] **Step 2: Add webhook paths to PUBLIC_ROUTES**

Add two entries to the `PUBLIC_ROUTES` array (after the `GET /` entry):

```javascript
    { method: 'POST', path: '/webhooks/uk/building' },
    { method: 'POST', path: '/webhooks/uk/request' },
```

Note: The `isPublicRoute` check normalizes trailing slashes, but webhook paths have no trailing slash by convention. These entries bypass JWT auth — webhooks use HMAC auth instead.

- [ ] **Step 3: Mount routes**

After `router.use('/admin', adminRoutes);` (around line 169), add:

```javascript
router.use('/webhooks/uk', webhookRoutes);
router.use('/integration', integrationRoutes);
```

- [ ] **Step 4: Update endpoints list**

Add to the `endpoints` array in the root route handler:

```javascript
            '/api/webhooks/uk - Вебхуки интеграции с UK',
            '/api/integration - Управление интеграцией UK (админ)',
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All existing + new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server.js src/routes/index.js
git commit -m "feat: mount webhook and integration routes, add rawBody for HMAC

Adds express.json verify callback to preserve rawBody for HMAC verification.
Mounts /api/webhooks/uk/ (public, HMAC auth) and /api/integration/ (admin JWT).
Webhook paths added to PUBLIC_ROUTES allowlist."
```

---

## Task 9: Admin HTML — Integration Tab

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add tab button**

After the alerts tab button (`<button class="nav-btn" id="alerts-tab" ...>🚨 Тревоги</button>`), add:

```html
        <span class="nav-separator">|</span>
        <button class="nav-btn" data-section="integration" role="tab" aria-selected="false" aria-controls="integration-section">🔗 Интеграция UK</button>
```

- [ ] **Step 2: Add integration section HTML**

After the alerts section closing `</section>`, add the HTML below. **Note:** Use CSS classes from `public/css/admin.css` where available (e.g., `filters-panel`, `table-container`, `action-btn`, `pagination`). Add new classes to `admin.css` for integration-specific layout (e.g., `integration-status-panel`, `integration-settings`, `secrets-group`). Inline styles shown below are illustrative — implementer should extract to CSS classes for consistency with existing admin panel.

```html
    <!-- Integration UK Section -->
    <section id="integration-section" class="admin-section" role="tabpanel" aria-label="Интеграция UK">
        <h2>Интеграция с UK</h2>

        <!-- Toggle + Status -->
        <div class="integration-status-panel" style="display:flex; align-items:center; gap:20px; margin-bottom:20px; padding:15px; background:#f5f5f5; border-radius:8px;">
            <div class="integration-toggle" style="display:flex; align-items:center; gap:10px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="integration-enabled-toggle">
                    <span id="integration-status-label">Интеграция выключена</span>
                </label>
            </div>
            <div id="integration-connection-status" style="display:flex; align-items:center; gap:6px;">
                <span id="integration-status-dot" style="width:10px; height:10px; border-radius:50%; background:#ccc; display:inline-block;"></span>
                <span id="integration-status-text">Не подключено</span>
            </div>
        </div>

        <!-- Settings -->
        <div class="integration-settings" style="margin-bottom:30px;">
            <h3>Настройки подключения</h3>
            <div style="display:grid; gap:10px; max-width:500px;">
                <div>
                    <label for="integration-uk-api-url">UK API URL:</label>
                    <input type="text" id="integration-uk-api-url" placeholder="http://uk-api:8085/api/v2" style="width:100%; padding:6px;">
                </div>
                <div>
                    <label for="integration-uk-frontend-url">UK Frontend URL:</label>
                    <input type="text" id="integration-uk-frontend-url" placeholder="https://uk.domain.com" style="width:100%; padding:6px;">
                </div>
            </div>

            <h4 style="margin-top:15px;">Секреты (из переменных окружения)</h4>
            <div style="display:grid; gap:8px; max-width:500px; opacity:0.7;">
                <div><label>Webhook Secret:</label> <span class="secret-masked">●●●●●●●●</span></div>
                <div><label>Логин сервиса:</label> <span class="secret-masked">●●●●●●●●</span></div>
                <div><label>Пароль сервиса:</label> <span class="secret-masked">●●●●●●●●</span></div>
            </div>

            <div style="margin-top:15px;">
                <button id="integration-save-config" class="action-btn">Сохранить</button>
            </div>
        </div>

        <!-- Alert Rules (read-only in Phase 1) -->
        <div class="integration-rules" style="margin-bottom:30px;">
            <h3>Правила маппинга: Алерт → Заявка</h3>
            <div class="table-container">
                <table id="integration-rules-table" border="1">
                    <thead>
                        <tr>
                            <th>Вкл</th>
                            <th>Тип алерта</th>
                            <th>Серьёзность</th>
                            <th>Категория UK</th>
                            <th>Срочность UK</th>
                            <th>Описание</th>
                        </tr>
                    </thead>
                    <tbody id="integration-rules-body">
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Integration Log -->
        <div class="integration-log">
            <h3>Лог интеграции</h3>
            <div style="display:flex; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                <select id="integration-log-direction">
                    <option value="">Все направления</option>
                    <option value="to_uk">→ UK</option>
                    <option value="from_uk">← UK</option>
                </select>
                <select id="integration-log-status">
                    <option value="">Все статусы</option>
                    <option value="pending">Ожидание</option>
                    <option value="success">Успех</option>
                    <option value="error">Ошибка</option>
                    <option value="failed">Провал</option>
                </select>
                <select id="integration-log-entity">
                    <option value="">Все типы</option>
                    <option value="building">Здание</option>
                    <option value="alert">Алерт</option>
                    <option value="request">Заявка</option>
                </select>
                <button id="integration-log-apply-filters" class="action-btn">Применить</button>
                <button id="integration-log-clear-filters">Очистить</button>
            </div>
            <div class="table-container">
                <table id="integration-log-table" border="1">
                    <thead>
                        <tr>
                            <th>Время</th>
                            <th>Направление</th>
                            <th>Тип</th>
                            <th>ID</th>
                            <th>Действие</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody id="integration-log-body">
                    </tbody>
                </table>
            </div>
            <div class="pagination" id="integration-log-pagination"></div>
        </div>
    </section>
```

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: add Integration UK tab HTML to admin panel

Toggle, settings (masked secrets), alert rules table,
integration log viewer with filters and pagination."
```

---

## Task 10: Admin JS — Integration Tab Logic

**Files:**
- Modify: `public/admin.js`

- [ ] **Step 1: Add integration state object**

Near other state declarations at the top of the file, add:

```javascript
const integrationState = {
    config: {},
    rules: [],
    logs: { logs: [], total: 0 },
    logFilters: { page: 1, limit: 20, direction: '', status: '', entity_type: '' }
};
```

- [ ] **Step 2: Add integration functions**

Add at the end of admin.js (before the DOMContentLoaded closing brace, or as a standalone block):

```javascript
// ============================================================
// Integration UK Tab
// ============================================================

async function loadIntegrationConfig() {
    try {
        const response = await fetch(`${backendURL}/integration/config`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await response.json();
        if (data.success) {
            integrationState.config = data.data;
            renderIntegrationConfig();
        }
    } catch (error) {
        console.error('Failed to load integration config:', error);
    }
}

function renderIntegrationConfig() {
    const config = integrationState.config;
    const toggle = document.getElementById('integration-enabled-toggle');
    const label = document.getElementById('integration-status-label');
    const apiUrl = document.getElementById('integration-uk-api-url');
    const frontendUrl = document.getElementById('integration-uk-frontend-url');

    if (toggle) toggle.checked = config.uk_integration_enabled === 'true';
    if (label) label.textContent = config.uk_integration_enabled === 'true'
        ? 'Интеграция включена' : 'Интеграция выключена';
    if (apiUrl) apiUrl.value = config.uk_api_url || '';
    if (frontendUrl) frontendUrl.value = config.uk_frontend_url || '';
}

async function saveIntegrationConfig() {
    try {
        const toggle = document.getElementById('integration-enabled-toggle');
        const apiUrl = document.getElementById('integration-uk-api-url');
        const frontendUrl = document.getElementById('integration-uk-frontend-url');

        const body = {
            uk_integration_enabled: toggle.checked ? 'true' : 'false',
            uk_api_url: apiUrl.value.trim(),
            uk_frontend_url: frontendUrl.value.trim()
        };

        const response = await fetch(`${backendURL}/integration/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.success) {
            integrationState.config = data.data;
            renderIntegrationConfig();
            showToast('Настройки сохранены', 'success');
        } else {
            showToast('Ошибка: ' + (data.message || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        console.error('Failed to save integration config:', error);
        showToast('Ошибка сохранения настроек', 'error');
    }
}

async function loadIntegrationRules() {
    try {
        const response = await fetch(`${backendURL}/integration/rules`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await response.json();
        if (data.success) {
            integrationState.rules = data.data;
            renderIntegrationRules();
        }
    } catch (error) {
        console.error('Failed to load integration rules:', error);
    }
}

function renderIntegrationRules() {
    const tbody = document.getElementById('integration-rules-body');
    if (!tbody) return;

    tbody.textContent = '';
    integrationState.rules.forEach(rule => {
        const tr = document.createElement('tr');
        const cells = [
            rule.enabled ? '☑' : '☐',
            rule.alert_type,
            rule.severity,
            rule.uk_category,
            rule.uk_urgency,
            rule.description || ''
        ];
        cells.forEach(text => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

async function loadIntegrationLogs() {
    try {
        const f = integrationState.logFilters;
        const params = new URLSearchParams();
        params.set('page', f.page);
        params.set('limit', f.limit);
        if (f.direction) params.set('direction', f.direction);
        if (f.status) params.set('status', f.status);
        if (f.entity_type) params.set('entity_type', f.entity_type);

        const response = await fetch(`${backendURL}/integration/logs?${params}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await response.json();
        if (data.success) {
            integrationState.logs = data.data;
            renderIntegrationLogs();
        }
    } catch (error) {
        console.error('Failed to load integration logs:', error);
    }
}

function renderIntegrationLogs() {
    const tbody = document.getElementById('integration-log-body');
    if (!tbody) return;

    const { logs, total } = integrationState.logs;
    const directionMap = { to_uk: '→ UK', from_uk: '← UK' };
    const statusMap = { success: 'Успех', error: 'Ошибка', failed: 'Провал', pending: 'Ожидание' };

    tbody.textContent = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');

        const timeCell = document.createElement('td');
        timeCell.textContent = new Date(log.created_at).toLocaleString('ru-RU');
        tr.appendChild(timeCell);

        const dirCell = document.createElement('td');
        dirCell.textContent = directionMap[log.direction] || log.direction;
        tr.appendChild(dirCell);

        const typeCell = document.createElement('td');
        typeCell.textContent = log.entity_type;
        tr.appendChild(typeCell);

        const idCell = document.createElement('td');
        idCell.textContent = log.entity_id || '—';
        tr.appendChild(idCell);

        const actionCell = document.createElement('td');
        actionCell.textContent = log.action;
        tr.appendChild(actionCell);

        const statusCell = document.createElement('td');
        statusCell.textContent = statusMap[log.status] || log.status;
        tr.appendChild(statusCell);

        const actionsCell = document.createElement('td');
        if (log.status === 'error' || log.status === 'failed') {
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '↻ Повторить';
            retryBtn.className = 'btn-retry';
            retryBtn.dataset.logId = log.id;
            actionsCell.appendChild(retryBtn);
        }
        tr.appendChild(actionsCell);

        tbody.appendChild(tr);
    });

    // Pagination
    const paginationEl = document.getElementById('integration-log-pagination');
    if (paginationEl) {
        const f = integrationState.logFilters;
        const totalPages = Math.ceil(total / f.limit) || 1;
        paginationEl.textContent = '';

        const info = document.createElement('span');
        info.textContent = `Показано ${logs.length} из ${total} | Стр. ${f.page} / ${totalPages}`;
        paginationEl.appendChild(info);

        if (f.page > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.textContent = '← Пред';
            prevBtn.id = 'integration-log-prev';
            paginationEl.appendChild(prevBtn);
        }
        if (f.page < totalPages) {
            const nextBtn = document.createElement('button');
            nextBtn.textContent = 'След →';
            nextBtn.id = 'integration-log-next';
            paginationEl.appendChild(nextBtn);
        }
    }
}

async function retryIntegrationLog(logId) {
    try {
        const response = await fetch(`${backendURL}/integration/logs/retry/${logId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await response.json();
        if (data.success) {
            loadIntegrationLogs();
        } else {
            showToast('Ошибка повтора: ' + (data.message || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        console.error('Failed to retry log:', error);
    }
}

function initIntegrationTab() {
    const saveBtn = document.getElementById('integration-save-config');
    if (saveBtn) saveBtn.addEventListener('click', saveIntegrationConfig);

    const toggle = document.getElementById('integration-enabled-toggle');
    if (toggle) {
        toggle.addEventListener('change', () => {
            const label = document.getElementById('integration-status-label');
            if (label) label.textContent = toggle.checked
                ? 'Интеграция включена' : 'Интеграция выключена';
        });
    }

    const applyFilters = document.getElementById('integration-log-apply-filters');
    if (applyFilters) {
        applyFilters.addEventListener('click', () => {
            integrationState.logFilters.direction = document.getElementById('integration-log-direction').value;
            integrationState.logFilters.status = document.getElementById('integration-log-status').value;
            integrationState.logFilters.entity_type = document.getElementById('integration-log-entity').value;
            integrationState.logFilters.page = 1;
            loadIntegrationLogs();
        });
    }

    const clearFilters = document.getElementById('integration-log-clear-filters');
    if (clearFilters) {
        clearFilters.addEventListener('click', () => {
            document.getElementById('integration-log-direction').value = '';
            document.getElementById('integration-log-status').value = '';
            document.getElementById('integration-log-entity').value = '';
            integrationState.logFilters = { page: 1, limit: 20, direction: '', status: '', entity_type: '' };
            loadIntegrationLogs();
        });
    }

    // Event delegation for retry buttons and pagination
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-retry') && e.target.dataset.logId) {
            retryIntegrationLog(e.target.dataset.logId);
        }
        if (e.target.id === 'integration-log-prev') {
            integrationState.logFilters.page--;
            loadIntegrationLogs();
        }
        if (e.target.id === 'integration-log-next') {
            integrationState.logFilters.page++;
            loadIntegrationLogs();
        }
    });
}
```

- [ ] **Step 3: Hook into tab switching**

In `public/admin.js`, find `function loadSectionData(sectionName)` at ~line 365. Inside the `switch(sectionName)` block (before the closing `}`), add a new case:

```javascript
            case 'integration':
                loadIntegrationConfig();
                loadIntegrationRules();
                loadIntegrationLogs();
                break;
```

Also call `initIntegrationTab();` after the existing init calls (~line 1510, inside the DOMContentLoaded handler or the `admin-auth-ready` event handler).

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin.js
git commit -m "feat: add integration tab JS logic to admin panel

Config toggle/save, alert rules display (DOM API, no innerHTML),
integration log viewer with filters, pagination, and retry."
```

---

## Task 11: Run Full Test Suite and Verify

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: All tests PASS including ~41 new integration tests.

- [ ] **Step 2: Verify test count increased**

```bash
npm test -- --verbose 2>&1 | tail -20
```

Expected: Test suite count increased by 5 (integrationConfig, integrationLog, ukIntegrationService, webhookRoutes, integrationRoutes).

- [ ] **Step 3: Verify migration (if Docker running)**

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe -f /dev/stdin < database/migrations/011_uk_integration.sql
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe -c "SELECT * FROM integration_config;"
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe -c "SELECT count(*) FROM alert_rules;"
```

Expected: 3 config rows, 7 alert rules.

- [ ] **Step 4: Final commit if needed**

```bash
git status
```

If remaining changes exist, commit them.

---

## Summary

| Task | Description | New Tests | Files |
| --- | --- | --- | --- |
| 1 | DB Migration 011 | 0 | 1 new |
| 2 | IntegrationConfig model | 9 | 2 new |
| 3 | IntegrationLog model | 10 | 2 new |
| 4 | AlertRule + AlertRequestMap stubs | 0 | 2 new |
| 5 | ukIntegrationService scaffold | 11 | 2 new |
| 6 | webhookRoutes | 5 | 2 new |
| 7 | integrationRoutes | 8 | 2 new |
| 8 | Mount routes + rawBody | 0 | 2 modified |
| 9 | Admin HTML tab | 0 | 1 modified |
| 10 | Admin JS logic | 0 | 1 modified |
| 11 | Full verification | 0 | 0 |
| **Total** | | **~43** | **13 new, 4 modified** |

**Phase 1 Deliverable:** Admin can enable/disable UK integration, configure API URLs, view masked secrets, see alert mapping rules (read-only), and browse/filter/retry integration logs — all from the admin panel. Webhook endpoints accept HMAC-signed requests from UK and log events. No actual building sync or alert-to-request pipeline yet (Phase 2-3).
