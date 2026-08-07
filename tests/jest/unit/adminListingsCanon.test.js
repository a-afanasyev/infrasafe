/**
 * [AR-4] Восемь админских листингов отдавали `{data, pagination}` БЕЗ `success`.
 *
 * Это пятая форма конверта: потребителю приходилось узнавать её по отсутствию
 * ключа. Добавление `success: true` — изменение АДДИТИВНОЕ: фронт читает
 * `d.data`, и оно продолжает работать до и после. Поэтому здесь не нужен
 * expand-contract с окном деплоя, в отличие от ошибок.
 *
 * Пагинация обязана сохраниться на верхнем уровне: `sendSuccess` кладёт её
 * рядом с `data`, а не внутрь — иначе поменялся бы путь чтения на фронте.
 */

jest.mock('../../../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/utils/adminQueryBuilder', () => ({
    buildPaginatedList: jest.fn(),
    ALLOWED_TABLES: {}
}));

const { buildPaginatedList } = require('../../../src/utils/adminQueryBuilder');

const CONTROLLERS = [
    ['adminBuildingController', 'getOptimizedBuildings'],
    ['adminControllerController', 'getOptimizedControllers'],
    ['adminMetricController', 'getOptimizedMetrics'],
    ['adminTransformerController', 'getOptimizedTransformers'],
    ['adminLineController', 'getOptimizedLines'],
    ['adminWaterLineController', 'getOptimizedWaterLines'],
    ['adminColdWaterSourceController', 'getOptimizedColdWaterSources'],
    ['adminHeatSourceController', 'getOptimizedHeatSources'],
];

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const PAGINATION = { total: 2, page: 1, limit: 50, totalPages: 1 };
const ROWS = [{ id: 1 }, { id: 2 }];

describe('[AR-4] листинги админки в каноническом конверте', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        buildPaginatedList.mockResolvedValue({ data: ROWS, pagination: PAGINATION });
    });

    // Имена экспортов заранее не известны наверняка — берём то, что реально
    // экспортирует модуль, иначе тест закрепит опечатку вместо поведения.
    for (const [moduleName, exportName] of CONTROLLERS) {
        test(`${moduleName}.${exportName} отдаёт success + data + pagination`, async () => {
            const mod = require(`../../../src/controllers/admin/${moduleName}`);
            const handler = mod[exportName];
            expect(typeof handler).toBe('function');

            const res = mockRes();
            await handler({ query: {} }, res, jest.fn());

            const body = res.json.mock.calls[0][0];
            expect(body.success).toBe(true);
            expect(body.data).toEqual(ROWS);
            expect(body.pagination).toEqual(PAGINATION);
        });
    }

    test('старой формы без success больше нет ни в одном листинге', async () => {
        for (const [moduleName, exportName] of CONTROLLERS) {
            const mod = require(`../../../src/controllers/admin/${moduleName}`);
            const res = mockRes();
            await mod[exportName]({ query: {} }, res, jest.fn());

            const body = res.json.mock.calls[0][0];
            expect(Object.prototype.hasOwnProperty.call(body, 'success')).toBe(true);
        }
    });
});
