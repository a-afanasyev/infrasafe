# UK Integration Phase 3: Alert → Request Pipeline

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** When InfraSafe creates an alert, automatically create a corresponding request in the UK system for each affected building.

**Architecture:** The alert pipeline hooks into `alertService.sendNotifications()` to call `ukIntegrationService.sendAlertToUK()` after every alert creation. The service matches the alert against `alert_rules` to determine UK category/urgency, resolves affected building IDs from infrastructure FK relationships (transformer→buildings, controller→buildings, water_source→buildings, heat_source→buildings), and creates one UK request per building via a new `ukApiClient` that handles JWT authentication and exponential-backoff retries. Each request is tracked in `alert_request_map` with a UUID idempotency key to prevent duplicates.

**Tech Stack:** Node.js, pg, axios (already in dependencies) for UK API calls, Jest for tests

**Spec:** Section 5 of the v2 UK Integration design

---

## File Map

### New files to create

| File | Responsibility |
|------|---------------|
| `src/clients/ukApiClient.js` | JWT login to UK API, token caching, POST request creation with retry |
| `tests/jest/unit/ukApiClient.test.js` | Unit tests for UK API client (auth, retry, error handling) |
| `tests/jest/unit/alertPipeline.test.js` | Integration-style unit tests for the full alert→UK pipeline |

### Files to modify

| File | Change |
|------|--------|
| `src/models/AlertRule.js` | Add `findByTypeAndSeverity(alertType, severity)` static method |
| `src/models/AlertRequestMap.js` | Add `create()`, `findByAlertAndBuilding()`, `markSent()`, `findByIdempotencyKey()` static methods |
| `src/services/ukIntegrationService.js` | Add `sendAlertToUK()`, `resolveBuildingIds()`, `_mapInfrastructureToBuildings()` |
| `src/services/alertService.js` | Add UK integration hook inside `sendNotifications()` |

---

## Task 1: Add `findByTypeAndSeverity()` to AlertRule model

**Files:**
- Modify: `src/models/AlertRule.js`
- Test: `tests/jest/unit/alertPipeline.test.js` (partial — AlertRule section)

### Step 1: Write test (RED)

- [ ] **Create `tests/jest/unit/alertPipeline.test.js`** with initial AlertRule tests:

```javascript
'use strict';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');

describe('AlertRule', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('findByTypeAndSeverity()', () => {
        test('returns matching enabled rule', async () => {
            const mockRule = {
                id: 1,
                alert_type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                enabled: true,
                uk_category: 'Электрика',
                uk_urgency: 'Средняя'
            };
            db.query.mockResolvedValue({ rows: [mockRule] });

            const result = await AlertRule.findByTypeAndSeverity('TRANSFORMER_OVERLOAD', 'WARNING');

            expect(result).toEqual(mockRule);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('alert_type = $1'),
                ['TRANSFORMER_OVERLOAD', 'WARNING']
            );
        });

        test('returns null when no matching rule', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRule.findByTypeAndSeverity('UNKNOWN', 'INFO');

            expect(result).toBeNull();
        });

        test('returns null when rule is disabled', async () => {
            db.query.mockResolvedValue({ rows: [] }); // query filters by enabled = true

            const result = await AlertRule.findByTypeAndSeverity('TRANSFORMER_OVERLOAD', 'WARNING');

            expect(result).toBeNull();
        });
    });
});
```

- [ ] **Run test — verify RED:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

Expected: FAIL (findByTypeAndSeverity is not a function)

### Step 2: Implement (GREEN)

- [ ] **Add `findByTypeAndSeverity()` to `src/models/AlertRule.js`:**

After the existing `toggleEnabled()` method, add:

```javascript
static async findByTypeAndSeverity(alertType, severity) {
    try {
        const result = await db.query(
            `SELECT * FROM alert_rules
             WHERE alert_type = $1 AND severity = $2 AND enabled = true`,
            [alertType, severity]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error(`AlertRule.findByTypeAndSeverity error: ${error.message}`);
        throw error;
    }
}
```

- [ ] **Run test — verify GREEN:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

- [ ] **Commit:**

```bash
git add src/models/AlertRule.js tests/jest/unit/alertPipeline.test.js
git commit -m "feat(uk): add AlertRule.findByTypeAndSeverity() for alert→UK rule matching"
```

---

## Task 2: Add AlertRequestMap methods (create, findByAlertAndBuilding, markSent, findByIdempotencyKey)

**Files:**
- Modify: `src/models/AlertRequestMap.js`
- Modify: `tests/jest/unit/alertPipeline.test.js` (add AlertRequestMap section)

### Step 1: Write test (RED)

- [ ] **Append AlertRequestMap tests to `tests/jest/unit/alertPipeline.test.js`:**

```javascript
const AlertRequestMap = require('../../../src/models/AlertRequestMap');

describe('AlertRequestMap', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('create()', () => {
        test('inserts a new mapping row with pending status', async () => {
            const mockRow = {
                id: 1,
                infrasafe_alert_id: 42,
                building_external_id: 'abc-def-123',
                idempotency_key: 'idem-key-uuid',
                status: 'pending'
            };
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.create({
                infrasafe_alert_id: 42,
                building_external_id: 'abc-def-123',
                idempotency_key: 'idem-key-uuid',
                status: 'pending'
            });

            expect(result).toEqual(mockRow);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO alert_request_map'),
                expect.arrayContaining([42, 'abc-def-123', 'idem-key-uuid', 'pending'])
            );
        });

        test('returns null on UNIQUE violation (alert+building pair)', async () => {
            const uniqueError = new Error('unique violation');
            uniqueError.code = '23505';
            db.query.mockRejectedValue(uniqueError);

            const result = await AlertRequestMap.create({
                infrasafe_alert_id: 42,
                building_external_id: 'abc-def-123',
                idempotency_key: 'idem-key-uuid',
                status: 'pending'
            });

            expect(result).toBeNull();
        });
    });

    describe('findByAlertAndBuilding()', () => {
        test('returns existing mapping', async () => {
            const mockRow = { id: 1, status: 'pending', idempotency_key: 'key-1' };
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.findByAlertAndBuilding(42, 'abc-def-123');
            expect(result).toEqual(mockRow);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByAlertAndBuilding(42, 'nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('markSent()', () => {
        test('updates status to sent and sets request number', async () => {
            db.query.mockResolvedValue({ rows: [{ id: 1, status: 'sent' }] });

            await AlertRequestMap.markSent(1, 'REQ-001');
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE alert_request_map'),
                expect.arrayContaining(['sent', 'REQ-001', 1])
            );
        });
    });

    describe('findByIdempotencyKey()', () => {
        test('returns row when found', async () => {
            const mockRow = { id: 1, idempotency_key: 'some-uuid' };
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.findByIdempotencyKey('some-uuid');
            expect(result).toEqual(mockRow);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByIdempotencyKey('nonexistent');
            expect(result).toBeNull();
        });
    });
});
```

- [ ] **Run test — verify RED:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

Expected: FAIL (create, findByIdempotencyKey not defined)

### Step 2: Implement (GREEN)

- [ ] **Add methods to `src/models/AlertRequestMap.js`:**

After the existing `findByAlertId()` method, add:

```javascript
static async create(data) {
    try {
        const { infrasafe_alert_id, building_external_id, idempotency_key, status = 'pending' } = data;
        const result = await db.query(
            `INSERT INTO alert_request_map
             (infrasafe_alert_id, building_external_id, idempotency_key, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             RETURNING *`,
            [infrasafe_alert_id, building_external_id, idempotency_key, status]
        );
        return result.rows[0];
    } catch (error) {
        // UNIQUE(infrasafe_alert_id, building_external_id) violation = already exists
        if (error.code === '23505') {
            logger.warn(`AlertRequestMap.create: duplicate alert+building pair`);
            return null;
        }
        logger.error(`AlertRequestMap.create error: ${error.message}`);
        throw error;
    }
}

static async findByAlertAndBuilding(alertId, buildingExternalId) {
    try {
        const result = await db.query(
            'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 AND building_external_id = $2',
            [alertId, buildingExternalId]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error(`AlertRequestMap.findByAlertAndBuilding error: ${error.message}`);
        throw error;
    }
}

static async markSent(id, requestNumber) {
    try {
        const result = await db.query(
            `UPDATE alert_request_map SET status = $1, uk_request_number = $2, updated_at = NOW()
             WHERE id = $3 RETURNING *`,
            ['sent', requestNumber, id]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error(`AlertRequestMap.markSent error: ${error.message}`);
        throw error;
    }
}

static async findByIdempotencyKey(idempotencyKey) {
    try {
        const result = await db.query(
            'SELECT * FROM alert_request_map WHERE idempotency_key = $1',
            [idempotencyKey]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error(`AlertRequestMap.findByIdempotencyKey error: ${error.message}`);
        throw error;
    }
}
```

- [ ] **Run test — verify GREEN:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

- [ ] **Commit:**

```bash
git add src/models/AlertRequestMap.js tests/jest/unit/alertPipeline.test.js
git commit -m "feat(uk): add AlertRequestMap.create() and findByIdempotencyKey() for idempotent request tracking"
```

---

## Task 3: Create UK API client

**Files:**
- Create: `src/clients/ukApiClient.js`
- Create: `tests/jest/unit/ukApiClient.test.js`

### Step 1: Write test (RED)

- [ ] **Create `tests/jest/unit/ukApiClient.test.js`:**

```javascript
'use strict';

jest.mock('axios');
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/IntegrationConfig', () => ({
    get: jest.fn()
}));

const axios = require('axios');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const logger = require('../../../src/utils/logger');

// Will require after creating the file
let ukApiClient;

describe('UKApiClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        // Set ENV-only credentials (sensitive keys never stored in DB)
        process.env.UK_SERVICE_USER = 'svc_user';
        process.env.UK_SERVICE_PASSWORD = 'svc_pass';
        // Re-require to reset cached token
        jest.mock('axios');
        jest.mock('../../../src/utils/logger', () => ({
            info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
        }));
        jest.mock('../../../src/models/IntegrationConfig', () => ({
            get: jest.fn()
        }));
        ukApiClient = require('../../../src/clients/ukApiClient');
    });

    afterAll(() => {
        delete process.env.UK_SERVICE_USER;
        delete process.env.UK_SERVICE_PASSWORD;
    });

    describe('authenticate()', () => {
        test('obtains JWT token from UK API', async () => {
            // Only uk_api_url comes from DB; credentials from process.env
            IntegrationConfig.get.mockResolvedValueOnce('https://uk.example.com');

            axios.post.mockResolvedValue({
                status: 200,
                data: { token: 'jwt-token-123' }
            });

            const token = await ukApiClient.authenticate();

            expect(token).toBe('jwt-token-123');
            expect(axios.post).toHaveBeenCalledWith(
                'https://uk.example.com/auth/login',
                { username: 'svc_user', password: 'svc_pass' },
                expect.objectContaining({ timeout: expect.any(Number) })
            );
        });

        test('caches token on subsequent calls', async () => {
            // Only uk_api_url from DB; UK_SERVICE_USER/PASSWORD from process.env (set in beforeEach)
            IntegrationConfig.get.mockResolvedValueOnce('https://uk.example.com');

            axios.post.mockResolvedValue({
                status: 200,
                data: { token: 'jwt-token-123' }
            });

            await ukApiClient.authenticate();
            await ukApiClient.authenticate();

            // axios.post called only once (cached)
            expect(axios.post).toHaveBeenCalledTimes(1);
        });

        test('throws when UK API URL not configured', async () => {
            IntegrationConfig.get.mockResolvedValue(null);

            await expect(ukApiClient.authenticate())
                .rejects.toThrow(/not configured/i);
        });
    });

    describe('createRequest()', () => {
        test('posts request to UK API with auth header', async () => {
            // Setup: authenticate first
            // Only uk_api_url from DB; UK_SERVICE_USER/PASSWORD from process.env (set in beforeEach)
            IntegrationConfig.get.mockResolvedValueOnce('https://uk.example.com');

            axios.post
                .mockResolvedValueOnce({ status: 200, data: { token: 'jwt-123' } })  // auth
                .mockResolvedValueOnce({                                                // create request
                    status: 201,
                    data: { request_number: 'REQ-2026-001' }
                });

            const result = await ukApiClient.createRequest({
                building_external_id: 'bld-uuid-1',
                category: 'Электрика',
                urgency: 'Критическая',
                description: 'Overload detected',
                idempotency_key: 'idem-uuid-1'
            });

            expect(result).toEqual({ request_number: 'REQ-2026-001' });
            expect(axios.post).toHaveBeenLastCalledWith(
                'https://uk.example.com/requests/create',
                expect.objectContaining({
                    building_external_id: 'bld-uuid-1',
                    category: 'Электрика',
                    urgency: 'Критическая'
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer jwt-123'
                    })
                })
            );
        });

        test('retries on failure with exponential backoff (max 3)', async () => {
            // Only uk_api_url from DB; UK_SERVICE_USER/PASSWORD from process.env (set in beforeEach)
            IntegrationConfig.get.mockResolvedValueOnce('https://uk.example.com');

            const networkError = new Error('ECONNRESET');
            networkError.code = 'ECONNRESET';

            axios.post
                .mockResolvedValueOnce({ status: 200, data: { token: 'jwt-123' } })  // auth
                .mockRejectedValueOnce(networkError)   // attempt 1
                .mockRejectedValueOnce(networkError)   // attempt 2
                .mockResolvedValueOnce({               // attempt 3 succeeds
                    status: 201,
                    data: { request_number: 'REQ-RETRY' }
                });

            const result = await ukApiClient.createRequest({
                building_external_id: 'bld-1',
                category: 'Электрика',
                urgency: 'Средняя',
                description: 'Test',
                idempotency_key: 'idem-1'
            });

            expect(result).toEqual({ request_number: 'REQ-RETRY' });
            // 1 auth + 3 request attempts = 4 total
            expect(axios.post).toHaveBeenCalledTimes(4);
        });

        test('throws after 3 failed retries', async () => {
            // Only uk_api_url from DB; UK_SERVICE_USER/PASSWORD from process.env (set in beforeEach)
            IntegrationConfig.get.mockResolvedValueOnce('https://uk.example.com');

            const networkError = new Error('ECONNRESET');

            axios.post
                .mockResolvedValueOnce({ status: 200, data: { token: 'jwt-123' } })
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError);

            await expect(ukApiClient.createRequest({
                building_external_id: 'bld-1',
                category: 'Электрика',
                urgency: 'Средняя',
                description: 'Test',
                idempotency_key: 'idem-1'
            })).rejects.toThrow();
        });
    });
});
```

- [ ] **Run test — verify RED:**

```bash
npm run test:unit -- --testPathPattern=ukApiClient --no-coverage
```

Expected: FAIL (cannot find module `../../../src/clients/ukApiClient`)

### Step 2: Implement (GREEN)

- [ ] **Create directory and file `src/clients/ukApiClient.js`:**

```javascript
'use strict';

const axios = require('axios');
const IntegrationConfig = require('../models/IntegrationConfig');
const logger = require('../utils/logger');

const TOKEN_CACHE_TTL_MS = 25 * 60 * 1000; // 25 minutes (tokens typically expire in 30m)
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 5s, 25s (multiplied by 5^attempt)

class UKApiClient {
    constructor() {
        this._token = null;
        this._tokenExpiresAt = 0;
    }

    /**
     * Authenticate with the UK API and cache the JWT token.
     * @returns {Promise<string>} JWT token
     */
    async authenticate() {
        // Return cached token if still valid
        if (this._token && Date.now() < this._tokenExpiresAt) {
            return this._token;
        }

        const apiUrl = await IntegrationConfig.get('uk_api_url');
        // Sensitive credentials are ENV-ONLY (never stored in DB)
        // as defined in ukIntegrationService.js SENSITIVE_KEYS
        const username = process.env.UK_SERVICE_USER;
        const password = process.env.UK_SERVICE_PASSWORD;

        if (!apiUrl || !username || !password) {
            throw new Error('UK API credentials not configured (uk_api_url in DB + UK_SERVICE_USER/UK_SERVICE_PASSWORD env vars)');
        }

        const response = await axios.post(
            `${apiUrl}/auth/login`,
            { username, password },
            { timeout: REQUEST_TIMEOUT_MS }
        );

        const token = response.data.token;
        if (!token) {
            throw new Error('UK API auth response missing token');
        }

        this._token = token;
        this._tokenExpiresAt = Date.now() + TOKEN_CACHE_TTL_MS;

        logger.info('ukApiClient: authenticated with UK API');
        return token;
    }

    /**
     * Clear cached token (e.g., on 401 to force re-auth).
     */
    clearToken() {
        this._token = null;
        this._tokenExpiresAt = 0;
    }

    /**
     * Create a request in the UK system.
     * Retries up to MAX_RETRIES with exponential backoff.
     *
     * @param {Object} data - Request data
     * @param {string} data.building_external_id - Building external UUID
     * @param {string} data.category - UK category (e.g., 'Электрика')
     * @param {string} data.urgency - UK urgency (e.g., 'Критическая')
     * @param {string} data.description - Human-readable alert description
     * @param {string} data.idempotency_key - UUID for deduplication
     * @returns {Promise<Object>} UK API response with request_number
     */
    async createRequest(data) {
        const token = await this.authenticate();
        const apiUrl = await IntegrationConfig.get('uk_api_url');

        let lastError;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(
                    `${apiUrl}/requests/create`,
                    {
                        building_external_id: data.building_external_id,
                        category: data.category,
                        urgency: data.urgency,
                        description: data.description,
                        idempotency_key: data.idempotency_key
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            'Idempotency-Key': data.idempotency_key
                        },
                        timeout: REQUEST_TIMEOUT_MS
                    }
                );

                logger.info(`ukApiClient: created UK request ${response.data.request_number} (attempt ${attempt + 1})`);
                return response.data;
            } catch (error) {
                lastError = error;
                logger.warn(
                    `ukApiClient.createRequest attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error.message}`
                );

                // On 401, clear token and re-authenticate on next attempt
                if (error.response && error.response.status === 401) {
                    this.clearToken();
                }

                // Don't sleep after the last attempt
                if (attempt < MAX_RETRIES - 1) {
                    const delay = BACKOFF_BASE_MS * Math.pow(5, attempt); // 1s, 5s, 25s
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Generic authenticated GET request to UK API.
     * Used by Phase 5 (request counts, building requests).
     * @param {string} path - URL path appended to uk_api_url
     * @returns {Promise<Object>} parsed response body
     */
    async get(path) {
        const token = await this.authenticate();
        const apiUrl = await IntegrationConfig.get('uk_api_url');

        const response = await axios.get(`${apiUrl}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: REQUEST_TIMEOUT_MS
        });

        return response.data;
    }
}

module.exports = new UKApiClient();
```

- [ ] **Run test — verify GREEN:**

```bash
npm run test:unit -- --testPathPattern=ukApiClient --no-coverage
```

**Important:** The retry tests use `setTimeout` internally. Mock timers with `jest.useFakeTimers()` if tests are slow, or accept real delays (max 6s total for backoff tests). Alternatively, inject a `sleep` function for testability.

- [ ] **Commit:**

```bash
git add src/clients/ukApiClient.js tests/jest/unit/ukApiClient.test.js
git commit -m "feat(uk): create ukApiClient with JWT auth, token caching, and exponential backoff retry"
```

---

## Task 4: Add `sendAlertToUK()` and `resolveBuildingIds()` to ukIntegrationService

**Files:**
- Modify: `src/services/ukIntegrationService.js`
- Modify: `tests/jest/unit/alertPipeline.test.js` (add pipeline tests)

### Step 1: Write test (RED)

- [ ] **Append sendAlertToUK tests to `tests/jest/unit/alertPipeline.test.js`:**

Add mocks at the top of the file:

```javascript
jest.mock('../../../src/clients/ukApiClient', () => ({
    createRequest: jest.fn()
}));
jest.mock('../../../src/models/IntegrationConfig', () => ({
    isEnabled: jest.fn(),
    get: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(),
    findByEventId: jest.fn(),
    updateStatus: jest.fn()
}));
jest.mock('../../../src/models/Building', () => ({
    findByExternalId: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidBuildingEvent: jest.fn()
}));
```

Add test section:

```javascript
const ukApiClient = require('../../../src/clients/ukApiClient');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');

describe('ukIntegrationService.sendAlertToUK()', () => {
    beforeEach(() => jest.clearAllMocks());

    const mockAlert = {
        alert_id: 42,
        type: 'TRANSFORMER_OVERLOAD',
        severity: 'WARNING',
        infrastructure_id: '5',
        infrastructure_type: 'transformer',
        message: 'Перегрузка трансформатора ТП-5: 87.5%'
    };

    test('skips when UK integration is disabled', async () => {
        IntegrationConfig.isEnabled.mockResolvedValue(false);

        await ukIntegrationService.sendAlertToUK(mockAlert);

        expect(ukApiClient.createRequest).not.toHaveBeenCalled();
    });

    test('skips when no matching alert rule', async () => {
        IntegrationConfig.isEnabled.mockResolvedValue(true);
        db.query.mockResolvedValue({ rows: [] }); // no rule found

        await ukIntegrationService.sendAlertToUK(mockAlert);

        expect(ukApiClient.createRequest).not.toHaveBeenCalled();
    });

    test('creates UK request for each affected building', async () => {
        IntegrationConfig.isEnabled.mockResolvedValue(true);

        // findByTypeAndSeverity returns a rule
        db.query
            .mockResolvedValueOnce({ rows: [{  // AlertRule.findByTypeAndSeverity
                uk_category: 'Электрика',
                uk_urgency: 'Средняя'
            }]})
            .mockResolvedValueOnce({ rows: [   // resolveBuildingIds (transformer→buildings)
                { building_id: 1, external_id: 'bld-uuid-1' },
                { building_id: 2, external_id: 'bld-uuid-2' }
            ]})
            .mockResolvedValueOnce({ rows: [{ id: 1 }] })  // AlertRequestMap.create bld-1
            .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // AlertRequestMap.create bld-2

        ukApiClient.createRequest
            .mockResolvedValueOnce({ request_number: 'REQ-001' })
            .mockResolvedValueOnce({ request_number: 'REQ-002' });

        await ukIntegrationService.sendAlertToUK(mockAlert);

        expect(ukApiClient.createRequest).toHaveBeenCalledTimes(2);
    });

    test('does not throw on UK API failure (graceful degradation)', async () => {
        IntegrationConfig.isEnabled.mockResolvedValue(true);

        db.query
            .mockResolvedValueOnce({ rows: [{ uk_category: 'Электрика', uk_urgency: 'Средняя' }] })
            .mockResolvedValueOnce({ rows: [{ building_id: 1, external_id: 'bld-uuid-1' }] })
            .mockResolvedValueOnce({ rows: [{ id: 1 }] });

        ukApiClient.createRequest.mockRejectedValue(new Error('UK API down'));

        // Should not throw — logs error and continues
        await expect(
            ukIntegrationService.sendAlertToUK(mockAlert)
        ).resolves.not.toThrow();
    });

    test('skips buildings without external_id', async () => {
        IntegrationConfig.isEnabled.mockResolvedValue(true);

        db.query
            .mockResolvedValueOnce({ rows: [{ uk_category: 'Электрика', uk_urgency: 'Средняя' }] })
            .mockResolvedValueOnce({ rows: [
                { building_id: 1, external_id: 'bld-uuid-1' },
                { building_id: 2, external_id: null }           // no external_id — skip
            ]})
            .mockResolvedValueOnce({ rows: [{ id: 1 }] });

        ukApiClient.createRequest.mockResolvedValue({ request_number: 'REQ-001' });

        await ukIntegrationService.sendAlertToUK(mockAlert);

        expect(ukApiClient.createRequest).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Run test — verify RED:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

Expected: FAIL (sendAlertToUK is not a function)

### Step 2: Implement (GREEN)

- [ ] **Add methods to `src/services/ukIntegrationService.js`:**

Add new requires at the top of the file:

```javascript
const AlertRule = require('../models/AlertRule');
const AlertRequestMap = require('../models/AlertRequestMap');
const db = require('../config/database');
```

Add new methods to the `UKIntegrationService` class before the closing brace:

```javascript
/**
 * Resolve building IDs affected by an infrastructure alert.
 * Uses direct SQL based on infrastructure_type:
 *   - transformer → buildings.power_transformer_id
 *   - controller  → controllers.controller_id → controllers.building_id
 *   - water_source → buildings.cold_water_source_id
 *   - heat_source  → buildings.heat_source_id
 *
 * @param {string} infrastructureId
 * @param {string} infrastructureType
 * @returns {Promise<Array<{building_id: number, external_id: string|null}>>}
 */
async resolveBuildingIds(infrastructureId, infrastructureType) {
    const queries = {
        transformer: `SELECT building_id, external_id FROM buildings
                      WHERE power_transformer_id = $1 AND uk_deleted_at IS NULL`,
        controller:  `SELECT b.building_id, b.external_id FROM controllers c
                      JOIN buildings b ON b.building_id = c.building_id
                      WHERE c.controller_id = $1 AND b.uk_deleted_at IS NULL`,
        water_source: `SELECT building_id, external_id FROM buildings
                       WHERE cold_water_source_id = $1 AND uk_deleted_at IS NULL`,
        heat_source:  `SELECT building_id, external_id FROM buildings
                       WHERE heat_source_id = $1 AND uk_deleted_at IS NULL`
    };

    const query = queries[infrastructureType];
    if (!query) {
        logger.warn(`sendAlertToUK: unknown infrastructure_type "${infrastructureType}"`);
        return [];
    }

    const result = await db.query(query, [infrastructureId]);
    return result.rows;
}

/**
 * Send an InfraSafe alert to the UK system.
 * Called after alert creation. On ANY error, logs and returns — never throws.
 *
 * Flow:
 * 1. Check if UK integration is enabled
 * 2. Match alert against alert_rules → get uk_category, uk_urgency
 * 3. Resolve affected building IDs from infrastructure FKs
 * 4. For each building with external_id: create UK request via ukApiClient
 * 5. Track each in alert_request_map with idempotency_key
 *
 * @param {Object} alertData - The created alert
 * @param {number} alertData.alert_id
 * @param {string} alertData.type - Alert type (e.g., 'TRANSFORMER_OVERLOAD')
 * @param {string} alertData.severity - 'WARNING' | 'CRITICAL'
 * @param {string} alertData.infrastructure_id
 * @param {string} alertData.infrastructure_type - 'transformer' | 'controller' | 'water_source' | 'heat_source'
 * @param {string} alertData.message
 * @returns {Promise<void>}
 */
async sendAlertToUK(alertData) {
    try {
        // 1. Check integration status
        const enabled = await this.isEnabled();
        if (!enabled) {
            return;
        }

        // 2. Find matching rule
        const rule = await AlertRule.findByTypeAndSeverity(alertData.type, alertData.severity);
        if (!rule) {
            logger.debug(`sendAlertToUK: no matching rule for ${alertData.type}/${alertData.severity}`);
            return;
        }

        // 3. Resolve buildings
        const buildings = await this.resolveBuildingIds(
            alertData.infrastructure_id,
            alertData.infrastructure_type
        );

        if (buildings.length === 0) {
            logger.debug(`sendAlertToUK: no buildings found for ${alertData.infrastructure_type}:${alertData.infrastructure_id}`);
            return;
        }

        // 4. Create one UK request per building
        const ukApiClient = require('../clients/ukApiClient');

        for (const building of buildings) {
            // Skip buildings without external_id (not synced to UK)
            if (!building.external_id) {
                logger.debug(`sendAlertToUK: building ${building.building_id} has no external_id, skipping`);
                continue;
            }

            try {
                // 5. Check if mapping already exists (idempotency)
                const existing = await AlertRequestMap.findByAlertAndBuilding(
                    alertData.alert_id, building.external_id
                );

                let mapping;
                let idempotencyKey;

                if (existing && existing.status === 'sent') {
                    // Already successfully sent — skip
                    logger.debug(`sendAlertToUK: already sent for alert ${alertData.alert_id}, building ${building.building_id}`);
                    continue;
                } else if (existing && existing.status === 'pending') {
                    // Previous attempt failed after mapping was created — retry with same key
                    mapping = existing;
                    idempotencyKey = existing.idempotency_key;
                } else {
                    // New mapping
                    idempotencyKey = crypto.randomUUID();
                    mapping = await AlertRequestMap.create({
                        infrasafe_alert_id: alertData.alert_id,
                        building_external_id: building.external_id,
                        idempotency_key: idempotencyKey,
                        status: 'pending'
                    });
                }

                // 6. Call UK API (idempotency_key header ensures UK deduplicates too)
                const ukResponse = await ukApiClient.createRequest({
                    building_external_id: building.external_id,
                    category: rule.uk_category,
                    urgency: rule.uk_urgency,
                    description: alertData.message,
                    idempotency_key: idempotencyKey
                });

                // 7. Mark mapping as sent with UK request number
                await AlertRequestMap.markSent(
                    mapping.id, ukResponse.request_number
                );

                logger.info(
                    `sendAlertToUK: created UK request ${ukResponse.request_number} ` +
                    `for alert ${alertData.alert_id}, building ${building.building_id}`
                );
            } catch (buildingError) {
                // Log per-building failure but continue with remaining buildings
                logger.error(
                    `sendAlertToUK: failed for building ${building.building_id}: ${buildingError.message}`
                );
            }
        }
    } catch (error) {
        // Top-level catch: never throw — InfraSafe must work normally
        logger.error(`sendAlertToUK error: ${error.message}`);
    }
}
```

- [ ] **Run test — verify GREEN:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

- [ ] **Commit:**

```bash
git add src/services/ukIntegrationService.js tests/jest/unit/alertPipeline.test.js
git commit -m "feat(uk): add sendAlertToUK() with building resolution and per-building UK request creation"
```

---

## Task 5: Hook UK integration into alertService.sendNotifications()

**Files:**
- Modify: `src/services/alertService.js`
- Modify: `tests/jest/unit/alertPipeline.test.js` (add hook test)

### Step 1: Write test (RED)

- [ ] **Append sendNotifications hook test to `tests/jest/unit/alertPipeline.test.js`:**

```javascript
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

const alertService = require('../../../src/services/alertService');

describe('alertService.sendNotifications() UK hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
    });

    test('calls ukIntegrationService.sendAlertToUK after notification', async () => {
        const alertData = {
            type: 'TRANSFORMER_OVERLOAD',
            severity: 'WARNING',
            infrastructure_id: '5',
            infrastructure_type: 'transformer',
            message: 'Test alert'
        };
        const alertId = 42;

        // sendAlertToUK is mocked via ukIntegrationService mock
        IntegrationConfig.isEnabled.mockResolvedValue(false); // UK disabled — just verify it's called

        await alertService.sendNotifications(alertData, alertId);

        expect(ukIntegrationService.sendAlertToUK).toHaveBeenCalledWith(
            expect.objectContaining({
                alert_id: alertId,
                type: alertData.type,
                severity: alertData.severity
            })
        );
    });

    test('does not throw when sendAlertToUK fails', async () => {
        ukIntegrationService.sendAlertToUK = jest.fn().mockRejectedValue(new Error('boom'));

        await expect(
            alertService.sendNotifications(
                { severity: 'WARNING', type: 'TEST', infrastructure_id: '1', infrastructure_type: 'transformer', message: 'x' },
                99
            )
        ).resolves.not.toThrow();
    });
});
```

- [ ] **Run test — verify RED:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

Expected: FAIL (sendAlertToUK never called by sendNotifications)

### Step 2: Implement (GREEN)

- [ ] **Modify `src/services/alertService.js` — add UK hook to `sendNotifications()`:**

Add require at the top (lazy-load to avoid circular dependency):

```javascript
// At the top of the file, no new require needed — we'll use lazy require inside the method
```

Modify the `sendNotifications()` method (currently at line ~246). After the existing `broadcastAlert()` call and before the catch block, add:

```javascript
// UK Integration hook: send alert to UK system (fire-and-forget, never throws)
try {
    const ukIntegrationService = require('./ukIntegrationService');
    await ukIntegrationService.sendAlertToUK({
        alert_id: alertId,
        ...alertData
    });
} catch (ukError) {
    logger.error('sendNotifications: UK integration hook failed:', ukError);
}
```

The modified `sendNotifications()` should look like:

```javascript
async sendNotifications(alertData, alertId) {
    try {
        if (alertData.severity === 'CRITICAL') {
            await this.sendImmediateNotification(alertData, alertId);
        }

        this.broadcastAlert(alertData, alertId);

        // UK Integration hook
        try {
            const ukIntegrationService = require('./ukIntegrationService');
            await ukIntegrationService.sendAlertToUK({
                alert_id: alertId,
                ...alertData
            });
        } catch (ukError) {
            logger.error('sendNotifications: UK integration hook failed:', ukError);
        }

    } catch (error) {
        logger.error('Ошибка отправки уведомлений:', error);
    }
}
```

- [ ] **Run test — verify GREEN:**

```bash
npm run test:unit -- --testPathPattern=alertPipeline --no-coverage
```

- [ ] **Commit:**

```bash
git add src/services/alertService.js tests/jest/unit/alertPipeline.test.js
git commit -m "feat(uk): hook sendAlertToUK into alertService.sendNotifications()"
```

---

## Task 6: Run full test suite and verify no regressions

**Files:** None (testing only)

- [ ] **Run all unit tests:**

```bash
npm run test:unit
```

Expected: All existing tests pass + new tests pass. Total should be ~185+ tests across ~22 suites.

- [ ] **Run integration tests (requires running Docker):**

```bash
docker compose -f docker-compose.dev.yml up -d
npm run test:integration
```

- [ ] **Run security tests:**

```bash
npm run test:security
```

- [ ] **Verify test coverage:**

```bash
npm run test:coverage
```

Expected: Coverage should remain above 80%. New files (`ukApiClient.js`, modified models/services) should have >90% coverage from the new tests.

- [ ] **Fix any regressions** found during test runs.

- [ ] **Final commit (if fixes needed):**

```bash
git add -A
git commit -m "fix(uk): resolve test regressions from Phase 3 alert pipeline"
```

---

## Task 7: Verify existing ukIntegrationService tests still pass

**Files:** None (testing only)

The existing `tests/jest/unit/ukIntegrationService.test.js` tests the Phase 1/2 webhook functionality. Adding `sendAlertToUK()` and new requires (AlertRule, AlertRequestMap, db) to the service file must not break existing tests.

- [ ] **Run existing ukIntegrationService tests:**

```bash
npm run test:unit -- --testPathPattern=ukIntegrationService --no-coverage
```

- [ ] **If broken:** Add missing mocks for `AlertRule`, `AlertRequestMap`, and `../clients/ukApiClient` to the existing test file's mock block. These are needed because the `require()` at the top of the modified service will try to resolve them even if they're not used in Phase 1/2 tests.

Add to the existing mock block in `tests/jest/unit/ukIntegrationService.test.js`:

```javascript
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    create: jest.fn(),
    findByAlertId: jest.fn(),
    findByIdempotencyKey: jest.fn()
}));
jest.mock('../../../src/clients/ukApiClient', () => ({
    createRequest: jest.fn(),
    authenticate: jest.fn()
}));
```

- [ ] **Commit (if mock updates needed):**

```bash
git add tests/jest/unit/ukIntegrationService.test.js
git commit -m "test(uk): add Phase 3 mocks to existing ukIntegrationService tests"
```

---

## Summary

| Task | Description | Effort |
|------|-------------|--------|
| 1 | AlertRule.findByTypeAndSeverity() | 30 min |
| 2 | AlertRequestMap.create() + findByIdempotencyKey() | 30 min |
| 3 | ukApiClient (JWT auth, retry, token cache) | 1.5 hours |
| 4 | sendAlertToUK() + resolveBuildingIds() | 1.5 hours |
| 5 | Hook into alertService.sendNotifications() | 30 min |
| 6 | Full test suite verification | 30 min |
| 7 | Existing test compatibility | 15 min |
| **Total** | | **~5 hours** |

**Dependencies:**
```
Task 1 (AlertRule model) ──────────────────────┐
Task 2 (AlertRequestMap model) ────────────────┤
Task 3 (ukApiClient) ─────────────────────────┤
                                               ├──→ Task 4 (sendAlertToUK) ──→ Task 5 (hook) ──→ Task 6 (verify) ──→ Task 7 (compat)
```

Tasks 1, 2, 3 can run in parallel. Task 4 depends on all three. Tasks 5-7 are sequential.

**Key Design Decisions:**
1. **Lazy require** for `ukApiClient` inside `sendAlertToUK()` — avoids circular dependencies and allows the service to load even if the client module has import issues.
2. **Lazy require** for `ukIntegrationService` inside `sendNotifications()` — same reason, plus the alert service is a singleton loaded early.
3. **Never throw** from `sendAlertToUK()` or the notification hook — InfraSafe must work normally even if the UK system is completely down.
4. **Per-building error isolation** — if creating a UK request fails for one building, the pipeline continues with remaining buildings.
5. **Idempotency** via `alert_request_map.idempotency_key` (UUID UNIQUE constraint) — prevents duplicate UK requests on retry.
6. **Token caching** in ukApiClient with 25-minute TTL — avoids re-authenticating on every request while still refreshing before typical 30-minute JWT expiry.
7. **Exponential backoff** at 1s, 5s, 25s (5^n base) — balances between fast recovery and not hammering a failing UK API.
