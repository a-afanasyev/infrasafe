/**
 * [B-009] Сезонное окно правила.
 *
 * Базовый баг: схема не знала про сезон вообще, поэтому HEATING_FAILURE
 * срабатывал круглый год — в июле «нет горячей воды» уходило в УК как авария
 * отопления.
 *
 * Основной случай здесь — ПЕРЕХОД ЧЕРЕЗ НОВЫЙ ГОД (отопительный сезон
 * 10-15..04-15), а не обычный интервал внутри года: именно на нём ломается
 * наивное `from <= today <= to`.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const alertGates = require('../../../src/services/alert/alertGates');
const logger = require('../../../src/utils/logger');

const ALERT = { type: 'HEATING_FAILURE', severity: 'CRITICAL', infrastructure_type: 'heat_source', infrastructure_id: 1 };
const rule = (season_from, season_to) => ({
    alert_type: 'HEATING_FAILURE', severity: 'CRITICAL', season_from, season_to
});
// Локальная дата без UTC-сдвига: гейт читает getMonth()/getDate().
const at = (mm, dd) => new Date(2026, mm - 1, dd, 12, 0, 0);

beforeEach(() => jest.clearAllMocks());

describe('checkSeasonGate — окно не задано', () => {
    test('оба NULL → круглогодичное правило, гейт пропускает', () => {
        const r = alertGates.checkSeasonGate(ALERT, rule(null, null), at(7, 25));
        expect(r.allowed).toBe(true);
        expect(r.reason).toMatch(/круглогодич/);
    });

    test('правило вообще без полей сезона (старая строка) пропускается', () => {
        const r = alertGates.checkSeasonGate(ALERT, { alert_type: 'X', severity: 'Y' }, at(7, 25));
        expect(r.allowed).toBe(true);
    });
});

describe('checkSeasonGate — окно через Новый год (отопительный сезон 10-15..04-15)', () => {
    const heating = rule('10-15', '04-15');

    test.each([
        ['15 октября — первый день окна', 10, 15],
        ['31 декабря', 12, 31],
        ['1 января', 1, 1],
        ['15 апреля — последний день окна', 4, 15],
        ['1 февраля — середина', 2, 1],
    ])('внутри: %s', (_label, mm, dd) => {
        expect(alertGates.checkSeasonGate(ALERT, heating, at(mm, dd)).allowed).toBe(true);
    });

    test.each([
        ['16 апреля — день после конца', 4, 16],
        ['25 июля — разгар лета (тот самый баг)', 7, 25],
        ['14 октября — день до начала', 10, 14],
    ])('снаружи: %s', (_label, mm, dd) => {
        const r = alertGates.checkSeasonGate(ALERT, heating, at(mm, dd));
        expect(r.allowed).toBe(false);
        expect(r.reason).toContain('вне окна 10-15..04-15');
    });
});

describe('checkSeasonGate — обычное окно внутри года', () => {
    const summer = rule('06-01', '08-31');

    test('границы включительные с обеих сторон', () => {
        expect(alertGates.checkSeasonGate(ALERT, summer, at(6, 1)).allowed).toBe(true);
        expect(alertGates.checkSeasonGate(ALERT, summer, at(8, 31)).allowed).toBe(true);
    });

    test('снаружи с обеих сторон', () => {
        expect(alertGates.checkSeasonGate(ALERT, summer, at(5, 31)).allowed).toBe(false);
        expect(alertGates.checkSeasonGate(ALERT, summer, at(9, 1)).allowed).toBe(false);
    });

    test('окно в один день', () => {
        const oneDay = rule('03-08', '03-08');
        expect(alertGates.checkSeasonGate(ALERT, oneDay, at(3, 8)).allowed).toBe(true);
        expect(alertGates.checkSeasonGate(ALERT, oneDay, at(3, 9)).allowed).toBe(false);
    });
});

describe('checkSeasonGate — устойчивость', () => {
    test('CHAR(5) с добивкой пробелами не ломает сравнение', () => {
        const padded = rule('10-15 ', ' 04-15');
        expect(alertGates.checkSeasonGate(ALERT, padded, at(12, 1)).allowed).toBe(true);
        expect(alertGates.checkSeasonGate(ALERT, padded, at(7, 25)).allowed).toBe(false);
    });

    test('однозначные месяц и день зеропадятся (09-05, а не 9-5)', () => {
        const r = alertGates.checkSeasonGate(ALERT, rule('09-01', '09-30'), at(9, 5));
        expect(r.allowed).toBe(true);
        expect(r.reason).toContain('09-05');
    });

    test('полузаполненная пара → fail-open + warn (не глушим эскалацию из-за недоредактированной строки)', () => {
        const r = alertGates.checkSeasonGate(ALERT, rule('10-15', null), at(7, 25));
        expect(r.allowed).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('полузаполненное окно'));
    });

    test('по умолчанию берётся текущая дата (now необязателен)', () => {
        expect(() => alertGates.checkSeasonGate(ALERT, rule(null, null))).not.toThrow();
    });
});
