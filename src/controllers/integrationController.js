'use strict';

/**
 * [AR-12] Контроллерный слой интеграции с УК.
 *
 * До этого `integrationController.js` (321 строка) держал в себе всё сразу:
 * валидацию, доступ к моделям, формирование ответов и 13 копий
 * `catch → res.status(500)`. Роут-файл перестал быть картой маршрутов и стал
 * местом, где живёт логика.
 *
 * Перенос механический: тела обработчиков переехали как есть. Изменилась одна
 * вещь — обработка ошибок: вместо собственной 500 в каждом обработчике идёт
 * проброс в `next(error)`. Канонический ответ формирует `errorHandler`, он же
 * скрывает внутренние детали от клиента (AR-4). Логирование с прежним
 * контекстом сохранено — оно и есть та часть, ради которой catch остаётся.
 */

const ukIntegrationService = require('../services/ukIntegrationService');
const IntegrationLog = require('../models/IntegrationLog');
const AlertRule = require('../models/AlertRule');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiResponse');
const { isValidDirection, isValidStatus, isValidEntityType } = require('../utils/webhookValidation');

// --- Доступно любому аутентифицированному пользователю (без isAdmin) ---

async function getRequestCounts(req, res, next) {
    try {
        const data = await ukIntegrationService.getRequestCounts();
        return res.json({ success: true, data });
    } catch (error) {
            logger.error(`GET /integration/request-counts error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
}

async function getBuildingRequests(req, res, next) {
    try {
        const { externalId } = req.params;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!externalId || !UUID_RE.test(externalId)) {
            return sendError(res, 400, 'Invalid externalId format');
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
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
}

// --- Только для администратора ---

const handlers = {
    /**
     * GET /config
     * Returns current UK integration configuration (sensitive values masked).
     */
    async getConfig(req, res, next) {
        try {
            const config = await ukIntegrationService.getConfig();
            return res.json({ success: true, data: config });
        } catch (error) {
            logger.error(`integrationController.getConfig error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * PUT /config
     * Updates allowed config keys. Returns 400 if a sensitive key is supplied.
     */
    async updateConfig(req, res, next) {
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
                return sendError(res, 400, error.message);
            }
            logger.error(`integrationController.updateConfig error: ${error.message}`);
            // [AR-12] Непредвиденная ошибка — как и во всех остальных обработчиках,
            // в errorHandler. Здесь catch остаётся только ради ранней 400-ветки выше.
            return next(error);
        }
    },

    /**
     * GET /logs
     * Returns paginated integration logs with optional filters.
     */
    async getLogs(req, res, next) {
        try {
            const { direction, status, entity_type, date_from, date_to } = req.query;
            const rawPage = parseInt(req.query.page, 10);
            const rawLimit = parseInt(req.query.limit, 10);
            const page = (!isNaN(rawPage) && rawPage >= 1) ? rawPage : undefined;
            const limit = (!isNaN(rawLimit) && rawLimit >= 1 && rawLimit <= 100) ? rawLimit : undefined;

            if (direction !== undefined && !isValidDirection(direction)) {
                return sendError(res, 400, 'Invalid direction filter');
            }
            if (status !== undefined && !isValidStatus(status)) {
                return sendError(res, 400, 'Invalid status filter');
            }
            if (entity_type !== undefined && !isValidEntityType(entity_type)) {
                return sendError(res, 400, 'Invalid entity_type filter');
            }

            if (date_from !== undefined && isNaN(Date.parse(date_from))) {
                return sendError(res, 400, 'Invalid date_from format');
            }
            if (date_to !== undefined && isNaN(Date.parse(date_to))) {
                return sendError(res, 400, 'Invalid date_to format');
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
            logger.error(`integrationController.getLogs error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * GET /logs/:id
     * Returns a single integration log entry by ID, or 404.
     */
    async getLogById(req, res, next) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return sendError(res, 400, 'Invalid log entry ID');
            }
            const log = await IntegrationLog.findById(id);
            if (!log) {
                return sendError(res, 404, 'Log entry not found');
            }
            return res.json({ success: true, data: log });
        } catch (error) {
            logger.error(`integrationController.getLogById error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * POST /logs/retry/:id
     * Marks a failed/error log entry as 'pending' for retry.
     * Phase 1: marks for retry only; actual re-execution handled in Phase 2+.
     */
    async retryLog(req, res, next) {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id) || id < 1) {
                return sendError(res, 400, 'Invalid log entry ID');
            }
            const log = await IntegrationLog.findById(id);
            if (!log) {
                return sendError(res, 404, 'Log entry not found');
            }
            if (log.status !== 'error' && log.status !== 'failed') {
                return sendError(res, 400, `Cannot retry log entry with status '${log.status}'. Only 'error' or 'failed' entries can be retried.`);
            }
            // [AR-11] Было два автокоммита подряд: сперва статус, потом счётчик.
            // Между ними строка уже 'pending', а счётчик ещё старый — окно, в
            // которое параллельный обработчик мог взять запись повторно.
            await IntegrationLog.markForRetry(id);
            return res.json({ success: true, message: 'Marked for retry' });
        } catch (error) {
            logger.error(`integrationController.retryLog error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * GET /rules
     * Returns all alert rules.
     */
    async getRules(req, res, next) {
        try {
            const rules = await AlertRule.findAll();
            return res.json({ success: true, data: rules });
        } catch (error) {
            logger.error(`integrationController.getRules error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * [Sprint 10 PR-5] GET /rules/stats?days=7
     * Returns all rules joined with per-rule activity stats from the last
     * N days (alert count, escalated count, reopen count). Admin UI uses
     * this for the "Status" badges in the rules editor.
     */
    async getRulesStats(req, res, next) {
        try {
            const days = parseInt(req.query.days, 10) || 7;
            const rules = await AlertRule.listWithStats(days);
            return res.json({ success: true, data: rules, meta: { days } });
        } catch (error) {
            logger.error(`integrationController.getRulesStats error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * [Sprint 10 PR-5] PATCH /rules/:id
     * Update one or more editable fields. Validates whitelist + ranges.
     * Writes audit log entries per field change.
     * Body: { fields: { min_persistence_seconds: 90, ... }, reason?: string }
     */
    async updateRule(req, res, next) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return sendError(res, 400, 'Invalid rule id');
            }
            const { fields, reason } = req.body || {};
            if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
                return sendError(res, 400, 'fields object is required');
            }
            const userId = req.user ? req.user.user_id : null;

            try {
                const { rule, changes } = await AlertRule.update(id, fields, userId, reason || null);
                if (!rule) {
                    return sendError(res, 404, 'Rule not found');
                }
                return res.json({
                    success: true,
                    data: rule,
                    changes_recorded: changes.length
                });
            } catch (validationErr) {
                // AlertRule.update throws on invalid field name or value
                return sendError(res, 400, validationErr.message);
            }
        } catch (error) {
            logger.error(`integrationController.updateRule error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * [Sprint 10 PR-5] POST /rules/:id/toggle
     * Body: { enabled: boolean, reason?: string }
     * Audit-logged.
     */
    async toggleRule(req, res, next) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return sendError(res, 400, 'Invalid rule id');
            }
            const { enabled, reason } = req.body || {};
            if (typeof enabled !== 'boolean') {
                return sendError(res, 400, 'enabled (boolean) is required');
            }
            const userId = req.user ? req.user.user_id : null;
            const rule = await AlertRule.toggleEnabled(id, enabled, userId, reason || null);
            if (!rule) {
                return sendError(res, 404, 'Rule not found');
            }
            return res.json({ success: true, data: rule });
        } catch (error) {
            logger.error(`integrationController.toggleRule error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    },

    /**
     * [Sprint 10 PR-5] GET /rules/:id/history?limit=50
     * Returns audit log entries for the rule, most-recent first.
     */
    async getRuleHistory(req, res, next) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return sendError(res, 400, 'Invalid rule id');
            }
            const AlertRuleChange = require('../models/AlertRuleChange');
            const limit = parseInt(req.query.limit, 10) || 50;
            const history = await AlertRuleChange.findByRuleId(id, limit);
            return res.json({ success: true, data: history });
        } catch (error) {
            logger.error(`integrationController.getRuleHistory error: ${error.message}`);
            // [AR-12] Проброс вместо собственной 500: канонический ответ
            // формирует errorHandler, и он же прячет внутренние детали.
            return next(error);
        }
    }
};


module.exports = {
    getRequestCounts,
    getBuildingRequests,
    ...handlers,
};
