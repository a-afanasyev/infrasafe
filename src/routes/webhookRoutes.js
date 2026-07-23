'use strict';

const express = require('express');
const router = express.Router();
const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');
const { isValidUUID, isValidRequestEvent } = require('../utils/webhookValidation');
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

/**
 * POST /api/webhooks/uk/building
 * Receives building events from UK system.
 * Rate-limited by `webhookLimiter` mounted via `router.use` above.
 */
// lgtm[js/missing-rate-limiting]
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
 * Phase 4: processes request status changes and auto-resolves alerts when all requests are terminal.
 * Rate-limited by `webhookLimiter` mounted via `router.use` above.
 */
// lgtm[js/missing-rate-limiting]
router.post('/request', verifyWebhook, async (req, res) => {
    try {
        const { event_id, event, request: ukRequest } = req.body;

        if (!event_id || !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event_id' });
        }

        if (!event || !isValidRequestEvent(event)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event (expected request.created or request.status_changed)' });
        }

        if (!ukRequest || typeof ukRequest !== 'object') {
            return res.status(400).json({ success: false, message: 'Missing required field: request' });
        }

        if (!ukRequest.request_number || typeof ukRequest.request_number !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing required field: request.request_number' });
        }

        if (ukRequest.request_number.length > 50) {
            return res.status(400).json({ success: false, message: 'request.request_number exceeds maximum length' });
        }

        // [Sprint 9.2 / FIX-007] Accept either `status` (legacy InfraSafe spec)
        // or `new_status` (UK Phase 2 contract — `{old_status, new_status}` is
        // semantically richer and matches UK request lifecycle events).
        // Either field satisfies the required-status check.
        // [request.reconcile 2026-07-23] Reconcile carries the full current
        // status (terminality is derived from it), so it is required there too.
        const effectiveStatus = ukRequest.new_status ?? ukRequest.status;
        if ((event === 'request.status_changed' || event === 'request.reconcile')
            && (!effectiveStatus || typeof effectiveStatus !== 'string')) {
            return res.status(400).json({ success: false, message: 'Missing required field: request.status or request.new_status for status_changed/reconcile event' });
        }

        // [request.reconcile 2026-07-23] building_external_id is optional
        // (null for yard/legacy requests) but must be a valid UUID when set —
        // it lands in a UUID column and feeds the per-building map counters.
        const reconcileBuilding = ukRequest.building_external_id;
        if (event === 'request.reconcile'
            && reconcileBuilding !== undefined && reconcileBuilding !== null
            && !isValidUUID(reconcileBuilding)) {
            return res.status(400).json({ success: false, message: 'Invalid request.building_external_id: must be a UUID or null' });
        }

        if (effectiveStatus && effectiveStatus.length > 100) {
            return res.status(400).json({ success: false, message: 'request.status / request.new_status exceeds maximum length' });
        }

        if (await ukIntegrationService.isDuplicateEvent(event_id)) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        await ukIntegrationService.handleRequestWebhook(req.body);

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error(`POST /webhooks/uk/request error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.verifyWebhook = verifyWebhook;
router.webhookLimiter = webhookLimiter;
module.exports = router;
