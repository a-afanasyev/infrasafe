'use strict';

/**
 * [H-4] Route-level tests for GET /uk-requests-metrics wiring: rate limiter +
 * requireServiceToken gate, both dormant-until-configured. The controller's
 * own behavior is covered by ukRequestsMetricsController.test.js — this file
 * verifies the middleware chain actually applied in the route.
 */

jest.mock('../../../src/models/AlertRequestMap', () => ({
    listInventory: jest.fn().mockResolvedValue({ rows: [], limit: 5000 }),
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

describe('ukRequestsMetricsRoutes', () => {
    let app;
    const ORIGINAL_TOKEN = process.env.UK_INVENTORY_TOKEN;

    function buildApp() {
        jest.resetModules();
        const router = require('../../../src/routes/ukRequestsMetricsRoutes');
        const freshApp = express();
        freshApp.use('/', router);
        return freshApp;
    }

    afterEach(() => {
        if (ORIGINAL_TOKEN === undefined) {
            delete process.env.UK_INVENTORY_TOKEN;
        } else {
            process.env.UK_INVENTORY_TOKEN = ORIGINAL_TOKEN;
        }
    });

    test('dormant: returns 200 without any token when UK_INVENTORY_TOKEN is unset', async () => {
        delete process.env.UK_INVENTORY_TOKEN;
        app = buildApp();

        const res = await request(app).get('/');

        expect(res.status).toBe(200);
    });

    test('enforced: rejects the request when UK_INVENTORY_TOKEN is set but no header is sent', async () => {
        process.env.UK_INVENTORY_TOKEN = 'shared-uk-secret';
        app = buildApp();

        const res = await request(app).get('/');

        expect(res.status).toBe(401);
    });

    test('enforced: accepts the request with the correct x-service-token header', async () => {
        process.env.UK_INVENTORY_TOKEN = 'shared-uk-secret';
        app = buildApp();

        const res = await request(app).get('/').set('x-service-token', 'shared-uk-secret');

        expect(res.status).toBe(200);
    });

    test('enforced: rejects the request with a wrong x-service-token header', async () => {
        process.env.UK_INVENTORY_TOKEN = 'shared-uk-secret';
        app = buildApp();

        const res = await request(app).get('/').set('x-service-token', 'wrong-secret');

        expect(res.status).toBe(401);
    });
});
