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
    createDatabaseBreaker: () => ({
      execute: (fn) => fn(),
      getState: () => 'CLOSED'
    })
  }
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
});
