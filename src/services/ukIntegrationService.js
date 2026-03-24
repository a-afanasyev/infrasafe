'use strict';

const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const IntegrationLog = require('../models/IntegrationLog');
const logger = require('../utils/logger');

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
}

module.exports = new UKIntegrationService();
