'use strict';

const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
// [R2-16] non-numeric :id → 400, а не pg-500. `:externalId` не трогаем — он
// UUID и валидируется отдельно прямо в обработчике.
const { validateIntParam } = require('../middleware/validators');
const ukIntegrationService = require('../services/ukIntegrationService');
const IntegrationLog = require('../models/IntegrationLog');
const AlertRule = require('../models/AlertRule');
const logger = require('../utils/logger');
const { isValidDirection, isValidStatus, isValidEntityType } = require('../utils/webhookValidation');

// --- Routes accessible to any authenticated user (JWT, no admin) ---
router.get('/request-counts', async (req, res) => {
    try {
        const data = await ukIntegrationService.getRequestCounts();
        return res.json({ success: true, data });
    } catch (error) {
        logger.error(`GET /integration/request-counts error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.get('/building-requests/:externalId', async (req, res) => {
    try {
        const { externalId } = req.params;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!externalId || !UUID_RE.test(externalId)) {
            return res.status(400).json({ success: false, message: 'Invalid externalId format' });
        }
        // [Sprint 5 / P2-5] Match the pattern used by getLogs (lines 82-83):
        // explicit radix + isNaN/range guard, then clamp.
        const rawLimit = parseInt(req.query.limit, 10);
        const safeLimit = (!isNaN(rawLimit) && rawLimit >= 1) ? rawLimit : 3;
        const limit = Math.min(safeLimit, 10);
        const data = await ukIntegrationService.getBuildingRequests(externalId, limit);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error(`GET /integration/building-requests error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// All remaining integration routes require admin access
router.use(isAdmin);

const handlers = {
    /**
     * GET /config
     * Returns current UK integration configuration (sensitive values masked).
     */
    async getConfig(req, res) {
        try {
            const config = await ukIntegrationService.getConfig();
            return res.json({ success: true, data: config });
        } catch (error) {
            logger.error(`integrationRoutes.getConfig error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * PUT /config
     * Updates allowed config keys. Returns 400 if a sensitive key is supplied.
     */
    async updateConfig(req, res) {
        try {
            await ukIntegrationService.updateConfig(req.body);
            const config = await ukIntegrationService.getConfig();
            return res.json({ success: true, data: config, message: 'Config updated' });
        } catch (error) {
            // [Sprint 7 / P1-7] Map both the sensitive-key rejection and the
            // new type-validation failures to a 400 client error.
            if (error.message && (
                error.message.includes('Cannot update this setting')
                || error.message.startsWith('Invalid value for')
            )) {
                return res.status(400).json({ success: false, message: error.message });
            }
            logger.error(`integrationRoutes.updateConfig error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * GET /logs
     * Returns paginated integration logs with optional filters.
     */
    async getLogs(req, res) {
        try {
            const { direction, status, entity_type, date_from, date_to } = req.query;
            const rawPage = parseInt(req.query.page, 10);
            const rawLimit = parseInt(req.query.limit, 10);
            const page = (!isNaN(rawPage) && rawPage >= 1) ? rawPage : undefined;
            const limit = (!isNaN(rawLimit) && rawLimit >= 1 && rawLimit <= 100) ? rawLimit : undefined;

            if (direction !== undefined && !isValidDirection(direction)) {
                return res.status(400).json({ success: false, message: 'Invalid direction filter' });
            }
            if (status !== undefined && !isValidStatus(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status filter' });
            }
            if (entity_type !== undefined && !isValidEntityType(entity_type)) {
                return res.status(400).json({ success: false, message: 'Invalid entity_type filter' });
            }

            if (date_from !== undefined && isNaN(Date.parse(date_from))) {
                return res.status(400).json({ success: false, message: 'Invalid date_from format' });
            }
            if (date_to !== undefined && isNaN(Date.parse(date_to))) {
                return res.status(400).json({ success: false, message: 'Invalid date_to format' });
            }

            const filters = {};
            if (direction !== undefined) filters.direction = direction;
            if (status !== undefined) filters.status = status;
            if (entity_type !== undefined) filters.entity_type = entity_type;
            if (date_from !== undefined) filters.date_from = date_from;
            if (date_to !== undefined) filters.date_to = date_to;
            if (page !== undefined) filters.page = page;
            if (limit !== undefined) filters.limit = limit;

            const result = await IntegrationLog.findAll(filters);
            return res.json({ success: true, data: result });
        } catch (error) {
            logger.error(`integrationRoutes.getLogs error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * GET /logs/:id
     * Returns a single integration log entry by ID, or 404.
     */
    async getLogById(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'Invalid log entry ID' });
            }
            const log = await IntegrationLog.findById(id);
            if (!log) {
                return res.status(404).json({ success: false, message: 'Log entry not found' });
            }
            return res.json({ success: true, data: log });
        } catch (error) {
            logger.error(`integrationRoutes.getLogById error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * POST /logs/retry/:id
     * Marks a failed/error log entry as 'pending' for retry.
     * Phase 1: marks for retry only; actual re-execution handled in Phase 2+.
     */
    async retryLog(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return res.status(400).json({ success: false, message: 'Invalid log entry ID' });
            }
            const log = await IntegrationLog.findById(id);
            if (!log) {
                return res.status(404).json({ success: false, message: 'Log entry not found' });
            }
            if (log.status !== 'error' && log.status !== 'failed') {
                return res.status(400).json({
                    success: false,
                    message: `Cannot retry log entry with status '${log.status}'. Only 'error' or 'failed' entries can be retried.`
                });
            }
            await IntegrationLog.updateStatus(id, 'pending');
            await IntegrationLog.incrementRetry(id);
            return res.json({ success: true, message: 'Marked for retry' });
        } catch (error) {
            logger.error(`integrationRoutes.retryLog error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * GET /rules
     * Returns all alert rules.
     */
    async getRules(req, res) {
        try {
            const rules = await AlertRule.findAll();
            return res.json({ success: true, data: rules });
        } catch (error) {
            logger.error(`integrationRoutes.getRules error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * [Sprint 10 PR-5] GET /rules/stats?days=7
     * Returns all rules joined with per-rule activity stats from the last
     * N days (alert count, escalated count, reopen count). Admin UI uses
     * this for the "Status" badges in the rules editor.
     */
    async getRulesStats(req, res) {
        try {
            const days = parseInt(req.query.days, 10) || 7;
            const rules = await AlertRule.listWithStats(days);
            return res.json({ success: true, data: rules, meta: { days } });
        } catch (error) {
            logger.error(`integrationRoutes.getRulesStats error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * [Sprint 10 PR-5] PATCH /rules/:id
     * Update one or more editable fields. Validates whitelist + ranges.
     * Writes audit log entries per field change.
     * Body: { fields: { min_persistence_seconds: 90, ... }, reason?: string }
     */
    async updateRule(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid rule id' });
            }
            const { fields, reason } = req.body || {};
            if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
                return res.status(400).json({ success: false, message: 'fields object is required' });
            }
            const userId = req.user ? req.user.user_id : null;

            try {
                const { rule, changes } = await AlertRule.update(id, fields, userId, reason || null);
                if (!rule) {
                    return res.status(404).json({ success: false, message: 'Rule not found' });
                }
                return res.json({
                    success: true,
                    data: rule,
                    changes_recorded: changes.length
                });
            } catch (validationErr) {
                // AlertRule.update throws on invalid field name or value
                return res.status(400).json({ success: false, message: validationErr.message });
            }
        } catch (error) {
            logger.error(`integrationRoutes.updateRule error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * [Sprint 10 PR-5] POST /rules/:id/toggle
     * Body: { enabled: boolean, reason?: string }
     * Audit-logged.
     */
    async toggleRule(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid rule id' });
            }
            const { enabled, reason } = req.body || {};
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({ success: false, message: 'enabled (boolean) is required' });
            }
            const userId = req.user ? req.user.user_id : null;
            const rule = await AlertRule.toggleEnabled(id, enabled, userId, reason || null);
            if (!rule) {
                return res.status(404).json({ success: false, message: 'Rule not found' });
            }
            return res.json({ success: true, data: rule });
        } catch (error) {
            logger.error(`integrationRoutes.toggleRule error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },

    /**
     * [Sprint 10 PR-5] GET /rules/:id/history?limit=50
     * Returns audit log entries for the rule, most-recent first.
     */
    async getRuleHistory(req, res) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid rule id' });
            }
            const AlertRuleChange = require('../models/AlertRuleChange');
            const limit = parseInt(req.query.limit, 10) || 50;
            const history = await AlertRuleChange.findByRuleId(id, limit);
            return res.json({ success: true, data: history });
        } catch (error) {
            logger.error(`integrationRoutes.getRuleHistory error: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

// Route definitions
router.get('/config', handlers.getConfig);
router.put('/config', handlers.updateConfig);
router.get('/logs', handlers.getLogs);
// [R2-16] БЕЗ validateIntParam: getLogById/retryLog валидируют id сами
// (parseInt + isNaN + id < 1) и отдают собственный 400 с внятным сообщением.
// Guard тут ничего не чинил бы, а только подменил форму ответа на конверт
// express-validator — сломав контракт, на который уже опираются тесты.
router.get('/logs/:id', handlers.getLogById);
router.post('/logs/retry/:id', handlers.retryLog);
router.get('/rules', handlers.getRules);

// [Sprint 10 PR-5] Rules admin endpoints — all admin-only via the
// `router.use(isAdmin)` mounted earlier in this file.
router.get('/rules/stats', handlers.getRulesStats);
router.patch('/rules/:id', validateIntParam('id'), handlers.updateRule);
router.post('/rules/:id/toggle', validateIntParam('id'), handlers.toggleRule);
router.get('/rules/:id/history', validateIntParam('id'), handlers.getRuleHistory);

module.exports = router;
module.exports.handlers = handlers;
