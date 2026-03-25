'use strict';

const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const ukIntegrationService = require('../services/ukIntegrationService');
const IntegrationLog = require('../models/IntegrationLog');
const AlertRule = require('../models/AlertRule');
const logger = require('../utils/logger');

// All integration routes require admin access
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
            if (error.message && error.message.includes('Cannot update this setting')) {
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
    }
};

// Route definitions
router.get('/config', handlers.getConfig);
router.put('/config', handlers.updateConfig);
router.get('/logs', handlers.getLogs);
router.get('/logs/:id', handlers.getLogById);
router.post('/logs/retry/:id', handlers.retryLog);
router.get('/rules', handlers.getRules);

module.exports = router;
module.exports.handlers = handlers;
