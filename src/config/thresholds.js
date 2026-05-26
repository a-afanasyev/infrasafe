/**
 * Infrastructure monitoring thresholds — single source of truth.
 * Phase 4.2 (KISS-008): consolidates duplicated constants previously
 * defined in alertService.js (transformer_overload=85) and
 * analyticsService.js (transformer_overload=80).
 *
 * Both services now import from this module so a threshold change
 * in one place propagates everywhere.
 *
 * Metric-level validation ranges (voltage / amperage / temperature /
 * humidity) live in metricService.js because they are a different
 * concept (per-reading bounds vs infrastructure load %).
 */

module.exports = Object.freeze({
    transformer: Object.freeze({
        overload: 85,       // % load — WARNING alert (transformer_overload)
        critical: 95,       // % load — CRITICAL alert (transformer_critical)
    }),
    water: Object.freeze({
        pressure_low: 2.0,      // bar — WARNING (water_pressure_low)
        pressure_critical: 1.5, // bar — CRITICAL (water_pressure_critical)
    }),
    heating: Object.freeze({
        temp_delta_low: 15,      // °C delta — WARNING (heating_temp_delta_low)
        temp_delta_critical: 10, // °C delta — CRITICAL (heating_temp_delta_critical)
        // [B-005-HEATING / Sprint 11] Hot-water inlet temperature gate for
        // HEATING_FAILURE auto-trigger. Below 40°C — heat-supply has degraded
        // (heat substation fail / cold riser); apartments cool down within
        // 10-30 min. Operators can tune via this constant; persistence-gate
        // (alert_rules.min_persistence_seconds=10s for CRITICAL) filters
        // single-blip noise. Seasonal/time-of-day modes — Sprint 12.
        hot_water_in_critical: 40,
    }),
    // [B-005-VOLTAGE / Sprint 11] Phase voltage gates for VOLTAGE_ANOMALY
    // auto-trigger. ГОСТ ±10% from 220V nominal → [198, 242]; any phase
    // outside that range triggers WARNING. Deep brownout/spike — outside
    // [180, 260] OR 2+ phases simultaneously outside warning range —
    // triggers CRITICAL. Three-phase asymmetry (typical РУ-0.4кВ fault)
    // is the dominant failure mode we want to catch early.
    voltage: Object.freeze({
        warn_min: 198,
        warn_max: 242,
        crit_min: 180,
        crit_max: 260,
    }),
});
