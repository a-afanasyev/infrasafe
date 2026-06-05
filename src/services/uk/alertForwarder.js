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
const UkOutbox = require('../../models/UkOutbox');
const logger = require('../../utils/logger');
const alertEvents = require('../../events/alertEvents');

const configProxy = require('./configProxy');
const webhookVerifier = require('./webhookVerifier');

// [Sprint 9 / FIX-007] Master gate for the new HMAC-webhook sender.
// When false, sendAlertToUK skips outbox.enqueue entirely (no event lost
// — AlertRequestMap row stays at 'pending' for the next attempt). Default
// false until UK Phase 2 lands + secret rotation completes.
const _isWebhookSenderEnabled = () => {
    const flag = (process.env.UK_USE_WEBHOOK_SENDER ?? 'false').toString().toLowerCase();
    return flag === 'true' || flag === '1';
};

// [UK contract 2026-06] Canonical urgency on the wire is a key, not Russian:
//   low | medium | high | critical
// The DB column alert_rules.uk_urgency may still hold legacy Russian strings
// (Обычная/Средняя/Срочная/Критическая) until migration 032 backfills them, and
// admins type the value free-form (no enum constraint). So we normalize to a key
// at send time: this keeps the outbound payload key-only regardless of what is
// stored, and tolerates both formats during the transition window.
const URGENCY_KEYS = Object.freeze(['low', 'medium', 'high', 'critical']);
const RU_URGENCY_TO_KEY = Object.freeze({
    'Обычная': 'low',
    'Средняя': 'medium',
    'Срочная': 'high',
    'Критическая': 'critical'
});

// Normalize any stored urgency value to a canonical key, or null if unknown.
// Accepts already-canonical keys (case-insensitive) and legacy Russian strings.
// Unknown → null so we never ship garbage UK can't map.
function toUrgencyKey(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    if (URGENCY_KEYS.includes(lower)) return lower;
    if (Object.prototype.hasOwnProperty.call(RU_URGENCY_TO_KEY, raw)) return RU_URGENCY_TO_KEY[raw];
    return null;
}

// [Sprint 10 PR-3] Reopen-bump: one tier up per reopen, capped at 'critical'.
// Operates on canonical keys; normalizes first so legacy Russian rows bump too.
function bumpUrgency(current) {
    const key = toUrgencyKey(current);
    if (!key) return null; // unknown urgency — no override rather than guess
    const idx = URGENCY_KEYS.indexOf(key);
    return URGENCY_KEYS[Math.min(idx + 1, URGENCY_KEYS.length - 1)];
}

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
     *
     * @param {object} alertData
     * @param {object} [options]
     * @param {boolean} [options.engineerRequired=false] - When true, the
     *   outbound payload uses event="alert.engineer_required" and adds
     *   `engineer_required_reason` + hardcoded category/urgency overrides
     *   per Sprint 10 spec §2.4. Triggered by the ALERT_ENGINEER_REQUIRED
     *   listener (below) after the verification worker hits a chain's
     *   max_reopens_per_24h ceiling.
     */
    async sendAlertToUK(alertData, options = {}) {
        const { engineerRequired = false } = options;
        const eventType = engineerRequired ? 'alert.engineer_required' : 'alert.created';
        const enqueueAction = engineerRequired ? 'alert.engineer_required.enqueued' : 'alert.enqueued';
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

            // [Sprint 9 / FIX-007] Master gate: skip the webhook path until
            // operator flips UK_USE_WEBHOOK_SENDER=true. Mappings stay at
            // 'pending' — next alert cycle will retry. This is the
            // safe-by-default state for prod until UK Phase 2 lands.
            const senderEnabled = _isWebhookSenderEnabled();

            // 3. For each affected building: ensure AlertRequestMap row,
            //    then enqueue an outbox event. The drain worker (see
            //    src/services/uk/ukOutboxService.js) sends to UK and
            //    transitions AlertRequestMap.status to 'sent' on 202/409.
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

                    if (!senderEnabled) {
                        // Mapping is created/reused; sender is dormant.
                        // When the flag flips later, the next alert cycle
                        // for this same {alert, building} pair finds the
                        // 'pending' mapping and re-enqueues (self-healing
                        // per D3 in the plan).
                        logger.debug(
                            `sendAlertToUK: webhook sender disabled, mapping ` +
                            `${mapping.id} stays pending`
                        );
                        continue;
                    }

                    // [Sprint 10 PR-3] Reopen context — if this alert is part
                    // of a reopen chain, include related_request_number +
                    // reopen_sequence so УК UI can show "Повторное обращение
                    // №N, предыдущая заявка XXX-YYY". Urgency bump (one tier
                    // up, capped at Критическая) is applied here if the rule
                    // says so — the УК side just sees a higher-urgency
                    // ticket without needing to know about reopens.
                    const isReopen = !!alertData.reopen_chain_id && (alertData.reopen_sequence || 1) > 1;
                    // Normalize to a canonical key (low|medium|high|critical);
                    // bump one tier on reopen if the rule says so.
                    let effectiveUrgency = (isReopen && rule.reopen_urgency_bump)
                        ? bumpUrgency(rule.uk_urgency)
                        : toUrgencyKey(rule.uk_urgency);

                    // Build canonical payload bytes ONCE. These exact bytes
                    // are signed by ukWebhookClient at send time and POSTed
                    // verbatim. Re-stringifying elsewhere would invalidate
                    // the HMAC (D1/D2 in the plan).
                    const eventBody = JSON.stringify({
                        event_id: idempotencyKey,
                        event: eventType,
                        timestamp: new Date().toISOString(),
                        alert: {
                            // UK Phase 2 schema (FIX-007 O0/O1/A1, see contract).
                            external_id: building.external_id,
                            type: alertData.type,
                            severity: alertData.severity,           // WARNING|CRITICAL — UK maps to urgency itself
                            message: alertData.message,
                            // Желательно поля для трассировки/debug:
                            alert_id: alertData.alert_id,
                            created_at: alertData.created_at || new Date().toISOString(),
                            correlation_id: alertData.correlation_id || null,
                            // Опционально поля (UK сохраняет в raw, не для логики):
                            infrastructure_type: alertData.infrastructure_type,
                            infrastructure_id: alertData.infrastructure_id,
                            metric_id: alertData.metric_id,
                            metric_value: alertData.metric_value,
                            metric_unit: alertData.metric_unit,
                            // [Sprint 10 PR-3] Reopen context (optional fields,
                            // UK can ignore unknowns per Phase 2 contract):
                            reopen_chain_id: alertData.reopen_chain_id || null,
                            reopen_sequence: alertData.reopen_sequence || 1,
                            related_request_number: alertData.previous_uk_request_number || null,
                            // For engineer_required: hardcoded override per spec
                            // §2.4 ("Инженерный разбор" / 'critical'); for the
                            // reopen-bump path on alert.created: per-rule urgency
                            // bump up the ladder. Always a canonical key (UK
                            // contract 2026-06), never Russian.
                            uk_urgency_override: engineerRequired
                                ? 'critical'
                                : (isReopen ? effectiveUrgency : null),
                            // Engineer-required-specific fields. Null on
                            // alert.created so UK schema validation sees a
                            // consistent shape regardless of event type.
                            uk_category_override: engineerRequired ? 'Инженерный разбор' : null,
                            engineer_required_reason: engineerRequired ? 'max_reopens_per_24h' : null
                        }
                    });

                    // ON CONFLICT DO NOTHING — idempotent enqueue. A null
                    // return here means a previous enqueue with the same
                    // event_id is already in flight; that's success.
                    await UkOutbox.enqueue({ event_id: idempotencyKey, payload_body: eventBody });

                    // Log enqueue (the actual send + UK response is logged
                    // by ukOutboxService when the drain worker picks it up).
                    await webhookVerifier.logEvent({
                        direction: 'to_uk',
                        entity_type: 'alert',
                        entity_id: String(alertData.alert_id),
                        action: enqueueAction,
                        payload: { alert_id: alertData.alert_id, building_id: building.building_id, event_id: idempotencyKey },
                        status: 'pending'
                    }).catch(logErr => logger.warn(
                        `sendAlertToUK: integration_log write failed for alert ${alertData.alert_id} ` +
                        `building ${building.building_id}: ${logErr.message}`
                    ));

                    logger.info(`sendAlertToUK: enqueued event_id=${idempotencyKey} for alert ${alertData.alert_id}, building ${building.building_id}`);
                } catch (buildingError) {
                    logger.error(`sendAlertToUK: failed for building ${building.building_id}: ${buildingError.message}`);

                    await webhookVerifier.logEvent({
                        direction: 'to_uk',
                        entity_type: 'alert',
                        entity_id: String(alertData.alert_id),
                        action: enqueueAction,
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

// [hotfix 2026-05-24] ALERT_ENGINEER_REQUIRED sender — when the
// verification worker hits a chain's max_reopens_per_24h ceiling
// (alertVerificationService.js:256), it emits this event. Without
// this listener the local alert flips to status='engineer_required'
// but UK never sees a ticket — engineering dispatch falls silent.
// Reuses sendAlertToUK with the engineerRequired option flag so
// the canonical body / HMAC / outbox / drain path are all identical
// to alert.created (only event_type + a few fields differ per
// Sprint 10 spec §2.4).
alertEvents.on(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, async ({ alertData, alertId }) => {
    try {
        if (!(await configProxy.isEnabled())) return;
        await singleton.sendAlertToUK({ ...alertData, alert_id: alertId }, { engineerRequired: true });
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
