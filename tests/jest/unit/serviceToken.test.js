'use strict';

/**
 * [H-4] Unit tests for src/middleware/serviceToken.js — dormant-until-set
 * shared-secret gate for machine-to-machine endpoints (GET
 * /uk-requests-metrics).
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const { requireServiceToken } = require('../../../src/middleware/serviceToken');

describe('requireServiceToken', () => {
    const ENV_VAR = 'TEST_SERVICE_TOKEN';
    const HEADER = 'x-service-token';
    let middleware;
    let req, res, next;
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        delete process.env[ENV_VAR];
        process.env.NODE_ENV = originalNodeEnv;
        middleware = requireServiceToken({ envVar: ENV_VAR, header: HEADER });
        req = { headers: {}, baseUrl: '/api/test' };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    test('dormant: calls next() when the env var is unset, regardless of headers', () => {
        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('enforced: rejects a missing header when the env var is set', () => {
        process.env[ENV_VAR] = 'super-secret-token';

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('enforced: rejects a wrong token', () => {
        process.env[ENV_VAR] = 'super-secret-token';
        req.headers[HEADER] = 'wrong-token';

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('enforced: rejects a token of different length (no length-leak via timingSafeEqual)', () => {
        process.env[ENV_VAR] = 'super-secret-token';
        req.headers[HEADER] = 'short';

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('enforced: accepts the correct token', () => {
        process.env[ENV_VAR] = 'super-secret-token';
        req.headers[HEADER] = 'super-secret-token';

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
