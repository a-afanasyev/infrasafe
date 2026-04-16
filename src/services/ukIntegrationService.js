'use strict';

const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const IntegrationLog = require('../models/IntegrationLog');
const logger = require('../utils/logger');
const Building = require('../models/Building');
const AlertRequestMap = require('../models/AlertRequestMap');
const { isValidBuildingEvent } = require('../utils/webhookValidation');
const { validateUKApiUrl } = require('../utils/urlValidation');
const alertEvents = require('../events/alertEvents');

const ALLOWED_CONFIG_KEYS = ['uk_integration_enabled', 'uk_api_url', 'uk_frontend_url'];
const SENSITIVE_KEYS = ['uk_webhook_secret', 'uk_service_user', 'uk_service_password'];
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;

class UKIntegrationService {
    _requestCountsCache = null;
    _requestCountsCacheTime = 0;
    _CACHE_TTL_MS = 60 * 1000; // 60 seconds

    /**
     * Check if UK integration is enabled.
     * On ANY error, returns false (graceful degradation). Never throws.
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        try {
            return await IntegrationConfig.isEnabled();
        } catch (error) {
            logger.error(`ukIntegrationService.isEnabled error: ${error.message}`);
            return false;
        }
    }

    /**
     * Get all config merged with masked sensitive values.
     * @returns {Promise<Object>}
     */
    async getConfig() {
        const dbConfig = await IntegrationConfig.getAll();
        return {
            ...dbConfig,
            uk_webhook_secret: '●●●●●●●●',
            uk_service_user: '●●●●●●●●',
            uk_service_password: '●●●●●●●●'
        };
    }

    /**
     * Update allowed config keys. Throws on sensitive keys, skips unknown keys.
     * @param {Object} settings - key/value pairs to update
     * @returns {Promise<void>}
     */
    async updateConfig(settings) {
        for (const [key, value] of Object.entries(settings)) {
            if (SENSITIVE_KEYS.includes(key)) {
                throw new Error('Cannot update this setting via API');
            }
            if (ALLOWED_CONFIG_KEYS.includes(key)) {
                if (key === 'uk_api_url') {
                    validateUKApiUrl(value);
                }
                await IntegrationConfig.set(key, value);
            } else {
                logger.warn(`ukIntegrationService.updateConfig: unknown key "${key}", skipping`);
            }
        }
    }

    /**
     * Verify webhook HMAC signature. Synchronous. Returns boolean.
     * @param {string} rawBody - Raw request body string
     * @param {string} signatureHeader - Signature header value (t=<ts>,v1=<hex>)
     * @returns {boolean}
     */
    verifyWebhookSignature(rawBody, signatureHeader) {
        try {
            const secret = process.env.UK_WEBHOOK_SECRET;
            if (!secret) {
                logger.error('ukIntegrationService.verifyWebhookSignature: UK_WEBHOOK_SECRET not configured');
                return false;
            }

            if (!signatureHeader) return false;

            // Parse header: "t=<timestamp>,v1=<hex_signature>"
            const parts = {};
            for (const part of signatureHeader.split(',')) {
                const eqIdx = part.indexOf('=');
                if (eqIdx === -1) continue;
                const k = part.substring(0, eqIdx);
                const v = part.substring(eqIdx + 1);
                parts[k] = v;
            }

            const timestamp = parts['t'];
            const signature = parts['v1'];

            if (!timestamp || !signature) {
                return false;
            }

            // Replay protection
            const now = Math.floor(Date.now() / 1000);
            if (Math.abs(now - parseInt(timestamp, 10)) > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) {
                return false;
            }

            // Compute expected HMAC
            const expected = crypto
                .createHmac('sha256', secret)
                .update(`${timestamp}.${rawBody}`)
                .digest('hex');

            // Length-safe comparison
            const sigBuf = Buffer.from(signature, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length) {
                return false;
            }

            return crypto.timingSafeEqual(sigBuf, expBuf);
        } catch (error) {
            logger.error(`ukIntegrationService.verifyWebhookSignature error: ${error.message}`);
            return false;
        }
    }

    /**
     * Log an integration event.
     * @param {Object} data - Event data
     * @returns {Promise<Object>}
     */
    async logEvent(data) {
        return IntegrationLog.create(data);
    }

    /**
     * Check if an event ID already exists in the log (duplicate detection).
     * @param {string} eventId
     * @returns {Promise<boolean>}
     */
    async isDuplicateEvent(eventId) {
        const entry = await IntegrationLog.findByEventId(eventId);
        return entry !== null;
    }

    /**
     * Generate a deterministic external_id for a UK building.
     * Uses SHA-256 hash of "uk-building-{id}" truncated to UUID format.
     * This is NOT a standard UUID v4/v5 — it is a deterministic hash-based ID
     * used solely for deduplication. The same UK building.id always produces
     * the same external_id, enabling idempotent create/update operations.
     * @param {number} ukBuildingId
     * @returns {string} UUID-formatted string (accepted by PostgreSQL UUID type)
     */
    _generateExternalId(ukBuildingId) {
        const hash = crypto.createHash('sha256').update(`uk-building-${ukBuildingId}`).digest('hex');
        return [
            hash.substring(0, 8),
            hash.substring(8, 12),
            hash.substring(12, 16),
            hash.substring(16, 20),
            hash.substring(20, 32)
        ].join('-');
    }

    /**
     * Resolve building IDs affected by an infrastructure alert.
     */
    async resolveBuildingIds(infrastructureId, infrastructureType) {
        const queries = {
            transformer: `SELECT building_id, external_id FROM buildings
                          WHERE (primary_transformer_id = $1 OR backup_transformer_id = $1)
                            AND uk_deleted_at IS NULL`,
            controller:  `SELECT b.building_id, b.external_id FROM controllers c
                          JOIN buildings b ON b.building_id = c.building_id
                          WHERE c.controller_id = $1 AND b.uk_deleted_at IS NULL`,
            water_source: `SELECT building_id, external_id FROM buildings
                           WHERE cold_water_source_id = $1 AND uk_deleted_at IS NULL`,
            heat_source:  `SELECT building_id, external_id FROM buildings
                           WHERE heat_source_id = $1 AND uk_deleted_at IS NULL`
        };

        const sql = queries[infrastructureType];
        if (!sql) {
            logger.warn(`resolveBuildingIds: unknown infrastructure_type '${infrastructureType}'`);
            return [];
        }

        try {
            const db = require('../config/database');
            const result = await db.query(sql, [infrastructureId]);
            return result.rows;
        } catch (error) {
            logger.error(`resolveBuildingIds error: ${error.message}`);
            return [];
        }
    }

    /**
     * Send alert to UK as request(s). Called from alertService.sendNotifications().
     * Never throws — InfraSafe must work normally even if UK integration fails.
     */
    async sendAlertToUK(alertData) {
        try {
            const enabled = await this.isEnabled();
            if (!enabled) return;

            const AlertRule = require('../models/AlertRule');
            const AlertRequestMap = require('../models/AlertRequestMap');
            const crypto = require('crypto');

            // 1. Match alert to rule
            const rule = await AlertRule.findByTypeAndSeverity(alertData.type, alertData.severity);
            if (!rule) {
                logger.debug(`sendAlertToUK: no matching rule for ${alertData.type}/${alertData.severity}`);
                return;
            }

            // 2. Resolve affected buildings
            const buildings = await this.resolveBuildingIds(alertData.infrastructure_id, alertData.infrastructure_type);
            if (!buildings.length) {
                logger.debug(`sendAlertToUK: no buildings found for ${alertData.infrastructure_type}:${alertData.infrastructure_id}`);
                return;
            }

            // 3. Create UK request per building
            const ukApiClient = require('../clients/ukApiClient');

            for (const building of buildings) {
                if (!building.external_id) {
                    logger.debug(`sendAlertToUK: building ${building.building_id} has no external_id, skipping`);
                    continue;
                }

                try {
                    // Check if mapping already exists (idempotency)
                    const existing = await AlertRequestMap.findByAlertAndBuilding(
                        alertData.alert_id, building.external_id
                    );

                    let mapping;
                    let idempotencyKey;

                    if (existing && existing.status === 'sent') {
                        logger.debug(`sendAlertToUK: already sent for alert ${alertData.alert_id}, building ${building.building_id}`);
                        continue;
                    } else if (existing && existing.status === 'pending') {
                        mapping = existing;
                        idempotencyKey = existing.idempotency_key;
                    } else {
                        idempotencyKey = crypto.randomUUID();
                        mapping = await AlertRequestMap.create({
                            infrasafe_alert_id: alertData.alert_id,
                            building_external_id: building.external_id,
                            idempotency_key: idempotencyKey,
                            status: 'pending'
                        });

                        if (!mapping) {
                            const raceWinner = await AlertRequestMap.findByAlertAndBuilding(
                                alertData.alert_id, building.external_id
                            );
                            if (raceWinner && raceWinner.status === 'sent') continue;
                            if (raceWinner && raceWinner.status === 'pending') {
                                mapping = raceWinner;
                                idempotencyKey = raceWinner.idempotency_key;
                            } else {
                                continue;
                            }
                        }
                    }

                    // Call UK API
                    const ukResponse = await ukApiClient.createRequest({
                        building_external_id: building.external_id,
                        category: rule.uk_category,
                        urgency: rule.uk_urgency,
                        description: alertData.message,
                        idempotency_key: idempotencyKey
                    });

                    // Mark as sent
                    await AlertRequestMap.markSent(mapping.id, ukResponse.request_number);

                    // Log success
                    await this.logEvent({
                        direction: 'to_uk',
                        entity_type: 'alert',
                        entity_id: String(alertData.alert_id),
                        action: 'alert.forwarded',
                        payload: { alert_id: alertData.alert_id, building_id: building.building_id, request_number: ukResponse.request_number },
                        status: 'success'
                    });

                    logger.info(`sendAlertToUK: created UK request ${ukResponse.request_number} for alert ${alertData.alert_id}, building ${building.building_id}`);
                } catch (buildingError) {
                    logger.error(`sendAlertToUK: failed for building ${building.building_id}: ${buildingError.message}`);

                    await this.logEvent({
                        direction: 'to_uk',
                        entity_type: 'alert',
                        entity_id: String(alertData.alert_id),
                        action: 'alert.forwarded',
                        payload: { alert_id: alertData.alert_id, building_id: building.building_id },
                        status: 'error',
                        error_message: buildingError.message
                    }).catch(() => {});
                }
            }
        } catch (error) {
            logger.error(`sendAlertToUK error: ${error.message}`);
        }
    }

    /**
     * Process a building webhook from UK system.
     * Handles building.created, building.updated, building.deleted events.
     * @param {Object} payload - Webhook payload with event, building, event_id
     * @returns {Promise<void>}
     */
    async handleBuildingWebhook(payload) {
        const { event, building: ukBuilding, event_id } = payload;

        if (!isValidBuildingEvent(event)) {
            throw new Error('Invalid building event type');
        }

        const externalId = this._generateExternalId(ukBuilding.id);

        // Insert pending log entry first — UNIQUE constraint on event_id
        // prevents concurrent processing of the same event (TOCTOU race protection)
        let logEntry;
        try {
            logEntry = await IntegrationLog.create({
                event_id,
                direction: 'from_uk',
                entity_type: 'building',
                entity_id: ukBuilding.id?.toString(),
                action: event,
                payload,
                status: 'pending'
            });
        } catch (logError) {
            // UNIQUE violation means another request is already processing this event
            if (logError.code === '23505') {
                logger.info(`Concurrent duplicate event_id ${event_id}, skipping`);
                return;
            }
            throw logError;
        }

        try {
            const existing = await Building.findByExternalId(externalId);

            if (event === 'building.deleted') {
                if (existing) {
                    await Building.softDelete(existing.building_id);
                    logger.info(`Soft-deleted building ${existing.building_id} (UK building ${ukBuilding.id})`);
                } else {
                    logger.warn(`Building with external_id ${externalId} not found for deletion, ignoring`);
                }
            } else {
                // building.created or building.updated — upsert logic
                // Note: UK webhook also sends `contacts` but InfraSafe's buildings table
                // does not have a contacts column — contacts are managed via management_company.
                // The contacts field is intentionally not stored.
                const ukFields = {
                    name: ukBuilding.name,
                    address: ukBuilding.address,
                    town: ukBuilding.town
                };

                if (existing) {
                    await Building.updateFromUK(existing.building_id, ukFields);
                    logger.info(`Updated building ${existing.building_id} from UK (event: ${event})`);
                } else {
                    await Building.createFromUK({ external_id: externalId, ...ukFields });
                    logger.info(`Created building from UK building ${ukBuilding.id} (event: ${event})`);
                }
            }

            await IntegrationLog.updateStatus(logEntry.id, 'success');
        } catch (error) {
            logger.error(`handleBuildingWebhook error: ${error.message}`);
            try {
                await IntegrationLog.updateStatus(logEntry.id, 'error', error.message);
            } catch (logError) {
                logger.error(`Failed to update integration log error: ${logError.message}`);
            }
            throw error;
        }
    }

    /**
     * Handle incoming request status webhook from UK.
     * Terminal statuses (Принято, Отменена) → resolve alert if all requests terminal.
     * Non-terminal → log only.
     */
    async handleRequestWebhook(payload) {
        const { event_id, event, request: ukRequest } = payload;

        const TERMINAL_STATUSES = ['Принято', 'Отменена'];

        // Insert pending log entry first — UNIQUE constraint on event_id
        // prevents concurrent processing of the same event (TOCTOU race protection)
        let logEntry;
        try {
            logEntry = await IntegrationLog.create({
                event_id,
                direction: 'from_uk',
                entity_type: 'request',
                entity_id: String(ukRequest.request_number || '').slice(0, 50),
                action: event,
                payload,
                status: 'pending'
            });
        } catch (logError) {
            if (logError.code === '23505') {
                logger.info(`handleRequestWebhook: concurrent duplicate event_id ${event_id}, skipping`);
                return;
            }
            throw logError;
        }

        try {
            // Invalidate request counts cache on any request event
            this.invalidateRequestCache();

            // For request.created — just log (no alert mapping expected)
            if (event === 'request.created') {
                logger.info(`handleRequestWebhook: request.created ${ukRequest.request_number}`);
                return;
            }

            // Deferred emit so the integration log is marked 'success' BEFORE
            // alertService reacts to UK_REQUEST_RESOLVED (preserves audit-trail
            // ordering: integration log success precedes the alert resolution).
            let deferredResolveAlertId = null;

            // For request.status_changed — check if terminal
            if (event === 'request.status_changed' && ukRequest.status) {
                // Find mapping by request number
                const mapping = await AlertRequestMap.findByRequestNumber(ukRequest.request_number);
                if (!mapping) {
                    logger.debug(`handleRequestWebhook: no mapping for request ${ukRequest.request_number} (manual UK request)`);
                    return;
                }

                // Update mapping status
                const newStatus = TERMINAL_STATUSES.includes(ukRequest.status) ? 'resolved' : 'active';
                await AlertRequestMap.updateStatus(mapping.id, newStatus);

                // If terminal — defer the UK_REQUEST_RESOLVED emit until after
                // the integration log is updated. alertService's listener then
                // calls resolveAlert with the system-initiated (null user) context.
                if (TERMINAL_STATUSES.includes(ukRequest.status)) {
                    const allTerminal = await AlertRequestMap.areAllTerminal(mapping.infrasafe_alert_id);
                    if (allTerminal) {
                        deferredResolveAlertId = mapping.infrasafe_alert_id;
                    }
                }

                logger.info(`handleRequestWebhook: updated mapping for request ${ukRequest.request_number} → status: ${newStatus}`);
            }

            // Mark log entry as success — must happen before the alert resolution
            // event so that audit trail shows the integration ack first.
            await IntegrationLog.updateStatus(logEntry.id, 'success').catch(() => {});

            if (deferredResolveAlertId !== null) {
                alertEvents.emit(
                    alertEvents.EVENTS.UK_REQUEST_RESOLVED,
                    { alertId: deferredResolveAlertId }
                );
            }
        } catch (error) {
            // Mark log entry as error
            if (logEntry) {
                await IntegrationLog.updateStatus(logEntry.id, 'error', error.message).catch(() => {});
            }
            logger.error(`handleRequestWebhook error: ${error.message}`);
            throw error;
        }
    }
    async getRequestCounts() {
        const EMPTY = { buildings: {} };
        try {
            const enabled = await this.isEnabled();
            if (!enabled) return EMPTY;

            const now = Date.now();
            if (this._requestCountsCache && (now - this._requestCountsCacheTime) < this._CACHE_TTL_MS) {
                return this._requestCountsCache;
            }

            const ukApiClient = require('../clients/ukApiClient');
            const response = await ukApiClient.get('/requests/counts-by-building');

            const result = response || EMPTY;
            this._requestCountsCache = result;
            this._requestCountsCacheTime = Date.now();
            return result;
        } catch (error) {
            logger.error(`ukIntegrationService.getRequestCounts error: ${error.message}`);
            return EMPTY;
        }
    }

    async getBuildingRequests(externalId, limit = 3) {
        const EMPTY = { requests: [] };
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
            if (!externalId || !UUID_RE.test(externalId)) return EMPTY;

            const enabled = await this.isEnabled();
            if (!enabled) return EMPTY;

            const ukApiClient = require('../clients/ukApiClient');
            const response = await ukApiClient.get(
                `/requests/by-building?external_id=${encodeURIComponent(externalId)}&limit=${limit}`
            );

            return response || EMPTY;
        } catch (error) {
            logger.error(`ukIntegrationService.getBuildingRequests error: ${error.message}`);
            return EMPTY;
        }
    }

    invalidateRequestCache() {
        this._requestCountsCache = null;
        this._requestCountsCacheTime = 0;
    }
}

const singleton = new UKIntegrationService();

// Phase 7: subscribe to `alert.created` so alertService can publish alerts
// without a direct require. Phase 4.4 UK-failure recording (appending to
// infrastructure_alerts.data.notification_failures) now lives inside this
// listener so alertService stays fire-and-forget. The listener never
// throws — it self-handles and logs.
alertEvents.on(alertEvents.EVENTS.ALERT_CREATED, async ({ alertData, alertId }) => {
    try {
        if (!(await singleton.isEnabled())) return;
        await singleton.sendAlertToUK({ ...alertData, alert_id: alertId });
    } catch (ukError) {
        logger.error(`Alert ${alertId} UK forwarding failed: ${ukError.message}`);
        try {
            const db = require('../config/database');
            await db.query(
                `UPDATE infrastructure_alerts
                 SET data = jsonb_set(
                     COALESCE(data::jsonb, '{}'::jsonb),
                     '{notification_failures}',
                     COALESCE(data::jsonb -> 'notification_failures', '[]'::jsonb)
                         || $1::jsonb,
                     true
                 )
                 WHERE alert_id = $2`,
                [JSON.stringify([{
                    channel: 'uk_integration',
                    error: ukError.message,
                    at: new Date().toISOString(),
                }]), alertId]
            );
        } catch (dbErr) {
            logger.error(
                `Failed to record UK forwarding failure for alert ${alertId}: ${dbErr.message}`
            );
        }
    }
});

module.exports = singleton;
