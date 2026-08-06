'use strict';

const express = require('express');
const router = express.Router();
const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');
const webhookController = require('../controllers/webhookController');
const { SimpleRateLimiter } = require('../middleware/rateLimiter');

const webhookLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Слишком много запросов к webhook. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false,
    // [R2-13] Explicit namespace: without it the constructor assigns a random
    // per-process default (`g<rand>`), so the 60/min webhook budget would NOT be
    // shared across replicas/restarts via Redis — each process would key its own.
    namespace: 'uk-webhook'
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
        // [CodeQL js/user-controlled-bypass false-positive] The check below
        // is part of the security gate: missing header → 401 reject. The
        // header value is never used to make a "skip security" decision,
        // only to extract HMAC components that are verified downstream
        // via timing-safe comparison.
        // lgtm[js/user-controlled-bypass]
        if (!signature) {
            return res.status(401).json({ success: false, message: 'Missing webhook signature' });
        }

        const rawBody = req.rawBody;
        if (!rawBody) {
            return res.status(400).json({ success: false, message: 'Invalid content type' });
        }
        // [Sprint 4] verifyWebhookSignature is async — Redis-backed dedup.
        const valid = await ukIntegrationService.verifyWebhookSignature(rawBody, signature);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        return next();
    } catch (error) {
        logger.error(`verifyWebhook error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// Rate-limiting for ALL routes in this router (60 req/min/IP).
router.use(webhookLimiter.middleware());

// [AR-12] Только маршруты и проверка подписи. Логика — в
// controllers/webhookController.js.
// lgtm[js/missing-rate-limiting]
router.post('/building', verifyWebhook, webhookController.handleBuilding);
// lgtm[js/missing-rate-limiting]
router.post('/request', verifyWebhook, webhookController.handleRequest);

router.verifyWebhook = verifyWebhook;
router.webhookLimiter = webhookLimiter;
module.exports = router;
