'use strict';

/**
 * [Sprint 9 / FIX-007] ukWebhookClient unit tests.
 *
 * Covers:
 *   - L1 reference-vector pin-test (symmetry with UK verifier)
 *   - Dual-secret rotation (UK_USE_NEXT_SECRET)
 *   - UK_API_URL hygiene (strip /api/vN suffix)
 *   - Response code → outcome translation
 *   - Network/timeout → retry outcome
 *   - Missing secret / URL → skip outcome
 *   - Body bytes are POSTed verbatim (no re-stringify)
 */

const crypto = require('crypto');

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const axios = require('axios');
const client = require('../../../src/clients/ukWebhookClient');
const { UKWebhookClient } = require('../../../src/clients/ukWebhookClient');

describe('ukWebhookClient', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.UK_WEBHOOK_SECRET;
        delete process.env.UK_WEBHOOK_SECRET_NEXT;
        delete process.env.UK_USE_NEXT_SECRET;
        delete process.env.UK_API_URL;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    // -------------------------------------------------------------------------
    // L1 reference vector — pin-test for HMAC symmetry with UK verifier
    // Source: docs/audit/2026-05-22-FIX-007-uk-integration-questions.md § L1
    // -------------------------------------------------------------------------
    describe('L1 reference vector', () => {
        const REFERENCE = {
            secret: 'uk_webhook_shared_secret_DEMO',
            t: 1747900800,
            body: '{"event_id":"11111111-1111-4111-8111-111111111111","event":"alert.created","timestamp":"2026-05-22T12:00:00Z","alert":{"severity":"high","message":"test"}}',
            expected_v1: '6fe9e4327b7e9c9e22e49442cc376650358ca7894b1102615274e0ba9d47a1dc'
        };

        it('sign() reproduces the UK-provided v1 byte-for-byte', () => {
            const { v1, header, t } = UKWebhookClient.sign(REFERENCE.secret, REFERENCE.t, REFERENCE.body);
            expect(v1).toBe(REFERENCE.expected_v1);
            expect(t).toBe(REFERENCE.t);
            expect(header).toBe(`t=${REFERENCE.t},v1=${REFERENCE.expected_v1}`);
        });

        it('any single-byte change to the body produces a different v1', () => {
            const { v1: base } = UKWebhookClient.sign(REFERENCE.secret, REFERENCE.t, REFERENCE.body);
            const tweaked = REFERENCE.body.replace('"high"', '"low"');
            const { v1: alt } = UKWebhookClient.sign(REFERENCE.secret, REFERENCE.t, tweaked);
            expect(alt).not.toBe(base);
        });

        it('different secret produces a different v1', () => {
            const { v1: base } = UKWebhookClient.sign(REFERENCE.secret, REFERENCE.t, REFERENCE.body);
            const { v1: alt } = UKWebhookClient.sign('OTHER_SECRET', REFERENCE.t, REFERENCE.body);
            expect(alt).not.toBe(base);
        });
    });

    // -------------------------------------------------------------------------
    // Endpoint resolution — UK_API_URL hygiene
    // -------------------------------------------------------------------------
    describe('_getEndpoint()', () => {
        it('returns null when UK_API_URL is unset', () => {
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBeNull();
        });

        it('appends /api/v2/webhooks/infrasafe/alert to bare host', () => {
            process.env.UK_API_URL = 'https://uk.example.com';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        });

        it('strips trailing slash', () => {
            process.env.UK_API_URL = 'https://uk.example.com/';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        });

        it('strips /api/v1 suffix (legacy prod env)', () => {
            process.env.UK_API_URL = 'https://uk.example.com/api/v1';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        });

        it('strips /api/v2 suffix too', () => {
            process.env.UK_API_URL = 'https://uk.example.com/api/v2';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        });

        // ---------------------------------------------------------------------
        // SEC-5 — SSRF: validate UK_API_URL on the runtime/env path. The admin
        // config path already runs validateUKApiUrl(); the env path did not.
        // A private / metadata / localhost host must be rejected (→ null), and
        // null is treated by send() as 'skip' (not configured).
        // ---------------------------------------------------------------------
        it('returns null for a private-IP host (SSRF block)', () => {
            process.env.UK_API_URL = 'https://10.0.0.5/api/v2';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBeNull();
        });

        it('returns null for the cloud metadata host (SSRF block)', () => {
            process.env.UK_API_URL = 'https://169.254.169.254/latest/meta-data';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBeNull();
        });

        it('returns null for the GCP metadata hostname (SSRF block)', () => {
            process.env.UK_API_URL = 'https://metadata.google.internal/computeMetadata';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBeNull();
        });

        it('returns null for localhost (SSRF block)', () => {
            process.env.NODE_ENV = 'test';
            process.env.UK_API_URL = 'https://localhost/api/v2';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBeNull();
        });

        it('still resolves a valid public https host after validation', () => {
            process.env.UK_API_URL = 'https://uk.example.com';
            const c = new UKWebhookClient();
            expect(c._getEndpoint()).toBe('https://uk.example.com/api/v2/webhooks/infrasafe/alert');
        });

        it('send() returns skip when UK_API_URL points at a private host', async () => {
            process.env.UK_WEBHOOK_SECRET = 'test-secret';
            process.env.UK_API_URL = 'https://127.0.0.1:8080';
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('skip');
            expect(axios.post).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Secret resolution — dual-secret rotation support
    // -------------------------------------------------------------------------
    describe('_getSecret()', () => {
        it('returns null when no secret env var is set', () => {
            const c = new UKWebhookClient();
            expect(c._getSecret()).toBeNull();
        });

        it('returns UK_WEBHOOK_SECRET by default', () => {
            process.env.UK_WEBHOOK_SECRET = 'primary';
            const c = new UKWebhookClient();
            expect(c._getSecret()).toBe('primary');
        });

        it('returns UK_WEBHOOK_SECRET_NEXT when UK_USE_NEXT_SECRET=true', () => {
            process.env.UK_WEBHOOK_SECRET = 'primary';
            process.env.UK_WEBHOOK_SECRET_NEXT = 'rotation';
            process.env.UK_USE_NEXT_SECRET = 'true';
            const c = new UKWebhookClient();
            expect(c._getSecret()).toBe('rotation');
        });

        it('falls back to primary if NEXT flag set but NEXT var missing', () => {
            process.env.UK_WEBHOOK_SECRET = 'primary';
            process.env.UK_USE_NEXT_SECRET = 'true';
            const c = new UKWebhookClient();
            expect(c._getSecret()).toBe('primary');
        });
    });

    // -------------------------------------------------------------------------
    // send() outcome translation
    // -------------------------------------------------------------------------
    describe('send()', () => {
        beforeEach(() => {
            process.env.UK_WEBHOOK_SECRET = 'test-secret';
            process.env.UK_API_URL = 'https://uk.example.com';
        });

        it('returns skip when secret is missing', async () => {
            delete process.env.UK_WEBHOOK_SECRET;
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('skip');
            expect(axios.post).not.toHaveBeenCalled();
        });

        it('returns skip when UK_API_URL is missing', async () => {
            delete process.env.UK_API_URL;
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('skip');
            expect(axios.post).not.toHaveBeenCalled();
        });

        it('returns success on 202', async () => {
            axios.post.mockResolvedValue({ status: 202, data: { ok: true } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('success');
            expect(result.code).toBe(202);
        });

        it('returns success on 409 (idempotent re-delivery)', async () => {
            axios.post.mockResolvedValue({ status: 409, data: { detail: 'duplicate event' } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('success');
            expect(result.code).toBe(409);
        });

        it('returns dead on 401', async () => {
            axios.post.mockResolvedValue({ status: 401, data: { detail: 'signature stale' } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('dead');
            expect(result.code).toBe(401);
            expect(result.error).toContain('signature stale');
        });

        it('returns dead on 422', async () => {
            axios.post.mockResolvedValue({ status: 422, data: { detail: 'invalid payload schema' } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('dead');
            expect(result.code).toBe(422);
        });

        it('returns retry on 429', async () => {
            axios.post.mockResolvedValue({ status: 429, data: { detail: 'rate limit' } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('retry');
            expect(result.code).toBe(429);
        });

        it('returns retry on 503', async () => {
            axios.post.mockResolvedValue({ status: 503, data: { detail: 'webhook receiver not configured' } });
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('retry');
            expect(result.code).toBe(503);
        });

        it('returns retry on network error', async () => {
            axios.post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
            const result = await client.send('{"event":"alert.created"}');
            expect(result.outcome).toBe('retry');
            expect(result.error).toContain('ECONNREFUSED');
        });

        it('POSTs the body bytes verbatim (no re-stringify)', async () => {
            axios.post.mockResolvedValue({ status: 202, data: {} });
            const canonical = '{"event_id":"abc","event":"alert.created"}';
            await client.send(canonical);
            const [, body, opts] = axios.post.mock.calls[0];
            expect(body).toBe(canonical);
            // transformRequest must be a no-op so axios doesn't re-serialize.
            expect(typeof opts.transformRequest[0]).toBe('function');
            expect(opts.transformRequest[0](canonical)).toBe(canonical);
        });

        it('includes signature header in request', async () => {
            axios.post.mockResolvedValue({ status: 202, data: {} });
            await client.send('{"e":1}');
            const [, , opts] = axios.post.mock.calls[0];
            expect(opts.headers['x-webhook-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
        });

        it('signs with current timestamp, not a stored one', async () => {
            axios.post.mockResolvedValue({ status: 202, data: {} });
            const before = Math.floor(Date.now() / 1000);
            await client.send('{"e":1}');
            const after = Math.floor(Date.now() / 1000);
            const [, , opts] = axios.post.mock.calls[0];
            const match = opts.headers['x-webhook-signature'].match(/^t=(\d+),/);
            const t = parseInt(match[1], 10);
            expect(t).toBeGreaterThanOrEqual(before);
            expect(t).toBeLessThanOrEqual(after);
        });

        it('treats unknown 5xx as retriable', async () => {
            axios.post.mockResolvedValue({ status: 500, data: { detail: 'internal' } });
            const result = await client.send('{"e":1}');
            expect(result.outcome).toBe('retry');
            expect(result.code).toBe(500);
        });

        it('treats unknown 4xx as retriable (paranoid: don\'t lose events on UK API drift)', async () => {
            axios.post.mockResolvedValue({ status: 418, data: { detail: 'teapot' } });
            const result = await client.send('{"e":1}');
            // Future UK API additions shouldn't silently dead-letter our events.
            expect(result.outcome).toBe('retry');
        });
    });
});
