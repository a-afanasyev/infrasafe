'use strict';

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
jest.mock('../../../src/models/AlertRule', () => ({ findAll: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/middleware/auth', () => ({
    isAdmin: (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const IntegrationLog = require('../../../src/models/IntegrationLog');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { user_id: 1, role: 'admin' };
        next();
    });
    app.use('/integration', require('../../../src/routes/integrationRoutes'));
    return app;
}

describe('integrationRoutes coverage (supertest)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildApp();
    });

    // -----------------------------------------------------------------
    // GET /integration/request-counts (lines 14-19)
    // -----------------------------------------------------------------
    describe('GET /integration/request-counts', () => {
        test('returns success with data when getRequestCounts resolves', async () => {
            ukIntegrationService.getRequestCounts.mockResolvedValue({ total: 5 });

            const res = await request(app).get('/integration/request-counts');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { total: 5 } });
            expect(ukIntegrationService.getRequestCounts).toHaveBeenCalledTimes(1);
        });

        test('returns 500 on service error', async () => {
            ukIntegrationService.getRequestCounts.mockRejectedValue(
                new Error('UK API unreachable')
            );

            const res = await request(app).get('/integration/request-counts');

            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                success: false,
                message: 'Internal server error'
            });
        });
    });

    // -----------------------------------------------------------------
    // GET /integration/building-requests/:externalId (lines 24-35)
    // -----------------------------------------------------------------
    describe('GET /integration/building-requests/:externalId', () => {
        const validUUID = '550e8400-e29b-41d4-a716-446655440000';

        test('returns success for a valid UUID', async () => {
            const mockData = [{ request_number: 'R-001', status: 'Принято' }];
            ukIntegrationService.getBuildingRequests.mockResolvedValue(mockData);

            const res = await request(app).get(
                `/integration/building-requests/${validUUID}`
            );

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: mockData });
            expect(ukIntegrationService.getBuildingRequests).toHaveBeenCalledWith(
                validUUID,
                3 // default limit
            );
        });

        test('returns 400 for invalid UUID format', async () => {
            const res = await request(app).get(
                '/integration/building-requests/not-a-uuid'
            );

            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                message: 'Invalid externalId format'
            });
            expect(ukIntegrationService.getBuildingRequests).not.toHaveBeenCalled();
        });

        test('returns 500 on service error', async () => {
            ukIntegrationService.getBuildingRequests.mockRejectedValue(
                new Error('Connection timeout')
            );

            const res = await request(app).get(
                `/integration/building-requests/${validUUID}`
            );

            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                success: false,
                message: 'Internal server error'
            });
        });

        test('clamps limit to max 10 when query exceeds', async () => {
            ukIntegrationService.getBuildingRequests.mockResolvedValue([]);

            const res = await request(app).get(
                `/integration/building-requests/${validUUID}?limit=50`
            );

            expect(res.status).toBe(200);
            expect(ukIntegrationService.getBuildingRequests).toHaveBeenCalledWith(
                validUUID,
                10
            );
        });
    });

    // -----------------------------------------------------------------
    // GET /integration/logs/:id — invalid ID and error paths (lines 129, 137-138)
    // -----------------------------------------------------------------
    describe('GET /integration/logs/:id', () => {
        test('returns 400 for invalid (non-numeric) ID', async () => {
            const res = await request(app).get('/integration/logs/abc');

            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                message: 'Invalid log entry ID'
            });
        });

        test('returns 400 for ID less than 1', async () => {
            const res = await request(app).get('/integration/logs/0');

            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                message: 'Invalid log entry ID'
            });
        });

        test('returns 500 when findById throws', async () => {
            IntegrationLog.findById.mockRejectedValue(new Error('DB failure'));

            const res = await request(app).get('/integration/logs/1');

            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                success: false,
                message: 'Internal server error'
            });
        });
    });

    // -----------------------------------------------------------------
    // POST /integration/logs/retry/:id — error paths (lines 151, 167-168)
    // -----------------------------------------------------------------
    describe('POST /integration/logs/retry/:id', () => {
        test('returns 400 for invalid (non-numeric) ID', async () => {
            const res = await request(app).post('/integration/logs/retry/abc');

            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                success: false,
                message: 'Invalid log entry ID'
            });
        });

        test('returns 400 when log status is success', async () => {
            IntegrationLog.findById.mockResolvedValue({ id: 1, status: 'success' });

            const res = await request(app).post('/integration/logs/retry/1');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain("Cannot retry log entry with status 'success'");
            expect(IntegrationLog.updateStatus).not.toHaveBeenCalled();
            expect(IntegrationLog.incrementRetry).not.toHaveBeenCalled();
        });

        test('returns 500 when findById throws', async () => {
            IntegrationLog.findById.mockRejectedValue(new Error('DB failure'));

            const res = await request(app).post('/integration/logs/retry/1');

            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                success: false,
                message: 'Internal server error'
            });
        });
    });
});
