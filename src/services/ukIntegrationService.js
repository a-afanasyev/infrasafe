'use strict';

/**
 * [P1-14] UK integration facade — thin re-export over five focused modules.
 *
 * The original 752-LoC god-class was split into five modules under
 * `src/services/uk/` per the bucket discovery in the Sprint 7+ audit:
 *
 *   - `uk/configProxy.js`     — isEnabled / get/updateConfig / UK API
 *                                proxy + 60s cache.
 *   - `uk/webhookVerifier.js` — HMAC verify + nonce replay protection,
 *                                logEvent / isDuplicateEvent helpers.
 *   - `uk/buildingSync.js`    — handleBuildingWebhook + _generateExternalId.
 *   - `uk/alertForwarder.js`  — sendAlertToUK + resolveBuildingIds, owns the
 *                                alertEvents.ALERT_CREATED listener.
 *   - `uk/requestProcessor.js`— handleRequestWebhook, emits
 *                                alertEvents.UK_REQUEST_RESOLVED.
 *
 * Existing callers (`src/routes/webhookRoutes.js`,
 * `src/routes/integrationRoutes.js`) and existing test mocks
 * (`jest.mock('.../ukIntegrationService', () => ({ ... }))`) continue
 * working without modification — they hit the same public method names
 * exported below. New code should import the sub-modules directly.
 *
 * The two side-effecting sub-modules (alertForwarder registers an
 * ALERT_CREATED listener on import; requestProcessor emits inside
 * handleRequestWebhook) are required here so a single
 * `require('./ukIntegrationService')` continues to wire up the full
 * integration as before.
 */

const configProxy = require('./uk/configProxy');
const webhookVerifier = require('./uk/webhookVerifier');
const buildingSync = require('./uk/buildingSync');
const alertForwarder = require('./uk/alertForwarder');
const requestProcessor = require('./uk/requestProcessor');

// Re-export the public API surface used by routes and tests. Each method
// is bound to its owning singleton so `this`-references inside the method
// resolve to the correct instance state (e.g., _requestCountsCache lives
// on configProxy, _seenSignatures lives on webhookVerifier).
module.exports = {
    // configProxy
    isEnabled:              configProxy.isEnabled.bind(configProxy),
    getConfig:              configProxy.getConfig.bind(configProxy),
    updateConfig:           configProxy.updateConfig.bind(configProxy),
    getRequestCounts:       configProxy.getRequestCounts.bind(configProxy),
    getBuildingRequests:    configProxy.getBuildingRequests.bind(configProxy),
    invalidateRequestCache: configProxy.invalidateRequestCache.bind(configProxy),

    // webhookVerifier
    verifyWebhookSignature: webhookVerifier.verifyWebhookSignature.bind(webhookVerifier),
    logEvent:               webhookVerifier.logEvent.bind(webhookVerifier),
    isDuplicateEvent:       webhookVerifier.isDuplicateEvent.bind(webhookVerifier),
    _resetSeenSignatures:   webhookVerifier._resetSeenSignatures.bind(webhookVerifier),

    // buildingSync
    handleBuildingWebhook:  buildingSync.handleBuildingWebhook.bind(buildingSync),
    _generateExternalId:    buildingSync._generateExternalId.bind(buildingSync),

    // alertForwarder
    sendAlertToUK:          alertForwarder.sendAlertToUK.bind(alertForwarder),
    resolveBuildingIds:     alertForwarder.resolveBuildingIds.bind(alertForwarder),

    // requestProcessor
    handleRequestWebhook:   requestProcessor.handleRequestWebhook.bind(requestProcessor),
};

// Tests inspect a few internal state fields directly (replay-protection map,
// request-counts cache). After the P1-14 split those live on the owning
// singletons; expose property proxies so the existing tests don't need to
// learn the new submodule paths just to assert on state.
Object.defineProperty(module.exports, '_seenSignatures', {
    get() { return webhookVerifier._seenSignatures; },
    enumerable: false,
    configurable: true,
});
Object.defineProperty(module.exports, '_requestCountsCache', {
    get() { return configProxy._requestCountsCache; },
    set(v) { configProxy._requestCountsCache = v; },
    enumerable: false,
    configurable: true,
});
Object.defineProperty(module.exports, '_requestCountsCacheTime', {
    get() { return configProxy._requestCountsCacheTime; },
    set(v) { configProxy._requestCountsCacheTime = v; },
    enumerable: false,
    configurable: true,
});
