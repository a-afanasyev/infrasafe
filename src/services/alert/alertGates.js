'use strict';

const db = require('../../config/database');
const sharedThresholds = require('../../config/thresholds');

/**
 * [AUD-012] Alert creation gates extracted from alertService.js (delegate-only
 * split). Stateless: each takes (alertData, rule, …), reads `db` +
 * sharedThresholds (the instances the unit tests mock) + lazy-requires
 * alertForwarder, and references no `this`. Internal cross-calls
 * (checkPersistenceGate → checkVerifyPersistenceGate → evaluateVerifyFaultWindow)
 * are module-local — those two inner helpers are NOT part of the test spy/direct-
 * call surface, so going local cannot change observable behaviour. alertService
 * keeps thin `this._x` delegators for all four so the spied surface
 * (_checkPersistenceGate / _checkAffectedBuildingsGate) is unchanged.
 */

// [Sprint 10 PR-1] Persistence gate. Returns { allowed, reason }.
//
// For LEAK_DETECTED via controller — SQL aggregation against `metrics`
// counting `leak_sensor=true` samples whose earliest reading is at least
// `minSeconds` ago. ≥2 samples needed to filter single-blip noise.
//
// [B-005 / Sprint 11] Extended to VOLTAGE_ANOMALY and HEATING_FAILURE.
// For TRANSFORMER_* — still fail-open in v1 (analyticsService aggregates
// pre-window, persistence semantics would require rolling helpers that
// are out of scope here).
async function checkPersistenceGate(alertData, rule, sinceTimestamp = null) {
    const minSeconds = rule.min_persistence_seconds;
    if (!minSeconds || minSeconds <= 0) {
        return { allowed: true, reason: 'persistence disabled (min=0)' };
    }

    // [AUD-001 PR-B] Verify mode: the fault must HOLD NOW, measured only on
    // post-resolve telemetry. Count the fault as continuous from the first
    // anomalous sample AFTER the last healthy one (silence is not fault
    // time), require ≥2 anomalous samples and span ≥ minSeconds.
    if (sinceTimestamp) {
        return await checkVerifyPersistenceGate(alertData, rule, sinceTimestamp);
    }

    const { type, severity, infrastructure_type, infrastructure_id } = alertData;
    const lookbackSeconds = Math.max(minSeconds * 2, 600);

    if (type === 'LEAK_DETECTED' && infrastructure_type === 'controller') {
        const result = await db.query(
            `SELECT COUNT(*) AS samples, MIN(timestamp) AS first_seen
             FROM metrics
             WHERE controller_id = $1
               AND leak_sensor = true
               AND timestamp >= NOW() - ($2::int * INTERVAL '1 second')`,
            [infrastructure_id, lookbackSeconds]
        );
        const samples = parseInt(result.rows[0].samples, 10);
        const firstSeen = result.rows[0].first_seen;
        if (samples < 2) {
            return { allowed: false, reason: `LEAK persistence: only ${samples} leak samples in lookback window` };
        }
        const firstSeenAge = (Date.now() - new Date(firstSeen).getTime()) / 1000;
        if (firstSeenAge < minSeconds) {
            return { allowed: false, reason: `LEAK persistence: condition observed for ${firstSeenAge.toFixed(0)}s, need ${minSeconds}s` };
        }
        return { allowed: true, reason: `LEAK persistence OK: ${samples} samples spanning ${firstSeenAge.toFixed(0)}s` };
    }

    if (type === 'VOLTAGE_ANOMALY' && infrastructure_type === 'controller') {
        // Two-tier predicate: WARNING needs ≥2 samples with any phase
        // outside the warn band; CRITICAL needs ≥2 samples with either
        // 2+ phases outside warn band OR any phase outside crit band.
        // We pick the predicate that matches the alertData.severity so
        // a WARNING alert isn't blocked by absence of CRITICAL samples
        // and vice versa.
        const { voltage } = sharedThresholds;
        const filterClause = severity === 'CRITICAL'
            ? `((CASE WHEN electricity_ph1 NOT BETWEEN $3 AND $4 THEN 1 ELSE 0 END)
              + (CASE WHEN electricity_ph2 NOT BETWEEN $3 AND $4 THEN 1 ELSE 0 END)
              + (CASE WHEN electricity_ph3 NOT BETWEEN $3 AND $4 THEN 1 ELSE 0 END)) >= 2
              OR electricity_ph1 NOT BETWEEN $5 AND $6
              OR electricity_ph2 NOT BETWEEN $5 AND $6
              OR electricity_ph3 NOT BETWEEN $5 AND $6`
            : `electricity_ph1 NOT BETWEEN $3 AND $4
               OR electricity_ph2 NOT BETWEEN $3 AND $4
               OR electricity_ph3 NOT BETWEEN $3 AND $4`;

        const params = severity === 'CRITICAL'
            ? [infrastructure_id, lookbackSeconds,
               voltage.warn_min, voltage.warn_max,
               voltage.crit_min, voltage.crit_max]
            : [infrastructure_id, lookbackSeconds,
               voltage.warn_min, voltage.warn_max];

        const result = await db.query(
            `SELECT COUNT(*) AS samples, MIN(timestamp) AS first_seen
             FROM metrics
             WHERE controller_id = $1
               AND timestamp >= NOW() - ($2::int * INTERVAL '1 second')
               AND (electricity_ph1 IS NOT NULL OR electricity_ph2 IS NOT NULL OR electricity_ph3 IS NOT NULL)
               AND (${filterClause})`,
            params
        );
        const samples = parseInt(result.rows[0].samples, 10);
        const firstSeen = result.rows[0].first_seen;
        if (samples < 2) {
            return { allowed: false, reason: `VOLTAGE persistence (${severity}): only ${samples} samples in lookback window` };
        }
        const firstSeenAge = (Date.now() - new Date(firstSeen).getTime()) / 1000;
        if (firstSeenAge < minSeconds) {
            return { allowed: false, reason: `VOLTAGE persistence (${severity}): condition observed for ${firstSeenAge.toFixed(0)}s, need ${minSeconds}s` };
        }
        return { allowed: true, reason: `VOLTAGE persistence OK (${severity}): ${samples} samples spanning ${firstSeenAge.toFixed(0)}s` };
    }

    if (type === 'HEATING_FAILURE' && infrastructure_type === 'controller') {
        const { heating } = sharedThresholds;
        const result = await db.query(
            `SELECT COUNT(*) AS samples, MIN(timestamp) AS first_seen
             FROM metrics
             WHERE controller_id = $1
               AND hot_water_in_temp IS NOT NULL
               AND hot_water_in_temp < $3
               AND timestamp >= NOW() - ($2::int * INTERVAL '1 second')`,
            [infrastructure_id, lookbackSeconds, heating.hot_water_in_critical]
        );
        const samples = parseInt(result.rows[0].samples, 10);
        const firstSeen = result.rows[0].first_seen;
        if (samples < 2) {
            return { allowed: false, reason: `HEATING persistence: only ${samples} sub-threshold samples in lookback window` };
        }
        const firstSeenAge = (Date.now() - new Date(firstSeen).getTime()) / 1000;
        if (firstSeenAge < minSeconds) {
            return { allowed: false, reason: `HEATING persistence: condition observed for ${firstSeenAge.toFixed(0)}s, need ${minSeconds}s` };
        }
        return { allowed: true, reason: `HEATING persistence OK: ${samples} samples spanning ${firstSeenAge.toFixed(0)}s` };
    }

    // Fail-open for unsupported type/infra combinations (TRANSFORMER_*
    // still pending rolling-window aggregations in analyticsService).
    return { allowed: true, reason: `persistence not enforced for ${type}/${infrastructure_type} in v1` };
}

// [AUD-001 PR-B] Verify-mode persistence gate. Unlike the legacy gate
// (which only counts anomalous samples + MIN(timestamp) and ignores healthy
// samples between them), this measures a CONTINUOUS fault that holds NOW:
//   lastHealthy = MAX(timestamp) of a healthy sample after observationSince
//   faultStart  = MIN(timestamp) of an anomalous sample AFTER lastHealthy
//   allow iff  ≥2 anomalous samples since faultStart  AND
//              (lastFault − faultStart) ≥ min_persistence_seconds
// Counting from faultStart (not observationSince) means post-resolve
// silence is NOT charged as fault time, and an "anomaly → healthy → anomaly"
// sequence restarts the clock. Clamp `timestamp > observationSince` keeps
// pre-resolve telemetry out. Returns { allowed, reason }.
async function checkVerifyPersistenceGate(alertData, rule, sinceTimestamp) {
    const minSeconds = rule.min_persistence_seconds;
    const { type, infrastructure_type, infrastructure_id } = alertData;

    if (type === 'LEAK_DETECTED' && infrastructure_type === 'controller') {
        const result = await db.query(
            `WITH s AS (
                 SELECT timestamp, leak_sensor FROM metrics
                 WHERE controller_id = $1 AND leak_sensor IS NOT NULL AND timestamp > $2
             ),
             h AS (SELECT MAX(timestamp) AS last_healthy FROM s WHERE leak_sensor = false)
             SELECT
                 MIN(s.timestamp) FILTER (WHERE s.leak_sensor = true AND s.timestamp > COALESCE(h.last_healthy, $2)) AS fault_start,
                 MAX(s.timestamp) FILTER (WHERE s.leak_sensor = true AND s.timestamp > COALESCE(h.last_healthy, $2)) AS last_fault,
                 COUNT(*)          FILTER (WHERE s.leak_sensor = true AND s.timestamp > COALESCE(h.last_healthy, $2)) AS n
             FROM s, h`,
            [infrastructure_id, sinceTimestamp]
        );
        return evaluateVerifyFaultWindow('LEAK', result.rows[0], minSeconds);
    }

    if (type === 'HEATING_FAILURE' && infrastructure_type === 'controller') {
        const { heating } = sharedThresholds;
        const result = await db.query(
            `WITH s AS (
                 SELECT timestamp, hot_water_in_temp FROM metrics
                 WHERE controller_id = $1 AND hot_water_in_temp IS NOT NULL AND timestamp > $2
             ),
             h AS (SELECT MAX(timestamp) AS last_healthy FROM s WHERE hot_water_in_temp >= $3)
             SELECT
                 MIN(s.timestamp) FILTER (WHERE s.hot_water_in_temp < $3 AND s.timestamp > COALESCE(h.last_healthy, $2)) AS fault_start,
                 MAX(s.timestamp) FILTER (WHERE s.hot_water_in_temp < $3 AND s.timestamp > COALESCE(h.last_healthy, $2)) AS last_fault,
                 COUNT(*)          FILTER (WHERE s.hot_water_in_temp < $3 AND s.timestamp > COALESCE(h.last_healthy, $2)) AS n
             FROM s, h`,
            [infrastructure_id, sinceTimestamp, heating.hot_water_in_critical]
        );
        return evaluateVerifyFaultWindow('HEATING', result.rows[0], minSeconds);
    }

    if (type === 'VOLTAGE_ANOMALY' && infrastructure_type === 'controller') {
        const { severity } = alertData;
        const { voltage } = sharedThresholds;
        // Null-safe per-sample anomaly predicate matching the legacy gate.
        const warnOut = (p) => `COALESCE(${p} NOT BETWEEN $3 AND $4, false)`;
        const critOut = (p) => `COALESCE(${p} NOT BETWEEN $5 AND $6, false)`;
        const anomaly = severity === 'CRITICAL'
            ? `((${warnOut('electricity_ph1')}::int + ${warnOut('electricity_ph2')}::int + ${warnOut('electricity_ph3')}::int) >= 2
                OR ${critOut('electricity_ph1')} OR ${critOut('electricity_ph2')} OR ${critOut('electricity_ph3')})`
            : `(${warnOut('electricity_ph1')} OR ${warnOut('electricity_ph2')} OR ${warnOut('electricity_ph3')})`;
        const params = severity === 'CRITICAL'
            ? [infrastructure_id, sinceTimestamp, voltage.warn_min, voltage.warn_max, voltage.crit_min, voltage.crit_max]
            : [infrastructure_id, sinceTimestamp, voltage.warn_min, voltage.warn_max];
        const result = await db.query(
            `WITH s AS (
                 SELECT timestamp, electricity_ph1, electricity_ph2, electricity_ph3 FROM metrics
                 WHERE controller_id = $1
                   AND (electricity_ph1 IS NOT NULL OR electricity_ph2 IS NOT NULL OR electricity_ph3 IS NOT NULL)
                   AND timestamp > $2
             ),
             h AS (SELECT MAX(timestamp) AS last_healthy FROM s WHERE NOT ${anomaly})
             SELECT
                 MIN(s.timestamp) FILTER (WHERE ${anomaly} AND s.timestamp > COALESCE(h.last_healthy, $2)) AS fault_start,
                 MAX(s.timestamp) FILTER (WHERE ${anomaly} AND s.timestamp > COALESCE(h.last_healthy, $2)) AS last_fault,
                 COUNT(*)          FILTER (WHERE ${anomaly} AND s.timestamp > COALESCE(h.last_healthy, $2)) AS n
             FROM s, h`,
            params
        );
        return evaluateVerifyFaultWindow(`VOLTAGE/${severity}`, result.rows[0], minSeconds);
    }

    // Fail-open for unsupported type/infra combinations (TRANSFORMER_*
    // measured separately via _getTransformerLoadSince in verify mode).
    return { allowed: true, reason: `verify persistence not enforced for ${type}/${infrastructure_type}` };
}

// [AUD-001 PR-B] Shared decision for the continuous-fault window: ≥2
// anomalous samples spanning ≥ minSeconds since faultStart.
function evaluateVerifyFaultWindow(label, row, minSeconds) {
    // Defensive: the controller CTEs `FROM s, h` return zero rows if `s` is
    // empty (no metrics in window). _runVerify's freshness-probe guarantees
    // ≥1 fresh sample before we get here, but guard anyway so a future caller
    // (or an empty-table edge) denies cleanly instead of throwing on undefined.
    if (!row || row.n == null) {
        return { allowed: false, reason: `${label} verify: no samples in window` };
    }
    const n = parseInt(row.n, 10);
    if (n < 2 || !row.fault_start) {
        return { allowed: false, reason: `${label} verify: only ${n} anomalous samples since last healthy` };
    }
    const spanSeconds = (new Date(row.last_fault).getTime() - new Date(row.fault_start).getTime()) / 1000;
    if (spanSeconds < minSeconds) {
        return { allowed: false, reason: `${label} verify: continuous fault held ${spanSeconds.toFixed(0)}s, need ${minSeconds}s` };
    }
    return { allowed: true, reason: `${label} verify OK: ${n} samples spanning ${spanSeconds.toFixed(0)}s of continuous fault` };
}

// [Sprint 10 PR-1] Affected-buildings gate. Returns { allowed, reason }.
// Uses alertForwarder.resolveBuildingIds (lazy require to avoid load-order
// issues — alertForwarder is loaded by server.js after alertService).
async function checkAffectedBuildingsGate(alertData, rule) {
    const minBuildings = rule.min_affected_buildings;
    if (!minBuildings || minBuildings <= 1) {
        return { allowed: true, reason: 'buildings gate default (min=1)' };
    }

    const alertForwarder = require('../uk/alertForwarder');
    const buildings = await alertForwarder.resolveBuildingIds(
        alertData.infrastructure_id,
        alertData.infrastructure_type
    );

    if (buildings.length < minBuildings) {
        return {
            allowed: false,
            reason: `buildings gate: ${buildings.length} buildings affected, need ${minBuildings}`
        };
    }
    return { allowed: true, reason: `buildings gate OK: ${buildings.length} affected` };
}

module.exports = {
    checkPersistenceGate,
    checkVerifyPersistenceGate,
    evaluateVerifyFaultWindow,
    checkAffectedBuildingsGate
};
