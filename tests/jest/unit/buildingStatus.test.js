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
    isStale,
    dataAgeMs,
    STALE_AFTER_MS,
} = require('../../../public/utils/buildingStatus');

/** «Сейчас» для тестов: время инжектируется, чтобы не зависеть от часов. */
const NOW = Date.parse('2026-09-17T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString();

/** Здание с полной СВЕЖЕЙ телеметрией и всем в норме. */
const healthy = (over = {}) => ({
    controller_id: 5,
    controller_status: 'online',
    timestamp: minutesAgo(1),
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
        expect(classifyStatus(item, NOW)).toBe('critical');
    });

    test('ГВС подключена и давления в норме → норма', () => {
        const item = healthy({ has_hot_water: true, hot_water_in_pressure: 2, hot_water_out_pressure: 1.5 });

        expect(isHotWaterOk(item)).toBe(true);
        expect(classifyStatus(item, NOW)).toBe('ok');
    });

    test('ГВС не подключена → давления не важны', () => {
        expect(isHotWaterOk(healthy({ has_hot_water: false }))).toBe(true);
        expect(classifyStatus(healthy({ has_hot_water: false }), NOW)).toBe('ok');
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
        expect(classifyStatus(healthy({ leak_sensor: true }), NOW)).toBe('leak');
    });

    test('полностью обесточенный дом → critical', () => {
        expect(classifyStatus(healthy({
            electricity_ph1: 0, electricity_ph2: 0, electricity_ph3: 0,
        }), NOW)).toBe('critical');
    });

    test('частичная авария при живом питании и ХВС → warning', () => {
        expect(classifyStatus(healthy({ electricity_ph1: 180 }), NOW)).toBe('warning');
    });

    test('анонимная выдача (метрик нет) → public либо no', () => {
        expect(classifyStatus({ has_controller: true }, NOW)).toBe('public');
        expect(classifyStatus({ has_controller: false }, NOW)).toBe('no');
    });
});

// [A-07] Карта не отличала «данных нет» от «всё в норме».
//
// Проверено на боевых данных 17.09.2026 (infrasafe.uz): оба контроллера в
// статусе `offline`, последние метрики от 13 и 16 ИЮНЯ — 92 дня. При этом
// классификатор читал сохранённые числа как текущие, и карта показывала:
//   - «Yangi Olmazor 14V» — норму (220/220/220, давление 5) по июньским данным;
//   - «Yangi Olmazor 13V» — ПРОТЕЧКУ (leak_sensor=true от 16 июня) как
//     действующую аварию.
// То есть дефект бьёт в обе стороны: ложное спокойствие и ложная тревога.
//
// `controller_status` и `timestamp` API отдавал всегда — правда доезжала до
// браузера и игнорировалась.
describe('[A-07] устаревшая телеметрия не выдаётся за текущую', () => {
    test('свежие данные при работающем контроллере — как прежде', () => {
        expect(isStale(healthy(), NOW)).toBe(false);
        expect(classifyStatus(healthy(), NOW)).toBe('ok');
    });

    test('данные старше порога → stale, а не «норма»', () => {
        const item = healthy({ timestamp: minutesAgo(11) });

        expect(isStale(item, NOW)).toBe(true);
        expect(classifyStatus(item, NOW)).toBe('stale');
    });

    test('контроллер offline → stale, даже если данные свежие', () => {
        // Планировщик мог отметить контроллер раньше, чем истёк порог возраста.
        const item = healthy({ controller_status: 'offline' });

        expect(classifyStatus(item, NOW)).toBe('stale');
    });

    test('июньская ПРОТЕЧКА не показывается действующей аварией', () => {
        // Прямой снимок боевой строки: leak_sensor=true, контроллер offline.
        const item = healthy({
            leak_sensor: true,
            controller_status: 'offline',
            timestamp: new Date(NOW - 92 * 24 * 3600 * 1000).toISOString(),
        });

        expect(classifyStatus(item, NOW)).toBe('stale');
    });

    test('порог совпадает с тем, по которому контроллер считается offline', () => {
        // 10 минут — `controllerService.statusTimeout`. Расхождение дало бы
        // окно, где карта и статус контроллера противоречат друг другу.
        expect(STALE_AFTER_MS).toBe(10 * 60 * 1000);
        expect(isStale(healthy({ timestamp: minutesAgo(9) }), NOW)).toBe(false);
        expect(isStale(healthy({ timestamp: minutesAgo(10.5) }), NOW)).toBe(true);
    });

    test('без отметки времени возраст не выдумывается', () => {
        // Судить не о чем — но и объявлять данные свежими нельзя.
        const item = healthy({ timestamp: null });
        expect(dataAgeMs(item, NOW)).toBeNull();
        expect(isStale(item, NOW)).toBe(true);
    });

    test('возраст данных считается от отметки, а не от момента опроса', () => {
        expect(dataAgeMs(healthy({ timestamp: minutesAgo(30) }), NOW)).toBe(30 * 60 * 1000);
    });
});

describe('[A-07] частичная телеметрия доходит до классификации', () => {
    test('протечка без фазных напряжений — это ПРОТЕЧКА, а не «нет данных»', () => {
        // Прежний признак наличия метрик смотрел только на electricity_ph1,
        // поэтому пакет с одним лишь датчиком протечки выпадал в 'no'.
        const item = {
            controller_id: 5,
            controller_status: 'online',
            timestamp: minutesAgo(1),
            leak_sensor: true,
        };

        expect(classifyStatus(item, NOW)).toBe('leak');
    });

    test('строка без единой метрики по-прежнему «нет данных»', () => {
        expect(classifyStatus({ has_controller: false }, NOW)).toBe('no');
    });
});
