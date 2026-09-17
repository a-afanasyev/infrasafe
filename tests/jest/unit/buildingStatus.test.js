/**
 * [A-08] Классификация состояния здания на карте.
 *
 * Дефект: API отдаёт `has_hot_water` (`buildingMetricsService.js:97`), а карта
 * читала `item.hot_water` (`script.js:1622`). Поля с таким именем в DTO нет,
 * поэтому `item.hot_water !== true` истинно ВСЕГДА и `isHotWaterOK` тоже —
 * дом с подключённой ГВС и нулевыми давлениями отображался нормой, а ветка
 * `critical` по ГВС не срабатывала никогда.
 *
 * Логика вынесена из `script.js` сюда не ради чистоты: пока она жила внутри
 * обработчика рендера, проверить её было нечем — 2263 строки файла вне
 * покрытия, и именно в таком месте подмена имени поля живёт годами.
 *
 * `has_hot_water` — единственная живая колонка: её пишет `Building.create`,
 * редактирует админка, отдаёт API. Legacy `hot_water` в БД есть, но не
 * пишется ничем и на проде NULL у всех зданий.
 */

const {
    isElectricityOk,
    isColdWaterOk,
    isHotWaterOk,
    classifyStatus,
} = require('../../../public/utils/buildingStatus');

/** Здание с полной телеметрией и всем в норме. */
const healthy = (over = {}) => ({
    controller_id: 5,
    electricity_ph1: 220, electricity_ph2: 220, electricity_ph3: 220,
    cold_water_pressure: 3,
    has_hot_water: false,
    leak_sensor: false,
    ...over,
});

describe('[A-08] горячая вода читается из has_hot_water', () => {
    test('ГВС подключена, давления нулевые → НЕ норма', () => {
        // Сердцевина находки: раньше здесь получалось `true`, и дом с
        // неисправной ГВС светился зелёным.
        const item = healthy({ has_hot_water: true, hot_water_in_pressure: 0, hot_water_out_pressure: 0 });

        expect(isHotWaterOk(item)).toBe(false);
        expect(classifyStatus(item)).toBe('critical');
    });

    test('ГВС подключена и давления в норме → норма', () => {
        const item = healthy({ has_hot_water: true, hot_water_in_pressure: 2, hot_water_out_pressure: 1.5 });

        expect(isHotWaterOk(item)).toBe(true);
        expect(classifyStatus(item)).toBe('ok');
    });

    test('ГВС не подключена → давления не важны', () => {
        expect(isHotWaterOk(healthy({ has_hot_water: false }))).toBe(true);
        expect(classifyStatus(healthy({ has_hot_water: false }))).toBe('ok');
    });

    test('СТАРОЕ имя поля больше не влияет ни на что', () => {
        // Если кто-то вернёт чтение `hot_water`, эта проверка упадёт: здесь
        // ГВС подключена (has_hot_water), давления нулевые, а legacy-поле
        // говорит обратное.
        const item = healthy({
            has_hot_water: true, hot_water: false,
            hot_water_in_pressure: 0, hot_water_out_pressure: 0,
        });

        expect(isHotWaterOk(item)).toBe(false);
    });

    test('отсутствующее has_hot_water трактуется как «ГВС нет»', () => {
        // Колонка nullable с DEFAULT false — молчание не должно давать аварию.
        const item = healthy();
        delete item.has_hot_water;

        expect(isHotWaterOk(item)).toBe(true);
    });
});

describe('[A-08] электричество и холодная вода — поведение сохранено', () => {
    test('все три фазы в окне 200–240 → норма', () => {
        expect(isElectricityOk(healthy())).toBe(true);
    });

    test.each([
        ['одна фаза просела', { electricity_ph1: 170 }],
        ['одна фаза завышена', { electricity_ph2: 250 }],
        ['фазы нет вовсе', { electricity_ph3: 0 }],
    ])('%s → не норма', (_l, over) => {
        expect(isElectricityOk(healthy(over))).toBe(false);
    });

    test('давление ХВС должно быть строго больше 1', () => {
        expect(isColdWaterOk(healthy({ cold_water_pressure: 3 }))).toBe(true);
        expect(isColdWaterOk(healthy({ cold_water_pressure: 1 }))).toBe(false);
        expect(isColdWaterOk(healthy({ cold_water_pressure: 0 }))).toBe(false);
    });
});

describe('[A-08] приоритет статусов', () => {
    test('протечка перекрывает всё остальное', () => {
        expect(classifyStatus(healthy({ leak_sensor: true }))).toBe('leak');
    });

    test('полностью обесточенный дом → critical', () => {
        expect(classifyStatus(healthy({
            electricity_ph1: 0, electricity_ph2: 0, electricity_ph3: 0,
        }))).toBe('critical');
    });

    test('частичная авария при живом питании и ХВС → warning', () => {
        expect(classifyStatus(healthy({ electricity_ph1: 180 }))).toBe('warning');
    });

    test('анонимная выдача (метрик нет) → public либо no', () => {
        expect(classifyStatus({ has_controller: true })).toBe('public');
        expect(classifyStatus({ has_controller: false })).toBe('no');
    });
});
