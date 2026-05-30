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
    async checkTransformerLoad(transformerId) {
        await this.ensureInitialized();

        const checkKey = `transformer:${transformerId}:load_check`;
        const now = Date.now();

        // Проверяем cooldown
        if (this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return null; // Слишком рано для повторной проверки
            }
        }

        try {
            // Phase 7: analyticsService now top-level required (no cycle).
            const loadData = await analyticsService.getTransformerLoad(transformerId);

            if (!loadData || typeof loadData.load_percent !== 'number') {
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

            // Если алерт не нужен, помечаем время проверки и выходим
            if (!alertType) {
                this.lastChecks.set(checkKey, now);
                return null;
            }

            // Проверяем, не создавали ли уже такой алерт
            const alertKey = `transformer:${transformerId}:${alertType}`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`Алерт ${alertType} для трансформатора ${transformerId} уже активен`);
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

            const createdAlert = await this.createAlert(alertData);
            this.lastChecks.set(checkKey, now);

            return createdAlert;

        } catch (error) {
            logger.error(`Ошибка проверки трансформатора ${transformerId}:`, error);
            return null;
        }
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
    async checkLeak(controllerId) {
        await this.ensureInitialized();

        const checkKey = `controller:${controllerId}:leak_check`;
        const now = Date.now();

        // Cooldown — avoid CPU thrashing when telemetry comes every few seconds.
        // Dedup index in DB already prevents duplicate active alerts; this is
        // purely an optimization for the hot path (createAlert + persistence
        // SQL query) before we even hit the DB-level guard.
        if (this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return null;
            }
        }

        try {
            // In-memory dedup (fast path before DB).
            const alertKey = `controller:${controllerId}:LEAK_DETECTED`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`LEAK_DETECTED для контроллера ${controllerId} уже активен`);
                this.lastChecks.set(checkKey, now);
                return null;
            }

            const alertData = {
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
            return null;
        }
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
    async checkVoltage(controllerId) {
        await this.ensureInitialized();

        const checkKey = `controller:${controllerId}:voltage_check`;
        const now = Date.now();

        if (this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return null;
            }
        }

        try {
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

            const alertData = {
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

            const createdAlert = await this.createAlert(alertData);
            if (createdAlert) {
                this.lastChecks.set(checkKey, now);
            }
            return createdAlert;
        } catch (error) {
            logger.error(`Ошибка checkVoltage для контроллера ${controllerId}: ${error.message}`);
            return null;
        }
    }

    // [B-005 / Sprint 11] Classify the current voltage condition. Returns
    // 'CRITICAL', 'WARNING', or null. Looks back 600s — long enough to
    // catch a sustained fault but short enough to avoid stale data from
    // a previous incident. The actual persistence-gate (≥2 samples
    // spanning ≥ min_persistence_seconds) runs inside createAlert.
    async _classifyVoltageSeverity(controllerId) {
        const { voltage } = sharedThresholds;
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
              AND timestamp >= NOW() - INTERVAL '600 seconds'`,
            [controllerId, voltage.warn_min, voltage.warn_max, voltage.crit_min, voltage.crit_max]
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
    async checkHeating(controllerId) {
        await this.ensureInitialized();

        const checkKey = `controller:${controllerId}:heating_check`;
        const now = Date.now();

        if (this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return null;
            }
        }

        try {
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

            const alertData = {
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

            const createdAlert = await this.createAlert(alertData);
            if (createdAlert) {
                this.lastChecks.set(checkKey, now);
            }
            return createdAlert;
        } catch (error) {
            logger.error(`Ошибка checkHeating для контроллера ${controllerId}: ${error.message}`);
            return null;
        }
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
    async _checkPersistenceGate(alertData, rule) {
        const minSeconds = rule.min_persistence_seconds;
        if (!minSeconds || minSeconds <= 0) {
            return { allowed: true, reason: 'persistence disabled (min=0)' };
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
            const AlertRule = require('../models/AlertRule');
            const rule = await AlertRule.findByTypeAndSeverity(alertData.type, alertData.severity);
            if (rule) {
                const persistenceCheck = await this._checkPersistenceGate(alertData, rule);
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

            // UPDATE with the chosen terminal status
            const newStatus = useVerifyingState ? 'resolved_verifying' : 'resolved';
            const updateResult = await db.query(
                `UPDATE infrastructure_alerts
                 SET status = $3, resolved_at = NOW(), resolved_by = $2
                 WHERE alert_id = $1 AND status IN ('active', 'acknowledged')
                 RETURNING *`,
                [alertId, userId, newStatus]
            );
            if (updateResult.rows.length === 0) {
                // Race: someone else closed it between SELECT and UPDATE.
                throw new Error(`Алерт ${alertId} не найден или уже закрыт`);
            }
            const alert = updateResult.rows[0];

            // Drop from in-memory active map regardless of branch.
            const alertKey = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
            this.activeAlerts.delete(alertKey);

            if (useVerifyingState) {
                // Enqueue verification + clear cooldown so a future check
                // isn't suppressed by the stale lastChecks timestamp from
                // the original alert generation.
                const { randomUUID } = require('crypto');
                const AlertVerification = require('../models/AlertVerification');
                const AlertRequestMap = require('../models/AlertRequestMap');

                const chainId = current.reopen_chain_id || randomUUID();
                const nextSequence = (current.reopen_sequence || 1);
                const nowMs = Date.now();
                const runAt = new Date(nowMs + rule.verification_grace_seconds * 1000);
                const windowUntil = new Date(runAt.getTime() + rule.verification_window_seconds * 1000);

                // Look up the previous UK request number (best-effort —
                // verifier passes this to alertForwarder for related_request_number
                // in the reopen payload).
                let previousUkRequestNumber = null;
                try {
                    const mappings = await AlertRequestMap.findByAlertId(alertId);
                    if (Array.isArray(mappings) && mappings.length > 0) {
                        // Pick the first mapping with a non-null uk_request_number
                        // (multi-building alerts have one row per building; any of
                        // them is a valid "related" reference for the reopen).
                        const withNumber = mappings.find((m) => m.uk_request_number);
                        if (withNumber) previousUkRequestNumber = withNumber.uk_request_number;
                    }
                } catch (e) {
                    logger.debug(`resolveAlert: previous_uk_request_number lookup failed: ${e.message}`);
                }

                try {
                    await AlertVerification.enqueue({
                        original_alert_id: alertId,
                        infrastructure_type: current.infrastructure_type,
                        infrastructure_id: current.infrastructure_id,
                        alert_type: current.type,
                        reopen_chain_id: chainId,
                        reopen_sequence: nextSequence,
                        run_at: runAt,
                        window_until: windowUntil
                    });
                    // Backfill chain_id on the alert if it didn't have one
                    if (!current.reopen_chain_id) {
                        await db.query(
                            'UPDATE infrastructure_alerts SET reopen_chain_id = $2 WHERE alert_id = $1',
                            [alertId, chainId]
                        );
                    }
                } catch (e) {
                    logger.warn(`resolveAlert: AlertVerification.enqueue failed for alert ${alertId}: ${e.message}`);
                    // Don't fail the resolve — alert is still in resolved_verifying;
                    // operator can manually re-resolve if needed.
                }

                // Clear cooldown so checker can re-evaluate after grace.
                this.lastChecks.delete(`${current.infrastructure_type}:${current.infrastructure_id}:load_check`);

                // Store previousUkRequestNumber on the alert row for the
                // future reopen alert to inherit (queried by the checker).
                if (previousUkRequestNumber) {
                    await db.query(
                        'UPDATE infrastructure_alerts SET previous_uk_request_number = $2 WHERE alert_id = $1',
                        [alertId, previousUkRequestNumber]
                    );
                }

                logger.info(
                    `Алерт ${alertId} → resolved_verifying (chain ${chainId}, seq ${nextSequence}, ` +
                    `grace ${rule.verification_grace_seconds}s, window ${rule.verification_window_seconds}s)`
                );
            } else {
                logger.info(`Алерт ${alertId} закрыт ${isSystemInitiated ? 'системой (no rule)' : `пользователем ${userId}`}`);
            }

            return alert;
        });
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

        conditions.push(`ia.status = $${paramIdx++}`);
        values.push(filters.status || 'active');

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

module.exports = singleton;