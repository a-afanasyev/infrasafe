'use strict';

const db = require('../../config/database');
const sharedThresholds = require('../../config/thresholds');

/**
 * [AUD-012] Stateless read-only SQL helpers extracted from alertService.js
 * (delegate-only split). Each takes only its args, reads `db` + sharedThresholds
 * (same module instances the unit tests mock), and references no `this`.
 * alertService keeps thin `this._x` delegators so the spied/direct-called
 * surface (e.g. _classifyVoltageSeverity, _recentVoltageMetric) is unchanged.
 */

// [AUD-001 PR-B] Current transformer load from the LATEST metric per
// controller (lateral latest-sample pattern, cf. 003_power_calculation_v2),
// clamped to post-resolve telemetry — bypasses the 24h-averaged MV
// (012_fix_materialized_view) and cache so a recovered transformer doesn't
// falsely reopen on stale samples. Load formula mirrors the MV:
// LEAST(100, AVG(total_amperage) * 0.4 / power_kva * 100). Returns null when
// no controller has a post-resolve sample. Keep this formula in sync with
// 012_fix_materialized_view.sql / 003_power_calculation_v2.sql.
async function getTransformerLoadSince(transformerId, observationSince) {
    const result = await db.query(
        `SELECT
             t.name,
             t.power_kva AS capacity_kva,
             COUNT(DISTINCT b.building_id) AS buildings_count,
             COUNT(m.timestamp) AS sample_count,
             MAX(m.timestamp) AS last_metric_time,
             CASE WHEN t.power_kva > 0 THEN
                 LEAST(100, AVG(COALESCE(m.amperage_ph1,0) + COALESCE(m.amperage_ph2,0) + COALESCE(m.amperage_ph3,0))
                            FILTER (WHERE m.timestamp IS NOT NULL)
                            * 0.4 / t.power_kva * 100)
             ELSE 0 END AS load_percent
         FROM transformers t
         LEFT JOIN buildings b
             ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
         LEFT JOIN controllers c ON b.building_id = c.building_id
         LEFT JOIN LATERAL (
             SELECT amperage_ph1, amperage_ph2, amperage_ph3, timestamp
             FROM metrics
             WHERE controller_id = c.controller_id AND timestamp > $2
             ORDER BY timestamp DESC LIMIT 1
         ) m ON true
         WHERE t.transformer_id = $1
         GROUP BY t.transformer_id, t.name, t.power_kva`,
        [transformerId, observationSince]
    );
    const row = result.rows[0];
    if (!row || parseInt(row.sample_count, 10) === 0) {
        return null; // no post-resolve telemetry from any controller
    }
    return {
        name: row.name,
        capacity_kva: row.capacity_kva,
        buildings_count: parseInt(row.buildings_count, 10),
        load_percent: parseFloat(row.load_percent),
        last_metric_time: row.last_metric_time,
        active_controllers_count: null
    };
}

// [AUD-001 PR-B] Freshness probe: the latest profile sample written AFTER
// observationSince (= the resolve/enqueue moment). Returns:
//   null  — no fresh sample (sensor silent since resolve)
//   false — latest fresh sample is healthy (recovered)
//   true  — latest fresh sample is anomalous (fault may still hold)
// Per-profile predicate; voltage uses the warn band (any phase out).
async function latestProfileSampleAnomalous(profile, controllerId, observationSince) {
    if (profile === 'leak') {
        const r = await db.query(
            `SELECT leak_sensor FROM metrics
             WHERE controller_id = $1 AND leak_sensor IS NOT NULL AND timestamp > $2
             ORDER BY timestamp DESC LIMIT 1`,
            [controllerId, observationSince]
        );
        if (r.rows.length === 0) return null;
        return r.rows[0].leak_sensor === true;
    }
    if (profile === 'heating') {
        const { heating } = sharedThresholds;
        const r = await db.query(
            `SELECT hot_water_in_temp FROM metrics
             WHERE controller_id = $1 AND hot_water_in_temp IS NOT NULL AND timestamp > $2
             ORDER BY timestamp DESC LIMIT 1`,
            [controllerId, observationSince]
        );
        if (r.rows.length === 0) return null;
        return r.rows[0].hot_water_in_temp < heating.hot_water_in_critical;
    }
    if (profile === 'voltage') {
        const { voltage } = sharedThresholds;
        const r = await db.query(
            `SELECT electricity_ph1, electricity_ph2, electricity_ph3 FROM metrics
             WHERE controller_id = $1
               AND (electricity_ph1 IS NOT NULL OR electricity_ph2 IS NOT NULL OR electricity_ph3 IS NOT NULL)
               AND timestamp > $2
             ORDER BY timestamp DESC LIMIT 1`,
            [controllerId, observationSince]
        );
        if (r.rows.length === 0) return null;
        const row = r.rows[0];
        const out = (v) => v != null && (v < voltage.warn_min || v > voltage.warn_max);
        return out(row.electricity_ph1) || out(row.electricity_ph2) || out(row.electricity_ph3);
    }
    return null;
}

// [FE-119 Phase 2] The single phase voltage furthest OUTSIDE the working band
// [warn_min, warn_max] in the recent window — the value that best explains the
// alert. Scans per-phase min/max (a low sag and a high spike are both
// candidates) and returns the most-deviant. Defensive: null (no throw) when
// the query yields nothing or every phase sits within band.
async function recentVoltageMetric(controllerId) {
    const { voltage } = sharedThresholds;
    const result = await db.query(
        `SELECT MIN(electricity_ph1) AS ph1_min, MAX(electricity_ph1) AS ph1_max,
                MIN(electricity_ph2) AS ph2_min, MAX(electricity_ph2) AS ph2_max,
                MIN(electricity_ph3) AS ph3_min, MAX(electricity_ph3) AS ph3_max
         FROM metrics
         WHERE controller_id = $1
           AND timestamp >= NOW() - INTERVAL '600 seconds'`,
        [controllerId]
    );
    const row = result && result.rows && result.rows[0] ? result.rows[0] : null;
    if (!row) return null;
    const candidates = [row.ph1_min, row.ph1_max, row.ph2_min, row.ph2_max, row.ph3_min, row.ph3_max]
        .filter((v) => v != null)
        .map(Number)
        .filter((v) => !Number.isNaN(v));
    let best = null;
    let bestDev = 0;
    for (const v of candidates) {
        const dev = v < voltage.warn_min
            ? voltage.warn_min - v
            : (v > voltage.warn_max ? v - voltage.warn_max : 0);
        if (dev > bestDev) { bestDev = dev; best = v; }
    }
    return best;
}

// [B-005 / Sprint 11] Classify the current voltage condition. Returns
// 'CRITICAL', 'WARNING', or null. Looks back 600s — long enough to
// catch a sustained fault but short enough to avoid stale data from
// a previous incident. The actual persistence-gate (≥2 samples
// spanning ≥ min_persistence_seconds) runs inside createAlert.
// [AUD-001 PR-B] sinceTimestamp (verify mode) clamps the window to
// post-resolve telemetry: timestamp > GREATEST(NOW() - 600s, observationSince).
// Without it the 600s lookback would re-classify pre-resolve samples.
async function classifyVoltageSeverity(controllerId, sinceTimestamp = null) {
    const { voltage } = sharedThresholds;
    const params = [controllerId, voltage.warn_min, voltage.warn_max, voltage.crit_min, voltage.crit_max];
    let sinceClause = '';
    if (sinceTimestamp) {
        params.push(sinceTimestamp);
        sinceClause = `AND timestamp > $${params.length}::timestamptz`;
    }
    const result = await db.query(
        `SELECT
            COUNT(*) FILTER (
                WHERE electricity_ph1 NOT BETWEEN $2 AND $3
                   OR electricity_ph2 NOT BETWEEN $2 AND $3
                   OR electricity_ph3 NOT BETWEEN $2 AND $3
            ) AS warn_samples,
            COUNT(*) FILTER (
                WHERE (CASE WHEN electricity_ph1 NOT BETWEEN $2 AND $3 THEN 1 ELSE 0 END)
                    + (CASE WHEN electricity_ph2 NOT BETWEEN $2 AND $3 THEN 1 ELSE 0 END)
                    + (CASE WHEN electricity_ph3 NOT BETWEEN $2 AND $3 THEN 1 ELSE 0 END) >= 2
                  OR electricity_ph1 NOT BETWEEN $4 AND $5
                  OR electricity_ph2 NOT BETWEEN $4 AND $5
                  OR electricity_ph3 NOT BETWEEN $4 AND $5
            ) AS crit_samples
        FROM metrics
        WHERE controller_id = $1
          AND (electricity_ph1 IS NOT NULL OR electricity_ph2 IS NOT NULL OR electricity_ph3 IS NOT NULL)
          AND timestamp >= NOW() - INTERVAL '600 seconds'
          ${sinceClause}`,
        params
    );
    const warnSamples = parseInt(result.rows[0].warn_samples, 10);
    const critSamples = parseInt(result.rows[0].crit_samples, 10);
    if (critSamples > 0) return 'CRITICAL';
    if (warnSamples > 0) return 'WARNING';
    return null;
}

// [FE-119] Worst (lowest) sub-threshold ГВС temperature in the recent
// window — the value the rule fired on. Defensive: returns null (no throw)
// when the query yields nothing, so a metric-fetch failure never blocks the
// alert (metric_value just stays null).
async function recentHeatingMinTemp(controllerId) {
    const { heating } = sharedThresholds;
    const result = await db.query(
        `SELECT MIN(hot_water_in_temp) AS min_temp
         FROM metrics
         WHERE controller_id = $1
           AND hot_water_in_temp IS NOT NULL
           AND hot_water_in_temp < $2
           AND timestamp >= NOW() - INTERVAL '600 seconds'`,
        [controllerId, heating.hot_water_in_critical]
    );
    const v = result && result.rows && result.rows[0] ? result.rows[0].min_temp : null;
    return v == null ? null : Number(v);
}

// [B-005 / Sprint 11] Quick predicate — is there at least one sub-
// threshold hot_water_in_temp reading in the recent window? Used by
// checkHeating to short-circuit on healthy controllers.
async function hasRecentHeatingAnomaly(controllerId) {
    const { heating } = sharedThresholds;
    const result = await db.query(
        `SELECT 1
         FROM metrics
         WHERE controller_id = $1
           AND hot_water_in_temp IS NOT NULL
           AND hot_water_in_temp < $2
           AND timestamp >= NOW() - INTERVAL '600 seconds'
         LIMIT 1`,
        [controllerId, heating.hot_water_in_critical]
    );
    return result.rows.length > 0;
}

module.exports = {
    getTransformerLoadSince,
    latestProfileSampleAnomalous,
    recentVoltageMetric,
    classifyVoltageSeverity,
    recentHeatingMinTemp,
    hasRecentHeatingAnomaly
};
