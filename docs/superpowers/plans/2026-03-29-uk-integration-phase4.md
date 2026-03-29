# UK Integration Phase 4: Request → Alert Feedback

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** When UK closes or accepts a request, automatically resolve the corresponding alert in InfraSafe.

**Architecture:** The existing POST `/api/webhooks/uk/request` route currently logs incoming webhooks and returns 200 without processing. This phase wires it to a new `handleRequestWebhook()` method in `ukIntegrationService` that classifies the incoming status as terminal ("Принято", "Отменена") or non-terminal, updates `alert_request_map` via new model methods, and — when all requests linked to an alert reach a terminal status — auto-resolves the alert via `alertService.resolveAlert()`. Manually created UK requests (no `alert_request_map` row) are logged and acknowledged but never trigger alert resolution.

**Tech Stack:** Node.js, pg, Jest

**Spec:** `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md` Section 6

---

## File Map

### Files to modify

| File | Change |
|------|--------|
| `src/models/AlertRequestMap.js` | Add `findByRequestNumber()`, `updateStatus()`, `areAllTerminal()` static methods |
| `src/services/ukIntegrationService.js` | Add `handleRequestWebhook()` with status classification, map lookup, and alert resolution |
| `src/routes/webhookRoutes.js` | Replace inline logging in POST `/request` with payload validation + `handleRequestWebhook()` call |
| `src/utils/webhookValidation.js` | No changes needed — `isValidRequestEvent` and `VALID_REQUEST_EVENTS` already exist |

### Files to create

| File | Responsibility |
|------|---------------|
| `tests/jest/unit/requestFeedback.test.js` | Unit tests for the full request feedback flow: model methods, service logic, route handler |

---

## Status Constants

Reference for implementation — from spec Section 6:

```
TERMINAL_STATUSES  = ['Принято', 'Отменена']
NON_TERMINAL_STATUSES = ['В работе', 'Закуп', 'Уточнение', 'Выполнена', 'Исполнено']
```

---

## Task 1: Add Model Methods to AlertRequestMap

**Files:**
- Modify: `src/models/AlertRequestMap.js`
- Test: `tests/jest/unit/requestFeedback.test.js` (create, model section)

### Step 1.1: Write failing tests for `findByRequestNumber()`

- [ ] Create `tests/jest/unit/requestFeedback.test.js` with Jest mocks for `../../../src/config/database` and `../../../src/utils/logger`.

- [ ] Add test: `AlertRequestMap.findByRequestNumber` returns a row when `uk_request_number` matches.

```js
// tests/jest/unit/requestFeedback.test.js
'use strict';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');

describe('AlertRequestMap', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('findByRequestNumber()', () => {
        it('returns row when uk_request_number matches', async () => {
            const row = { id: 1, infrasafe_alert_id: 42, uk_request_number: '260324-015', status: 'active' };
            db.query.mockResolvedValue({ rows: [row] });

            const result = await AlertRequestMap.findByRequestNumber('260324-015');

            expect(result).toEqual(row);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('uk_request_number'),
                ['260324-015']
            );
        });

        it('returns null when no match found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await AlertRequestMap.findByRequestNumber('999999-999');
            expect(result).toBeNull();
        });
    });
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect RED (method does not exist).

### Step 1.2: Implement `findByRequestNumber()`

- [ ] Add to `src/models/AlertRequestMap.js`:

```js
static async findByRequestNumber(requestNumber) {
    try {
        const result = await db.query(
            'SELECT * FROM alert_request_map WHERE uk_request_number = $1',
            [requestNumber]
        );
        return result.rows.length ? result.rows[0] : null;
    } catch (error) {
        logger.error(`AlertRequestMap.findByRequestNumber error: ${error.message}`);
        throw error;
    }
}
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect GREEN.

### Step 1.3: Write failing tests for `updateStatus()`

- [ ] Add tests to the `AlertRequestMap` describe block:

```js
describe('updateStatus()', () => {
    it('updates status and updated_at, returns updated row', async () => {
        const updated = { id: 1, status: 'Принято', updated_at: '2026-03-29T10:00:00Z' };
        db.query.mockResolvedValue({ rows: [updated] });

        const result = await AlertRequestMap.updateStatus(1, 'Принято');

        expect(result).toEqual(updated);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE alert_request_map'),
            ['Принято', 1]
        );
    });

    it('returns null when id not found', async () => {
        db.query.mockResolvedValue({ rows: [] });
        const result = await AlertRequestMap.updateStatus(999, 'Принято');
        expect(result).toBeNull();
    });
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect RED.

### Step 1.4: Implement `updateStatus()`

- [ ] Add to `src/models/AlertRequestMap.js`:

```js
static async updateStatus(id, status) {
    try {
        const result = await db.query(
            `UPDATE alert_request_map
             SET status = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [status, id]
        );
        return result.rows.length ? result.rows[0] : null;
    } catch (error) {
        logger.error(`AlertRequestMap.updateStatus error: ${error.message}`);
        throw error;
    }
}
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect GREEN.

### Step 1.5: Write failing tests for `areAllTerminal()`

- [ ] Add tests:

```js
describe('areAllTerminal()', () => {
    it('returns true when all requests for alert have terminal status', async () => {
        db.query.mockResolvedValue({
            rows: [
                { status: 'Принято' },
                { status: 'Отменена' }
            ]
        });

        const result = await AlertRequestMap.areAllTerminal(42);
        expect(result).toBe(true);
    });

    it('returns false when at least one request is non-terminal', async () => {
        db.query.mockResolvedValue({
            rows: [
                { status: 'Принято' },
                { status: 'В работе' }
            ]
        });

        const result = await AlertRequestMap.areAllTerminal(42);
        expect(result).toBe(false);
    });

    it('returns false when alert has no mapped requests', async () => {
        db.query.mockResolvedValue({ rows: [] });
        const result = await AlertRequestMap.areAllTerminal(42);
        expect(result).toBe(false);
    });
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect RED.

### Step 1.6: Implement `areAllTerminal()`

- [ ] Add to `src/models/AlertRequestMap.js`:

```js
static async areAllTerminal(alertId) {
    try {
        const TERMINAL_STATUSES = ['Принято', 'Отменена'];
        const result = await db.query(
            'SELECT status FROM alert_request_map WHERE infrasafe_alert_id = $1',
            [alertId]
        );
        if (result.rows.length === 0) return false;
        return result.rows.every(row => TERMINAL_STATUSES.includes(row.status));
    } catch (error) {
        logger.error(`AlertRequestMap.areAllTerminal error: ${error.message}`);
        throw error;
    }
}
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect GREEN.

### Step 1.7: Verify all model tests pass

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — all 7 tests GREEN.

**Commit:**
```
feat(models): add findByRequestNumber, updateStatus, areAllTerminal to AlertRequestMap
```

---

## Task 2: Implement `handleRequestWebhook()` in ukIntegrationService

**Files:**
- Modify: `src/services/ukIntegrationService.js`
- Test: `tests/jest/unit/requestFeedback.test.js` (add service section)

### Step 2.1: Write failing tests for `handleRequestWebhook()`

- [ ] Add mocks and a new `describe('UKIntegrationService.handleRequestWebhook')` block to `tests/jest/unit/requestFeedback.test.js`.

The test file needs additional mocks beyond those set up in Task 1. Add these mocks **at the top of the file**, before any `require` calls:

```js
jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(),
    findByEventId: jest.fn(),
    updateStatus: jest.fn()
}));
jest.mock('../../../src/models/IntegrationConfig', () => ({
    isEnabled: jest.fn()
}));
jest.mock('../../../src/models/Building', () => ({
    findByExternalId: jest.fn(),
    createFromUK: jest.fn(),
    updateFromUK: jest.fn(),
    softDelete: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidBuildingEvent: jest.fn(),
    isValidRequestEvent: jest.fn()
}));
// alertService is a singleton with methods, mock them
jest.mock('../../../src/services/alertService', () => ({
    resolveAlert: jest.fn()
}));
```

Then require the service and its dependencies:

```js
const IntegrationLog = require('../../../src/models/IntegrationLog');
const { isValidRequestEvent } = require('../../../src/utils/webhookValidation');
const alertService = require('../../../src/services/alertService');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');
```

- [ ] Add test: `request.status_changed` with terminal status and single mapped request resolves alert.

```js
describe('UKIntegrationService.handleRequestWebhook', () => {
    const TERMINAL_PAYLOAD = {
        event_id: '550e8400-e29b-41d4-a716-446655440000',
        event: 'request.status_changed',
        request: {
            request_number: '260324-015',
            status: 'Принято',
            building_id: 15,
            category: 'Электрика',
            urgency: 'Срочная'
        },
        previous_status: 'Исполнено',
        timestamp: '2026-03-29T14:30:00Z'
    };

    beforeEach(() => jest.clearAllMocks());

    it('resolves alert when terminal status and all requests terminal', async () => {
        isValidRequestEvent.mockReturnValue(true);
        IntegrationLog.create.mockResolvedValue({ id: 10 });
        const mapRow = { id: 1, infrasafe_alert_id: 42, uk_request_number: '260324-015', status: 'active' };
        db.query
            // findByRequestNumber
            .mockResolvedValueOnce({ rows: [mapRow] })
            // updateStatus
            .mockResolvedValueOnce({ rows: [{ ...mapRow, status: 'Принято' }] })
            // areAllTerminal
            .mockResolvedValueOnce({ rows: [{ status: 'Принято' }] });

        alertService.resolveAlert.mockResolvedValue({ alert_id: 42, status: 'resolved' });
        IntegrationLog.updateStatus.mockResolvedValue({});

        await ukIntegrationService.handleRequestWebhook(TERMINAL_PAYLOAD);

        expect(alertService.resolveAlert).toHaveBeenCalledWith(42, null);
        expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(10, 'success');
    });
});
```

- [ ] Add test: terminal status but NOT all requests terminal — does NOT resolve alert.

```js
it('does not resolve alert when not all requests are terminal', async () => {
    isValidRequestEvent.mockReturnValue(true);
    IntegrationLog.create.mockResolvedValue({ id: 11 });
    const mapRow = { id: 1, infrasafe_alert_id: 42, uk_request_number: '260324-015', status: 'active' };
    db.query
        .mockResolvedValueOnce({ rows: [mapRow] })
        .mockResolvedValueOnce({ rows: [{ ...mapRow, status: 'Принято' }] })
        .mockResolvedValueOnce({ rows: [{ status: 'Принято' }, { status: 'В работе' }] });

    IntegrationLog.updateStatus.mockResolvedValue({});

    await ukIntegrationService.handleRequestWebhook(TERMINAL_PAYLOAD);

    expect(alertService.resolveAlert).not.toHaveBeenCalled();
    expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(11, 'success');
});
```

- [ ] Add test: non-terminal status — logs only, no alert resolution attempted.

```js
it('logs only for non-terminal status, no alert resolution', async () => {
    const nonTerminalPayload = {
        ...TERMINAL_PAYLOAD,
        request: { ...TERMINAL_PAYLOAD.request, status: 'В работе' }
    };
    isValidRequestEvent.mockReturnValue(true);
    IntegrationLog.create.mockResolvedValue({ id: 12 });
    const mapRow = { id: 1, infrasafe_alert_id: 42, uk_request_number: '260324-015', status: 'active' };
    db.query
        .mockResolvedValueOnce({ rows: [mapRow] })
        .mockResolvedValueOnce({ rows: [{ ...mapRow, status: 'В работе' }] });

    IntegrationLog.updateStatus.mockResolvedValue({});

    await ukIntegrationService.handleRequestWebhook(nonTerminalPayload);

    expect(alertService.resolveAlert).not.toHaveBeenCalled();
});
```

- [ ] Add test: manually created UK request (no `alert_request_map` row) — logged, no alert update.

```js
it('handles manually created UK request (no alert mapping) gracefully', async () => {
    isValidRequestEvent.mockReturnValue(true);
    IntegrationLog.create.mockResolvedValue({ id: 13 });
    db.query.mockResolvedValueOnce({ rows: [] }); // findByRequestNumber returns null

    IntegrationLog.updateStatus.mockResolvedValue({});

    await ukIntegrationService.handleRequestWebhook(TERMINAL_PAYLOAD);

    expect(alertService.resolveAlert).not.toHaveBeenCalled();
    expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(13, 'success');
});
```

- [ ] Add test: `request.created` event — logged, no status processing.

```js
it('logs request.created event without status processing', async () => {
    const createdPayload = {
        event_id: '660e8400-e29b-41d4-a716-446655440000',
        event: 'request.created',
        request: {
            request_number: '260324-016',
            status: 'В работе',
            building_id: 15,
            category: 'Электрика',
            urgency: 'Обычная'
        },
        timestamp: '2026-03-29T15:00:00Z'
    };
    isValidRequestEvent.mockReturnValue(true);
    IntegrationLog.create.mockResolvedValue({ id: 14 });
    IntegrationLog.updateStatus.mockResolvedValue({});

    await ukIntegrationService.handleRequestWebhook(createdPayload);

    expect(alertService.resolveAlert).not.toHaveBeenCalled();
    // findByRequestNumber should not be called for request.created
    expect(db.query).not.toHaveBeenCalled();
    expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(14, 'success');
});
```

- [ ] Add test: invalid event type throws error.

```js
it('throws on invalid request event type', async () => {
    isValidRequestEvent.mockReturnValue(false);
    const badPayload = { ...TERMINAL_PAYLOAD, event: 'request.invalid' };

    await expect(ukIntegrationService.handleRequestWebhook(badPayload))
        .rejects.toThrow('Invalid request event type');
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect RED (handleRequestWebhook does not exist).

### Step 2.2: Implement `handleRequestWebhook()`

- [ ] Add imports at the top of `src/services/ukIntegrationService.js`:

```js
const AlertRequestMap = require('../models/AlertRequestMap');
const alertService = require('./alertService');
const { isValidRequestEvent } = require('../utils/webhookValidation');
```

- [ ] Add the constant inside the class (or at module scope):

```js
const TERMINAL_STATUSES = ['Принято', 'Отменена'];
```

- [ ] Add method to `UKIntegrationService` class, before the closing `}`:

```js
/**
 * Process a request webhook from UK system.
 * Handles request.status_changed (status mapping + alert resolution)
 * and request.created (log only).
 *
 * @param {Object} payload - Webhook payload
 * @returns {Promise<void>}
 */
async handleRequestWebhook(payload) {
    const { event, request: ukRequest, event_id } = payload;

    if (!isValidRequestEvent(event)) {
        throw new Error('Invalid request event type');
    }

    // Log the event with pending status (UNIQUE event_id prevents duplicates)
    let logEntry;
    try {
        logEntry = await IntegrationLog.create({
            event_id,
            direction: 'from_uk',
            entity_type: 'request',
            entity_id: ukRequest.request_number || null,
            action: event,
            payload,
            status: 'pending'
        });
    } catch (logError) {
        if (logError.code === '23505') {
            logger.info(`Concurrent duplicate event_id ${event_id}, skipping`);
            return;
        }
        throw logError;
    }

    try {
        if (event === 'request.created') {
            // request.created: log only, cache invalidation deferred to Phase 5
            logger.info(`UK request created: ${ukRequest.request_number}`);
            await IntegrationLog.updateStatus(logEntry.id, 'success');
            return;
        }

        // event === 'request.status_changed'
        const newStatus = ukRequest.status;
        const requestNumber = ukRequest.request_number;

        // Look up the alert_request_map row
        const mapRow = await AlertRequestMap.findByRequestNumber(requestNumber);

        if (!mapRow) {
            // Manually created UK request — no alert mapping
            logger.info(`No alert mapping for request ${requestNumber}, logging only`);
            await IntegrationLog.updateStatus(logEntry.id, 'success');
            return;
        }

        // Update the map row status
        await AlertRequestMap.updateStatus(mapRow.id, newStatus);

        // Check if this is a terminal status
        if (TERMINAL_STATUSES.includes(newStatus)) {
            // Check if ALL requests for this alert are now terminal
            const allTerminal = await AlertRequestMap.areAllTerminal(mapRow.infrasafe_alert_id);

            if (allTerminal) {
                await alertService.resolveAlert(mapRow.infrasafe_alert_id, null);
                logger.info(
                    `Auto-resolved alert ${mapRow.infrasafe_alert_id} — all requests terminal`
                );
            } else {
                logger.info(
                    `Request ${requestNumber} terminal (${newStatus}), ` +
                    `but alert ${mapRow.infrasafe_alert_id} has non-terminal requests remaining`
                );
            }
        } else {
            logger.info(
                `Request ${requestNumber} status changed to non-terminal "${newStatus}", logged`
            );
        }

        await IntegrationLog.updateStatus(logEntry.id, 'success');
    } catch (error) {
        logger.error(`handleRequestWebhook error: ${error.message}`);
        try {
            await IntegrationLog.updateStatus(logEntry.id, 'error', error.message);
        } catch (logError) {
            logger.error(`Failed to update integration log error: ${logError.message}`);
        }
        throw error;
    }
}
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect GREEN for all service tests.

**Commit:**
```
feat(service): add handleRequestWebhook with status mapping and alert resolution
```

---

## Task 3: Wire Route to Service Method

**Files:**
- Modify: `src/routes/webhookRoutes.js`
- Test: `tests/jest/unit/requestFeedback.test.js` (add route section)

### Step 3.1: Write failing tests for the updated route handler

- [ ] Add a new `describe('POST /webhooks/uk/request handler')` block to `tests/jest/unit/requestFeedback.test.js`.

These tests validate the route-level behavior: payload validation, calling `handleRequestWebhook`, and error responses. They require mocking `ukIntegrationService` at the route level.

```js
// Requires mocked ukIntegrationService and express app setup from the test file's beforeAll
const crypto = require('crypto');

const validPayload = () => ({
    event_id: crypto.randomUUID(),
    event: 'request.status_changed',
    request: { request_number: '260324-015', status: 'Принято', building_id: 15 }
});

describe('POST /webhooks/uk/request route handler', () => {
    beforeEach(() => {
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleRequestWebhook.mockResolvedValue(undefined);
    });

    it('returns 400 if event_id is missing', async () => {
        const body = validPayload();
        delete body.event_id;
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/event_id/i);
    });

    it('returns 400 if event is invalid', async () => {
        const body = { ...validPayload(), event: 'invalid.event' };
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/event/i);
    });

    it('returns 400 if request object is missing', async () => {
        const body = validPayload();
        delete body.request;
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/request/i);
    });

    it('returns 400 if request.request_number is missing', async () => {
        const body = validPayload();
        delete body.request.request_number;
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/request_number/i);
    });

    it('returns 400 if request.request_number exceeds 50 chars', async () => {
        const body = validPayload();
        body.request.request_number = 'x'.repeat(51);
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
    });

    it('returns 400 if status_changed but request.status missing', async () => {
        const body = validPayload();
        delete body.request.status;
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/status/i);
    });

    it('returns 200 for valid payload and delegates to handleRequestWebhook', async () => {
        const body = validPayload();
        const res = await request(app).post('/webhooks/uk/request').send(body);
        expect(res.status).toBe(200);
        expect(ukIntegrationService.handleRequestWebhook).toHaveBeenCalledWith(body);
    });

    it('returns 200 with "Already processed" for duplicate event_id', async () => {
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(true);
        const res = await request(app).post('/webhooks/uk/request').send(validPayload());
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/already/i);
    });

    it('returns 500 when handleRequestWebhook throws', async () => {
        ukIntegrationService.handleRequestWebhook.mockRejectedValue(new Error('DB down'));
        const res = await request(app).post('/webhooks/uk/request').send(validPayload());
        expect(res.status).toBe(500);
    });
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect RED for new validation tests.

### Step 3.2: Update route handler in webhookRoutes.js

- [ ] Replace the existing `router.post('/request', ...)` handler (lines 103-130) in `src/routes/webhookRoutes.js` with:

```js
/**
 * POST /api/webhooks/uk/request
 * Receives request events from UK system.
 * Delegates to ukIntegrationService.handleRequestWebhook() for processing.
 */
router.post('/request', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event, request: ukRequest } = req.body;

        // Validate event_id
        if (!event_id || !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event_id' });
        }

        // Validate event field — must be a valid request event type
        if (!event || !isValidRequestEvent(event)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event (expected request.created or request.status_changed)' });
        }

        // Validate request object
        if (!ukRequest || typeof ukRequest !== 'object') {
            return res.status(400).json({ success: false, message: 'Missing required field: request' });
        }

        // Validate request_number
        if (!ukRequest.request_number || typeof ukRequest.request_number !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing required field: request.request_number' });
        }

        if (ukRequest.request_number.length > 50) {
            return res.status(400).json({ success: false, message: 'request.request_number exceeds maximum length' });
        }

        // Validate status for status_changed events
        if (event === 'request.status_changed' && (!ukRequest.status || typeof ukRequest.status !== 'string')) {
            return res.status(400).json({ success: false, message: 'Missing required field: request.status for status_changed event' });
        }

        // Idempotency check
        if (await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        // Delegate to service
        await ukIntegrationService.handleRequestWebhook(req.body);

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`POST /webhooks/uk/request error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — expect GREEN.

### Step 3.3: Update webhookRoutes mock in existing test file

- [ ] In `tests/jest/unit/webhookRoutes.test.js`, add `handleRequestWebhook: jest.fn()` to the `ukIntegrationService` mock so existing tests do not break:

```js
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    isDuplicateEvent: jest.fn(),
    logEvent: jest.fn(),
    handleBuildingWebhook: jest.fn(),
    handleRequestWebhook: jest.fn()   // ← add this
}));
```

- [ ] Run: `npm run test:unit -- --testPathPattern=webhookRoutes` — all existing tests still GREEN.

**Commit:**
```
feat(routes): wire POST /webhooks/uk/request to handleRequestWebhook with payload validation
```

---

## Task 4: Full Test Suite Verification

**Files:**
- Test: all test files

### Step 4.1: Run the full unit test suite

- [ ] Run: `npm run test:unit` — all tests GREEN, no regressions.

### Step 4.2: Run the full test suite including integration and security

- [ ] Run: `npm test` — all suites pass.

### Step 4.3: Verify coverage for new code

- [ ] Run: `npm run test:coverage` — verify `AlertRequestMap.js`, `ukIntegrationService.js` (handleRequestWebhook), and `webhookRoutes.js` (request handler) all have 80%+ coverage.

**Commit:**
```
test: add request feedback unit tests for Phase 4 webhook processing
```

---

## Task 5: Edge Cases and Hardening (Optional, Recommended)

**Files:**
- Modify: `tests/jest/unit/requestFeedback.test.js`

### Step 5.1: Add edge case tests

- [ ] Test: `resolveAlert` throws (alert already resolved) — `handleRequestWebhook` catches the error, logs it with status 'error', and re-throws.

```js
it('handles resolveAlert failure gracefully (alert already resolved)', async () => {
    isValidRequestEvent.mockReturnValue(true);
    IntegrationLog.create.mockResolvedValue({ id: 15 });
    const mapRow = { id: 1, infrasafe_alert_id: 42, uk_request_number: '260324-015', status: 'active' };
    db.query
        .mockResolvedValueOnce({ rows: [mapRow] })
        .mockResolvedValueOnce({ rows: [{ ...mapRow, status: 'Принято' }] })
        .mockResolvedValueOnce({ rows: [{ status: 'Принято' }] });

    alertService.resolveAlert.mockRejectedValue(new Error('Алерт 42 не найден или уже закрыт'));
    IntegrationLog.updateStatus.mockResolvedValue({});

    await expect(ukIntegrationService.handleRequestWebhook(TERMINAL_PAYLOAD))
        .rejects.toThrow('Алерт 42 не найден или уже закрыт');

    expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(15, 'error', expect.any(String));
});
```

- [ ] Test: concurrent duplicate `event_id` (IntegrationLog.create throws 23505) — returns silently.

```js
it('handles concurrent duplicate event_id (23505 unique violation)', async () => {
    isValidRequestEvent.mockReturnValue(true);
    const uniqueError = new Error('duplicate key');
    uniqueError.code = '23505';
    IntegrationLog.create.mockRejectedValue(uniqueError);

    // Should not throw — silently returns
    await ukIntegrationService.handleRequestWebhook(TERMINAL_PAYLOAD);

    expect(alertService.resolveAlert).not.toHaveBeenCalled();
});
```

- [ ] Run: `npm run test:unit -- --testPathPattern=requestFeedback` — all tests GREEN.

**Commit:**
```
test: add edge case tests for request feedback error handling
```

---

## Summary

| Task | Files Modified | Files Created | Tests Added |
|------|---------------|---------------|-------------|
| 1. AlertRequestMap model methods | `src/models/AlertRequestMap.js` | `tests/jest/unit/requestFeedback.test.js` | 7 |
| 2. handleRequestWebhook service | `src/services/ukIntegrationService.js` | — | 6 |
| 3. Wire route to service | `src/routes/webhookRoutes.js`, `tests/jest/unit/webhookRoutes.test.js` | — | 8 |
| 4. Full test verification | — | — | 0 (regression check) |
| 5. Edge cases (optional) | `tests/jest/unit/requestFeedback.test.js` | — | 2 |
| **Total** | **4 files** | **1 file** | **~23 tests** |

### Dependency Chain

```
Task 1 (model) → Task 2 (service) → Task 3 (route) → Task 4 (verify) → Task 5 (harden)
```

Each task is independently committable. Tasks 1-3 are strictly sequential (each depends on the prior). Tasks 4-5 run after Task 3.

### What This Phase Does NOT Include

- Cache invalidation on `request.created` (Phase 5)
- UI display of request status (Phase 5 map layer)
- UK-side webhook sender implementation (UK team responsibility)
- Retry/dead-letter queue for failed webhook processing (future hardening)
