/**
 * Phase 7 — central event bus for the alert pipeline.
 *
 * Before this module existed, alertService, analyticsService and
 * ukIntegrationService formed a require-time cycle that was papered
 * over with five `const X = require('./X')` calls placed INSIDE
 * methods. That pattern made static analysis and unit testing harder
 * than necessary.
 *
 * Now:
 *   - analyticsService emits `transformer.check` → alertService subscribes.
 *   - alertService emits `alert.created` → ukIntegrationService subscribes.
 *   - ukIntegrationService emits `uk.request.resolved` → alertService subscribes.
 *
 * All producers call `alertEvents.emit(event, payload)` and never import
 * the consumer. All consumers register their listener on module load via
 * `alertEvents.on(event, handler)`.
 *
 * Listener registration is side-effect-free: each consumer module calls
 * `on(...)` exactly once during its require; hot-reload in tests should
 * use `alertEvents.removeAllListeners()` between runs.
 *
 * The bus is a singleton (module.exports is the same instance across all
 * requires). `setMaxListeners(20)` silences the Node 10-listener warning
 * without disabling it entirely.
 */

const EventEmitter = require('node:events');

const alertEvents = new EventEmitter();
alertEvents.setMaxListeners(20);

// Event name constants — prevents typos and makes it easy to grep usage.
alertEvents.EVENTS = Object.freeze({
    // analyticsService → alertService: fresh transformer metrics arrived;
    // alertService should run its threshold check for this transformer.
    TRANSFORMER_CHECK: 'transformer.check',

    // [B-005 / 2026-05-25] metricService → alertService: a new metric just
    // landed with leak_sensor=true for some controller. alertService should
    // run its persistence-gated leak check. Mirrors TRANSFORMER_CHECK contract:
    // fire-and-forget, payload `{ controllerId, metricId }`. Persistence gate
    // inside createAlert filters single-blip noise; cooldown filters spam.
    LEAK_CHECK: 'leak.check',

    // alertService → ukIntegrationService: an alert was just persisted;
    // if integration is enabled, forward it as a UK request.
    ALERT_CREATED: 'alert.created',

    // ukIntegrationService → alertService: every UK request mapped to
    // this alert reached a terminal status; alert should auto-resolve.
    UK_REQUEST_RESOLVED: 'uk.request.resolved',

    // [Sprint 10 PR-2] alertVerificationService → checker services:
    // per-type verification trigger. Payload:
    //   { infraType, infraId, alertType, bypassCooldown:true,
    //     reopenChainId, reopenSequence, originalAlertId,
    //     previousUkRequestNumber }
    // Checker emits a fresh alert via createAlert if condition persists;
    // verifier then markReopened with the new alert_id.
    VERIFY_TRANSFORMER: 'verify.transformer',
    VERIFY_LEAK:        'verify.leak',
    VERIFY_VOLTAGE:     'verify.voltage',
    VERIFY_HEATING:     'verify.heating',

    // [Sprint 10 PR-2] alertService → consumers (UI, audit, future
    // notification channels). Emitted when an alert is reopened as part
    // of a verification cycle. Payload: { alertId, reopenChainId,
    // reopenSequence, previousAlertId }.
    ALERT_REOPENED: 'alert.reopened',

    // [Sprint 10 PR-2] alertVerificationService → consumers. Emitted when
    // a verification cycle hits max_reopens_per_24h and auto-reopen
    // halts. Payload: { reopenChainId, lastAlertId, reopenCount }.
    ALERT_ENGINEER_REQUIRED: 'alert.engineer_required',

    // [Sprint 10 PR-4 — placeholder for future use] alertService → consumers.
    // Emitted when an operator suppresses an alert (forward-declared so
    // PR-2 tests that subscribe to all events don't need updating).
    ALERT_SUPPRESSED: 'alert.suppressed',
});

module.exports = alertEvents;
