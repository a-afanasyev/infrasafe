'use strict';

/**
 * [AUD-012] Constants extracted from alertService.js (delegate-only split).
 * Pure values, no dependencies. alertService re-requires these and continues to
 * expose COOLDOWN_SUFFIX_BY_TYPE / SEVERITY_RANK on the singleton for the
 * drift-guard tests.
 */

// [SEC-7] Cap on the number of alert_request_map rows aggregated into the
// inline uk_requests array per alert in getActiveAlerts(). A mass/transformer
// outage can map thousands of buildings to a single alert; bounding the
// per-alert sub-array prevents an unbounded JSON build (memory spike) on the
// admin endpoint. The array is truncated (most-recent first), not the request.
const UK_REQUESTS_MAX_PER_ALERT = 100;

// [AUD-003] Maps an alert type to the cooldown-key suffix its checker uses
// (checkTransformerLoad → :load_check, checkLeak → :leak_check, etc.). On a
// system-initiated resolve, _resolveVerifying clears the cooldown so the
// checker can re-evaluate after grace. The old code hardcoded ':load_check',
// which only matched transformer alerts — for controller types (leak/voltage/
// heating) it cleared a non-existent key and left re-detection masked by the
// 15-min cooldown. The drift guard in alertService.resolveAlert.test.js asserts
// every checker's checkKey suffix is represented here.
const COOLDOWN_SUFFIX_BY_TYPE = Object.freeze({
    TRANSFORMER_OVERLOAD: 'load_check',
    TRANSFORMER_CRITICAL_OVERLOAD: 'load_check',
    LEAK_DETECTED: 'leak_check',
    VOLTAGE_ANOMALY: 'voltage_check',
    HEATING_FAILURE: 'heating_check'
});

// [AUD-006] Total order over severities — escalate-in-place only fires when a
// newly-classified severity outranks the currently-active one.
const SEVERITY_RANK = Object.freeze({ INFO: 0, WARNING: 1, CRITICAL: 2 });

// [R2-23] Код ошибки «алерт не найден». Живёт ЗДЕСЬ, а не на singleton'е
// alertService, намеренно: контроллер сверяет `error.code` именно с этой
// константой, и если бы он брал её с сервиса, то любой тест, мокающий
// alertService без этого поля, получал бы `undefined === undefined` для обычной
// ошибки без `code` — и та молча классифицировалась бы как 404. Отдельный
// модуль констант мокнуть «мимо» нельзя.
const ALERT_NOT_FOUND = 'ALERT_NOT_FOUND';

module.exports = { UK_REQUESTS_MAX_PER_ALERT, COOLDOWN_SUFFIX_BY_TYPE, SEVERITY_RANK, ALERT_NOT_FOUND };
