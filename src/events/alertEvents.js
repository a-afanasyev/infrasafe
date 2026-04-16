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

    // alertService → ukIntegrationService: an alert was just persisted;
    // if integration is enabled, forward it as a UK request.
    ALERT_CREATED: 'alert.created',

    // ukIntegrationService → alertService: every UK request mapped to
    // this alert reached a terminal status; alert should auto-resolve.
    UK_REQUEST_RESOLVED: 'uk.request.resolved',
});

module.exports = alertEvents;
