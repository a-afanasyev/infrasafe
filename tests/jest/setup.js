// Jest setup файл для глобальной конфигурации тестов
require('dotenv').config({ path: '.env.test' });

// Настройка для тестов

// Глобальные переменные для тестов
global.TEST_CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/infrasafe_test',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret-key',
  TIMEOUT: 10000
};

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