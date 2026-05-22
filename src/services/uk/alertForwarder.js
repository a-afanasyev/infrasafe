'use strict';

/**
 * [P1-14 split] InfraSafe → UK alert forwarding (outbound).
 *
 * Owns:
 *   - sendAlertToUK — matches an alert to an AlertRule, resolves affected
 *     buildings, creates a UK request per building with idempotent mapping.
 *     Never throws — InfraSafe must keep working even when UK integration
 *     fails.
 *   - resolveBuildingIds — SQL join from infrastructure_id+type to the
 *     affected buildings (transformer / controller / water_source /
 *     heat_source). Honours uk_deleted_at to skip soft-deleted buildings.
 *
 * Module-level event subscription:
 *   - Listens to alertEvents.ALERT_CREATED — when alertService emits a new
 *     alert, this listener gates on isEnabled() and forwards to UK. Failure
 *     is appended to infrastructure_alerts.data.notification_failures so
 *     operators see UK forwarding errors in the alert detail view.
 *
 * Cross-module dependencies:
 *   - configProxy.isEnabled   — gate before any UK API call.
 *   - webhookVerifier.logEvent — write an entry to integration_log for
 *     each forward attempt (success or failure).
 */

const crypto = require('crypto');
const AlertRequestMap = require('../../models/AlertRequestMap');
const logger = require('../../utils/logger');
const alertEvents = require('../../events/alertEvents');

const configProxy = require('./configProxy');
const webhookVerifier = require('./webhookVerifier');

class UKAlertForwarder {
    /**
     * Resolve building IDs affected by an infrastructure alert.
     * Returns an empty array on unknown infrastructure_type or DB error.
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
            const db = require('../../config/database');
            const result = await db.query(sql, [infrastructureId]);
            return result.rows;
        } catch (error) {
            logger.error(`resolveBuildingIds error: ${error.message}`);
            return [];
        }
    }

    /**
     * Forward an alert to UK as request(s). Called by the ALERT_CREATED
     * listener (below) or, in tests, directly. Never throws.
     */
    async sendAlertToUK(alertData) {
        try {
            const enabled = await configProxy.isEnabled();
            if (!enabled) return;

            const AlertRule = require('../../models/AlertRule');

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
            const ukApiClient = require('../../clients/ukApiClient');

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
                    await webhookVerifier.logEvent({
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

                    await webhookVerifier.logEvent({
                        direction: 'to_uk',
                        entity_type: 'alert',
                        entity_id: String(alertData.alert_id),
                        action: 'alert.forwarded',
                        payload: { alert_id: alertData.alert_id, building_id: building.building_id },
                        status: 'error',
                        error_message: buildingError.message
                    }).catch(logErr => logger.warn(
                        `sendAlertToUK: integration_log write failed for alert ${alertData.alert_id} ` +
                        `building ${building.building_id}: ${logErr.message}`
                    ));
                }
            }
        } catch (error) {
            logger.error(`sendAlertToUK error: ${error.message}`);
        }
    }
}

const singleton = new UKAlertForwarder();

// Phase 7: subscribe to `alert.created` so alertService can publish alerts
// without a direct require. Phase 4.4 UK-failure recording (appending to
// infrastructure_alerts.data.notification_failures) lives inside this
// listener so alertService stays fire-and-forget. The listener never
// throws — it self-handles and logs.
alertEvents.on(alertEvents.EVENTS.ALERT_CREATED, async ({ alertData, alertId }) => {
    try {
        if (!(await configProxy.isEnabled())) return;
        await singleton.sendAlertToUK({ ...alertData, alert_id: alertId });
    } catch (ukError) {
        logger.error(`Alert ${alertId} UK forwarding failed: ${ukError.message}`);
        try {
            const db = require('../../config/database');
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
module.exports.UKAlertForwarder = UKAlertForwarder;
