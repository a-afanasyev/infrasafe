/**
 * [N-32] Сезонный гейт считает дату по Ташкенту, а не по TZ процесса.
 *
 * Гейт брал «сегодня» через `getMonth()`/`getDate()`, то есть в часовом поясе
 * процесса. Комментарий обещал Asia/Tashkent на проде, но 28.09.2026 на обеих
 * площадках в контейнере приложения `TZ` пуст и время UTC. Отопительный сезон
 * 10-15..04-15 тогда открывался бы в 05:00 по Ташкенту, а не в 00:00, и
 * закрывался бы на пять часов позже: алерт HEATING в эти часы глушился бы или
 * проходил не по календарю оператора.
 *
 * Тест делает процесс «живущим в UTC», как на проде: локальные геттеры даты
 * подменены UTC-вариантами. Менять `process.env.TZ` на лету внутри воркера jest
 * ненадёжно, а машина разработчика в UTC+5 дефект бы спрятала — там TZ процесса
 * и Ташкент совпадают.
 */
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { checkSeasonGate } = require('../../../src/services/alert/alertGates');

const HEATING = { alert_type: 'HEATING_FAILURE', severity: 'CRITICAL', season_from: '10-15', season_to: '04-15' };
const utc = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));

beforeEach(() => {
    const proto = Date.prototype;
    const asUtc = { getFullYear: 'getUTCFullYear', getMonth: 'getUTCMonth', getDate: 'getUTCDate', getHours: 'getUTCHours' };
    for (const [local, utcName] of Object.entries(asUtc)) {
        jest.spyOn(proto, local).mockImplementation(function () { return proto[utcName].call(this); });
    }
});
afterEach(() => jest.restoreAllMocks());

describe('[N-32] граница сезона — по календарю Ташкента', () => {
    test('процесс «в UTC» (условие теста)', () => {
        expect(utc(2026, 10, 14, 20).getDate()).toBe(14);
    });

    test('15.10 01:00 по Ташкенту (14.10 20:00 UTC) — сезон уже открыт', () => {
        const res = checkSeasonGate({}, HEATING, utc(2026, 10, 14, 20));
        expect(res.allowed).toBe(true);
        expect(res.reason).toContain('10-15');
    });

    test('14.10 23:59 по Ташкенту (14.10 18:59 UTC) — ещё закрыт', () => {
        expect(checkSeasonGate({}, HEATING, utc(2026, 10, 14, 18, 59)).allowed).toBe(false);
    });

    test('16.04 01:00 по Ташкенту (15.04 20:00 UTC) — сезон уже закрыт', () => {
        const res = checkSeasonGate({}, HEATING, utc(2026, 4, 15, 20));
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('04-16');
    });

    test('15.04 23:59 по Ташкенту (15.04 18:59 UTC) — ещё открыт (граница включительная)', () => {
        expect(checkSeasonGate({}, HEATING, utc(2026, 4, 15, 18, 59)).allowed).toBe(true);
    });

    test('Новый год: 01.01 00:30 по Ташкенту (31.12 19:30 UTC) — внутри окна', () => {
        const res = checkSeasonGate({}, HEATING, utc(2026, 12, 31, 19, 30));
        expect(res.allowed).toBe(true);
        expect(res.reason).toContain('01-01');
    });
});
