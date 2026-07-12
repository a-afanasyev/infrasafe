'use strict';

/**
 * Direct unit tests for src/services/uk/webhookVerifier.js — previously only
 * exercised indirectly through webhookRoutes tests (which mock it entirely).
 * Covers the [Hardening] timestamp-validation fix: a malformed/non-numeric
 * `t` must be rejected outright rather than silently passing the freshness
 * gate because `Math.abs(now - NaN) > TOLERANCE` is always false.
 */

jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(),
    findByEventId: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/utils/redisClient', () => ({
    getClient: jest.fn().mockReturnValue(null),
    isReady: jest.fn().mockReturnValue(false),
}));

const crypto = require('crypto');

describe('UKWebhookVerifier.verifyWebhookSignature', () => {
    const SECRET = 'unit-test-webhook-secret';
    let verifier;
    let originalSecret;

    function sign(timestamp, body) {
        const hmac = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
        return `t=${timestamp},v1=${hmac}`;
    }

    beforeEach(() => {
        jest.resetModules();
        originalSecret = process.env.INFRASAFE_WEBHOOK_SECRET;
        process.env.INFRASAFE_WEBHOOK_SECRET = SECRET;
        verifier = require('../../../src/services/uk/webhookVerifier');
        verifier._resetSeenSignatures();
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.INFRASAFE_WEBHOOK_SECRET;
        } else {
            process.env.INFRASAFE_WEBHOOK_SECRET = originalSecret;
        }
    });

    test('accepts a validly signed, fresh request', async () => {
        const body = '{"event":"ping"}';
        const t = Math.floor(Date.now() / 1000);
        const header = sign(t, body);

        await expect(verifier.verifyWebhookSignature(body, header)).resolves.toBe(true);
    });

    test('rejects a non-numeric timestamp even with a matching HMAC for that literal string', async () => {
        const body = '{"event":"ping"}';
        // Signed correctly against the literal string 't=abc' — proves this
        // isn't just "signature mismatch", it's the malformed-timestamp guard.
        const header = sign('abc', body);

        await expect(verifier.verifyWebhookSignature(body, header)).resolves.toBe(false);
    });

    test('rejects an empty timestamp', async () => {
        const body = '{"event":"ping"}';
        await expect(verifier.verifyWebhookSignature(body, 't=,v1=deadbeef')).resolves.toBe(false);
    });

    test('rejects an overlong / overflow-shaped timestamp', async () => {
        const body = '{"event":"ping"}';
        const hugeTimestamp = '99999999999999999999'; // 20 digits, exceeds Number.isSafeInteger range
        const header = sign(hugeTimestamp, body);

        await expect(verifier.verifyWebhookSignature(body, header)).resolves.toBe(false);
    });

    test('rejects a stale (but numeric) timestamp outside the tolerance window', async () => {
        const body = '{"event":"ping"}';
        const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1h ago
        const header = sign(staleTimestamp, body);

        await expect(verifier.verifyWebhookSignature(body, header)).resolves.toBe(false);
    });

    test('rejects when the signature header is missing', async () => {
        await expect(verifier.verifyWebhookSignature('{}', null)).resolves.toBe(false);
    });

    test('rejects when INFRASAFE_WEBHOOK_SECRET is not configured (fail-closed)', async () => {
        delete process.env.INFRASAFE_WEBHOOK_SECRET;
        jest.resetModules();
        const freshVerifier = require('../../../src/services/uk/webhookVerifier');
        const body = '{"event":"ping"}';
        const t = Math.floor(Date.now() / 1000);
        const header = sign(t, body);

        await expect(freshVerifier.verifyWebhookSignature(body, header)).resolves.toBe(false);
    });
});
