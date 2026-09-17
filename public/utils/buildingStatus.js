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

    // [A-07] Порог, после которого показания перестают считаться текущими.
    // Ровно тот же, по которому контроллер помечается `offline`
    // (`controllerService.statusTimeout` = 10 минут). Расхождение дало бы окно,
    // в котором карта и статус контроллера противоречат друг другу.
    const STALE_AFTER_MS = 10 * 60 * 1000;

    // Поля, наличие любого из которых означает «телеметрия приходила».
    // Прежде признаком служило ОДНО поле — electricity_ph1, — поэтому пакет с
    // одним лишь датчиком протечки не доходил до классификации вовсе.
    const METRIC_FIELDS = [
        'electricity_ph1', 'electricity_ph2', 'electricity_ph3',
        'amperage_ph1', 'amperage_ph2', 'amperage_ph3',
        'cold_water_pressure', 'cold_water_temp',
        'hot_water_in_pressure', 'hot_water_out_pressure',
        'hot_water_in_temp', 'hot_water_out_temp',
        'air_temp', 'humidity', 'leak_sensor',
    ];

    // Контроллер считается сообщающим только в этом статусе. `offline` и
    // `maintenance` одинаково означают, что показания историчны.
    const REPORTING_STATUS = 'online';

    const isPhaseOk = (value) => value > PHASE_MIN && value < PHASE_MAX;

    /**
     * Телеметрия вообще приходила? Анонимная выдача метрик не содержит.
     *
     * [A-07] Считается по ЛЮБОМУ полю метрики и по наличию отметки времени
     * (её даёт LATERAL-join строки метрик). Прежняя проверка смотрела только на
     * `electricity_ph1`, и частичный пакет — например, сработавший датчик
     * протечки без фазных напряжений — классификацию не проходил.
     */
    function hasMetrics(item) {
        if (!item) return false;
        if (item.timestamp !== undefined && item.timestamp !== null) return true;
        return METRIC_FIELDS.some((field) => item[field] !== undefined && item[field] !== null);
    }

    /**
     * Возраст показаний в миллисекундах, или `null`, если отметки времени нет.
     * Возраст НЕ выдумывается: отсутствие отметки — это «неизвестно», а не ноль.
     */
    function dataAgeMs(item, now) {
        const raw = item && item.timestamp;
        if (raw === undefined || raw === null) return null;
        const ts = new Date(raw).getTime();
        if (Number.isNaN(ts)) return null;
        return (now === undefined || now === null ? Date.now() : now) - ts;
    }

    /**
     * Показаниям нельзя верить как текущим: они старше порога, контроллер не
     * сообщает, или отметки времени нет вовсе (судить не о чем, а объявлять
     * свежими нельзя).
     */
    function isStale(item, now) {
        if (!item) return true;
        const status = item.controller_status;
        if (status !== undefined && status !== null && status !== REPORTING_STATUS) return true;
        const age = dataAgeMs(item, now);
        if (age === null) return true;
        return age > STALE_AFTER_MS;
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
     * Статус маркера: 'leak' | 'ok' | 'critical' | 'warning' | 'stale' | 'no' |
     * 'public'.
     *
     * [A-07] Проверка актуальности идёт ПЕРЕД всеми оценками показаний — иначе
     * любая ветка ниже выдаёт суждение по числам, которым может быть три
     * месяца. Порядок остальных веток сохранён: протечка перекрывает всё
     * остальное среди СВЕЖИХ данных.
     *
     * @param {Object} item
     * @param {number} [now] — «сейчас» в миллисекундах (инжектируется в тестах)
     */
    function classifyStatus(item, now) {
        if (!hasMetrics(item)) {
            return item.has_controller ? 'public' : 'no';
        }
        if (isStale(item, now)) return 'stale';
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
        STALE_AFTER_MS,
        hasMetrics,
        dataAgeMs,
        isStale,
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
