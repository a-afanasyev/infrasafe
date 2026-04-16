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
    }),
});
