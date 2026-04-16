// Мокаем зависимости до импорта
jest.mock('../../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/utils/circuitBreaker', () => ({
  CircuitBreakerFactory: {
    // Phase 7: analyticsService is now top-level required by alertService,
    // so its createAnalyticsBreaker + createDatabaseBreaker must also be
    // stubbed for the full module graph to load in this test.
    createDatabaseBreaker: () => ({
      execute: (fn) => fn(),
      getState: () => 'CLOSED'
    }),
    createAnalyticsBreaker: () => ({
      execute: (fn) => fn(),
      getState: () => 'CLOSED'
    })
  }
}));

// analyticsService is required top-level by alertService (Phase 7). Mock
// it so the test does not pull in the real service's DB queries.
jest.mock('../../../src/services/analyticsService', () => ({
  getTransformerLoad: jest.fn().mockResolvedValue(null),
  getAllTransformersWithAnalytics: jest.fn().mockResolvedValue([]),
  checkForAlerts: jest.fn(),
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');

describe('AlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mark as initialized to skip DB wait
    alertService.initialized = true;
  });

  describe('getAlertStatistics', () => {
    test('uses parameterized query instead of string interpolation', async () => {
      db.query.mockResolvedValue({ rows: [] });

      await alertService.getAlertStatistics(30);

      const [query, params] = db.query.mock.calls[0];
      // Query should use $1 parameter placeholder
      expect(query).toContain('$1');
      // Query should NOT contain string interpolation of days
      expect(query).not.toContain("'30 days'");
      expect(query).not.toMatch(/INTERVAL\s+'[^1]/);
      // Params should contain the sanitized value
      expect(params).toEqual([30]);
    });

    test('sanitizes malicious days input', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await alertService.getAlertStatistics('1; DROP TABLE');

      const [, params] = db.query.mock.calls[0];
      // parseInt('1; DROP TABLE') = 1
      expect(params).toEqual([1]);
      expect(result.period_days).toBe(1);
    });

    test('clamps days to valid range', async () => {
      db.query.mockResolvedValue({ rows: [] });

      await alertService.getAlertStatistics(999);
      expect(db.query.mock.calls[0][1]).toEqual([365]);

      db.query.mockClear();

      await alertService.getAlertStatistics(-5);
      expect(db.query.mock.calls[0][1]).toEqual([1]);
    });

    test('defaults to 7 days for non-numeric input', async () => {
      db.query.mockResolvedValue({ rows: [] });

      await alertService.getAlertStatistics('abc');
      expect(db.query.mock.calls[0][1]).toEqual([7]);
    });
  });

  describe('getActiveAlerts', () => {
    test('defaults to status=active when no filter provided', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await alertService.getActiveAlerts();

      const [countQuery, countParams] = db.query.mock.calls[0];
      expect(countParams[0]).toBe('active');
    });

    test('uses provided status filter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({ rows: [{ alert_id: 1 }, { alert_id: 2 }] });

      const result = await alertService.getActiveAlerts({ status: 'acknowledged' });

      const [, countParams] = db.query.mock.calls[0];
      expect(countParams[0]).toBe('acknowledged');
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    test('applies pagination offset correctly', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      await alertService.getActiveAlerts({}, { page: 3, limit: 10 });

      const [dataQuery, dataParams] = db.query.mock.calls[1];
      // limit=10, offset=(3-1)*10=20
      expect(dataParams).toContain(10);
      expect(dataParams).toContain(20);
    });

    test('validates sort column against whitelist, falls back to created_at', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await alertService.getActiveAlerts({}, { sort: 'DROP TABLE infrastructure_alerts;--' });

      const [dataQuery] = db.query.mock.calls[1];
      expect(dataQuery).toContain('ORDER BY ia.created_at');
      expect(dataQuery).not.toContain('DROP');
    });
  });
});
