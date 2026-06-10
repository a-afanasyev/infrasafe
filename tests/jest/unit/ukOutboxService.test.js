'use strict';

/**
 * [Sprint 9 / FIX-007] ukOutboxService drain worker unit tests.
 *
 * Covers:
 *   - isEnabled / intervalMs env handling
 *   - start() / stop() lifecycle (dormant when flag off)
 *   - _tick advisory-lock guard (skip when lock not acquired)
 *   - _tick mutex (skip when previous tick still inflight)
 *   - _drainOne outcome translation (success/dead/retry/skip)
 *   - Backoff schedule + dead-letter after MAX_ATTEMPTS
 *   - AlertRequestMap.markSent called on success
 *   - notification_failure recorded on dead-letter
 */

// [B-022] _tick is now client-scoped: advisory lock acquired/released on a
// checked-out client (db.getPool().connect()). The drain's own row ops
// (_recordNotificationFailure) stay on db.query.
jest.mock('../../../src/config/database', () => {
    const mockClient = { query: jest.fn(), release: jest.fn() };
    const mockPool = { connect: jest.fn(() => Promise.resolve(mockClient)) };
    return {
        query: jest.fn(),
        getPool: jest.fn(() => mockPool),
        __mockClient: mockClient,
        __mockPool: mockPool
    };
});
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/models/UkOutbox', () => ({
    pickNext: jest.fn(),
    markSent: jest.fn(),
    markFailed: jest.fn(),
    markDead: jest.fn(),
    resetForSkip: jest.fn(),
    MAX_ATTEMPTS: 5
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByIdempotencyKey: jest.fn(),
    markSent: jest.fn()
}));
jest.mock('../../../src/clients/ukWebhookClient', () => ({
    send: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    updateStatusByEventId: jest.fn()
}));

const db = require('../../../src/config/database');
const UkOutbox = require('../../../src/models/UkOutbox');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const ukWebhookClient = require('../../../src/clients/ukWebhookClient');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/uk/ukOutboxService');
const { UkOutboxService } = require('../../../src/services/uk/ukOutboxService');

// Helper: lock acquired on the client; db.query (pool) handles the drain's
// notification_failure UPDATE.
const mockAdvisoryLockAcquired = () => {
    db.__mockClient.query.mockImplementation((sql) => {
        if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
        if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
        return Promise.resolve({ rows: [] });
    });
    db.query.mockResolvedValue({ rows: [] });
};
const mockAdvisoryLockDenied = () => {
    db.__mockClient.query.mockImplementation((sql) => {
        if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: false }] });
        return Promise.resolve({ rows: [] });
    });
};
const clientSqls = () => db.__mockClient.query.mock.calls.map((c) => c[0]);

describe('ukOutboxService', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockReset();
        db.__mockClient.query.mockReset();
        db.__mockClient.release.mockClear();
        db.__mockPool.connect.mockClear();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.UK_USE_WEBHOOK_SENDER;
        delete process.env.UK_OUTBOX_DRAIN_INTERVAL_MS;
        // Reset internal state of singleton between tests
        service._running = false;
        service._stopped = false;
        service._consecutiveFailures = 0;
        service._lastFailureLogAt = 0;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe('isEnabled()', () => {
        it('returns false when UK_USE_WEBHOOK_SENDER is unset', () => {
            expect(service.isEnabled()).toBe(false);
        });

        it('returns true for "true"', () => {
            process.env.UK_USE_WEBHOOK_SENDER = 'true';
            expect(service.isEnabled()).toBe(true);
        });

        it('returns true for "1"', () => {
            process.env.UK_USE_WEBHOOK_SENDER = '1';
            expect(service.isEnabled()).toBe(true);
        });

        it('returns false for "false", "0", random strings', () => {
            for (const v of ['false', '0', 'yes', '']) {
                process.env.UK_USE_WEBHOOK_SENDER = v;
                expect(service.isEnabled()).toBe(false);
            }
        });
    });

    describe('intervalMs()', () => {
        it('defaults to 2000ms', () => {
            expect(service.intervalMs()).toBe(2000);
        });

        it('clamps to floor 500ms', () => {
            process.env.UK_OUTBOX_DRAIN_INTERVAL_MS = '100';
            expect(service.intervalMs()).toBe(500);
        });

        it('clamps to ceiling 60000ms', () => {
            process.env.UK_OUTBOX_DRAIN_INTERVAL_MS = '999999';
            expect(service.intervalMs()).toBe(60000);
        });

        it('respects valid env value', () => {
            process.env.UK_OUTBOX_DRAIN_INTERVAL_MS = '3000';
            expect(service.intervalMs()).toBe(3000);
        });

        it('falls back to default on NaN', () => {
            process.env.UK_OUTBOX_DRAIN_INTERVAL_MS = 'banana';
            expect(service.intervalMs()).toBe(2000);
        });
    });

    describe('start() lifecycle', () => {
        it('does not start any timer when disabled', () => {
            const s = new UkOutboxService();
            s.start();
            expect(s._timer).toBeNull();
            expect(s._warmupTimer).toBeNull();
        });

        it('schedules warmup + interval timer when enabled', () => {
            process.env.UK_USE_WEBHOOK_SENDER = 'true';
            const s = new UkOutboxService();
            s.start();
            expect(s._timer).not.toBeNull();
            expect(s._warmupTimer).not.toBeNull();
            s.stop();
        });

        it('idempotent: second start() warns and is a no-op', () => {
            process.env.UK_USE_WEBHOOK_SENDER = 'true';
            const s = new UkOutboxService();
            s.start();
            const firstTimer = s._timer;
            s.start();
            expect(s._timer).toBe(firstTimer);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already started'));
            s.stop();
        });
    });

    describe('_tick — advisory lock (B-022 client-scoped)', () => {
        it('skips drain + releases client when lock is denied (another replica holds it)', async () => {
            mockAdvisoryLockDenied();
            await service._tick();
            expect(UkOutbox.pickNext).not.toHaveBeenCalled();
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        it('drains when lock acquired; lock + unlock on the SAME client; releases', async () => {
            mockAdvisoryLockAcquired();
            UkOutbox.pickNext.mockResolvedValue(null); // queue empty

            await service._tick();

            const sqls = clientSqls();
            expect(sqls.some(s => /pg_try_advisory_lock/.test(s))).toBe(true);
            expect(sqls.some(s => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(db.__mockPool.connect).toHaveBeenCalledTimes(1);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
            // Lock no longer taken via the pool wrapper.
            expect(db.query.mock.calls.some(c => /pg_(try_)?advisory_(un)?lock/.test(c[0]))).toBe(false);
        });

        it('releases client + unlock even when drain throws', async () => {
            mockAdvisoryLockAcquired();
            UkOutbox.pickNext.mockRejectedValue(new Error('DB outage'));

            await service._tick();

            expect(clientSqls().some(s => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
            expect(service._consecutiveFailures).toBe(1);
        });

        it('records failure + no client release when connect() throws', async () => {
            db.__mockPool.connect.mockRejectedValueOnce(new Error('pool exhausted'));
            await service._tick();
            expect(service._consecutiveFailures).toBe(1);
            expect(db.__mockClient.release).not.toHaveBeenCalled();
            expect(service._running).toBe(false);
        });
    });

    describe('_tick — mutex', () => {
        it('skips when previous tick is still inflight (no checkout)', async () => {
            service._running = true;
            await service._tick();
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
            expect(db.query).not.toHaveBeenCalled();
        });

        it('skips when service has been stopped (no checkout)', async () => {
            service._stopped = true;
            await service._tick();
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
            expect(db.query).not.toHaveBeenCalled();
        });
    });

    describe('_drainOne — outcomes', () => {
        const queuedRow = {
            id: 1,
            event_id: 'evt-abc',
            payload_body: '{"event":"alert.created"}',
            attempt_count: 0
        };

        beforeEach(() => {
            mockAdvisoryLockAcquired();
        });

        it('success → markSent + AlertRequestMap.markSent', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ id: 99, status: 'pending', infrasafe_alert_id: 7 });

            await service._tick();

            expect(UkOutbox.markSent).toHaveBeenCalledWith(1, 202);
            expect(AlertRequestMap.markSent).toHaveBeenCalledWith(99, null);
        });

        it('success but no AlertRequestMap → still markSent on outbox row (does not throw)', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service._tick();

            expect(UkOutbox.markSent).toHaveBeenCalled();
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
        });

        it('success but ARM already in sent status → skips ARM update', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ id: 99, status: 'sent' });

            await service._tick();

            expect(UkOutbox.markSent).toHaveBeenCalled();
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
        });

        it('dead → markDead + records notification_failure', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'dead', code: 401, error: 'signature stale' });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ id: 99, infrasafe_alert_id: 7 });

            await service._tick();

            expect(UkOutbox.markDead).toHaveBeenCalledWith(1, 'signature stale', 401);
            // notification_failure: an UPDATE infrastructure_alerts SET data = ...
            const calls = db.query.mock.calls.map(c => c[0]);
            expect(calls.some(s => /UPDATE infrastructure_alerts/.test(s))).toBe(true);
        });

        // [B-007] integration_log must reflect retry/dead transitions, not just
        // the terminal success/dead landing. Each outbound event_id has a log row
        // written at enqueue time (alertForwarder → webhookVerifier.logEvent);
        // the drain worker now updates that row's status as the event progresses.
        it('[AUD-001 PR-B] dead engineer escalation with NO mapping → records failure via payload_body.alert.alert_id', async () => {
            // Engineer escalations are enqueued without an AlertRequestMap row,
            // so findByIdempotencyKey returns null. The dead-letter must fall
            // back to the alert_id baked into the canonical payload body.
            UkOutbox.pickNext.mockResolvedValue({
                id: 1,
                event_id: 'eng-evt',
                payload_body: JSON.stringify({ event: 'alert.engineer_required', alert: { alert_id: 7 } }),
                attempt_count: 0
            });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'dead', code: 401, error: 'stale' });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null); // no mapping

            await service._tick();

            const updateCall = db.query.mock.calls.find(c => /UPDATE infrastructure_alerts/.test(c[0]));
            expect(updateCall).toBeDefined();
            expect(updateCall[1][0]).toBe(7); // alert_id from payload_body
        });

        it('[B-007] dead → updates integration_log status to "failed" with error', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'dead', code: 401, error: 'signature stale' });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ id: 99, infrasafe_alert_id: 7 });

            await service._tick();

            expect(IntegrationLog.updateStatusByEventId).toHaveBeenCalledWith('evt-abc', 'failed', 'signature stale');
        });

        it('[B-007] retry → updates integration_log status to "retrying" with error', async () => {
            UkOutbox.pickNext.mockResolvedValue({ ...queuedRow, attempt_count: 0 });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'retry', code: 429, error: 'rate limit' });

            await service._tick();

            expect(IntegrationLog.updateStatusByEventId).toHaveBeenCalledWith('evt-abc', 'retrying', 'rate limit');
        });

        it('[B-007] retry escalating to dead at MAX_ATTEMPTS → integration_log "failed"', async () => {
            UkOutbox.pickNext.mockResolvedValue({ ...queuedRow, attempt_count: 4 });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'retry', code: 503, error: 'persistent 503' });

            await service._tick();

            expect(IntegrationLog.updateStatusByEventId).toHaveBeenCalledWith('evt-abc', 'failed', 'persistent 503');
        });

        it('[B-007] success → updates integration_log status to "success"', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ id: 99, status: 'pending' });

            await service._tick();

            expect(IntegrationLog.updateStatusByEventId).toHaveBeenCalledWith('evt-abc', 'success', null);
        });

        it('[B-007] integration_log write failure must NOT break the drain (best-effort)', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);
            IntegrationLog.updateStatusByEventId.mockRejectedValueOnce(new Error('db blip'));

            await expect(service._tick()).resolves.not.toThrow();
            expect(UkOutbox.markSent).toHaveBeenCalled(); // primary transition still happened
        });

        it('skip → resetForSkip with 60s', async () => {
            UkOutbox.pickNext.mockResolvedValue(queuedRow);
            ukWebhookClient.send.mockResolvedValue({ outcome: 'skip', error: 'UK_WEBHOOK_SECRET missing' });

            await service._tick();

            expect(UkOutbox.resetForSkip).toHaveBeenCalledWith(1, 60);
            expect(UkOutbox.markDead).not.toHaveBeenCalled();
            expect(UkOutbox.markFailed).not.toHaveBeenCalled();
        });

        it('retry on first failure → markFailed with backoff 2s', async () => {
            UkOutbox.pickNext.mockResolvedValue({ ...queuedRow, attempt_count: 0 });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'retry', code: 429, error: 'rate limit' });

            await service._tick();

            expect(UkOutbox.markFailed).toHaveBeenCalledWith(1, 'rate limit', 429, 2);
        });

        it('retry escalates: attempt_count=1 → 4s backoff', async () => {
            UkOutbox.pickNext.mockResolvedValue({ ...queuedRow, attempt_count: 1 });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'retry', code: 503, error: 'down' });

            await service._tick();

            expect(UkOutbox.markFailed).toHaveBeenCalledWith(1, 'down', 503, 4);
        });

        it('retry at MAX_ATTEMPTS-1 → markDead instead of markFailed', async () => {
            UkOutbox.pickNext.mockResolvedValue({ ...queuedRow, attempt_count: 4 });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'retry', code: 503, error: 'persistent 503' });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({ infrasafe_alert_id: 7 });

            await service._tick();

            expect(UkOutbox.markDead).toHaveBeenCalled();
            expect(UkOutbox.markFailed).not.toHaveBeenCalled();
        });
    });

    // [AUD-001 PR-C Finding 3] Drain-TTL guard — a row older than
    // UK_OUTBOX_MAX_AGE_HOURS is marked dead instead of POSTed, so flipping
    // UK_USE_WEBHOOK_SENDER on doesn't burst a backlog of stale tickets at UK.
    describe('[AUD-001 PR-C] drain-TTL guard', () => {
        beforeEach(() => mockAdvisoryLockAcquired());

        const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

        it('stale row (older than default 24h) → markDead, NO send, failure recorded', async () => {
            UkOutbox.pickNext.mockResolvedValue({
                id: 1, event_id: 'old-evt',
                payload_body: JSON.stringify({ event: 'alert.engineer_required', alert: { alert_id: 7 } }),
                attempt_count: 0, created_at: hoursAgo(25)
            });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service._tick();

            expect(ukWebhookClient.send).not.toHaveBeenCalled();
            expect(UkOutbox.markDead).toHaveBeenCalledWith(1, expect.stringContaining('stale'), null);
            // dead-letter recorded against the alert_id from the payload body
            const updateCall = db.query.mock.calls.find(c => /UPDATE infrastructure_alerts/.test(c[0]));
            expect(updateCall).toBeDefined();
            expect(updateCall[1][0]).toBe(7);
        });

        it('fresh row (younger than 24h) → sent normally', async () => {
            UkOutbox.pickNext.mockResolvedValue({
                id: 1, event_id: 'fresh-evt', payload_body: '{"event":"alert.created"}',
                attempt_count: 0, created_at: hoursAgo(1)
            });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service._tick();

            expect(ukWebhookClient.send).toHaveBeenCalledTimes(1);
            expect(UkOutbox.markDead).not.toHaveBeenCalled();
        });

        it('row with NO created_at (legacy/test) is never considered stale', async () => {
            UkOutbox.pickNext.mockResolvedValue({
                id: 1, event_id: 'no-ts', payload_body: '{"event":"alert.created"}', attempt_count: 0
            });
            ukWebhookClient.send.mockResolvedValue({ outcome: 'success', code: 202 });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service._tick();

            expect(ukWebhookClient.send).toHaveBeenCalledTimes(1);
            expect(UkOutbox.markDead).not.toHaveBeenCalled();
        });

        it('honours UK_OUTBOX_MAX_AGE_HOURS override (1h) → a 2h-old row is stale', async () => {
            process.env.UK_OUTBOX_MAX_AGE_HOURS = '1';
            UkOutbox.pickNext.mockResolvedValue({
                id: 1, event_id: 'evt', payload_body: '{"event":"alert.created","alert":{"alert_id":3}}',
                attempt_count: 0, created_at: hoursAgo(2)
            });
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service._tick();

            expect(ukWebhookClient.send).not.toHaveBeenCalled();
            expect(UkOutbox.markDead).toHaveBeenCalled();
        });
    });

    describe('_drainOne — empty queue', () => {
        beforeEach(() => mockAdvisoryLockAcquired());

        it('pickNext null → no client call, no marks', async () => {
            UkOutbox.pickNext.mockResolvedValue(null);
            await service._tick();

            expect(ukWebhookClient.send).not.toHaveBeenCalled();
            expect(UkOutbox.markSent).not.toHaveBeenCalled();
            expect(UkOutbox.markFailed).not.toHaveBeenCalled();
            expect(UkOutbox.markDead).not.toHaveBeenCalled();
        });
    });
});
