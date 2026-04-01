jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/models/PowerTransformer', () => ({
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

// Mock CircuitBreakerFactory to return breakers whose execute just runs the callback
jest.mock('../../../src/utils/circuitBreaker', () => {
    const createMockBreaker = () => ({
        execute: jest.fn(async (operation, fallback) => {
            try {
                return await operation();
            } catch (err) {
                if (fallback) return await fallback();
                throw err;
            }
        }),
        getState: jest.fn().mockReturnValue('CLOSED'),
        reset: jest.fn()
    });

    return {
        CircuitBreakerFactory: {
            createAnalyticsBreaker: jest.fn(() => createMockBreaker()),
            createDatabaseBreaker: jest.fn(() => createMockBreaker())
        }
    };
});

const PowerTransformer = require('../../../src/models/PowerTransformer');
const cacheService = require('../../../src/services/cacheService');
const db = require('../../../src/config/database');

// analyticsService is a singleton, require after mocks
let analyticsService;

beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
    cacheService.set.mockResolvedValue(undefined);
    cacheService.getTransformerAnalytics.mockResolvedValue(null);
    cacheService.setTransformerAnalytics.mockResolvedValue(undefined);
    cacheService.invalidate.mockResolvedValue(undefined);
    cacheService.invalidatePattern.mockResolvedValue(undefined);

    // Require fresh for each test to reset constructor state
    jest.isolateModules(() => {
        analyticsService = require('../../../src/services/analyticsService');
    });
});

describe('AnalyticsService', () => {
    describe('getTransformerLoad', () => {
        test('returns cached data when available', async () => {
            const cached = { id: 1, load_percent: 50 };
            cacheService.getTransformerAnalytics.mockResolvedValue(cached);

            const result = await analyticsService.getTransformerLoad(1);

            expect(result).toEqual(cached);
            expect(PowerTransformer.getLoadAnalytics).not.toHaveBeenCalled();
        });

        test('fetches from materialized view on cache miss', async () => {
            const data = { id: 1, load_percent: 75, is_fallback: false };
            PowerTransformer.getLoadAnalytics.mockResolvedValue(data);

            const result = await analyticsService.getTransformerLoad(1);

            expect(PowerTransformer.getLoadAnalytics).toHaveBeenCalledWith(1);
            expect(cacheService.setTransformerAnalytics).toHaveBeenCalledWith(1, data);
            expect(result).toEqual(data);
        });

        test('uses fallback when materialized view fails', async () => {
            PowerTransformer.getLoadAnalytics.mockRejectedValue(new Error('MV error'));
            const fallbackTransformer = {
                id: 1,
                name: 'TP-1',
                capacity_kva: 630,
                status: 'active',
                latitude: 41.3,
                longitude: 69.2,
                buildings_count: 5,
                controllers_count: 10
            };
            PowerTransformer.findById.mockResolvedValue(fallbackTransformer);

            const result = await analyticsService.getTransformerLoad(1);

            expect(result).toEqual(expect.objectContaining({
                id: 1,
                is_fallback: true,
                load_percent: 0
            }));
        });
    });

    describe('getAllTransformersWithAnalytics', () => {
        test('returns cached data when available', async () => {
            const cached = [{ id: 1 }, { id: 2 }];
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.getAllTransformersWithAnalytics();

            expect(result).toEqual(cached);
            expect(PowerTransformer.getAllWithLoadAnalytics).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches on miss', async () => {
            const data = [{ id: 1, load_percent: 50 }];
            PowerTransformer.getAllWithLoadAnalytics.mockResolvedValue(data);

            const result = await analyticsService.getAllTransformersWithAnalytics();

            expect(PowerTransformer.getAllWithLoadAnalytics).toHaveBeenCalled();
            expect(cacheService.set).toHaveBeenCalledWith(
                'transformers:all:analytics',
                data,
                expect.objectContaining({ ttl: 120 })
            );
            expect(result).toEqual(data);
        });

        test('uses fallback findAll when materialized view fails', async () => {
            PowerTransformer.getAllWithLoadAnalytics.mockRejectedValue(new Error('MV error'));
            const fallback = [{ id: 1, name: 'TP-1' }];
            PowerTransformer.findAll.mockResolvedValue(fallback);

            const result = await analyticsService.getAllTransformersWithAnalytics();

            expect(result).toEqual(fallback);
        });
    });

    describe('getOverloadedTransformers', () => {
        test('returns cached data when available', async () => {
            const cached = [{ id: 1, load_percent: 90 }];
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.getOverloadedTransformers();

            expect(result).toEqual(cached);
        });

        test('fetches from DB with default threshold', async () => {
            const data = [{ id: 1, load_percent: 85 }];
            PowerTransformer.getOverloadedTransformers.mockResolvedValue(data);

            const result = await analyticsService.getOverloadedTransformers();

            expect(PowerTransformer.getOverloadedTransformers).toHaveBeenCalledWith(80);
            expect(result).toEqual(data);
        });

        test('uses custom threshold', async () => {
            const data = [{ id: 1, load_percent: 95 }];
            PowerTransformer.getOverloadedTransformers.mockResolvedValue(data);

            const result = await analyticsService.getOverloadedTransformers(90);

            expect(PowerTransformer.getOverloadedTransformers).toHaveBeenCalledWith(90);
            expect(result).toEqual(data);
        });

        test('uses fallback empty array when MV fails', async () => {
            PowerTransformer.getOverloadedTransformers.mockRejectedValue(new Error('MV error'));

            const result = await analyticsService.getOverloadedTransformers();

            expect(result).toEqual([]);
        });

        test('caches result with short TTL', async () => {
            PowerTransformer.getOverloadedTransformers.mockResolvedValue([]);

            await analyticsService.getOverloadedTransformers();

            expect(cacheService.set).toHaveBeenCalledWith(
                expect.stringContaining('transformers:overloaded:'),
                expect.any(Array),
                expect.objectContaining({ ttl: 30 })
            );
        });
    });

    describe('refreshTransformerAnalytics', () => {
        test('executes refresh query and invalidates caches', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await analyticsService.refreshTransformerAnalytics();

            expect(db.query).toHaveBeenCalledWith('SELECT refresh_transformer_analytics()');
            expect(cacheService.invalidatePattern).toHaveBeenCalledWith('transformer');
            expect(result).toEqual(expect.objectContaining({
                success: true,
                refreshed_at: expect.any(String)
            }));
        });
    });

    describe('findNearestBuildings', () => {
        test('returns cached data when available', async () => {
            const cached = [{ id: 1, distance: 100 }];
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.findNearestBuildings(1, 1000, 50);

            expect(result).toEqual(cached);
        });

        test('fetches from DB on cache miss', async () => {
            const data = [{ id: 1, distance: 100 }];
            PowerTransformer.findNearestBuildings.mockResolvedValue(data);

            const result = await analyticsService.findNearestBuildings(1, 1000, 50);

            expect(PowerTransformer.findNearestBuildings).toHaveBeenCalledWith(1, 1000, 50);
            expect(result).toEqual(data);
        });
    });

    describe('findTransformersInRadius', () => {
        test('returns cached data when available', async () => {
            const cached = [{ id: 1 }];
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.findTransformersInRadius(41.3, 69.2, 5000);

            expect(result).toEqual(cached);
        });

        test('fetches from DB on cache miss', async () => {
            const data = [{ id: 1, distance: 2000 }];
            PowerTransformer.findInRadius.mockResolvedValue(data);

            const result = await analyticsService.findTransformersInRadius(41.3, 69.2, 5000);

            expect(PowerTransformer.findInRadius).toHaveBeenCalledWith(41.3, 69.2, 5000);
            expect(result).toEqual(data);
        });
    });

    describe('getTransformerStatistics', () => {
        test('returns cached data when available', async () => {
            const cached = { total: 10 };
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.getTransformerStatistics();

            expect(result).toEqual(cached);
        });

        test('fetches from DB on cache miss', async () => {
            const data = { total: 10, active: 8 };
            PowerTransformer.getStatistics.mockResolvedValue(data);

            const result = await analyticsService.getTransformerStatistics();

            expect(PowerTransformer.getStatistics).toHaveBeenCalled();
            expect(result).toEqual(data);
        });
    });

    describe('getLoadAnalysByZone', () => {
        test('returns cached data when available', async () => {
            const cached = [{ zone_name: 'Moscow', avg_load_percent: 50 }];
            cacheService.get.mockResolvedValue(cached);

            const result = await analyticsService.getLoadAnalysByZone();

            expect(result).toEqual(cached);
        });

        test('fetches zone analysis from DB', async () => {
            const data = [{ zone_name: 'Moscow', avg_load_percent: 65 }];
            db.query.mockResolvedValue({ rows: data });

            const result = await analyticsService.getLoadAnalysByZone();

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('GROUP BY b.town'),
                [80] // default threshold
            );
            expect(result).toEqual(data);
        });
    });

    describe('generateSimpleForecast', () => {
        test('returns empty array for empty historical data', () => {
            const result = analyticsService.generateSimpleForecast([], 24);

            expect(result).toEqual([]);
        });

        test('generates forecast entries for specified hours', () => {
            const historicalData = [
                { hour: '2026-01-01T10:00:00Z', avg_amperage: '50.0' },
                { hour: '2026-01-01T11:00:00Z', avg_amperage: '60.0' }
            ];

            const result = analyticsService.generateSimpleForecast(historicalData, 3);

            expect(result).toHaveLength(3);
            result.forEach(entry => {
                expect(entry).toHaveProperty('timestamp');
                expect(entry).toHaveProperty('predicted_amperage');
                expect(entry).toHaveProperty('confidence');
            });
        });

        test('confidence is low when < 24 data points', () => {
            const historicalData = [
                { hour: '2026-01-01T10:00:00Z', avg_amperage: '50.0' }
            ];

            const result = analyticsService.generateSimpleForecast(historicalData, 1);

            expect(result[0].confidence).toBe('low');
        });

        test('confidence is medium when > 24 data points', () => {
            const historicalData = Array.from({ length: 30 }, (_, i) => ({
                hour: new Date(2026, 0, 1, i % 24).toISOString(),
                avg_amperage: String(50 + i)
            }));

            const result = analyticsService.generateSimpleForecast(historicalData, 1);

            expect(result[0].confidence).toBe('medium');
        });
    });

    describe('getCircuitBreakerStatus', () => {
        test('returns status of all breakers and cache stats', () => {
            const result = analyticsService.getCircuitBreakerStatus();

            expect(result).toHaveProperty('transformer_analytics');
            expect(result).toHaveProperty('database');
            expect(result).toHaveProperty('materialized_view');
            expect(result).toHaveProperty('cache_stats');
        });
    });

    describe('resetCircuitBreakers', () => {
        test('resets all circuit breakers', () => {
            analyticsService.resetCircuitBreakers();

            expect(analyticsService.transformerAnalyticsBreaker.reset).toHaveBeenCalled();
            expect(analyticsService.databaseBreaker.reset).toHaveBeenCalled();
            expect(analyticsService.materializedViewBreaker.reset).toHaveBeenCalled();
        });
    });

    describe('updateThresholds', () => {
        test('merges new thresholds with existing ones', () => {
            const originalOverload = analyticsService.thresholds.transformer_overload;

            analyticsService.updateThresholds({ transformer_critical: 99 });

            expect(analyticsService.thresholds.transformer_critical).toBe(99);
            expect(analyticsService.thresholds.transformer_overload).toBe(originalOverload);
        });

        test('invalidates transformer caches', () => {
            analyticsService.updateThresholds({ transformer_overload: 90 });

            expect(cacheService.invalidatePattern).toHaveBeenCalledWith('transformer');
        });
    });
});
