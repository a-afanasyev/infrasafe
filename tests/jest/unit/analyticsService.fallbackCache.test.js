/**
 * [AR-20] Fallback-данные не должны попадать в кэш аналитики.
 *
 * `getTransformerLoad` при недоступном MV (или отсутствии строки в нём)
 * возвращает `_baseTransformerData` с `is_fallback: true` и `load_percent: 0`.
 * Guard `!data.is_fallback` стоял только перед проверкой алертов — сам кэш
 * наполнялся безусловно. Итог: MV уже ожил, а карта до конца TTL продолжала
 * показывать нули из закэшированного fallback'а.
 */

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
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

const TRANSFORMER_ROW = {
    transformer_id: 7,
    name: 'ТП-Фараби',
    capacity_kva: 400,
    status: 'active'
};

describe('[AR-20] кэш не принимает fallback-данные', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.getTransformerAnalytics.mockResolvedValue(null);
    });

    test('строки в MV нет → fallback отдан вызывающему, но НЕ закэширован', async () => {
        Transformer.getLoadAnalytics.mockResolvedValue(null);
        Transformer.findById.mockResolvedValue(TRANSFORMER_ROW);

        const data = await analyticsService.getTransformerLoad(7);

        expect(data.is_fallback).toBe(true);
        expect(cacheService.setTransformerAnalytics).not.toHaveBeenCalled();
    });

    test('живые данные из MV кэшируются как раньше', async () => {
        const mvRow = { transformer_id: 7, load_percent: 42, total_power_kw: 170 };
        Transformer.getLoadAnalytics.mockResolvedValue(mvRow);

        const data = await analyticsService.getTransformerLoad(7);

        expect(data.is_fallback).toBeUndefined();
        expect(cacheService.setTransformerAnalytics).toHaveBeenCalledWith(7, mvRow);
    });
});
