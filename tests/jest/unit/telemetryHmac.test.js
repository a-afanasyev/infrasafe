'use strict';

/**
 * [H-3] Unit tests for src/middleware/telemetryHmac.js — HMAC service-key
 * gate on POST /api/metrics/telemetry. Dormant when TELEMETRY_HMAC_SECRET is
 * unset (current behavior preserved); fail-closed once set.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/utils/redisClient', () => ({
    getClient: jest.fn().mockReturnValue(null),
    isReady: jest.fn().mockReturnValue(false),
}));

const crypto = require('crypto');

describe('telemetryHmac', () => {
    const SECRET = 'unit-test-telemetry-secret';
    let telemetryHmac;
    let originalSecret;
    let req, res, next;

    function sign(timestamp, body) {
        const hmac = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
        return `t=${timestamp},v1=${hmac}`;
    }

    beforeEach(() => {
        jest.resetModules();
        originalSecret = process.env.TELEMETRY_HMAC_SECRET;
        telemetryHmac = require('../../../src/middleware/telemetryHmac');
        telemetryHmac._resetSeenSignatures();

        req = { headers: {}, rawBody: '{"serial_number":"CRTL_OL_01"}' };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.TELEMETRY_HMAC_SECRET;
        } else {
            process.env.TELEMETRY_HMAC_SECRET = originalSecret;
        }
    });

    describe('dormant when TELEMETRY_HMAC_SECRET is unset', () => {
        test('calls next() without requiring a signature header', async () => {
            delete process.env.TELEMETRY_HMAC_SECRET;

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('enforced once TELEMETRY_HMAC_SECRET is set', () => {
        beforeEach(() => {
            process.env.TELEMETRY_HMAC_SECRET = SECRET;
        });

        test('accepts a validly signed, fresh request', async () => {
            const t = Math.floor(Date.now() / 1000);
            req.headers['x-telemetry-signature'] = sign(t, req.rawBody);

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('rejects a missing signature header', async () => {
            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        test('rejects a wrong signature', async () => {
            const t = Math.floor(Date.now() / 1000);
            req.headers['x-telemetry-signature'] = `t=${t},v1=${'0'.repeat(64)}`;

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        test('rejects a non-numeric timestamp even with a matching HMAC for that literal string', async () => {
            req.headers['x-telemetry-signature'] = sign('abc', req.rawBody);

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        test('rejects an empty timestamp', async () => {
            req.headers['x-telemetry-signature'] = 't=,v1=deadbeef';

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('rejects an overlong / overflow-shaped timestamp', async () => {
            const hugeTimestamp = '99999999999999999999';
            req.headers['x-telemetry-signature'] = sign(hugeTimestamp, req.rawBody);

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('rejects a stale (but numeric) timestamp outside the tolerance window', async () => {
            const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
            req.headers['x-telemetry-signature'] = sign(staleTimestamp, req.rawBody);

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('rejects a replayed signature', async () => {
            const t = Math.floor(Date.now() / 1000);
            req.headers['x-telemetry-signature'] = sign(t, req.rawBody);

            await telemetryHmac.verifyTelemetryHmac(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);

            // Second request, identical header (same body, same signature).
            const req2 = { ...req };
            const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next2 = jest.fn();
            await telemetryHmac.verifyTelemetryHmac(req2, res2, next2);

            expect(res2.status).toHaveBeenCalledWith(401);
            expect(next2).not.toHaveBeenCalled();
        });

        test('rejects when req.rawBody is missing (400, fail-closed)', async () => {
            const t = Math.floor(Date.now() / 1000);
            req.headers['x-telemetry-signature'] = sign(t, req.rawBody);
            delete req.rawBody;

            await telemetryHmac.verifyTelemetryHmac(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
