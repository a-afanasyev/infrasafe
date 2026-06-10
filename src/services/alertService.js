const db = require('../config/database');
const logger = require('../utils/logger');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');
const sharedThresholds = require('../config/thresholds');
const alertEvents = require('../events/alertEvents');
// Phase 7: top-level require is now safe. analyticsService no longer
// requires alertService — the feedback edge goes through `transformer.check`
// events instead. We still need analyticsService to PULL data (load numbers,
// overloaded transformer list), which is a plain function call.
const analyticsService = require('./analyticsService');

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

class InfrastructureAlertService {
    constructor() {
        // Circuit breaker для операций с БД
        this.dbBreaker = CircuitBreakerFactory.createDatabaseBreaker('AlertsDB');

        // Phase 4.2 (KISS-008): thresholds come from the shared config module.
        // Local copy kept for updateThresholds() compatibility (runtime overrides).
        this.thresholds = {
            transformer_overload: sharedThresholds.transformer.overload,
            transformer_critical: sharedThresholds.transformer.critical,
            water_pressure_low: sharedThresholds.water.pressure_low,
            water_pressure_critical: sharedThresholds.water.pressure_critical,
            heating_temp_delta_low: sharedThresholds.heating.temp_delta_low,
            heating_temp_delta_critical: sharedThresholds.heating.temp_delta_critical,
        };

        // Активные алерты в памяти для быстрого доступа
        this.activeAlerts = new Map();

        // Последние проверки (чтобы не спамить)
        this.lastChecks = new Map();

        // Минимальный интервал между одинаковыми алертами (минуты)
        this.alertCooldown = 15;

        // Флаг инициализации
        this.initialized = false;
        // [Sprint 5 / P1-4] In-flight init promise — concurrent callers share
        // one initialize() call instead of racing parallel loadActiveAlerts().
        // Cleared in finally so a failed init can be retried.
        this._initPromise = null;
    }

    // Инициализация сервиса (вызывается после готовности БД)
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Проверяем готовность БД
            await this.waitForDatabase();

            // Загружаем активные алерты
            await this.loadActiveAlerts();

            this.initialized = true;
            logger.info('AlertService успешно инициализирован');
        } catch (error) {
            logger.error('Ошибка инициализации AlertService:', error);
            throw error;
        }
    }

    // Ожидание готовности БД
    async waitForDatabase() {
        const maxRetries = 30;
        const retryDelay = 1000; // 1 секунда

        for (let i = 0; i < maxRetries; i++) {
            try {
                // Пробуем выполнить простой запрос
                await db.query('SELECT 1');
                logger.info('База данных готова для AlertService');
                return;
            } catch (error) {
                logger.warn(`Попытка ${i + 1}/${maxRetries}: БД не готова, ожидание...`);
                if (i === maxRetries - 1) {
                    throw new Error('Превышено максимальное время ожидания готовности БД');
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    // Проверка инициализации перед операциями
    async ensureInitialized() {
        if (this.initialized) return;
        if (!this._initPromise) {
            this._initPromise = this.initialize().finally(() => {
                this._initPromise = null;
            });
        }
        await this._initPromise;
    }

    // Загрузка активных алертов при старте
    async loadActiveAlerts() {
        try {
            const query = `
                SELECT alert_id, type, infrastructure_id, infrastructure_type, severity, created_at
                FROM infrastructure_alerts
                WHERE status = 'active'
                ORDER BY created_at DESC
            `;

            const result = await db.query(query);

            for (const alert of result.rows) {
                const key = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
                this.activeAlerts.set(key, {
                    alert_id: alert.alert_id,
                    created_at: alert.created_at,
                    severity: alert.severity
                });
            }

            // Phase 4.3 (ARCH-109): restore cooldown timestamps from active alert
            // created_at values so a process restart does not cause an alert burst.
            // checkTransformerLoad et al. use a per-infrastructure cooldown keyed as
            // `${infra_type}:${infra_id}:load_check`; we project active alerts onto
            // the same key shape and keep the most recent timestamp.
            for (const [alertKey, alertInfo] of this.activeAlerts.entries()) {
                const parts = alertKey.split(':');
                if (parts.length < 2) continue;
                const checkKey = `${parts[0]}:${parts[1]}:load_check`;
                const alertTime = new Date(alertInfo.created_at).getTime();
                const existing = this.lastChecks.get(checkKey);
                if (!existing || alertTime > existing) {
                    this.lastChecks.set(checkKey, alertTime);
                }
            }

            logger.info(
                `Загружено ${this.activeAlerts.size} активных алертов; восстановлено ${this.lastChecks.size} cooldown-меток`
            );
        } catch (error) {
            logger.error('Ошибка загрузки активных алертов:', error);
            // Не бросаем ошибку, чтобы не ломать инициализацию
        }
    }

    // Основной метод для проверки трансформатора и создания алертов
    async checkTransformerLoad(transformerId, opts = {}) {
        await this.ensureInitialized();

        const verifyMode = !!opts.reopenContext;
        const checkKey = `transformer:${transformerId}:load_check`;
        const now = Date.now();

        // Проверяем cooldown
        if (!opts.bypassCooldown && this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return verifyMode ? { checked: false, alert: null } : null; // Слишком рано для повторной проверки
            }
        }

        try {
            // [AUD-001 PR-B] Verify mode CANNOT use getTransformerLoad — it
            // returns a cached/MV row whose load_percent is AVERAGED over 24h
            // (012_fix_materialized_view.sql), so post-resolve silence still
            // reads "overloaded" from stale samples. Use a direct current-load
            // calc from the latest metric per controller, clamped to
            // post-resolve telemetry. No fresh metrics → cannot conclude.
            const loadData = verifyMode
                ? await this._getTransformerLoadSince(transformerId, opts.reopenContext.observationSince)
                : await analyticsService.getTransformerLoad(transformerId);

            if (!loadData || typeof loadData.load_percent !== 'number') {
                if (verifyMode) return { checked: false, alert: null };
                logger.warn(`Нет данных загрузки для трансформатора ${transformerId}`);
                return null;
            }

            const loadPercent = loadData.load_percent;
            let alertType = null;
            let severity = null;
            let message = null;

            // Определяем тип алерта
            if (loadPercent >= this.thresholds.transformer_critical) {
                alertType = 'TRANSFORMER_CRITICAL_OVERLOAD';
                severity = 'CRITICAL';
                message = `Критическая перегрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`;
            } else if (loadPercent >= this.thresholds.transformer_overload) {
                alertType = 'TRANSFORMER_OVERLOAD';
                severity = 'WARNING';
                message = `Высокая загрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`;
            }

            // Если алерт не нужен (load below overload threshold).
            if (!alertType) {
                if (verifyMode) {
                    // Recovered — fresh load is back under threshold. Checked, no reopen.
                    return { checked: true, alert: null };
                }
                this.lastChecks.set(checkKey, now);
                return null;
            }

            // Создаем алерт
            const alertData = {
                type: alertType,
                infrastructure_id: transformerId,
                infrastructure_type: 'transformer',
                severity: severity,
                message: message,
                affected_buildings: loadData.buildings_count || 0,
                data: {
                    load_percent: loadPercent,
                    capacity_kva: loadData.capacity_kva,
                    active_controllers: loadData.active_controllers_count,
                    last_metric_time: loadData.last_metric_time,
                    threshold_used: alertType.includes('CRITICAL') ?
                        this.thresholds.transformer_critical :
                        this.thresholds.transformer_overload
                }
            };

            if (verifyMode) {
                // Snapshot rule once (TOCTOU) — missing/disabled → cannot evaluate.
                const AlertRule = require('../models/AlertRule');
                const rule = await AlertRule.findByTypeAndSeverity(alertType, severity);
                if (!rule) {
                    logger.debug(`verify ${alertType}/${severity} for transformer ${transformerId}: no/disabled rule — cannot evaluate`);
                    return { checked: false, alert: null };
                }
                this._applyReopenContext(alertData, opts.reopenContext);
                const created = await this.createAlert(alertData, {
                    sinceTimestamp: opts.reopenContext.observationSince,
                    ruleSnapshot: rule
                });
                return { checked: true, alert: created };
            }

            // Проверяем, не создавали ли уже такой алерт (legacy auto-trigger).
            const alertKey = `transformer:${transformerId}:${alertType}`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`Алерт ${alertType} для трансформатора ${transformerId} уже активен`);
                return null;
            }

            const createdAlert = await this.createAlert(alertData);
            this.lastChecks.set(checkKey, now);

            return createdAlert;

        } catch (error) {
            logger.error(`Ошибка проверки трансформатора ${transformerId}:`, error);
            return verifyMode ? { checked: false, alert: null } : null;
        }
    }

    // [AUD-001 PR-B] Current transformer load from the LATEST metric per
    // controller (lateral latest-sample pattern, cf. 003_power_calculation_v2),
    // clamped to post-resolve telemetry — bypasses the 24h-averaged MV
    // (012_fix_materialized_view) and cache so a recovered transformer doesn't
    // falsely reopen on stale samples. Load formula mirrors the MV:
    // LEAST(100, AVG(total_amperage) * 0.4 / power_kva * 100). Returns null when
    // no controller has a post-resolve sample. Keep this formula in sync with
    // 012_fix_materialized_view.sql / 003_power_calculation_v2.sql.
    async _getTransformerLoadSince(transformerId, observationSince) {
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

    // [B-005 / 2026-05-25] LEAK auto-trigger from telemetry.
    //
    // Called via alertEvents.LEAK_CHECK when metricService.createMetric
    // persists a row with leak_sensor=true. Mirrors checkTransformerLoad
    // contract: cooldown + dedup + delegate to createAlert (which runs the
    // persistence-gate SQL aggregation: ≥2 samples spanning ≥minSeconds).
    //
    // Severity is hardcoded CRITICAL for v1 — a real basement leak is
    // critical by definition. The persistence gate already filters
    // single-blip noise (10s window for CRITICAL rule, 600s lookback).
    // Operators can fine-tune via alert_rules.* (Sprint 10 PR-5 admin UI).
    async checkLeak(controllerId, opts = {}) {
        await this.ensureInitialized();

        // [AUD-001 PR-B] Verify mode: invoked from a VERIFY_LEAK event after a
        // resolve. Bypass cooldown + in-memory dedup, evaluate ONLY fresh
        // post-resolve telemetry, return a structured {checked, alert} result.
        const verifyMode = !!opts.reopenContext;
        const checkKey = `controller:${controllerId}:leak_check`;
        const now = Date.now();

        // Cooldown — avoid CPU thrashing when telemetry comes every few seconds.
        // Dedup index in DB already prevents duplicate active alerts; this is
        // purely an optimization for the hot path (createAlert + persistence
        // SQL query) before we even hit the DB-level guard.
        if (!opts.bypassCooldown && this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return verifyMode ? { checked: false, alert: null } : null;
            }
        }

        try {
            if (verifyMode) {
                return await this._runVerify({
                    profile: 'leak',
                    controllerId,
                    observationSince: opts.reopenContext.observationSince,
                    type: 'LEAK_DETECTED',
                    resolveSeverity: 'CRITICAL',
                    buildAlertData: () => this._buildLeakAlertData(controllerId),
                    reopenContext: opts.reopenContext
                });
            }

            const alertData = this._buildLeakAlertData(controllerId);

            // In-memory dedup (fast path before DB) — legacy auto-trigger only.
            const alertKey = `controller:${controllerId}:LEAK_DETECTED`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`LEAK_DETECTED для контроллера ${controllerId} уже активен`);
                this.lastChecks.set(checkKey, now);
                return null;
            }

            // createAlert runs persistence-gate (SQL aggregation against
            // metrics.leak_sensor=true) + buildings-gate + DB dedup. Returns
            // null if any gate denies OR if dedup hit.
            //
            // Cooldown is bumped ONLY on successful creation. On gate-denied
            // (returned null because not enough samples in window yet) we
            // MUST keep re-checking on next telemetry — otherwise a
            // 15-minute cooldown would mask the threshold being met by
            // later samples. Sensor-spam protection comes from the
            // in-memory dedup check above (active alert ⇒ short return) +
            // the DB-level partial unique index inside createAlert.
            const createdAlert = await this.createAlert(alertData);
            if (createdAlert) {
                this.lastChecks.set(checkKey, now);
            }

            return createdAlert;
        } catch (error) {
            logger.error(`Ошибка checkLeak для контроллера ${controllerId}: ${error.message}`);
            return verifyMode ? { checked: false, alert: null } : null;
        }
    }

    // [AUD-001 PR-B] Canonical LEAK alertData (shared by legacy + verify paths).
    _buildLeakAlertData(controllerId) {
        return {
            type: 'LEAK_DETECTED',
            severity: 'CRITICAL',
            infrastructure_id: controllerId,
            infrastructure_type: 'controller',
            message: `Протечка в подвале — датчик контроллера ${controllerId} сработал. Уровень воды требует проверки.`,
            affected_buildings: 1,
            data: {
                source: 'auto_leak_check',
                controller_id: controllerId,
                detected_at: new Date().toISOString()
            }
        };
    }

    // [AUD-001 PR-B] Merge reopen-chain fields from a VERIFY payload's
    // reopenContext into alertData so createAlert persists the chain linkage
    // and emits ALERT_REOPENED.
    _applyReopenContext(alertData, ctx) {
        alertData.reopen_chain_id = ctx.chainId;
        alertData.reopen_sequence = ctx.sequence;
        alertData.previous_alert_id = ctx.previousAlertId;
        alertData.previous_uk_request_number = ctx.previousUkRequestNumber;
        return alertData;
    }

    // [AUD-001 PR-B] Shared verify-mode evaluator for the controller checkers
    // (leak/voltage/heating). Returns {checked, alert}:
    //   - freshness-probe: no fresh post-resolve sample → {checked:false}
    //     (silent sensor ≠ recovered); latest fresh sample healthy →
    //     {checked:true, alert:null} (recovered, no reopen)
    //   - rule snapshot read ONCE; missing/disabled → {checked:false}
    //   - else createAlert with {sinceTimestamp, ruleSnapshot}: the verify
    //     persistence-gate (continuous fault since last healthy) decides. Gate
    //     denial → null → {checked:true, alert:null}; pass → reopen alert.
    async _runVerify({ profile, controllerId, observationSince, type, resolveSeverity, buildAlertData, reopenContext }) {
        const latest = await this._latestProfileSampleAnomalous(profile, controllerId, observationSince);
        if (latest === null) {
            // No fresh post-resolve telemetry — cannot conclude.
            return { checked: false, alert: null };
        }
        if (latest === false) {
            // Latest fresh sample is healthy → fault recovered. Checked, no reopen.
            return { checked: true, alert: null };
        }

        // Resolve severity: fixed for leak/heating, dynamic (clamped classifier)
        // for voltage. A null classifier result means "recovered" → checked, no
        // reopen (the latest sample tripped the cheap probe but the windowed
        // classifier disagrees — treat as not-faulting).
        const severity = typeof resolveSeverity === 'function'
            ? await resolveSeverity()
            : resolveSeverity;
        if (!severity) {
            return { checked: true, alert: null };
        }

        // Snapshot the rule once (TOCTOU): a rule disabled between here and the
        // INSERT would otherwise make createAlert fail-open. Missing/disabled →
        // honest "cannot evaluate" (window-expired ⇒ skipped, not passed).
        const AlertRule = require('../models/AlertRule');
        const rule = await AlertRule.findByTypeAndSeverity(type, severity);
        if (!rule) {
            logger.debug(`verify ${type}/${severity} for ${controllerId}: no/disabled rule — cannot evaluate`);
            return { checked: false, alert: null };
        }

        const alertData = this._applyReopenContext(buildAlertData(severity), reopenContext);
        const created = await this.createAlert(alertData, {
            sinceTimestamp: observationSince,
            ruleSnapshot: rule
        });
        return { checked: true, alert: created };
    }

    // [AUD-001 PR-B] Freshness probe: the latest profile sample written AFTER
    // observationSince (= the resolve/enqueue moment). Returns:
    //   null  — no fresh sample (sensor silent since resolve)
    //   false — latest fresh sample is healthy (recovered)
    //   true  — latest fresh sample is anomalous (fault may still hold)
    // Per-profile predicate; voltage uses the warn band (any phase out).
    async _latestProfileSampleAnomalous(profile, controllerId, observationSince) {
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

    // [B-005 / Sprint 11] VOLTAGE auto-trigger. Mirrors checkLeak contract:
    // dedup → cooldown → createAlert (gate inside) → bump cooldown only on
    // success. Severity is determined dynamically:
    //   - any phase outside [crit_min, crit_max] OR ≥2 phases outside the
    //     warning band [warn_min, warn_max] → CRITICAL
    //   - otherwise any 1 phase outside [warn_min, warn_max] → WARNING
    //   - all three phases inside [warn_min, warn_max] (or all NULL) → no alert
    // Classification is done by _classifyVoltageSeverity which does a single
    // SQL aggregation over recent metrics (~600s lookback) so a single-blip
    // out-of-range reading doesn't escalate severity prematurely. The
    // per-rule persistence-gate inside createAlert then re-checks
    // min_persistence_seconds against samples spanning the right interval.
    async checkVoltage(controllerId, opts = {}) {
        await this.ensureInitialized();

        const verifyMode = !!opts.reopenContext;
        const checkKey = `controller:${controllerId}:voltage_check`;
        const now = Date.now();

        if (!opts.bypassCooldown && this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return verifyMode ? { checked: false, alert: null } : null;
            }
        }

        try {
            if (verifyMode) {
                // Severity is dynamic — classify on clamped post-resolve data.
                return await this._runVerify({
                    profile: 'voltage',
                    controllerId,
                    observationSince: opts.reopenContext.observationSince,
                    type: 'VOLTAGE_ANOMALY',
                    resolveSeverity: () => this._classifyVoltageSeverity(controllerId, opts.reopenContext.observationSince),
                    buildAlertData: (severity) => this._buildVoltageAlertData(controllerId, severity),
                    reopenContext: opts.reopenContext
                });
            }

            const severity = await this._classifyVoltageSeverity(controllerId);
            if (!severity) {
                // Voltage is currently within both warn and crit bands —
                // nothing to do. Do not bump cooldown so we can re-check
                // promptly when the next metric lands.
                return null;
            }

            // In-memory dedup — fast path before DB. The dedup key is per
            // alert-type, so a WARNING alert active doesn't block a later
            // CRITICAL alert (different key). createAlert's DB-level partial
            // unique index handles the deeper invariant.
            const alertKey = `controller:${controllerId}:VOLTAGE_ANOMALY`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`VOLTAGE_ANOMALY для контроллера ${controllerId} уже активен`);
                this.lastChecks.set(checkKey, now);
                return null;
            }

            const alertData = this._buildVoltageAlertData(controllerId, severity);

            const createdAlert = await this.createAlert(alertData);
            if (createdAlert) {
                this.lastChecks.set(checkKey, now);
            }
            return createdAlert;
        } catch (error) {
            logger.error(`Ошибка checkVoltage для контроллера ${controllerId}: ${error.message}`);
            return verifyMode ? { checked: false, alert: null } : null;
        }
    }

    // [AUD-001 PR-B] Canonical VOLTAGE alertData (shared by legacy + verify).
    _buildVoltageAlertData(controllerId, severity) {
        return {
            type: 'VOLTAGE_ANOMALY',
            severity,
            infrastructure_id: controllerId,
            infrastructure_type: 'controller',
            message: severity === 'CRITICAL'
                ? `Критическая аномалия напряжения на контроллере ${controllerId} — глубокая просадка или несколько фаз вне нормы.`
                : `Аномалия напряжения на контроллере ${controllerId} — одна из фаз вне допустимого диапазона.`,
            affected_buildings: 1,
            data: {
                source: 'auto_voltage_check',
                controller_id: controllerId,
                detected_at: new Date().toISOString(),
                classified_severity: severity
            }
        };
    }

    // [B-005 / Sprint 11] Classify the current voltage condition. Returns
    // 'CRITICAL', 'WARNING', or null. Looks back 600s — long enough to
    // catch a sustained fault but short enough to avoid stale data from
    // a previous incident. The actual persistence-gate (≥2 samples
    // spanning ≥ min_persistence_seconds) runs inside createAlert.
    // [AUD-001 PR-B] sinceTimestamp (verify mode) clamps the window to
    // post-resolve telemetry: timestamp > GREATEST(NOW() - 600s, observationSince).
    // Without it the 600s lookback would re-classify pre-resolve samples.
    async _classifyVoltageSeverity(controllerId, sinceTimestamp = null) {
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

    // [B-005 / Sprint 11] HEATING auto-trigger. Hot-water inlet temperature
    // below threshold (default 40°C) indicates heat-supply degradation:
    // heat substation failure, cold riser, or supply company outage.
    // Severity is hardcoded CRITICAL — there is no useful "mild" band;
    // either the substation delivers warm water or it doesn't. Operators
    // can tune via thresholds.heating.hot_water_in_critical.
    async checkHeating(controllerId, opts = {}) {
        await this.ensureInitialized();

        const verifyMode = !!opts.reopenContext;
        const checkKey = `controller:${controllerId}:heating_check`;
        const now = Date.now();

        if (!opts.bypassCooldown && this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return verifyMode ? { checked: false, alert: null } : null;
            }
        }

        try {
            if (verifyMode) {
                return await this._runVerify({
                    profile: 'heating',
                    controllerId,
                    observationSince: opts.reopenContext.observationSince,
                    type: 'HEATING_FAILURE',
                    resolveSeverity: 'CRITICAL',
                    buildAlertData: () => this._buildHeatingAlertData(controllerId),
                    reopenContext: opts.reopenContext
                });
            }

            // Cheap preliminary check — do we have any anomalous samples at
            // all in the lookback window? Saves a createAlert call (which
            // dereferences AlertRule + persistence-gate SQL) when telemetry
            // is normal. Persistence-gate inside createAlert still runs the
            // full ≥2 samples spanning ≥ minSeconds check.
            const hasAnomaly = await this._hasRecentHeatingAnomaly(controllerId);
            if (!hasAnomaly) {
                return null;
            }

            const alertKey = `controller:${controllerId}:HEATING_FAILURE`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`HEATING_FAILURE для контроллера ${controllerId} уже активен`);
                this.lastChecks.set(checkKey, now);
                return null;
            }

            const alertData = this._buildHeatingAlertData(controllerId);

            const createdAlert = await this.createAlert(alertData);
            if (createdAlert) {
                this.lastChecks.set(checkKey, now);
            }
            return createdAlert;
        } catch (error) {
            logger.error(`Ошибка checkHeating для контроллера ${controllerId}: ${error.message}`);
            return verifyMode ? { checked: false, alert: null } : null;
        }
    }

    // [AUD-001 PR-B] Canonical HEATING alertData (shared by legacy + verify).
    _buildHeatingAlertData(controllerId) {
        return {
            type: 'HEATING_FAILURE',
            severity: 'CRITICAL',
            infrastructure_id: controllerId,
            infrastructure_type: 'controller',
            message: `Отказ теплоснабжения — температура ГВС на контроллере ${controllerId} ниже допустимой.`,
            affected_buildings: 1,
            data: {
                source: 'auto_heating_check',
                controller_id: controllerId,
                detected_at: new Date().toISOString()
            }
        };
    }

    // [B-005 / Sprint 11] Quick predicate — is there at least one sub-
    // threshold hot_water_in_temp reading in the recent window? Used by
    // checkHeating to short-circuit on healthy controllers.
    async _hasRecentHeatingAnomaly(controllerId) {
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
    async _checkPersistenceGate(alertData, rule, sinceTimestamp = null) {
        const minSeconds = rule.min_persistence_seconds;
        if (!minSeconds || minSeconds <= 0) {
            return { allowed: true, reason: 'persistence disabled (min=0)' };
        }

        // [AUD-001 PR-B] Verify mode: the fault must HOLD NOW, measured only on
        // post-resolve telemetry. Count the fault as continuous from the first
        // anomalous sample AFTER the last healthy one (silence is not fault
        // time), require ≥2 anomalous samples and span ≥ minSeconds.
        if (sinceTimestamp) {
            return await this._checkVerifyPersistenceGate(alertData, rule, sinceTimestamp);
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
    async _checkVerifyPersistenceGate(alertData, rule, sinceTimestamp) {
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
            return this._evaluateVerifyFaultWindow('LEAK', result.rows[0], minSeconds);
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
            return this._evaluateVerifyFaultWindow('HEATING', result.rows[0], minSeconds);
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
            return this._evaluateVerifyFaultWindow(`VOLTAGE/${severity}`, result.rows[0], minSeconds);
        }

        // Fail-open for unsupported type/infra combinations (TRANSFORMER_*
        // measured separately via _getTransformerLoadSince in verify mode).
        return { allowed: true, reason: `verify persistence not enforced for ${type}/${infrastructure_type}` };
    }

    // [AUD-001 PR-B] Shared decision for the continuous-fault window: ≥2
    // anomalous samples spanning ≥ minSeconds since faultStart.
    _evaluateVerifyFaultWindow(label, row, minSeconds) {
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
    async _checkAffectedBuildingsGate(alertData, rule) {
        const minBuildings = rule.min_affected_buildings;
        if (!minBuildings || minBuildings <= 1) {
            return { allowed: true, reason: 'buildings gate default (min=1)' };
        }

        const alertForwarder = require('./uk/alertForwarder');
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

    // Создание нового алерта.
    //
    // [Sprint 10 PR-1] options.bypassGates=true skips persistence + buildings
    // gates. Manual POST /api/alerts/ from operator passes this — the operator
    // explicitly chose to escalate. Auto-emitters (checkTransformerLoad,
    // future leak-checker) leave it false so gates apply.
    async createAlert(alertData, options = {}) {
        await this.ensureInitialized();

        // [Sprint 10 PR-1] Gate evaluation BEFORE INSERT. If a matching
        // AlertRule defines persistence / buildings thresholds and the data
        // doesn't satisfy them, skip alert creation entirely (returns null —
        // same as DB dedup hit, so callers handle uniformly).
        if (!options.bypassGates) {
            // [AUD-001 PR-B] In verify mode the checker already snapshotted the
            // rule (TOCTOU-safe) and passes it as options.ruleSnapshot — use it
            // instead of re-reading (a re-read could see a just-disabled rule →
            // null → fail-open INSERT between check and insert).
            const AlertRule = require('../models/AlertRule');
            const rule = options.ruleSnapshot
                || await AlertRule.findByTypeAndSeverity(alertData.type, alertData.severity);
            if (rule) {
                // sinceTimestamp (verify mode) clamps the persistence gate to
                // post-resolve telemetry and switches it to continuous-fault
                // semantics. Null in the legacy path → existing behavior.
                const persistenceCheck = await this._checkPersistenceGate(alertData, rule, options.sinceTimestamp);
                if (!persistenceCheck.allowed) {
                    logger.info(
                        `Alert skipped by persistence gate: ${alertData.type}/${alertData.severity} ` +
                        `for ${alertData.infrastructure_type}:${alertData.infrastructure_id} — ${persistenceCheck.reason}`
                    );
                    return null;
                }
                const buildingsCheck = await this._checkAffectedBuildingsGate(alertData, rule);
                if (!buildingsCheck.allowed) {
                    logger.info(
                        `Alert skipped by buildings gate: ${alertData.type}/${alertData.severity} ` +
                        `for ${alertData.infrastructure_type}:${alertData.infrastructure_id} — ${buildingsCheck.reason}`
                    );
                    return null;
                }
            }
            // No matching rule → no gates apply (existing behavior preserved;
            // alert created but won't be forwarded to UK anyway).
        }

        return await this.dbBreaker.execute(async () => {
            // [Sprint 10 PR-3] Reopen fields — when present, the alert is
            // part of a verification chain. Persisted alongside the row;
            // post-INSERT, an ALERT_REOPENED event lets the verifier mark
            // its pending row as 'reopened' with this new alert_id.
            const isReopen = !!alertData.reopen_chain_id;
            const reopenChainId = alertData.reopen_chain_id || null;
            const reopenSequence = alertData.reopen_sequence || 1;
            const previousAlertId = alertData.previous_alert_id || null;
            const previousUkRequestNumber = alertData.previous_uk_request_number || null;

            const query = `
                INSERT INTO infrastructure_alerts
                (type, infrastructure_id, infrastructure_type, severity, message,
                 affected_buildings, data, status,
                 reopen_chain_id, reopen_sequence, previous_alert_id, previous_uk_request_number,
                 created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11, NOW())
                RETURNING alert_id, created_at
            `;

            const values = [
                alertData.type,
                alertData.infrastructure_id,
                alertData.infrastructure_type,
                alertData.severity,
                alertData.message,
                alertData.affected_buildings || 0,
                JSON.stringify(alertData.data),
                reopenChainId,
                reopenSequence,
                previousAlertId,
                previousUkRequestNumber
            ];

            // Phase 4.1 (ARCH-106): DB-level dedup via partial UNIQUE index
            // idx_active_alert_dedup. Catch the UNIQUE violation and return
            // null instead of throwing — caller treats it as "already active".
            let result;
            try {
                result = await db.query(query, values);
            } catch (err) {
                if (err.code === '23505') {
                    logger.info(
                        `Duplicate alert suppressed by DB (UNIQUE): ${alertData.type} for ${alertData.infrastructure_type}:${alertData.infrastructure_id}`
                    );
                    return null;
                }
                throw err;
            }
            const alertId = result.rows[0].alert_id;
            const createdAt = result.rows[0].created_at;

            // Добавляем в активные алерты
            const alertKey = `${alertData.infrastructure_type}:${alertData.infrastructure_id}:${alertData.type}`;
            this.activeAlerts.set(alertKey, {
                alert_id: alertId,
                created_at: createdAt,
                severity: alertData.severity
            });

            // Отправляем уведомления
            await this.sendNotifications(alertData, alertId);

            // [Sprint 10 PR-3] If this is a reopen alert, emit ALERT_REOPENED
            // so alertVerificationService can mark its pending verification
            // row 'reopened' and link the new alert_id. Fire-and-forget;
            // listener handles its own failures.
            if (isReopen) {
                alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                    alertId,
                    reopenChainId,
                    reopenSequence,
                    previousAlertId
                });
            }

            // Логируем создание алерта
            const reopenLog = isReopen ? ` (reopen chain=${reopenChainId} seq=${reopenSequence})` : '';
            logger.info(`Создан алерт ${alertData.type} для ${alertData.infrastructure_type} ${alertData.infrastructure_id}, severity: ${alertData.severity}${reopenLog}`);

            return {
                alert_id: alertId,
                ...alertData,
                created_at: createdAt,
                status: 'active',
                reopen_chain_id: reopenChainId,
                reopen_sequence: reopenSequence,
                previous_alert_id: previousAlertId,
                previous_uk_request_number: previousUkRequestNumber
            };
        });
    }

    // Отправка уведомлений (базовая реализация)
    // Phase 4.4 (ARCH-112): per-channel try/catch + persist failures into
    // infrastructure_alerts.data.notification_failures for monitoring/retry.
    async sendNotifications(alertData, alertId) {
        const failures = [];

        // Критические алерты - немедленные уведомления
        if (alertData.severity === 'CRITICAL') {
            try {
                await this.sendImmediateNotification(alertData, alertId);
            } catch (notifError) {
                logger.error(`Alert ${alertId} immediate notification failed: ${notifError.message}`);
                failures.push({
                    channel: 'immediate',
                    error: notifError.message,
                    at: new Date().toISOString(),
                });
            }
        }

        // Phase 9.3 (YAGNI-010): the WebSocket broadcastAlert stub was
        // removed. Re-add a real channel through alertEvents here when
        // the WebSocket transport lands.

        // UK Integration: publish `alert.created` and let ukIntegrationService
        // (subscribed at module load) forward to UK. Failure-recording for
        // this channel now lives inside the listener (it appends its own
        // entry to infrastructure_alerts.data.notification_failures) so
        // alertService.sendNotifications stays fire-and-forget.
        alertEvents.emit(alertEvents.EVENTS.ALERT_CREATED, { alertData, alertId });

        // Persist failures so operators can see them in the alert detail view.
        // Best-effort — a failure here is logged but never re-thrown so the
        // caller's main flow (alert creation) is not affected.
        if (failures.length > 0) {
            try {
                await db.query(
                    `UPDATE infrastructure_alerts
                     SET data = jsonb_set(
                         COALESCE(data::jsonb, '{}'::jsonb),
                         '{notification_failures}',
                         $1::jsonb,
                         true
                     )
                     WHERE alert_id = $2`,
                    [JSON.stringify(failures), alertId]
                );
            } catch (updateError) {
                logger.error(
                    `Failed to record notification_failures for alert ${alertId}: ${updateError.message}`
                );
            }
        }
    }

    // Немедленные уведомления для критических алертов.
    // Phase 9.5: dropped emoji prefix to keep log aggregators happy (SEC-004).
    async sendImmediateNotification(alertData, alertId) {
        const notificationData = {
            alert_id: alertId,
            type: alertData.type,
            severity: alertData.severity,
            message: alertData.message,
            infrastructure: `${alertData.infrastructure_type}:${alertData.infrastructure_id}`,
            affected_buildings: alertData.affected_buildings,
            timestamp: new Date().toISOString(),
        };

        // Phase 9.3 (YAGNI-004): getCriticalAlertRecipients returned a
        // hardcoded `[{type:'log'}]` with no consumer. Removed — when
        // email/SMS/Telegram notification channels land, they should read
        // recipients from a users table or notification_preferences.
        logger.warn(`CRITICAL ALERT: ${alertData.message}`, notificationData);
    }

    // Подтверждение алерта
    async acknowledgeAlert(alertId, userId) {
        await this.ensureInitialized();

        return await this.dbBreaker.execute(async () => {
            const query = `
                UPDATE infrastructure_alerts
                SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
                WHERE alert_id = $1 AND status = 'active'
                RETURNING *
            `;

            const result = await db.query(query, [alertId, userId]);

            if (result.rows.length === 0) {
                throw new Error(`Алерт ${alertId} не найден или уже обработан`);
            }

            const alert = result.rows[0];

            // Удаляем из активных алертов
            const alertKey = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
            this.activeAlerts.delete(alertKey);

            logger.info(`Алерт ${alertId} подтвержден пользователем ${userId}`);

            return alert;
        });
    }

    // Закрытие алерта.
    //
    // [Sprint 10 PR-3] System-initiated resolve (userId === null) — typically
    // from UK_REQUEST_RESOLVED — transitions the alert through a verification
    // cycle before truly closing it: status='resolved_verifying' + enqueue
    // AlertVerification. After grace+window, the verifier checks if the
    // sensor still shows the fault; if yes → reopen with new alert_id;
    // if no → final resolve.
    //
    // Manual resolve (userId !== null) — operator clicked the close button —
    // skips verification (operator's judgement is canonical).
    //
    // The verification gate is per-rule (only types that have an AlertRule
    // with verification_grace_seconds > 0 enter the verifying state).
    // Alerts without a matching rule resolve directly as before.
    async resolveAlert(alertId, userId) {
        await this.ensureInitialized();

        return await this.dbBreaker.execute(async () => {
            // Read the alert first so we can decide whether to enter
            // resolved_verifying or resolve directly.
            const existing = await db.query(
                `SELECT alert_id, type, infrastructure_id, infrastructure_type,
                        severity, status, reopen_chain_id, reopen_sequence
                 FROM infrastructure_alerts
                 WHERE alert_id = $1 AND status IN ('active', 'acknowledged')`,
                [alertId]
            );
            if (existing.rows.length === 0) {
                throw new Error(`Алерт ${alertId} не найден или уже закрыт`);
            }
            const current = existing.rows[0];

            // System-initiated resolve + matching rule → verification cycle
            //
            // [hotfix 2026-05-24] Gate on ALERT_VERIFICATION_ENABLED env flag too.
            // alertVerificationService.start() is the only thing that ever clears
            // a resolved_verifying row (back to resolved or forward to reopened/
            // engineer_required). If the worker is dormant (flag false — Sprint
            // 10 default until CR-window flip), any alert that enters
            // resolved_verifying stays there forever. Without this gate the e2e
            // smoke alert 24 ("Течь в подвале") got stuck after UK closed
            // 260524-001 — the alert auto-resolved but couldn't transition past
            // verifying. The flag now controls both worker AND status-flip in
            // lockstep, which is what was originally intended in the plan
            // (D9 in tingly-munching-badger.md).
            const isSystemInitiated = userId === null || userId === undefined;
            const verificationEnabled = (process.env.ALERT_VERIFICATION_ENABLED || 'false')
                .toString().toLowerCase() === 'true';
            let useVerifyingState = false;
            let rule = null;

            if (isSystemInitiated && verificationEnabled) {
                const AlertRule = require('../models/AlertRule');
                rule = await AlertRule.findByTypeAndSeverity(current.type, current.severity);
                if (rule && rule.verification_grace_seconds > 0 && rule.verification_window_seconds > 0) {
                    useVerifyingState = true;
                }
            }

            // [B-021 PR3] Non-verifying resolve (operator/manual, or system
            // with no matching rule / grace 0 / flag off): single autocommit
            // UPDATE → resolved. Unchanged hot path — no lock/transaction.
            if (!useVerifyingState) {
                const updateResult = await db.query(
                    `UPDATE infrastructure_alerts
                     SET status = 'resolved', resolved_at = NOW(), resolved_by = $2
                     WHERE alert_id = $1 AND status IN ('active', 'acknowledged')
                     RETURNING *`,
                    [alertId, userId]
                );
                if (updateResult.rows.length === 0) {
                    // Race: someone else closed it between SELECT and UPDATE.
                    throw new Error(`Алерт ${alertId} не найден или уже закрыт`);
                }
                const alert = updateResult.rows[0];
                this.activeAlerts.delete(`${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`);
                logger.info(`Алерт ${alertId} закрыт ${isSystemInitiated ? 'системой (no rule)' : `пользователем ${userId}`}`);
                return alert;
            }

            // [B-021 PR3] System verifying path: serialise against the
            // verification drain (same advisory key) and make the
            // UPDATE→resolved_verifying + enqueue ATOMIC. Previously the enqueue
            // failure was swallowed ("don't fail the resolve") — which left the
            // alert in resolved_verifying with NO verification row to ever clear
            // it (a B-020-class orphan). Now a failed enqueue rolls back the
            // status flip, so the alert stays active and can be re-resolved.
            return await this._resolveVerifying(alertId, userId, current, rule);
        });
    }

    /**
     * [B-021 PR3] System-initiated verifying resolve under one checked-out
     * client: take the verification drain's advisory lock (blocking — we must
     * complete, unlike the worker which try-locks and skips), then
     * UPDATE→resolved_verifying + enqueue + chain/uk backfills in ONE
     * transaction. The lock serialises this against `_drainOne`/`_handleReopen`
     * on the same chain; the transaction guarantees no orphaned
     * resolved_verifying alert if the enqueue fails.
     */
    async _resolveVerifying(alertId, userId, current, rule) {
        const { randomUUID } = require('crypto');
        const AlertVerification = require('../models/AlertVerification');
        const AlertRequestMap = require('../models/AlertRequestMap');
        const { ADVISORY_LOCK_KEY } = require('./alertVerificationService');

        const chainId = current.reopen_chain_id || randomUUID();
        const nextSequence = (current.reopen_sequence || 1);
        const nowMs = Date.now();
        const runAt = new Date(nowMs + rule.verification_grace_seconds * 1000);
        const windowUntil = new Date(runAt.getTime() + rule.verification_window_seconds * 1000);

        // Previous UK request number — best-effort read BEFORE the transaction
        // (it's read-only context; a failure here must not abort the resolve).
        let previousUkRequestNumber = null;
        try {
            const mappings = await AlertRequestMap.findByAlertId(alertId);
            if (Array.isArray(mappings) && mappings.length > 0) {
                const withNumber = mappings.find((m) => m.uk_request_number);
                if (withNumber) previousUkRequestNumber = withNumber.uk_request_number;
            }
        } catch (e) {
            logger.debug(`resolveAlert: previous_uk_request_number lookup failed: ${e.message}`);
        }

        const client = await db.getPool().connect();
        let alert;
        try {
            // Blocking lock — the drain holds it only briefly (one row/tick).
            await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
            try {
                await client.query('BEGIN');
                try {
                    const updateResult = await client.query(
                        `UPDATE infrastructure_alerts
                         SET status = 'resolved_verifying', resolved_at = NOW(), resolved_by = $2
                         WHERE alert_id = $1 AND status IN ('active', 'acknowledged')
                         RETURNING *`,
                        [alertId, userId]
                    );
                    if (updateResult.rows.length === 0) {
                        // Race: someone else closed it between SELECT and UPDATE.
                        throw new Error(`Алерт ${alertId} не найден или уже закрыт`);
                    }
                    alert = updateResult.rows[0];

                    await AlertVerification.enqueue({
                        original_alert_id: alertId,
                        infrastructure_type: current.infrastructure_type,
                        infrastructure_id: current.infrastructure_id,
                        alert_type: current.type,
                        reopen_chain_id: chainId,
                        reopen_sequence: nextSequence,
                        run_at: runAt,
                        window_until: windowUntil
                    }, client);

                    if (!current.reopen_chain_id) {
                        await client.query(
                            'UPDATE infrastructure_alerts SET reopen_chain_id = $2 WHERE alert_id = $1',
                            [alertId, chainId]
                        );
                    }
                    if (previousUkRequestNumber) {
                        await client.query(
                            'UPDATE infrastructure_alerts SET previous_uk_request_number = $2 WHERE alert_id = $1',
                            [alertId, previousUkRequestNumber]
                        );
                    }
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK').catch((e) => {
                        logger.warn(`resolveAlert: ROLLBACK failed for alert ${alertId}: ${e.message}`);
                    });
                    throw err;
                }
            } finally {
                await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((e) => {
                    logger.warn(`resolveAlert: advisory_unlock failed for alert ${alertId}: ${e.message}`);
                });
            }
        } finally {
            client.release();
        }

        // Post-commit in-memory bookkeeping.
        this.activeAlerts.delete(`${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`);
        // Clear cooldown so the checker can re-evaluate after grace. [AUD-003]
        // Use the per-type suffix the checker keys on, not a hardcoded
        // ':load_check' (that only matched transformer alerts; controller types
        // stayed cooldown-masked). Unknown type → no key to clear (no-op).
        const cooldownSuffix = COOLDOWN_SUFFIX_BY_TYPE[current.type];
        if (cooldownSuffix) {
            this.lastChecks.delete(`${current.infrastructure_type}:${current.infrastructure_id}:${cooldownSuffix}`);
        }

        logger.info(
            `Алерт ${alertId} → resolved_verifying (chain ${chainId}, seq ${nextSequence}, ` +
            `grace ${rule.verification_grace_seconds}s, window ${rule.verification_window_seconds}s)`
        );
        return alert;
    }

    // [Sprint 10 PR-4] Получение одного алерта по alert_id (для suppress endpoint —
    // нужно знать {infra_type, infra_id, type} чтобы создать suppression).
    async getAlertById(alertId) {
        await this.ensureInitialized();
        const result = await db.query(
            `SELECT alert_id, type, infrastructure_id, infrastructure_type,
                    severity, message, status, created_at, resolved_at, resolved_by
             FROM infrastructure_alerts
             WHERE alert_id = $1`,
            [alertId]
        );
        return result.rows[0] || null;
    }

    // Получение активных алертов
    async getActiveAlerts(filters = {}, pagination = {}) {
        await this.ensureInitialized();

        const { page = 1, limit = 10, sort = 'created_at', order = 'desc' } = pagination;
        const offset = (page - 1) * limit;

        const conditions = [];
        const values = [];
        let paramIdx = 1;

        // [B-026] Default (no explicit status) must include BOTH 'active' and
        // 'acknowledged' — that's the set the dedup index (migration 027) treats
        // as "open". Defaulting to 'active' only meant an acknowledged alert
        // invisibly blocked new alerts (DB dedup hit) while being absent from
        // the operator's list. An explicit status filter still does exact match.
        if (filters.status) {
            conditions.push(`ia.status = $${paramIdx++}`);
            values.push(filters.status);
        } else {
            conditions.push(`ia.status IN ($${paramIdx++}, $${paramIdx++})`);
            values.push('active', 'acknowledged');
        }

        if (filters.severity) {
            conditions.push(`ia.severity = $${paramIdx++}`);
            values.push(filters.severity);
        }
        if (filters.infrastructure_type) {
            conditions.push(`ia.infrastructure_type = $${paramIdx++}`);
            values.push(filters.infrastructure_type);
        }

        const whereClause = conditions.join(' AND ');

        const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
        const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
        const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const countQuery = `
            SELECT COUNT(*) as total
            FROM infrastructure_alerts ia
            WHERE ${whereClause}
        `;
        const countResult = await db.query(countQuery, values);
        const total = parseInt(countResult.rows[0].total);

        // [B-001 / Sprint 11] uk_requests aggregation. LEFT JOIN against
        // alert_request_map + json_agg so the frontend gets the related UK
        // request numbers inline (one query instead of N+1 lazy fetches).
        // FILTER (WHERE arm.uk_request_number IS NOT NULL) keeps unsent /
        // pending mappings out of the array. COALESCE returns '[]'::json
        // when there are no rows so consumers can always Array.isArray it.
        // GROUP BY enumerates every non-aggregated column from the SELECT.
        // Postgres allows SELECT ia.* with GROUP BY ia.alert_id (primary key —
        // functional-dependency rule, since 9.1). This keeps the explicit
        // column list out of sync with the table schema as the model evolves.
        //
        // [SEC-7] The mappings sub-array is bounded to UK_REQUESTS_MAX_PER_ALERT
        // rows per alert via a LATERAL subquery with LIMIT *before* json_agg.
        // A mass/transformer outage can map thousands of buildings to a single
        // alert; without this cap an admin page-load would build an unbounded
        // JSON array per row → memory spike. The array is intentionally
        // truncated (most-recent first) rather than failing the request.
        const dataQuery = `
            SELECT
                ia.*,
                u1.username as acknowledged_by_name,
                u2.username as resolved_by_name,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'uk_request_number', arm.uk_request_number,
                            'building_external_id', arm.building_external_id,
                            'status', arm.status
                        )
                    ) FILTER (WHERE arm.uk_request_number IS NOT NULL),
                    '[]'::json
                ) AS uk_requests
            FROM infrastructure_alerts ia
            LEFT JOIN users u1 ON ia.acknowledged_by = u1.user_id
            LEFT JOIN users u2 ON ia.resolved_by = u2.user_id
            LEFT JOIN LATERAL (
                SELECT arm_inner.uk_request_number,
                       arm_inner.building_external_id,
                       arm_inner.status
                FROM alert_request_map arm_inner
                WHERE arm_inner.infrasafe_alert_id = ia.alert_id
                ORDER BY arm_inner.id DESC
                LIMIT ${UK_REQUESTS_MAX_PER_ALERT}
            ) arm ON true
            WHERE ${whereClause}
            GROUP BY ia.alert_id, u1.username, u2.username
            ORDER BY ia.${sortColumn} ${sortOrder}
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `;
        values.push(limit, offset);

        const result = await db.query(dataQuery, values);
        return { data: result.rows, total };
    }

    // PERF-002: Bounded concurrency replaces sequential for...of loop
    async checkAllTransformers() {
        await this.ensureInitialized();

        try {
            // Phase 7: analyticsService top-level required (no more cycle).
            const transformers = await analyticsService.getAllTransformersWithAnalytics();

            const CONCURRENCY = 5;
            const alerts = [];

            for (let i = 0; i < transformers.length; i += CONCURRENCY) {
                const batch = transformers.slice(i, i + CONCURRENCY);
                const results = await Promise.allSettled(
                    batch.map(t => this.checkTransformerLoad(t.id))
                );
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value) {
                        alerts.push(result.value);
                    } else if (result.status === 'rejected') {
                        logger.error(`Ошибка проверки трансформатора: ${result.reason?.message}`);
                    }
                }
            }

            logger.info(`Проверено ${transformers.length} трансформаторов, создано ${alerts.length} алертов`);

            return {
                checked: transformers.length,
                alerts_created: alerts.length,
                alerts: alerts
            };

        } catch (error) {
            logger.error('Ошибка массовой проверки трансформаторов:', error);
            throw error;
        }
    }

    // Получение статистики алертов
    async getAlertStatistics(days = 7) {
        await this.ensureInitialized();

        const safeDays = Math.max(1, Math.min(365, parseInt(days, 10) || 7));

        const query = `
            SELECT
                severity,
                infrastructure_type,
                status,
                COUNT(*) as count,
                DATE(created_at) as date
            FROM infrastructure_alerts
            WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            GROUP BY severity, infrastructure_type, status, DATE(created_at)
            ORDER BY date DESC, severity, infrastructure_type
        `;

        const result = await db.query(query, [safeDays]);

        return {
            period_days: safeDays,
            statistics: result.rows,
            active_alerts_count: this.activeAlerts.size
        };
    }

    // Обновление порогов алертов
    updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        logger.info('Обновлены пороги алертов:', newThresholds);
    }

    // Получение текущих порогов
    getThresholds() {
        return { ...this.thresholds };
    }

    // Статус сервиса алертов
    getStatus() {
        return {
            active_alerts: this.activeAlerts.size,
            last_checks: this.lastChecks.size,
            cooldown_minutes: this.alertCooldown,
            thresholds: this.thresholds,
            circuit_breaker_state: this.dbBreaker.getState()
        };
    }
}

const singleton = new InfrastructureAlertService();

// Phase 7 event subscriptions — registered once at module load.
// These replace former inbound require() calls from analyticsService /
// ukIntegrationService.
alertEvents.on(alertEvents.EVENTS.TRANSFORMER_CHECK, (payload) => {
    const { transformerId } = payload || {};
    if (transformerId == null) return;
    // Mirror the old fire-and-forget contract: background check, do not
    // block the emitter. Errors are logged inside checkTransformerLoad.
    Promise.resolve()
        .then(() => singleton.checkTransformerLoad(transformerId))
        .catch(err => logger.error(
            `alertEvents transformer.check handler: ${err.message}`
        ));
});

// [B-005 / 2026-05-25] LEAK auto-trigger from telemetry. metricService
// emits LEAK_CHECK after persisting a metric with leak_sensor=true.
alertEvents.on(alertEvents.EVENTS.LEAK_CHECK, (payload) => {
    const { controllerId } = payload || {};
    if (controllerId == null) return;
    Promise.resolve()
        .then(() => singleton.checkLeak(controllerId))
        .catch(err => logger.error(
            `alertEvents leak.check handler: ${err.message}`
        ));
});

// [B-005 / Sprint 11] VOLTAGE + HEATING auto-trigger listeners.
// metricService emits these after persisting a metric carrying the
// relevant non-null columns (electricity_ph* for voltage, hot_water_in_temp
// for heating). Listener runs persistence-gated SQL aggregation inside
// alertService.checkVoltage / checkHeating; cooldown bumped only on
// successful createAlert (mirror checkLeak invariant — see e15436f).
alertEvents.on(alertEvents.EVENTS.VOLTAGE_CHECK, (payload) => {
    const { controllerId } = payload || {};
    if (controllerId == null) return;
    Promise.resolve()
        .then(() => singleton.checkVoltage(controllerId))
        .catch(err => logger.error(
            `alertEvents voltage.check handler: ${err.message}`
        ));
});

alertEvents.on(alertEvents.EVENTS.HEATING_CHECK, (payload) => {
    const { controllerId } = payload || {};
    if (controllerId == null) return;
    Promise.resolve()
        .then(() => singleton.checkHeating(controllerId))
        .catch(err => logger.error(
            `alertEvents heating.check handler: ${err.message}`
        ));
});

alertEvents.on(alertEvents.EVENTS.UK_REQUEST_RESOLVED, (payload) => {
    const { alertId } = payload || {};
    if (alertId == null) return;
    singleton.resolveAlert(alertId, null)
        .then(() => logger.info(
            `alertEvents uk.request.resolved: auto-resolved alert ${alertId}`
        ))
        .catch(err => logger.error(
            `alertEvents uk.request.resolved handler: failed to resolve alert ${alertId}: ${err.message}`
        ));
});

// [AUD-001 PR-B] VERIFY_* listeners — the missing link that made the entire
// Sprint-10 verification/reopen subsystem dead in production. alertVerification
// Service emits VERIFY_<TYPE> after grace; until now NOTHING subscribed, so no
// checker ever ran in verify mode, no reopen_chain_id ever reached createAlert,
// and every verification ended passed/skipped. These listeners run the matching
// checker in verify mode and, when it actually evaluated the fault on fresh data
// (result.checked === true), ack the verification via markChecked so the
// window-expired branch can mark it 'passed' (not 'skipped').
const VERIFY_LISTENER_MAP = [
    [alertEvents.EVENTS.VERIFY_TRANSFORMER, 'checkTransformerLoad'],
    [alertEvents.EVENTS.VERIFY_LEAK,        'checkLeak'],
    [alertEvents.EVENTS.VERIFY_VOLTAGE,     'checkVoltage'],
    [alertEvents.EVENTS.VERIFY_HEATING,     'checkHeating'],
];
for (const [event, method] of VERIFY_LISTENER_MAP) {
    alertEvents.on(event, (payload) => {
        const p = payload || {};
        // Need a target + a chain to attach the reopen to. Missing either →
        // nothing actionable (logged once at debug to avoid noise).
        if (p.infraId == null || !p.reopenChainId) {
            logger.debug(`alertEvents ${event}: missing infraId/reopenChainId — skipped`);
            return;
        }
        Promise.resolve()
            .then(() => singleton[method](p.infraId, {
                bypassCooldown: true,
                reopenContext: {
                    chainId: p.reopenChainId,
                    sequence: p.reopenSequence,
                    previousAlertId: p.originalAlertId,
                    previousUkRequestNumber: p.previousUkRequestNumber,
                    observationSince: p.observationSince
                }
            }))
            .then((result) => {
                // Ack ONLY when the checker really evaluated the condition on
                // fresh data. {checked:false} (no fresh telemetry / DB error /
                // disabled rule) must NOT ack → window-expired ⇒ skipped.
                if (result && result.checked === true && p.verificationId != null) {
                    const AlertVerification = require('../models/AlertVerification');
                    return AlertVerification.markChecked(p.verificationId);
                }
            })
            .catch(err => logger.error(`alertEvents ${event} handler: ${err.message}`));
    });
}

// [AUD-003] Expose the suffix map for the drift guard test (read-only).
singleton.COOLDOWN_SUFFIX_BY_TYPE = COOLDOWN_SUFFIX_BY_TYPE;

module.exports = singleton;