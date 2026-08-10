'use strict';

/**
 * [AR-12] Контроллерный слой входящих вебхуков УК.
 *
 * До выноса `webhookRoutes.js` держал в себе ~15 ручных проверок полей подряд,
 * работу с сервисом и формирование ответов. Роут-файл теперь только маршруты и
 * проверка подписи.
 *
 * ⚠️ ФОРМА ОТВЕТА НАМЕРЕННО НЕ КАНОНИЗИРОВАНА (в отличие от остального AR-4).
 * Это ВНЕШНИЙ контракт: тела читает сторона УК, а не наш фронт. Перевод
 * `{success:false, message}` в `{success:false, error:{message}}` здесь —
 * изменение чужого интеграционного контракта, и делать его в одностороннем
 * порядке нельзя: сначала согласование с УК, потом отдельный релиз с окном.
 * Внутренние конверты к этому файлу отношения не имеют.
 *
 * Непредвиденная ошибка по той же причине отвечается здесь сама (500 в прежней
 * форме), а не пробрасывается в errorHandler: тот отдал бы канон.
 */

const ukIntegrationService = require('../services/ukIntegrationService');
const logger = require('../utils/logger');
const { isValidUUID, isValidRequestEvent, isValidBuildingEvent } = require('../utils/webhookValidation');

/**
 * POST /api/webhooks/uk/building — события зданий от УК.
 */
async function handleBuilding(req, res) {
    try {
        const { event_id, event, building } = req.body;

        if (!event_id || !isValidUUID(event_id)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing event_id' });
        }

        // [L-6] Здесь проверялось только «строка и не пусто», а домен события —
        // уже в сервисе, где неизвестное значение падало 500-й. У соседнего
        // обработчика `/request` асимметрично: он зовёт `isValidRequestEvent`
        // прямо здесь. `isValidBuildingEvent` был экспортирован и не вызывался
        // ни разу. Интегратору на той стороне 500 не говорит ничего — 400 с
        // перечнем допустимых значений говорит всё.
        if (!event || typeof event !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing required field: event' });
        }

        if (!isValidBuildingEvent(event)) {
            return res.status(400).json({
                success: false,
                message: `Unknown event: ${event}. Allowed: building.created, building.updated, building.deleted`
            });
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
}

/**
 * POST /api/webhooks/uk/request — события заявок от УК.
 * Phase 4: обрабатывает смену статуса и авто-резолв алерта, когда все
 * связанные заявки терминальны.
 */
async function handleRequest(req, res) {
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
}

module.exports = { handleBuilding, handleRequest };
