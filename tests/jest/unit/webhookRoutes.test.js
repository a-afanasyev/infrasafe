'use strict';

jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    isDuplicateEvent: jest.fn(),
    logEvent: jest.fn(),
    handleBuildingWebhook: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const webhookRoutes = require('../../../src/routes/webhookRoutes');
const verifyWebhook = webhookRoutes.verifyWebhook;

function createMockReqRes(body = {}, headers = {}) {
    const req = {
        body,
        headers,
        rawBody: JSON.stringify(body),
        get: jest.fn((name) => headers[name.toLowerCase()])
    };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    return { req, res, next };
}

describe('webhookRoutes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('verifyWebhook middleware', () => {
        it('returns 503 when UK integration is disabled', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(false);
            const { req, res, next } = createMockReqRes();

            await verifyWebhook(req, res, next);

            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'UK integration is disabled'
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 401 when x-webhook-signature header is missing', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            const { req, res, next } = createMockReqRes({}, {});

            await verifyWebhook(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 401 when signature is invalid', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.verifyWebhookSignature.mockReturnValue(false);
            const { req, res, next } = createMockReqRes(
                { event: 'test' },
                { 'x-webhook-signature': 't=12345,v1=invalidsig' }
            );

            await verifyWebhook(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
            expect(next).not.toHaveBeenCalled();
        });

        it('calls next() when signature is valid', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
            const { req, res, next } = createMockReqRes(
                { event: 'test' },
                { 'x-webhook-signature': 't=12345,v1=validsig' }
            );

            await verifyWebhook(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });

        it('returns 500 when an unexpected error is thrown', async () => {
            ukIntegrationService.isEnabled.mockRejectedValue(new Error('Unexpected DB error'));
            const { req, res, next } = createMockReqRes();

            await verifyWebhook(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
            expect(next).not.toHaveBeenCalled();
        });
    });

    const request = require('supertest');
    const express = require('express');

    describe('POST /building — building sync', () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use(express.json({
                verify: (req, res, buf) => { req.rawBody = buf.toString(); }
            }));
            app.use('/', webhookRoutes);
        });

        it('calls handleBuildingWebhook for building events', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
            ukIntegrationService.handleBuildingWebhook.mockResolvedValue();

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 15, name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(ukIntegrationService.handleBuildingWebhook).toHaveBeenCalledWith(
                expect.objectContaining({ event: 'building.created' })
            );
        });

        it('returns 500 when handleBuildingWebhook throws', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
            ukIntegrationService.handleBuildingWebhook.mockRejectedValue(new Error('DB error'));

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 15, name: 'Дом 42' }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
        });

        it('returns 200 for duplicate event_id', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(true);

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 15 }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Already processed');
            expect(ukIntegrationService.handleBuildingWebhook).not.toHaveBeenCalled();
        });
    });

    describe('module export', () => {
        it('exports an Express router (typeof === function)', () => {
            expect(typeof webhookRoutes).toBe('function');
        });

        it('exports verifyWebhook as a named property', () => {
            expect(typeof webhookRoutes.verifyWebhook).toBe('function');
        });
    });
});
