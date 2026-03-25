'use strict';

const express = require('express');
const router = express.Router();
const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');
const { isValidUUID } = require('../utils/webhookValidation');
const { SimpleRateLimiter } = require('../middleware/rateLimiter');

const webhookLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Слишком много запросов к webhook. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Middleware: verify HMAC webhook signature.
 * Exported for unit testing.
 */
async function verifyWebhook(req, res, next) {
    try {
        const enabled = await ukIntegrationService.isEnabled();
        if (!enabled) {
            return res.status(503).json({ success: false, message: 'UK integration is disabled' });
        }

        const signature = req.headers['x-webhook-signature'];
        if (!signature) {
            return res.status(401).json({ success: false, message: 'Missing webhook signature' });
        }

        const rawBody = req.rawBody;
        if (!rawBody) {
            return res.status(400).json({ success: false, message: 'Invalid content type' });
        }
        const valid = ukIntegrationService.verifyWebhookSignature(rawBody, signature);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        return next();
    } catch (error) {
        logger.error(`verifyWebhook error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

router.use(webhookLimiter.middleware());

/**
 * POST /api/webhooks/uk/building
 * Receives building events from UK system.
 */
router.post('/building', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event, building } = req.body;

        if (!event_id || !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event_id' });
        }

        if (!event || typeof event !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing required field: event' });
        }

        if (!building || typeof building !== 'object' || typeof building.id === 'undefined') {
            return res.status(400).json({ success: false, message: 'Missing required field: building' });
        }

        if (!Number.isInteger(building.id) || building.id <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid building.id: must be a positive integer' });
        }

        if (building.name && String(building.name).length > 500) {
            return res.status(400).json({ success: false, message: 'building.name exceeds maximum length' });
        }
        if (building.address && String(building.address).length > 500) {
            return res.status(400).json({ success: false, message: 'building.address exceeds maximum length' });
        }
        if (building.town && String(building.town).length > 200) {
            return res.status(400).json({ success: false, message: 'building.town exceeds maximum length' });
        }

        if (await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.handleBuildingWebhook(req.body);

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`POST /webhooks/uk/building error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * POST /api/webhooks/uk/request
 * Receives request events from UK system.
 */
router.post('/request', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event } = req.body;

        if (!event_id || !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event_id' });
        }

        if (await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.logEvent({
            event_id,
            direction: 'from_uk',
            entity_type: 'request',
            entity_id: String(req.body.request?.request_number ?? '').slice(0, 50) || null,
            action: event || 'request.unknown',
            payload: req.body,
            status: 'success'
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`POST /webhooks/uk/request error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.verifyWebhook = verifyWebhook;
router.webhookLimiter = webhookLimiter;
module.exports = router;
