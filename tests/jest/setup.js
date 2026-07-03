// Jest setup файл для глобальной конфигурации тестов
require('dotenv').config({ path: '.env.test' });

// Keep test output clean and cheap: winston writes info/debug to stdout, and the
// per-test rate-limiter reset below logs one line each time. Default the level to
// `error` in tests (set before any module requires the logger, which reads
// LOG_LEVEL once at creation). This only gates transport OUTPUT — logger.info()
// is still invoked, so suites that spy on logger methods keep working.
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';
}

// Ensure JWT secrets are always set for tests
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-key';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
}
if (!process.env.TOTP_ENCRYPTION_KEY) {
  process.env.TOTP_ENCRYPTION_KEY = 'test-totp-encryption-key-32chars!';
}

// Настройка для тестов

// Глобальные переменные для тестов
global.TEST_CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/infrasafe_test',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret-key',
  TIMEOUT: 10000
};

// [CI flake fix] The HTTP rate-limiter singletons (auth/register/crud/admin/
// analytics/telemetry/password-change) are module-level state shared by every
// test in a jest worker. supertest sends all requests from the same loopback IP,
// so counters accumulate ACROSS test files — a later test that expects 401/403
// can instead get a 429 once an earlier file exhausts the window. This heisenbug
// has broken CI at least twice (security.test.js, csrfOriginGuard). Reset the
// shared limiters before every test so counters always start clean.
//
// Guarded require: several suites jest.mock() the whole rateLimiter module (e.g.
// default-deny), in which case resetAllRateLimits is absent — skip silently.
// Dedicated limiter suites use their OWN `new SimpleRateLimiter()` instances,
// which this reset does not touch.
beforeEach(() => {
  try {
    const { resetAllRateLimits } = require('../../src/middleware/rateLimiter');
    if (typeof resetAllRateLimits === 'function') {
      resetAllRateLimits();
    }
  } catch {
    // Module mocked/unavailable in this suite — nothing shared to reset.
  }
});

// Настройка API перед всеми тестами
beforeAll(async () => {
  console.log('🧪 Настройка Jest тестов...');
  
  // Используем случайный порт для избежания конфликтов
  const testPort = process.env.TEST_PORT || Math.floor(Math.random() * 1000) + 4000;
  global.TEST_CONFIG.API_BASE_URL = `http://localhost:${testPort}`;
  process.env.PORT = testPort;
  
  console.log(`✅ Jest тесты настроены на порт: ${testPort}`);
}, 5000);

// Глобальные моки
global.console = {
  ...console,
  // Отключаем логи в тестах для чистоты вывода
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Обработка необработанных исключений в тестах
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
}); 