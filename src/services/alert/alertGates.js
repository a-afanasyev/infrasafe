'use strict';

const db = require('../../config/database');
const sharedThresholds = require('../../config/thresholds');
const logger = require('../../utils/logger');

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
// LEAK_DETECTED / VOLTAGE_ANOMALY / HEATING_FAILURE via controller — SQL
// aggregation against `metrics`. TRANSFORMER_* — fail-open (the MV load is a
// 24h average; there is no per-sample series to measure persistence on).
//
// [Q-08] Both paths measure a CONTINUOUS fault (checkVerifyPersistenceGate):
// ≥2 anomalous samples since the last healthy one, spanning ≥ minSeconds.
// The legacy path used to count anomalous samples in the lookback and ignore
// healthy ones between them — two isolated blips 9 minutes apart raised a
// CRITICAL. Now it is the same gate with the window start at NOW() − lookback.
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

    const lookbackSeconds = Math.max(minSeconds * 2, 600);
    return await checkVerifyPersistenceGate(alertData, rule, new Date(Date.now() - lookbackSeconds * 1000));
}

// [AUD-001 PR-B] Continuous-fault persistence gate (since Q-08 — for both the
// verify and the ordinary path). Measures a fault that holds NOW, not a
// count of anomalous samples with healthy ones ignored between them:
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

// [B-009] Сезонное окно правила. Синхронный (в отличие от соседей) — данных из
// БД не нужно, окно уже лежит в снапшоте правила.
//
// Формат хранения — 'MM-DD' (миграция 041); лексикографическое сравнение
// zero-padded строк совпадает с календарным, поэтому парсинг не нужен.
//
// Переход через Новый год — основной случай (отопительный сезон 10-15..04-15),
// а не краевой:
//   from <= to → внутри, если from <= today <= to
//   from >  to → внутри, если today >= from ИЛИ today <= to
// Границы ВКЛЮЧИТЕЛЬНЫЕ с обеих сторон.
//
// Оба NULL = круглый год (значение по умолчанию для всех существующих правил →
// поведение до B-009 сохраняется). Полузаполненная пара запрещена констрейнтом
// БД, но если она каким-то образом возникла — fail-open: гейт пропускает и пишет
// warn. Заглушить эскалацию из-за недоредактированной строки хуже, чем пропустить
// лишний алерт.
//
// `now` инжектируется тестами. Календарная дата берётся по Ташкенту явно, а не по
// TZ процесса. [N-32] Прежде здесь стояли getMonth()/getDate() с расчётом на
// «TZ контейнера — Asia/Tashkent», но на обеих площадках TZ пуст и время UTC:
// сезон 10-15..04-15 открывался бы в 05:00 по Ташкенту и закрывался на пять
// часов позже. Окно задаёт оператор по местному календарю — так и считаем.
const SEASON_TIME_ZONE = 'Asia/Tashkent';
const seasonDateFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEASON_TIME_ZONE, month: '2-digit', day: '2-digit',
});

// 'MM-DD' в SEASON_TIME_ZONE. formatToParts, а не format: порядок и разделитель
// у format зависят от локали, у частей — нет.
function seasonToday(now) {
    const parts = Object.fromEntries(
        seasonDateFormat.formatToParts(now).map(({ type, value }) => [type, value])
    );
    return `${parts.month}-${parts.day}`;
}

function checkSeasonGate(alertData, rule, now = new Date()) {
    const from = rule.season_from ? String(rule.season_from).trim() : null;
    const to   = rule.season_to   ? String(rule.season_to).trim()   : null;

    if (!from && !to) {
        return { allowed: true, reason: 'season gate: круглогодичное правило' };
    }
    if (!from || !to) {
        logger.warn(
            `season gate: полузаполненное окно у правила ${rule.alert_type}/${rule.severity} ` +
            `(from=${from ?? 'NULL'}, to=${to ?? 'NULL'}) — пропускаем (fail-open)`
        );
        return { allowed: true, reason: 'season gate: неполное окно, fail-open' };
    }

    const today = seasonToday(now);

    const inside = (from <= to)
        ? (today >= from && today <= to)
        : (today >= from || today <= to);

    if (!inside) {
        return {
            allowed: false,
            reason: `season gate: ${today} вне окна ${from}..${to}`
        };
    }
    return { allowed: true, reason: `season gate OK: ${today} внутри ${from}..${to}` };
}

module.exports = {
    checkPersistenceGate,
    checkVerifyPersistenceGate,
    evaluateVerifyFaultWindow,
    checkAffectedBuildingsGate,
    checkSeasonGate
};
