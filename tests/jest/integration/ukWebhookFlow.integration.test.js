'use strict';

/**
 * [Sprint 9 / FIX-007] End-to-end flow integration test.
 *
 * Verifies that the three Sprint 9 modules cooperate correctly through
 * a representative scenario: an alert fires → alertForwarder enqueues
 * to outbox → drain worker picks it up → ukWebhookClient signs + POSTs
 * → outbox marks sent → AlertRequestMap transitions to 'sent'.
 *
 * No external network: axios is mocked, db.query is mocked. The point of
 * this test is to exercise module wiring (real require graph), not
 * production DB or HTTP.
 */

jest.mock('axios', () => ({ post: jest.fn() }));
// [B-022] _tick takes the advisory lock on a checked-out client; the drain's
// row ops (pickNext/markSent/ARM/notification) stay on db.query.
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

const axios = require('axios');
const db = require('../../../src/config/database');

const ukOutboxService = require('../../../src/services/uk/ukOutboxService');
const { UKWebhookClient } = require('../../../src/clients/ukWebhookClient');

describe('Sprint 9 / FIX-007 — end-to-end outbound flow', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockReset();
        db.__mockClient.query.mockReset();
        db.__mockClient.release.mockClear();
        db.__mockPool.connect.mockClear();
        // [B-022] advisory lock lives on the checked-out client now.
        db.__mockClient.query.mockImplementation((sql) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
            return Promise.resolve({ rows: [] });
        });
        process.env = { ...ORIGINAL_ENV };
        process.env.UK_USE_WEBHOOK_SENDER = 'true';
        process.env.UK_WEBHOOK_SECRET = 'test-secret-do-not-use-in-prod';
        process.env.UK_API_URL = 'https://uk.example.com';
        ukOutboxService._running = false;
        ukOutboxService._stopped = false;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('happy path: enqueue → drain → UK 202 → outbox sent → AlertRequestMap sent', async () => {
        // ── ARRANGE ──────────────────────────────────────────────
        const payloadBody = JSON.stringify({
            event_id: 'aaaaaaaa-1111-4111-8111-111111111111',
            event: 'alert.created',
            timestamp: '2026-05-22T12:00:00Z',
            alert: { external_id: 'b1', type: 'TRANSFORMER_OVERLOAD', severity: 'WARNING', message: 'overload' }
        });

        // Simulate: an outbox row already exists (enqueue side of the
        // flow is unit-tested in ukIntegrationServiceTest). pickNext returns
        // this row to the drain worker.
        const queuedRow = {
            id: 1,
            event_id: 'aaaaaaaa-1111-4111-8111-111111111111',
            payload_body: payloadBody,
            attempt_count: 0,
            status: 'pending'
        };

        // db.query is called for:
        //   1. advisory_lock (locked)
        //   2. pickNext (returns row)
        //   3. markSent UPDATE
        //   4. AlertRequestMap.findByIdempotencyKey
        //   5. AlertRequestMap.markSent UPDATE
        //   6. advisory_unlock
        db.query.mockImplementation((sql, _params) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql))  return Promise.resolve({ rows: [{}] });
            if (/FOR UPDATE SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [queuedRow] });
            if (/UPDATE uk_outbox/.test(sql) && /SET status = 'sent'/.test(sql)) {
                return Promise.resolve({ rows: [{ id: 1, status: 'sent' }] });
            }
            if (/SELECT \* FROM alert_request_map WHERE idempotency_key/.test(sql)) {
                return Promise.resolve({ rows: [{ id: 99, status: 'pending', infrasafe_alert_id: 7 }] });
            }
            if (/UPDATE alert_request_map SET status = \$1, uk_request_number/.test(sql)) {
                return Promise.resolve({ rows: [{ id: 99, status: 'sent' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        axios.post.mockResolvedValue({ status: 202, data: { detail: 'accepted' } });

        // ── ACT ──────────────────────────────────────────────────
        await ukOutboxService._tick();

        // ── ASSERT ───────────────────────────────────────────────
        // axios.post should have been called once with the body byte-stable
        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, opts] = axios.post.mock.calls[0];
        expect(url).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        expect(body).toBe(payloadBody);                              // verbatim — D2 byte stability
        expect(opts.headers['x-webhook-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

        // Signature should be deterministic given the same body+secret+t
        // (we don't know the exact `t` but we can compute what it should be)
        const sigMatch = opts.headers['x-webhook-signature'].match(/^t=(\d+),v1=([a-f0-9]{64})$/);
        const observedT = parseInt(sigMatch[1], 10);
        const observedV1 = sigMatch[2];
        const recomputed = UKWebhookClient.sign(process.env.UK_WEBHOOK_SECRET, observedT, payloadBody);
        expect(recomputed.v1).toBe(observedV1);

        // outbox + ARM transitions invoked
        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /UPDATE uk_outbox/.test(s) && /SET status = 'sent'/.test(s))).toBe(true);
        expect(sqls.some(s => /UPDATE alert_request_map.*uk_request_number/.test(s))).toBe(true);
        // [B-022] advisory unlock now happens on the checked-out client.
        const clientSqls = db.__mockClient.query.mock.calls.map(c => c[0]);
        expect(clientSqls.some(s => /pg_advisory_unlock/.test(s))).toBe(true);
        expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
    });

    test('409 from UK is idempotent success (re-delivery)', async () => {
        const payloadBody = '{"event_id":"aaaaaaaa-2222-4222-8222-222222222222","event":"alert.created"}';
        const queuedRow = { id: 2, event_id: 'aaaaaaaa-2222-4222-8222-222222222222', payload_body: payloadBody, attempt_count: 0 };

        db.query.mockImplementation((sql) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql))  return Promise.resolve({ rows: [{}] });
            if (/FOR UPDATE SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [queuedRow] });
            if (/UPDATE uk_outbox/.test(sql)) return Promise.resolve({ rows: [{}] });
            if (/SELECT \* FROM alert_request_map/.test(sql)) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [] });
        });

        axios.post.mockResolvedValue({ status: 409, data: { detail: 'duplicate event' } });

        await ukOutboxService._tick();

        const sqls = db.query.mock.calls.map(c => c[0]);
        // Marked sent even though UK said 409 — idempotent
        expect(sqls.some(s => /UPDATE uk_outbox/.test(s) && /SET status = 'sent'/.test(s))).toBe(true);
    });

    test('401 from UK is terminal (no retry) and notification_failure recorded', async () => {
        const payloadBody = '{"event_id":"aaaaaaaa-3333-4333-8333-333333333333"}';
        const queuedRow = { id: 3, event_id: 'aaaaaaaa-3333-4333-8333-333333333333', payload_body: payloadBody, attempt_count: 0 };

        db.query.mockImplementation((sql, _params) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql))  return Promise.resolve({ rows: [{}] });
            if (/FOR UPDATE SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [queuedRow] });
            if (/UPDATE uk_outbox/.test(sql) && /SET status = 'dead'/.test(sql)) {
                return Promise.resolve({ rows: [{}] });
            }
            if (/SELECT \* FROM alert_request_map/.test(sql)) {
                return Promise.resolve({ rows: [{ infrasafe_alert_id: 42 }] });
            }
            if (/UPDATE infrastructure_alerts/.test(sql)) {
                return Promise.resolve({ rows: [{}] });
            }
            return Promise.resolve({ rows: [] });
        });

        axios.post.mockResolvedValue({ status: 401, data: { detail: 'signature stale' } });

        await ukOutboxService._tick();

        const sqls = db.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /UPDATE uk_outbox/.test(s) && /SET status = 'dead'/.test(s))).toBe(true);
        // notification_failure recorded on the underlying alert
        expect(sqls.some(s => /UPDATE infrastructure_alerts/.test(s) && /notification_failures/.test(s))).toBe(true);
    });

    test('429 from UK is retriable with backoff (no dead, no retry-burn)', async () => {
        const payloadBody = '{"event_id":"aaaaaaaa-4444-4444-8444-444444444444"}';
        const queuedRow = { id: 4, event_id: 'aaaaaaaa-4444-4444-8444-444444444444', payload_body: payloadBody, attempt_count: 0 };

        db.query.mockImplementation((sql) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql))  return Promise.resolve({ rows: [{}] });
            if (/FOR UPDATE SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [queuedRow] });
            if (/UPDATE uk_outbox/.test(sql) && /attempt_count = attempt_count \+ 1/.test(sql)) {
                return Promise.resolve({ rows: [{}] });
            }
            return Promise.resolve({ rows: [] });
        });

        axios.post.mockResolvedValue({ status: 429, data: { detail: 'rate limit' } });

        await ukOutboxService._tick();

        const sqls = db.query.mock.calls.map(c => c[0]);
        const updateMarkFailed = sqls.find(s =>
            /UPDATE uk_outbox/.test(s) &&
            /attempt_count = attempt_count \+ 1/.test(s) &&
            /next_attempt_at = NOW\(\)/.test(s)
        );
        expect(updateMarkFailed).toBeDefined();
        // Did NOT mark dead
        expect(sqls.some(s => /UPDATE uk_outbox/.test(s) && /SET status = 'dead'/.test(s))).toBe(false);
    });

    test('secret missing → skip outcome, row stays pending with 60s backoff', async () => {
        delete process.env.UK_WEBHOOK_SECRET;

        const payloadBody = '{"event_id":"aaaaaaaa-5555-4555-8555-555555555555"}';
        const queuedRow = { id: 5, event_id: 'aaaaaaaa-5555-4555-8555-555555555555', payload_body: payloadBody, attempt_count: 0 };

        db.query.mockImplementation((sql) => {
            if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
            if (/pg_advisory_unlock/.test(sql))  return Promise.resolve({ rows: [{}] });
            if (/FOR UPDATE SKIP LOCKED/.test(sql)) return Promise.resolve({ rows: [queuedRow] });
            if (/UPDATE uk_outbox/.test(sql)) return Promise.resolve({ rows: [{}] });
            return Promise.resolve({ rows: [] });
        });

        await ukOutboxService._tick();

        // No HTTP call attempted
        expect(axios.post).not.toHaveBeenCalled();
        // resetForSkip path: UPDATE uk_outbox SET next_attempt_at = ..., last_error = ...
        // (no attempt_count++, no markDead)
        const sqls = db.query.mock.calls.map(c => c[0]);
        const skipUpdate = sqls.find(s =>
            /UPDATE uk_outbox/.test(s) &&
            /next_attempt_at = NOW\(\)/.test(s) &&
            !/attempt_count = attempt_count \+ 1/.test(s) &&
            !/SET status = 'dead'/.test(s)
        );
        expect(skipUpdate).toBeDefined();
    });
});
