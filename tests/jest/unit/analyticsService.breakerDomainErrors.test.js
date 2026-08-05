/**
 * [AR-19] Регресс на родственника AR-1 в аналитике.
 *
 * `getTransformerLoad` превращал ОТСУТСТВИЕ строки в материализованном
 * представлении в исключение прямо внутри `materializedViewBreaker.execute`,
 * а оно пролетало и через внешний `transformerAnalyticsBreaker`. Оба —
 * createAnalyticsBreaker с порогом 3. Итог: три запроса трансформатора,
 * которого ещё нет в MV (а MV обновляется раз в 60 с, см.
 * MV_REFRESH_INTERVAL_SECONDS), открывали ОБА предохранителя на 30 секунд и
 * деградировали аналитику для ВСЕХ трансформаторов. Через
 * `alertService.checkTransformerLoad` это же глушило проверку перегрузки.
 *
 * Отсутствие строки в MV — не отказ MV: `Transformer.getLoadAnalytics`
 * штатно возвращает null. Настоящие отказы MV должны считаться отказами
 * по-прежнему.
 *
 * ВАЖНО: analyticsServiceTest.test.js подменяет breaker заглушкой, которая
 * зовёт fallback на ЛЮБУЮ ошибку, — для неё этого бага не существует. Здесь
 * breaker НАСТОЯЩИЙ.
 */

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/models/Transformer', () => ({
    getLoadAnalytics: jest.fn(),
    findById: jest.fn(),
    getAllWithLoadAnalytics: jest.fn(),
    findAll: jest.fn(),
    getOverloadedTransformers: jest.fn(),
    findNearestBuildings: jest.fn(),
    findInRadius: jest.fn(),
    getStatistics: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(),
    set: jest.fn(),
    getTransformerAnalytics: jest.fn(),
    setTransformerAnalytics: jest.fn(),
    invalidate: jest.fn(),
    invalidatePattern: jest.fn(),
    getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 })
}));

const Transformer = require('../../../src/models/Transformer');
const cacheService = require('../../../src/services/cacheService');
const analyticsService = require('../../../src/services/analyticsService');
const { TRANSFORMER_NOT_FOUND } = require('../../../src/services/analyticsService');

const EXISTING_TRANSFORMER = {
    transformer_id: 7,
    name: 'ТП-7',
    power_kva: 630,
    status: 'active',
    latitude: 41.3,
    longitude: 69.2,
    buildings_count: 5,
    controllers_count: 10
};

describe('analyticsService: промах MV не открывает предохранители (AR-19)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        analyticsService.resetCircuitBreakers();
        cacheService.getTransformerAnalytics.mockResolvedValue(null);
    });

    test('трансформатор ещё не в MV: предохранители остаются CLOSED', async () => {
        Transformer.getLoadAnalytics.mockResolvedValue(null);
        Transformer.findById.mockResolvedValue(EXISTING_TRANSFORMER);

        for (let i = 0; i < 6; i++) {
            await analyticsService.getTransformerLoad(7).catch(() => {});
        }

        expect(analyticsService.materializedViewBreaker.getState().state).toBe('CLOSED');
        expect(analyticsService.transformerAnalyticsBreaker.getState().state).toBe('CLOSED');
    });

    test('трансформатор ещё не в MV: с первого вызова отдаются данные основной таблицы', async () => {
        Transformer.getLoadAnalytics.mockResolvedValue(null);
        Transformer.findById.mockResolvedValue(EXISTING_TRANSFORMER);

        const result = await analyticsService.getTransformerLoad(7);

        expect(result).toEqual(expect.objectContaining({
            id: 7,
            name: 'ТП-7',
            is_fallback: true
        }));
    });

    test('трансформатора нет вовсе: коды ошибки проставлены, предохранители целы', async () => {
        Transformer.getLoadAnalytics.mockResolvedValue(null);
        Transformer.findById.mockResolvedValue(null);

        for (let i = 0; i < 6; i++) {
            await expect(analyticsService.getTransformerLoad(404)).rejects.toMatchObject({
                code: TRANSFORMER_NOT_FOUND
            });
        }

        expect(analyticsService.materializedViewBreaker.getState().state).toBe('CLOSED');
        expect(analyticsService.transformerAnalyticsBreaker.getState().state).toBe('CLOSED');
    });

    test('настоящий отказ MV по-прежнему открывает предохранитель', async () => {
        Transformer.getLoadAnalytics.mockRejectedValue(new Error('relation does not exist'));
        Transformer.findById.mockResolvedValue(EXISTING_TRANSFORMER);

        for (let i = 0; i < 3; i++) {
            await analyticsService.getTransformerLoad(7).catch(() => {});
        }

        expect(analyticsService.materializedViewBreaker.getState().state).toBe('OPEN');
    });

    test('при открытом MV-предохранителе аналитика деградирует на основную таблицу', async () => {
        Transformer.getLoadAnalytics.mockRejectedValue(new Error('relation does not exist'));
        Transformer.findById.mockResolvedValue(EXISTING_TRANSFORMER);

        for (let i = 0; i < 3; i++) {
            await analyticsService.getTransformerLoad(7).catch(() => {});
        }
        expect(analyticsService.materializedViewBreaker.getState().state).toBe('OPEN');

        analyticsService.transformerAnalyticsBreaker.reset();
        const result = await analyticsService.getTransformerLoad(7);

        expect(result).toEqual(expect.objectContaining({ id: 7, is_fallback: true }));
    });
});
