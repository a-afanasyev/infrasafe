'use strict';

/**
 * [P1-14 split] UK → InfraSafe request status feedback.
 *
 * Owns:
 *   - handleRequestWebhook — processes request.created and
 *     request.status_changed events from UK. Terminal statuses (Принято /
 *     Отменена) on the last open mapping for an alert emit a deferred
 *     UK_REQUEST_RESOLVED event so alertService can resolve the alert.
 *
 * Cross-module dependencies:
 *   - configProxy.invalidateRequestCache — called on every request event so
 *     the dashboard's count cache picks up the new state promptly.
 *
 * Event interactions:
 *   - Emits alertEvents.UK_REQUEST_RESOLVED with { alertId } when all
 *     mappings for an alert reach a terminal status. The emit is deferred
 *     until after IntegrationLog.updateStatus(.., 'success') so the audit
 *     trail shows the integration ack before the alert resolution.
 */

const IntegrationLog = require('../../models/IntegrationLog');
const AlertRequestMap = require('../../models/AlertRequestMap');
const logger = require('../../utils/logger');
const alertEvents = require('../../events/alertEvents');

const configProxy = require('./configProxy');

const TERMINAL_STATUSES = ['Принято', 'Отменена'];

// [CodeQL js/log-injection] Strip CR/LF/TAB and cap length so attacker-shaped
// values from the webhook payload (event_id, request_number, status) cannot
// forge extra log lines.
const safeLogValue = (v) => String(v ?? '').replace(/[\r\n\t]/g, '_').slice(0, 64);

class UKRequestProcessor {
    /**
     * Handle incoming request status webhook from UK.
     * Terminal statuses (Принято, Отменена) → resolve alert if all mappings
     * for the alert are terminal. Non-terminal → log only.
     */
    async handleRequestWebhook(payload) {
        const { event_id, event, request: ukRequest } = payload;

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
                logger.info(`handleRequestWebhook: concurrent duplicate event_id ${safeLogValue(event_id)}, skipping`);
                return;
            }
            throw logError;
        }

        try {
            // Invalidate request counts cache on any request event
            configProxy.invalidateRequestCache();

            // For request.created — just log (no alert mapping expected)
            if (event === 'request.created') {
                logger.info(`handleRequestWebhook: request.created ${safeLogValue(ukRequest.request_number)}`);
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
                    logger.debug(`handleRequestWebhook: no mapping for request ${safeLogValue(ukRequest.request_number)} (manual UK request)`);
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

                logger.info(`handleRequestWebhook: updated mapping for request ${safeLogValue(ukRequest.request_number)} → status: ${newStatus}`);
            }

            // Mark log entry as success — must happen before the alert resolution
            // event so that audit trail shows the integration ack first.
            await IntegrationLog.updateStatus(logEntry.id, 'success').catch(logErr => logger.warn(
                `handleRequestWebhook: failed to mark integration_log ${logEntry.id} as success: ${logErr.message}`
            ));

            if (deferredResolveAlertId !== null) {
                alertEvents.emit(
                    alertEvents.EVENTS.UK_REQUEST_RESOLVED,
                    { alertId: deferredResolveAlertId }
                );
            }
        } catch (error) {
            // Mark log entry as error
            if (logEntry) {
                await IntegrationLog.updateStatus(logEntry.id, 'error', error.message).catch(logErr => logger.warn(
                    `handleRequestWebhook: failed to mark integration_log ${logEntry.id} as error: ${logErr.message}`
                ));
            }
            logger.error(`handleRequestWebhook error: ${error.message}`);
            throw error;
        }
    }
}

const singleton = new UKRequestProcessor();
module.exports = singleton;
module.exports.UKRequestProcessor = UKRequestProcessor;
