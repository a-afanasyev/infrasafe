'use strict';

/**
 * Extended webhook routes tests: POST /request route handler with full
 * validation (event type, request_number, status), duplicate event handling.
 */

jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    isDuplicateEvent: jest.fn(),
    logEvent: jest.fn(),
    handleBuildingWebhook: jest.fn(),
    handleRequestWebhook: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidUUID: jest.fn(),
    isValidRequestEvent: jest.fn()
}));

const request = require('supertest');
const express = require('express');
const { isValidUUID, isValidRequestEvent } = require('../../../src/utils/webhookValidation');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const webhookRoutes = require('../../../src/routes/webhookRoutes');

describe('webhookRoutes — POST /request', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json({
            verify: (req, res, buf) => { req.rawBody = buf.toString(); }
        }));
        app.use('/', webhookRoutes);

        // Default: integration enabled, signature valid, UUID valid, request event valid
        ukIntegrationService.isEnabled.mockResolvedValue(true);
        ukIntegrationService.verifyWebhookSignature.mockReturnValue(true);
        isValidUUID.mockReturnValue(true);
        isValidRequestEvent.mockReturnValue(true);
    });

    afterAll(() => {
        if (webhookRoutes.webhookLimiter) {
            webhookRoutes.webhookLimiter.destroy();
        }
    });

    const validBody = {
        event_id: '550e8400-e29b-41d4-a716-446655440000',
        event: 'request.status_changed',
        request: {
            request_number: 'REQ-001',
            status: 'В работе'
        }
    };

    it('calls handleRequestWebhook for valid request events', async () => {
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleRequestWebhook.mockResolvedValue();

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(ukIntegrationService.handleRequestWebhook).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'request.status_changed' })
        );
    });

    it('returns 400 when event_id is missing', async () => {
        isValidUUID.mockReturnValue(false);
        const body = { ...validBody, event_id: undefined };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid or missing event_id');
    });

    it('returns 400 when event_id is not a valid UUID', async () => {
        isValidUUID.mockReturnValue(false);
        const body = { ...validBody, event_id: 'not-a-uuid' };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid or missing event_id');
    });

    it('returns 400 when event is missing', async () => {
        isValidRequestEvent.mockReturnValue(false);
        const body = { ...validBody, event: undefined };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Invalid or missing event');
    });

    it('returns 400 when event is not a valid request event type', async () => {
        isValidRequestEvent.mockReturnValue(false);
        const body = { ...validBody, event: 'request.unknown' };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('expected request.created or request.status_changed');
    });

    it('returns 400 when request field is missing', async () => {
        const body = {
            event_id: validBody.event_id,
            event: validBody.event
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Missing required field: request');
    });

    it('returns 400 when request is not an object', async () => {
        const body = {
            ...validBody,
            request: 'not-an-object'
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Missing required field: request');
    });

    it('returns 400 when request_number is missing', async () => {
        const body = {
            ...validBody,
            request: { status: 'В работе' }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Missing required field: request.request_number');
    });

    it('returns 400 when request_number is not a string', async () => {
        const body = {
            ...validBody,
            request: { request_number: 12345, status: 'В работе' }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Missing required field: request.request_number');
    });

    it('returns 400 when request_number exceeds 50 characters', async () => {
        const body = {
            ...validBody,
            request: { request_number: 'R'.repeat(51), status: 'В работе' }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('request.request_number exceeds maximum length');
    });

    it('returns 400 when status is missing for status_changed event', async () => {
        const body = {
            ...validBody,
            event: 'request.status_changed',
            request: { request_number: 'REQ-001' }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('request.status for status_changed event');
    });

    it('returns 400 when status exceeds 100 characters', async () => {
        const body = {
            ...validBody,
            request: { request_number: 'REQ-001', status: 'S'.repeat(101) }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('request.status exceeds maximum length');
    });

    it('returns 200 for duplicate event_id (already processed)', async () => {
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(true);

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Already processed');
        expect(ukIntegrationService.handleRequestWebhook).not.toHaveBeenCalled();
    });

    it('returns 500 when handleRequestWebhook throws', async () => {
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleRequestWebhook.mockRejectedValue(new Error('Processing error'));

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(validBody);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe('Internal server error');
    });

    it('accepts request.created event without status field', async () => {
        isValidRequestEvent.mockReturnValue(true);
        ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);
        ukIntegrationService.handleRequestWebhook.mockResolvedValue();

        const body = {
            event_id: '550e8400-e29b-41d4-a716-446655440000',
            event: 'request.created',
            request: { request_number: 'REQ-002' }
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 400 when request field is null', async () => {
        const body = {
            event_id: validBody.event_id,
            event: validBody.event,
            request: null
        };

        const res = await request(app)
            .post('/request')
            .set('x-webhook-signature', 't=1234567890,v1=abc123')
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Missing required field: request');
    });

    // -------------------------------------------------------------------------
    // POST /building — additional validation tests
    // -------------------------------------------------------------------------
    describe('POST /building — extended validation', () => {
        it('rejects building.name exceeding 500 characters', async () => {
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 1, name: 'N'.repeat(501) }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('building.name exceeds maximum length');
        });

        it('rejects building.address exceeding 500 characters', async () => {
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 1, address: 'A'.repeat(501) }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('building.address exceeds maximum length');
        });

        it('rejects building.town exceeding 200 characters', async () => {
            ukIntegrationService.isDuplicateEvent.mockResolvedValue(false);

            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: 1, town: 'T'.repeat(201) }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('building.town exceeds maximum length');
        });

        it('rejects negative building.id', async () => {
            const body = {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                event: 'building.created',
                building: { id: -1 }
            };

            const res = await request(app)
                .post('/building')
                .set('x-webhook-signature', 't=1234567890,v1=abc123')
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Invalid building.id');
        });

        it('returns 400 when rawBody is missing (invalid content type)', async () => {
            // Test the verifyWebhook middleware directly
            const verifyWebhook = webhookRoutes.verifyWebhook;
            const reqObj = {
                headers: { 'x-webhook-signature': 't=123,v1=abc' },
                rawBody: undefined
            };
            const resObj = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            const nextFn = jest.fn();

            await verifyWebhook(reqObj, resObj, nextFn);

            expect(resObj.status).toHaveBeenCalledWith(400);
            expect(resObj.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid content type' })
            );
        });
    });
});
