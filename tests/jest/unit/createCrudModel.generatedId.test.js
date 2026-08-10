/**
 * [AR-3(б), побочная находка] `create` без `id` вставляет NULL в NOT NULL.
 *
 * Обнаружено при переводе admin-контроллеров на модели. `cold_water_sources.id`
 * и `heat_sources.id` — `NOT NULL` и БЕЗ `DEFAULT` (проверено на живой схеме
 * 10.08.2026). Фабрика же формирует INSERT по полному списку `createColumns` и
 * подставляет `null` всему, чего нет во входных данных:
 *
 *     const values = createColumns.map(col => {
 *         if (data[col] !== undefined) return data[col];
 *         if (defaults[col] !== undefined) return defaults[col];
 *         return null;                       // ← сюда попадает id
 *     });
 *
 * Это не теоретический риск: `POST /api/cold-water-sources` и
 * `POST /api/heat-sources` собраны фабрикой контроллеров и зовут
 * `Model.create(req.body)` напрямую. Клиент, не приславший `id` (а его неоткуда
 * взять — это внутренний UUID), получал 500. Admin-путь работал только потому,
 * что генерировал UUID сам, сырым SQL — тем самым, который AR-3(б) убирает.
 *
 * Починка: `defaults` принимает функцию, вычисляемую на каждую вставку.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const { createCrudModel } = require('../../../src/models/factories/createCrudModel');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('[AR-3(б)] createCrudModel: генерируемые значения по умолчанию', () => {
    let Model;

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [{ id: 'x', name: 'n' }] });
        Model = createCrudModel({
            tableName: 'cold_water_sources',
            idColumn: 'id',
            entityName: 'cold water source',
            entityType: 'water_sources',
            fields: ['id', 'name', 'status'],
            createColumns: ['id', 'name', 'status'],
            updateColumns: ['name', 'status'],
            defaults: { id: () => require('crypto').randomUUID(), status: 'active' },
        });
    });

    test('id генерируется, когда вызывающий его не передал', async () => {
        await Model.create({ name: 'Источник' });

        const [, params] = db.query.mock.calls[0];
        expect(params[0]).toMatch(UUID_RE);
    });

    test('переданный id не перетирается — легаси-путь сохраняет свой UUID', async () => {
        await Model.create({ id: 'ffffffff-1111-2222-3333-444444444444', name: 'Источник' });

        const [, params] = db.query.mock.calls[0];
        expect(params[0]).toBe('ffffffff-1111-2222-3333-444444444444');
    });

    test('два создания подряд получают РАЗНЫЕ id', async () => {
        // Функция должна вычисляться на каждую вставку, а не один раз при
        // конфигурировании модели: иначе вторая запись упрётся в UNIQUE.
        await Model.create({ name: 'Первый' });
        await Model.create({ name: 'Второй' });

        const first = db.query.mock.calls[0][1][0];
        const second = db.query.mock.calls[1][1][0];
        expect(first).not.toBe(second);
    });

    test('статические значения по умолчанию продолжают работать как раньше', async () => {
        await Model.create({ name: 'Источник' });

        const [, params] = db.query.mock.calls[0];
        expect(params[2]).toBe('active');
    });
});
