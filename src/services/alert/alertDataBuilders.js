'use strict';

const sharedThresholds = require('../../config/thresholds');

/**
 * [AUD-012] Pure alertData builders + reopen-context merge, extracted from
 * alertService.js (delegate-only split). No DB, no `this` — each function is a
 * deterministic transform. alertService keeps thin `this._buildX` delegators so
 * the existing direct-call tests (alertService._buildLeakAlertData(…)) still hit
 * the same surface.
 */

// [AUD-001 PR-B] Canonical LEAK alertData (shared by legacy + verify paths).
function buildLeakAlertData(controllerId) {
    return {
        type: 'LEAK_DETECTED',
        severity: 'CRITICAL',
        infrastructure_id: controllerId,
        infrastructure_type: 'controller',
        message: `Протечка в подвале — датчик контроллера ${controllerId} сработал. Уровень воды требует проверки.`,
        affected_buildings: 1,
        // [FE-119] LEAK is a boolean sensor → label-only per UK. No numeric
        // metric_value/normal_* (the payload helper nulls them); UK renders
        // just the label + device.
        infrastructure_label: `Контроллер №${controllerId}`,
        metric_id: 'leak_sensor',
        metric_label: 'Протечка',
        data: {
            source: 'auto_leak_check',
            controller_id: controllerId,
            detected_at: new Date().toISOString()
        }
    };
}

// [AUD-001 PR-B] Canonical VOLTAGE alertData (shared by legacy + verify).
// [FE-119 Phase 2] metricValue = the most-deviant out-of-band phase voltage
// (legacy path fetches it; the verify/reopen closure omits it → null).
function buildVoltageAlertData(controllerId, severity, metricValue = null) {
    const { voltage } = sharedThresholds;
    return {
        type: 'VOLTAGE_ANOMALY',
        severity,
        infrastructure_id: controllerId,
        infrastructure_type: 'controller',
        message: severity === 'CRITICAL'
            ? `Критическая аномалия напряжения на контроллере ${controllerId} — глубокая просадка или несколько фаз вне нормы.`
            : `Аномалия напряжения на контроллере ${controllerId} — одна из фаз вне допустимого диапазона.`,
        affected_buildings: 1,
        // [FE-119] metric/infrastructure context for the UK card.
        infrastructure_label: `Контроллер №${controllerId}`,
        metric_id: 'voltage',
        metric_label: 'Напряжение',
        metric_value: metricValue ?? null,
        metric_unit: 'В',
        metric_normal_min: voltage.warn_min,
        metric_normal_max: voltage.warn_max,
        data: {
            source: 'auto_voltage_check',
            controller_id: controllerId,
            detected_at: new Date().toISOString(),
            classified_severity: severity
        }
    };
}

// [AUD-001 PR-B] Canonical HEATING alertData (shared by legacy + verify).
// [FE-119] metricValue = the triggering ГВС temperature (the legacy path
// fetches it; the verify/reopen closure omits it → null, UK ignores null).
function buildHeatingAlertData(controllerId, metricValue = null) {
    const { heating } = sharedThresholds;
    return {
        type: 'HEATING_FAILURE',
        severity: 'CRITICAL',
        infrastructure_id: controllerId,
        infrastructure_type: 'controller',
        message: `Отказ теплоснабжения — температура ГВС на контроллере ${controllerId} ниже допустимой.`,
        affected_buildings: 1,
        // [FE-119] metric/infrastructure context for the UK card.
        infrastructure_label: `Контроллер №${controllerId}`,
        metric_id: 'hot_water_in_temp',
        metric_label: 'Температура ГВС',
        metric_value: metricValue ?? null,
        metric_unit: '°C',
        metric_normal_min: heating.hot_water_in_critical,
        metric_normal_max: null,
        data: {
            source: 'auto_heating_check',
            controller_id: controllerId,
            detected_at: new Date().toISOString()
        }
    };
}

// [AUD-001 PR-B] Merge reopen-chain fields from a VERIFY payload's
// reopenContext into alertData so createAlert persists the chain linkage
// and emits ALERT_REOPENED.
function applyReopenContext(alertData, ctx) {
    alertData.reopen_chain_id = ctx.chainId;
    alertData.reopen_sequence = ctx.sequence;
    alertData.previous_alert_id = ctx.previousAlertId;
    alertData.previous_uk_request_number = ctx.previousUkRequestNumber;
    return alertData;
}

module.exports = {
    buildLeakAlertData,
    buildVoltageAlertData,
    buildHeatingAlertData,
    applyReopenContext
};
