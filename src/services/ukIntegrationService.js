'use strict';

const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const IntegrationLog = require('../models/IntegrationLog');
const logger = require('../utils/logger');
const Building = require('../models/Building');
const { isValidBuildingEvent } = require('../utils/webhookValidation');

const ALLOWED_CONFIG_KEYS = ['uk_integration_enabled', 'uk_api_url', 'uk_frontend_url'];
const SENSITIVE_KEYS = ['uk_webhook_secret', 'uk_service_user', 'uk_service_password'];
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;

class UKIntegrationService {
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
}

module.exports = new UKIntegrationService();
