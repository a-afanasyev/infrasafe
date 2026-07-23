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
const UkRequest = require('../../models/UkRequest');
const logger = require('../../utils/logger');
const alertEvents = require('../../events/alertEvents');

const configProxy = require('./configProxy');

const { UK_TERMINAL_STATUSES, ARM_TERMINAL_STATUSES } = require('./ukStatusConstants');
const TERMINAL_STATUSES = UK_TERMINAL_STATUSES;

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
            // UNIQUE violation: either a concurrent delivery of this event, or
            // [Variant A, 2026-07-22] a UK redelivery after our earlier
            // processing failed (status='error' row — deterministic event_ids
            // retry with the SAME id). Atomic reclaim disambiguates: exactly
            // one caller flips error→pending and reprocesses.
            if (logError.code === '23505') {
                logEntry = await IntegrationLog.reclaimErrorByEventId(event_id);
                if (!logEntry) {
                    logger.info(`handleRequestWebhook: concurrent duplicate event_id ${safeLogValue(event_id)}, skipping`);
                    return;
                }
                logger.info(`handleRequestWebhook: reclaimed error row for event_id ${safeLogValue(event_id)}, reprocessing`);
            } else {
                throw logError;
            }
        }

        try {
            // Invalidate request counts cache on any request event
            configProxy.invalidateRequestCache();

            // For request.created — match by `source_event_id` (which is our
            // AlertRequestMap.idempotency_key, also the uk_outbox.event_id we
            // signed and sent) so we can fill in `uk_request_number` on our
            // mapping row. Without this, subsequent `request.status_changed`
            // events for this request can't find the mapping
            // (findByRequestNumber returns NULL) — and the alert never
            // auto-resolves when UK closes the ticket.
            //
            // [Sprint 9.1 / FIX-007] Closes the integration gap discovered
            // during cutover smoke (260523-001) — Sprint 9 sender +
            // outbox ship the outbound channel but the inbound feedback loop
            // was a Sprint 8 leftover not updated for UK Phase 2 payloads.
            //
            // Backward-compat: `source_event_id` may be missing on manual UK
            // requests (created via dashboard without our event_id), in which
            // case we just log and skip — no mapping to fill, no alert flow.
            if (event === 'request.created') {
                const sourceEventId = ukRequest.source_event_id;
                if (sourceEventId) {
                    const mapping = await AlertRequestMap.findByIdempotencyKey(sourceEventId);
                    if (mapping) {
                        await AlertRequestMap.markSent(mapping.id, ukRequest.request_number);
                        logger.info(
                            `handleRequestWebhook: request.created matched mapping ${mapping.id} ` +
                            `via source_event_id, uk_request_number=${safeLogValue(ukRequest.request_number)}`
                        );
                    } else {
                        logger.debug(
                            `handleRequestWebhook: request.created ${safeLogValue(ukRequest.request_number)}: ` +
                            `no AlertRequestMap for source_event_id ${safeLogValue(sourceEventId)} ` +
                            '(synthetic test or stale)'
                        );
                    }
                } else {
                    logger.info(
                        `handleRequestWebhook: request.created ${safeLogValue(ukRequest.request_number)} ` +
                        '(no source_event_id — manual UK request)'
                    );
                }
                // Fall through to integration_log success — see below.
            }

            // Deferred emit so the integration log is marked 'success' BEFORE
            // alertService reacts to UK_REQUEST_RESOLVED (preserves audit-trail
            // ordering: integration log success precedes the alert resolution).
            let deferredResolveAlertId = null;

            // For request.status_changed — check if terminal.
            //
            // [Sprint 9.2 / FIX-007] Accept either `status` (legacy InfraSafe
            // single-field spec) or `new_status` (UK Phase 2 contract, which
            // also carries `old_status`). Prefer `new_status` when both
            // present. Empty/missing both → skip the status-changed branch
            // (validator at webhookRoutes.js:140 already 400s on this).
            const ukStatus = ukRequest.new_status ?? ukRequest.status;

            // [request.reconcile — UK contract 2026-07-23] Reconcile shares the
            // status_changed flow: an existing ARM row is updated in place
            // (criterion c — a terminal status heals a missed auto-resolve),
            // while a number with no ARM row diverges per event below.
            if ((event === 'request.status_changed' || event === 'request.reconcile') && ukStatus) {
                // Find mapping by request number
                const mapping = await AlertRequestMap.findByRequestNumber(ukRequest.request_number);
                // [Sprint 9.2.1 / FIX-007] No mapping is an expected case
                // (manual UK request, or our ARM row was cleaned up). Fall
                // through to integration_log.success instead of early return:
                // "successful no-op" is the correct status — anything else
                // leaves pending rows in operator's audit trail.
                if (!mapping) {
                    if (event === 'request.reconcile') {
                        // UK-originated request (infrasafe_alert_id NOT NULL
                        // forbids an ARM row) → atomic upsert into uk_requests
                        // so the inventory union reports it and UK's set-diff
                        // converges. Fresh event_id per cycle is by design;
                        // convergence comes from the uk_request_number upsert
                        // key, not event dedup.
                        await UkRequest.reconcile({
                            requestNumber: ukRequest.request_number,
                            status: ukStatus,
                            buildingExternalId: ukRequest.building_external_id ?? null
                        });
                        logger.info(
                            `handleRequestWebhook: reconciled UK-originated request ` +
                            `${safeLogValue(ukRequest.request_number)} into uk_requests`
                        );
                    } else {
                        logger.debug(`handleRequestWebhook: no mapping for request ${safeLogValue(ukRequest.request_number)} (manual UK request or stale ARM)`);
                    }
                } else if (event === 'request.reconcile'
                    && (mapping.status === (TERMINAL_STATUSES.includes(ukStatus) ? 'resolved' : 'active')
                        || (ARM_TERMINAL_STATUSES.includes(mapping.status) && !TERMINAL_STATUSES.includes(ukStatus)))) {
                    // [review fix 2026-07-23] Reconcile is a periodic
                    // full-state replay, so unlike an event-driven
                    // status_changed it must be defensive about state it
                    // replays ONTO:
                    //   - no-op when the mapping is already at the target
                    //     status (else every cycle re-runs areAllTerminal and
                    //     re-emits UK_REQUEST_RESOLVED for long-closed alerts
                    //     → resolveAlert "уже закрыт" error-log noise);
                    //   - never downgrade a terminal mapping on a stale
                    //     non-terminal snapshot (else a closed request pops
                    //     back into the map counters as "active").
                    logger.debug(
                        `handleRequestWebhook: reconcile no-op for request ` +
                        `${safeLogValue(ukRequest.request_number)} (mapping ${mapping.id} ` +
                        `status=${safeLogValue(mapping.status)}, uk_status=${safeLogValue(ukStatus)})`
                    );
                } else {
                    // Update mapping status
                    const newStatus = TERMINAL_STATUSES.includes(ukStatus) ? 'resolved' : 'active';
                    await AlertRequestMap.updateStatus(mapping.id, newStatus);

                    // If terminal — defer the UK_REQUEST_RESOLVED emit until after
                    // the integration log is updated. alertService's listener then
                    // calls resolveAlert with the system-initiated (null user) context.
                    if (TERMINAL_STATUSES.includes(ukStatus)) {
                        const allTerminal = await AlertRequestMap.areAllTerminal(mapping.infrasafe_alert_id);
                        if (allTerminal) {
                            deferredResolveAlertId = mapping.infrasafe_alert_id;
                        }
                    }

                    logger.info(`handleRequestWebhook: updated mapping for request ${safeLogValue(ukRequest.request_number)} → status: ${newStatus} (uk_status=${safeLogValue(ukStatus)})`);
                }
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
