/**
 * [A-08] Классификация состояния здания для карты.
 *
 * Вынесено из `public/script.js`, где эта логика жила внутри обработчика
 * рендера маркеров. Причина не косметическая: API отдаёт `has_hot_water`, а
 * карта читала `item.hot_water` — поля с таким именем в DTO нет, поэтому
 * `item.hot_water !== true` было истинно всегда, ГВС считалась исправной при
 * любых давлениях, а ветка `critical` по ней не срабатывала никогда. Такая
 * подмена имени поля не видна ни линтеру, ни ревью, и живёт ровно там, где
 * логика недоступна тестам: `script.js` — 2263 строки вне покрытия.
 *
 * `has_hot_water` — единственная живая колонка (её пишет `Building.create` /
 * `update`, редактирует админка, отдаёт `buildingMetricsService`). Legacy
 * `hot_water` в таблице есть, но не пишется ничем и на проде NULL у всех
 * зданий, поэтому здесь он не читается СОЗНАТЕЛЬНО: поддержка обоих имён
 * сохранила бы ровно ту двусмысленность, из-за которой дефект и возник.
 *
 * Пороговые значения перенесены как есть — это фиксация поведения, а не его
 * пересмотр.
 *
 * Экспортируется и как браузерный глобал (esbuild с bundle:false сохраняет
 * глобалы), и как CommonJS-модуль для юнит-тестов.
 */
(function (root) {
    'use strict';

    // Окно «нормального» фазного напряжения на карте. Совпадает с прежними
    // литералами в script.js; пороги алертов живут отдельно в alertService.
    const PHASE_MIN = 200;
    const PHASE_MAX = 240;

    // Давление ХВС: строго больше 1 — прежнее поведение.
    const COLD_WATER_MIN = 1;

    // Давления ГВС: не ниже 1 на входе И на выходе.
    const HOT_WATER_MIN = 1;

    const isPhaseOk = (value) => value > PHASE_MIN && value < PHASE_MAX;

    /** Телеметрия вообще пришла? Анонимная выдача не содержит метрик. */
    function hasMetrics(item) {
        return item.electricity_ph1 !== undefined && item.electricity_ph1 !== null;
    }

    /** ГВС подключена к дому (то, что редактируется в админке). */
    function hasHotWater(item) {
        return item.has_hot_water === true;
    }

    function isElectricityOk(item) {
        return isPhaseOk(item.electricity_ph1)
            && isPhaseOk(item.electricity_ph2)
            && isPhaseOk(item.electricity_ph3);
    }

    function isColdWaterOk(item) {
        return Boolean(item.cold_water_pressure && item.cold_water_pressure > COLD_WATER_MIN);
    }

    /**
     * ГВС исправна. Дом без подключённой ГВС считается исправным: у него нет
     * контура, за которым следить.
     */
    function isHotWaterOk(item) {
        if (!hasHotWater(item)) return true;
        return Boolean(
            item.hot_water_in_pressure && item.hot_water_out_pressure
            && item.hot_water_in_pressure >= HOT_WATER_MIN
            && item.hot_water_out_pressure >= HOT_WATER_MIN
        );
    }

    /** Питание пропало целиком (все три фазы на нуле или отсутствуют). */
    function isPowerDown(item) {
        return (!item.electricity_ph1 || item.electricity_ph1 <= 0)
            && (!item.electricity_ph2 || item.electricity_ph2 <= 0)
            && (!item.electricity_ph3 || item.electricity_ph3 <= 0);
    }

    /** ГВС подключена, но давления нет ни на входе, ни на выходе. */
    function isHotWaterDown(item) {
        return hasHotWater(item)
            && (!item.hot_water_in_pressure || item.hot_water_in_pressure <= 0)
            && (!item.hot_water_out_pressure || item.hot_water_out_pressure <= 0);
    }

    /** Хоть какие-то признаки жизни по всем контурам. */
    function isPartiallyAlive(item) {
        const anyPhase = item.electricity_ph1 > 0 || item.electricity_ph2 > 0 || item.electricity_ph3 > 0;
        const coldAlive = Boolean(item.cold_water_pressure && item.cold_water_pressure > 0);
        const hotAlive = !hasHotWater(item)
            || Boolean(item.hot_water_in_pressure && item.hot_water_in_pressure > 0)
            || Boolean(item.hot_water_out_pressure && item.hot_water_out_pressure > 0);
        return anyPhase && coldAlive && hotAlive;
    }

    /**
     * Статус маркера: 'leak' | 'ok' | 'critical' | 'warning' | 'no' | 'public'.
     * Порядок веток сохранён — протечка перекрывает всё остальное.
     */
    function classifyStatus(item) {
        if (!hasMetrics(item)) {
            return item.has_controller ? 'public' : 'no';
        }
        if (item.leak_sensor === true) return 'leak';
        if (isElectricityOk(item) && isColdWaterOk(item) && isHotWaterOk(item)) return 'ok';

        const coldDown = !item.cold_water_pressure || item.cold_water_pressure <= 0;
        if (item.controller_id && (isPowerDown(item) || coldDown || isHotWaterDown(item))) {
            return 'critical';
        }
        if (item.controller_id && isPartiallyAlive(item)) return 'warning';
        return 'no';
    }

    const api = {
        hasMetrics,
        hasHotWater,
        isElectricityOk,
        isColdWaterOk,
        isHotWaterOk,
        classifyStatus,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.BuildingStatus = api;
    }
})(typeof window !== 'undefined' ? window : this);
