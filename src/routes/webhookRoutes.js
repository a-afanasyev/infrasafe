'use strict';

const express = require('express');
const router = express.Router();
const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');

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

/**
 * POST /api/webhooks/uk/building
 * Receives building events from UK system.
 */
router.post('/building', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event } = req.body;

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.logEvent({
            event_id,
            direction: 'from_uk',
            entity_type: 'building',
            entity_id: req.body.building?.id?.toString(),
            action: event || 'building.unknown',
            payload: req.body,
            status: 'success'
        });

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

        if (event_id && await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.logEvent({
            event_id,
            direction: 'from_uk',
            entity_type: 'request',
            entity_id: req.body.request?.request_number,
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
module.exports = router;
