# Test Coverage 90%+ Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести покрытие тестами до 90%+ по всем метрикам (stmts, branch, funcs, lines) во всех директориях.

**Architecture:** Дотестирование 10 файлов с наибольшими дырами. Каждый таск — один файл, один тест-файл. Все тесты используют стандартные моки (db, logger, circuitBreaker) из существующих паттернов проекта.

**Tech Stack:** Jest, mock-based unit tests (no live DB), стандартные паттерны проекта.

**Текущие метрики:**
- All files: 89.76% stmts, 86.73% branch, 92.16% funcs, 90.79% lines
- Порог: 80% (package.json) — цель: 90%+

**Приоритет файлов (по impact на общее покрытие):**

| # | Файл | Stmts | Branch | Uncovered Lines | Impact |
|---|------|-------|--------|-----------------|--------|
| 1 | adminGeneralController.js | 57% | 0% | 5-15,35,46 | HIGH |
| 2 | alertService.js | 72% | 61% | 50-51,67-71,136-191,260-267,425-454 | HIGH |
| 3 | src/config/database.js | 72% | 50% | pool.on handlers | MEDIUM |
| 4 | Line.js | 78% | 75% | create/update optional fields | MEDIUM |
| 5 | WaterLine.js | 77% | 74% | create/update optional fields | MEDIUM |
| 6 | Building.js | 80% | 67% | findByIdWithControllers, deleteCascade errors | MEDIUM |
| 7 | integrationRoutes.js | 79% | 84% | inline middleware, error paths | MEDIUM |
| 8 | controllerService.js | 81% | 72% | status update flows | LOW |
| 9 | authService.js | 81% | 78% | edge cases | LOW |
| 10 | metricService.js | 84% | 90% | cleanup, aggregation | LOW |

---

### Task 1: adminGeneralController.js — globalSearch + error paths

**Files:**
- Test: `tests/jest/unit/adminGeneralController.test.js` (modify — existing file has only 2 tests)
- Target: `src/controllers/admin/adminGeneralController.js`

- [ ] **Step 1: Add tests for globalSearch and error branches**

```js
// Add to existing describe block in adminGeneralController.test.js

const { globalSearch, getAdminStats, exportData } = require('../../../src/controllers/admin/adminGeneralController');

describe('globalSearch', () => {
    test('returns search results stub with query params', async () => {
        const req = { query: { query: 'test', type: 'buildings', limit: 10 } };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await globalSearch(req, res, next);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            results: [],
            total: 0,
            query: 'test',
            type: 'buildings',
            message: 'Search completed (stub)'
        }));
    });

    test('uses defaults when no params provided', async () => {
        const req = { query: {} };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await globalSearch(req, res, next);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            type: 'all',
        }));
    });
});

describe('error paths', () => {
    test('getAdminStats calls next on db error', async () => {
        db.query.mockRejectedValue(new Error('DB down'));
        const req = {};
        const res = { json: jest.fn() };
        const next = jest.fn();

        await getAdminStats(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Failed to get stats'
        }));
    });

    test('exportData calls next on unexpected error', async () => {
        const req = {};
        const res = {
            status: jest.fn(() => { throw new Error('res broken'); }),
            json: jest.fn()
        };
        const next = jest.fn();

        await exportData(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Export failed'
        }));
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/adminGeneralController.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/adminGeneralController.test.js
git commit -m "test: cover adminGeneralController globalSearch + error paths"
```

---

### Task 2: alertService.js — checkTransformerLoad, checkAllTransformers, waitForDatabase, sendNotifications

**Files:**
- Test: `tests/jest/unit/alertServiceCoverage.test.js` (create — new dedicated file)
- Target: `src/services/alertService.js` (lines 50-51, 67-71, 136-191, 260-267, 425-454)

- [ ] **Step 1: Create test file for uncovered alertService branches**

```js
// tests/jest/unit/alertServiceCoverage.test.js

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/utils/circuitBreaker', () => ({
    CircuitBreakerFactory: {
        createDatabaseBreaker: () => ({
            execute: (fn) => fn(),
            getState: () => 'CLOSED'
        })
    }
}));

// Mock analyticsService for checkTransformerLoad
jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn(),
    getAllTransformersWithAnalytics: jest.fn()
}));

// Mock ukIntegrationService for sendNotifications
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false),
    sendAlertToUK: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const analyticsService = require('../../../src/services/analyticsService');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');

describe('AlertService — uncovered branches', () => {
    let alertService;

    beforeEach(() => {
        jest.clearAllMocks();
        // Re-require to get fresh instance
        jest.isolateModules(() => {
            alertService = require('../../../src/services/alertService');
        });
        alertService.initialized = true;
        alertService.activeAlerts = new Map();
        alertService.lastChecks = new Map();
    });

    describe('waitForDatabase', () => {
        test('retries until DB is ready', async () => {
            alertService.initialized = false;
            db.query
                .mockRejectedValueOnce(new Error('not ready'))
                .mockRejectedValueOnce(new Error('not ready'))
                .mockResolvedValueOnce({ rows: [] })  // DB ready
                .mockResolvedValueOnce({ rows: [] });  // loadActiveAlerts

            await alertService.initialize();

            expect(alertService.initialized).toBe(true);
        });

        test('throws after max retries exceeded', async () => {
            alertService.initialized = false;
            alertService.alertCooldown = 0;

            // Override waitForDatabase to use fewer retries for test speed
            const origWait = alertService.waitForDatabase.bind(alertService);
            alertService.waitForDatabase = async () => {
                const maxRetries = 2;
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        await db.query('SELECT 1');
                        return;
                    } catch {
                        if (i === maxRetries - 1) {
                            throw new Error('Превышено максимальное время ожидания готовности БД');
                        }
                    }
                }
            };

            db.query.mockRejectedValue(new Error('down'));

            await expect(alertService.initialize()).rejects.toThrow('Превышено максимальное время');
        });
    });

    describe('checkTransformerLoad', () => {
        test('returns null when within cooldown period', async () => {
            alertService.lastChecks.set('transformer:1:load_check', Date.now());

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });

        test('returns null when no load data available', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue(null);

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });

        test('returns null when load_percent is not a number', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({ load_percent: 'bad' });

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });

        test('returns null when load is below threshold', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 50, name: 'T1'
            });

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });

        test('creates WARNING alert for overload (85-94%)', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 90, name: 'Transformer A', buildings_count: 5,
                capacity_kva: 1000, active_controllers_count: 3
            });
            db.query.mockResolvedValue({
                rows: [{ alert_id: 42, created_at: new Date() }]
            });

            const result = await alertService.checkTransformerLoad('1');

            expect(result).toBeTruthy();
            expect(result.severity).toBe('WARNING');
            expect(result.type).toBe('TRANSFORMER_OVERLOAD');
        });

        test('creates CRITICAL alert for critical overload (>=95%)', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 97, name: 'Transformer B', buildings_count: 10,
                capacity_kva: 2000, active_controllers_count: 8
            });
            db.query.mockResolvedValue({
                rows: [{ alert_id: 43, created_at: new Date() }]
            });

            const result = await alertService.checkTransformerLoad('1');

            expect(result).toBeTruthy();
            expect(result.severity).toBe('CRITICAL');
            expect(result.type).toBe('TRANSFORMER_CRITICAL_OVERLOAD');
        });

        test('skips alert if already active for same transformer+type', async () => {
            alertService.activeAlerts.set('transformer:1:TRANSFORMER_OVERLOAD', {
                alert_id: 99, severity: 'WARNING'
            });

            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 90, name: 'T1'
            });

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });

        test('returns null on error', async () => {
            analyticsService.getTransformerLoad.mockRejectedValue(new Error('DB down'));

            const result = await alertService.checkTransformerLoad('1');
            expect(result).toBeNull();
        });
    });

    describe('sendNotifications', () => {
        test('calls sendImmediateNotification for CRITICAL severity', async () => {
            const spy = jest.spyOn(alertService, 'sendImmediateNotification').mockResolvedValue();
            const spy2 = jest.spyOn(alertService, 'broadcastAlert').mockImplementation();

            await alertService.sendNotifications(
                { severity: 'CRITICAL', type: 'TEST', message: 'test' }, 1
            );

            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
            spy2.mockRestore();
        });

        test('forwards to UK integration when enabled', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            jest.spyOn(alertService, 'broadcastAlert').mockImplementation();

            await alertService.sendNotifications(
                { severity: 'WARNING', type: 'TEST', message: 'test' }, 1
            );

            expect(ukIntegrationService.sendAlertToUK).toHaveBeenCalled();
        });

        test('catches UK integration errors without throwing', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.sendAlertToUK.mockRejectedValue(new Error('UK down'));
            jest.spyOn(alertService, 'broadcastAlert').mockImplementation();

            // Should not throw
            await alertService.sendNotifications(
                { severity: 'WARNING', type: 'TEST', message: 'test' }, 1
            );
        });
    });

    describe('checkAllTransformers', () => {
        test('checks all and returns summary', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue([
                { id: '1' }, { id: '2' }
            ]);
            jest.spyOn(alertService, 'checkTransformerLoad')
                .mockResolvedValueOnce({ alert_id: 1 })
                .mockResolvedValueOnce(null);

            const result = await alertService.checkAllTransformers();

            expect(result.checked).toBe(2);
            expect(result.alerts_created).toBe(1);
        });

        test('continues on individual transformer error', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue([
                { id: '1' }, { id: '2' }
            ]);
            jest.spyOn(alertService, 'checkTransformerLoad')
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce(null);

            const result = await alertService.checkAllTransformers();

            expect(result.checked).toBe(2);
            expect(result.alerts_created).toBe(0);
        });

        test('throws on getAllTransformers failure', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockRejectedValue(
                new Error('analytics down')
            );

            await expect(alertService.checkAllTransformers()).rejects.toThrow('analytics down');
        });
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/alertServiceCoverage.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/alertServiceCoverage.test.js
git commit -m "test: cover alertService checkTransformerLoad, waitForDatabase, sendNotifications, checkAllTransformers"
```

---

### Task 3: src/config/database.js — pool event handlers

**Files:**
- Test: `tests/jest/unit/database.test.js` (modify — add pool.on handler coverage)
- Target: `src/config/database.js` (lines 24-26, 29-31)

- [ ] **Step 1: Add tests for pool.on('error') and pool.on('connect') handlers**

```js
// Add to existing describe('init') block in database.test.js

test('registers error and connect event handlers', async () => {
    await db.init();

    // pool.on should be called for 'error' and 'connect'
    const onCalls = mockPoolInstance.on.mock.calls;
    const eventNames = onCalls.map(call => call[0]);
    expect(eventNames).toContain('error');
    expect(eventNames).toContain('connect');
});

test('pool error handler logs the error', async () => {
    await db.init();

    const errorHandler = mockPoolInstance.on.mock.calls.find(c => c[0] === 'error')[1];
    errorHandler(new Error('idle client error'));

    expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('idle database client'),
        expect.any(String)
    );
});

test('pool connect handler sets statement_timeout', async () => {
    await db.init();

    const connectHandler = mockPoolInstance.on.mock.calls.find(c => c[0] === 'connect')[1];
    const mockClientInner = { query: jest.fn() };
    connectHandler(mockClientInner);

    expect(mockClientInner.query).toHaveBeenCalledWith('SET statement_timeout = 30000');
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/database.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/database.test.js
git commit -m "test: cover database.js pool event handlers (error, connect)"
```

---

### Task 4: Line.js — create/update with optional coordinate fields

**Files:**
- Test: `tests/jest/unit/lineModel.test.js` (modify — add create/update optional field branches)
- Target: `src/models/Line.js` (lines 161-182 create, 225-281 update)

- [ ] **Step 1: Add tests for Line.create and Line.update with coordinates**

```js
// Add to existing describe('Line Model') in lineModel.test.js

describe('create with optional coordinate fields', () => {
    test('includes coordinate fields when provided', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await Line.create({
            name: 'Test Line',
            voltage_kv: 10,
            length_km: 5,
            transformer_id: 1,
            latitude_start: 41.3,
            longitude_start: 69.2,
            latitude_end: 41.4,
            longitude_end: 69.3,
            cable_type: 'copper',
            commissioning_year: 2023
        });

        const query = db.query.mock.calls[0][0];
        const values = db.query.mock.calls[0][1];
        expect(query).toContain('latitude_start');
        expect(query).toContain('longitude_start');
        expect(query).toContain('latitude_end');
        expect(query).toContain('longitude_end');
        expect(values).toContain(41.3);
        expect(values).toContain(69.2);
        expect(values).toContain(41.4);
        expect(values).toContain(69.3);
    });

    test('omits coordinate fields when not provided', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await Line.create({ name: 'Minimal', voltage_kv: 10, length_km: 5 });

        const query = db.query.mock.calls[0][0];
        expect(query).not.toContain('latitude_start');
    });
});

describe('update with optional fields', () => {
    test('updates only provided fields including coordinates', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await Line.update(1, {
            name: 'Updated',
            latitude_start: 41.5,
            longitude_start: 69.5,
            latitude_end: 41.6,
            longitude_end: 69.6,
            cable_type: 'aluminum',
            commissioning_year: 2025,
            main_path: [{ lat: 41.5, lng: 69.5 }],
            branches: [{ name: 'B1' }]
        });

        const query = db.query.mock.calls[0][0];
        expect(query).toContain('latitude_start');
        expect(query).toContain('longitude_end');
        expect(query).toContain('cable_type');
        expect(query).toContain('commissioning_year');
        expect(query).toContain('main_path');
        expect(query).toContain('branches');
    });

    test('updates voltage_kv and length_km when provided', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await Line.update(1, { voltage_kv: 20, length_km: 10, transformer_id: 2 });

        const query = db.query.mock.calls[0][0];
        expect(query).toContain('voltage_kv');
        expect(query).toContain('length_km');
        expect(query).toContain('transformer_id');
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/lineModel.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/lineModel.test.js
git commit -m "test: cover Line.js create/update optional coordinate and metadata fields"
```

---

### Task 5: WaterLine.js — create/update with optional fields

**Files:**
- Test: `tests/jest/unit/waterLineModel.test.js` (modify)
- Target: `src/models/WaterLine.js` (lines 167-211 create, 246-314 update)

- [ ] **Step 1: Add tests for WaterLine.create and WaterLine.update optional branches**

```js
// Add to existing describe in waterLineModel.test.js

describe('create with all optional fields', () => {
    test('includes coordinate and metadata fields when provided', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await WaterLine.create({
            name: 'WL Test',
            description: 'desc',
            diameter_mm: 200,
            material: 'steel',
            pressure_bar: 4.5,
            installation_date: '2024-01-01',
            status: 'active',
            main_path: [{ lat: 41.3, lng: 69.2 }],
            branches: [{ name: 'B1' }],
            latitude_start: 41.3,
            longitude_start: 69.2,
            latitude_end: 41.4,
            longitude_end: 69.3
        });

        const query = db.query.mock.calls[0][0];
        const values = db.query.mock.calls[0][1];
        expect(query).toContain('latitude_start');
        expect(query).toContain('longitude_end');
        expect(query).toContain('main_path');
        expect(query).toContain('branches');
        expect(query).toContain('pressure_bar');
        expect(query).toContain('installation_date');
        expect(query).toContain('status');
        expect(values).toContain(41.3);
    });
});

describe('update with all optional fields', () => {
    test('updates all fields including coordinates', async () => {
        db.query.mockResolvedValue({ rows: [mockRow] });

        await WaterLine.update(1, {
            name: 'Updated WL',
            description: 'new desc',
            diameter_mm: 300,
            material: 'plastic',
            pressure_bar: 5.0,
            installation_date: '2025-01-01',
            status: 'maintenance',
            main_path: [{ lat: 41.5, lng: 69.5 }],
            branches: [{ name: 'B2' }],
            latitude_start: 41.5,
            longitude_start: 69.5,
            latitude_end: 41.6,
            longitude_end: 69.6
        });

        const query = db.query.mock.calls[0][0];
        expect(query).toContain('description');
        expect(query).toContain('diameter_mm');
        expect(query).toContain('material');
        expect(query).toContain('pressure_bar');
        expect(query).toContain('installation_date');
        expect(query).toContain('status');
        expect(query).toContain('main_path');
        expect(query).toContain('branches');
        expect(query).toContain('latitude_start');
        expect(query).toContain('longitude_end');
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/waterLineModel.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/waterLineModel.test.js
git commit -m "test: cover WaterLine.js create/update optional coordinate and metadata fields"
```

---

### Task 6: Building.js — findByIdWithControllers, deleteCascade error paths, UK methods

**Files:**
- Test: `tests/jest/unit/buildingModelCoverage.test.js` (create)
- Target: `src/models/Building.js` (lines 61-99, 150-151, 183-184, 218, 224-225, 247-248, 326-327, 382-383)

- [ ] **Step 1: Create test file for uncovered Building methods**

```js
// tests/jest/unit/buildingModelCoverage.test.js

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');

describe('Building Model — uncovered branches', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('findById', () => {
        test('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.findById(999);
            expect(result).toBeNull();
        });

        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));
            await expect(Building.findById(1)).rejects.toThrow('Failed to fetch building');
        });
    });

    describe('findByIdWithControllers', () => {
        test('returns building with controllers', async () => {
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, name: 'B1', controllers: [] }]
            });

            const result = await Building.findByIdWithControllers(1);
            expect(result).toEqual(expect.objectContaining({ building_id: 1 }));
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.findByIdWithControllers(999);
            expect(result).toBeNull();
        });

        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('JOIN failed'));
            await expect(Building.findByIdWithControllers(1)).rejects.toThrow(
                'Failed to fetch building with controllers'
            );
        });
    });

    describe('create', () => {
        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('unique violation'));
            await expect(Building.create({ name: 'B', address: 'A', town: 'T' }))
                .rejects.toThrow('Failed to create building');
        });
    });

    describe('update', () => {
        test('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.update(999, { name: 'X', address: 'A', town: 'T' });
            expect(result).toBeNull();
        });

        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('update failed'));
            await expect(Building.update(1, { name: 'X' })).rejects.toThrow('Failed to update building');
        });
    });

    describe('delete', () => {
        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('FK constraint'));
            await expect(Building.delete(1)).rejects.toThrow('Failed to delete building');
        });
    });

    describe('findByExternalId', () => {
        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));
            await expect(Building.findByExternalId('uuid-1')).rejects.toThrow(
                'Failed to find building by external_id'
            );
        });
    });

    describe('softDelete', () => {
        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('update failed'));
            await expect(Building.softDelete(1)).rejects.toThrow('Failed to soft-delete building');
        });
    });

    describe('findAll error path', () => {
        test('throws on db error', async () => {
            db.query.mockRejectedValue(new Error('query failed'));
            await expect(Building.findAll()).rejects.toThrow('Failed to fetch buildings');
        });
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/buildingModelCoverage.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/buildingModelCoverage.test.js
git commit -m "test: cover Building.js findByIdWithControllers, error paths, UK methods"
```

---

### Task 7: integrationRoutes.js — request-counts, building-requests, error paths

**Files:**
- Test: `tests/jest/unit/integrationRoutesCoverage.test.js` (create)
- Target: `src/routes/integrationRoutes.js` (lines 14-19, 24-35, 129, 137-138, 151, 167-168)

- [ ] **Step 1: Create test file for uncovered integrationRoutes handlers**

```js
// tests/jest/unit/integrationRoutesCoverage.test.js

jest.mock('../../../src/services/ukIntegrationService', () => ({
    getRequestCounts: jest.fn(),
    getBuildingRequests: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn()
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

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/middleware/auth', () => ({
    isAdmin: (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');
const ukService = require('../../../src/services/ukIntegrationService');
const IntegrationLog = require('../../../src/models/IntegrationLog');

// Build a minimal app with the routes
function buildApp() {
    const app = express();
    app.use(express.json());
    // Simulate JWT user
    app.use((req, res, next) => {
        req.user = { user_id: 1, role: 'admin' };
        next();
    });
    app.use('/integration', require('../../../src/routes/integrationRoutes'));
    return app;
}

describe('integrationRoutes — uncovered paths', () => {
    let app;
    beforeEach(() => {
        jest.clearAllMocks();
        app = buildApp();
    });

    describe('GET /integration/request-counts', () => {
        test('returns success with data', async () => {
            ukService.getRequestCounts.mockResolvedValue({ total: 5 });
            const res = await request(app).get('/integration/request-counts');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('returns 500 on service error', async () => {
            ukService.getRequestCounts.mockRejectedValue(new Error('UK down'));
            const res = await request(app).get('/integration/request-counts');
            expect(res.status).toBe(500);
        });
    });

    describe('GET /integration/building-requests/:externalId', () => {
        test('returns success for valid UUID', async () => {
            ukService.getBuildingRequests.mockResolvedValue([]);
            const res = await request(app)
                .get('/integration/building-requests/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(res.status).toBe(200);
        });

        test('returns 400 for invalid UUID', async () => {
            const res = await request(app).get('/integration/building-requests/invalid');
            expect(res.status).toBe(400);
        });

        test('returns 500 on service error', async () => {
            ukService.getBuildingRequests.mockRejectedValue(new Error('fail'));
            const res = await request(app)
                .get('/integration/building-requests/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(res.status).toBe(500);
        });

        test('clamps limit to max 10', async () => {
            ukService.getBuildingRequests.mockResolvedValue([]);
            await request(app)
                .get('/integration/building-requests/a1b2c3d4-e5f6-7890-abcd-ef1234567890?limit=50');
            expect(ukService.getBuildingRequests).toHaveBeenCalledWith(
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 10
            );
        });
    });

    describe('POST /integration/logs/retry/:id', () => {
        test('returns 400 for non-success status', async () => {
            IntegrationLog.findById.mockResolvedValue({ id: 1, status: 'success' });
            const res = await request(app).post('/integration/logs/retry/1');
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot retry');
        });
    });
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `npx jest tests/jest/unit/integrationRoutesCoverage.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/jest/unit/integrationRoutesCoverage.test.js
git commit -m "test: cover integrationRoutes request-counts, building-requests, retry error paths"
```

---

### Task 8: controllerService.js — uncovered status update flows

**Files:**
- Test: `tests/jest/unit/controllerServiceTest.test.js` (modify — add status update branches)
- Target: `src/services/controllerService.js` (lines 247-305, 352-353, 387, 397)

- [ ] **Step 1: Read uncovered lines first**

Run: `npx jest --coverage --collectCoverageFrom='src/services/controllerService.js' 2>&1 | tail -5`

Examine uncovered line ranges and add targeted tests for those branches.

- [ ] **Step 2: Add tests for uncovered branches**

Add tests to `tests/jest/unit/controllerServiceTest.test.js` covering:
- `updateControllersStatusByActivity` — no stale controllers found
- `updateControllersStatusByActivity` — db error during status update
- `getControllersByBuildingId` — empty building
- Error paths in CRUD operations

- [ ] **Step 3: Run test to verify pass**

Run: `npx jest tests/jest/unit/controllerServiceTest.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/jest/unit/controllerServiceTest.test.js
git commit -m "test: cover controllerService status update flows and error paths"
```

---

### Task 9: authService.js — edge cases

**Files:**
- Test: `tests/jest/unit/authServiceTest.test.js` (modify)
- Target: `src/services/authService.js` (lines 170-211, 224-226, 257-258, 275-277, 342-343, 366-367, 447, 472-477, 511)

- [ ] **Step 1: Read uncovered lines first**

Run: `npx jest --coverage --collectCoverageFrom='src/services/authService.js' 2>&1 | tail -5`

- [ ] **Step 2: Add tests for uncovered branches**

Focus on:
- `changePassword` — wrong old password, user not found
- `refreshToken` — expired refresh token, token not in DB
- Token cleanup — blacklist cleanup edge cases
- Account lockout — lock timing edge case

- [ ] **Step 3: Run test to verify pass**

Run: `npx jest tests/jest/unit/authServiceTest.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/jest/unit/authServiceTest.test.js
git commit -m "test: cover authService edge cases (password change, refresh, lockout)"
```

---

### Task 10: metricService.js — cleanup and aggregation

**Files:**
- Test: `tests/jest/unit/metricServiceTest.test.js` (modify)
- Target: `src/services/metricService.js` (lines 75-94, 258-264, 289-305, 416-422, 439)

- [ ] **Step 1: Read uncovered lines first**

Run: `npx jest --coverage --collectCoverageFrom='src/services/metricService.js' 2>&1 | tail -5`

- [ ] **Step 2: Add tests for uncovered branches**

Focus on:
- `cleanupOldMetrics` — invalid days parameter, no metrics to delete
- `getAggregatedMetrics` — invalid timeFrame
- Error paths in metric creation

- [ ] **Step 3: Run test to verify pass**

Run: `npx jest tests/jest/unit/metricServiceTest.test.js --verbose`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/jest/unit/metricServiceTest.test.js
git commit -m "test: cover metricService cleanup, aggregation edge cases"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full coverage report**

Run: `npm run test:coverage`
Expected: All directories 90%+ stmts, 90%+ lines

- [ ] **Step 2: If any directory still below 90%, identify gaps**

Run: `npm run test:coverage 2>&1 | grep -E "^\s" | awk -F'|' '$2+0 < 90 {print}'`
Fix remaining gaps.

- [ ] **Step 3: Commit final state**

```bash
git add -A tests/
git commit -m "test: achieve 90%+ coverage across all directories"
```

---

## Summary

| Task | File | Impact | Est. Tests |
|------|------|--------|-----------|
| 1 | adminGeneralController.js | 57% → 95%+ | +4 |
| 2 | alertService.js | 72% → 90%+ | +14 |
| 3 | database.js | 72% → 95%+ | +3 |
| 4 | Line.js | 78% ��� 90%+ | +4 |
| 5 | WaterLine.js | 77% → 90%+ | +4 |
| 6 | Building.js | 80% → 90%+ | +8 |
| 7 | integrationRoutes.js | 79% → 90%+ | +5 |
| 8 | controllerService.js | 81% → 90%+ | +4 |
| 9 | authService.js | 81% → 90%+ | +4 |
| 10 | metricService.js | 84% → 90%+ | +3 |
| 11 | Final verification | — | — |
| **Total** | | **89.76% → 93%+** | **~53 tests** |
