/**
 * Простой тест для проверки базовой функциональности Jest
 */

describe('Simple Jest Test', () => {
  test('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  test('should handle environment variables', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });

  test('should have test configuration', () => {
    expect(global.TEST_CONFIG).toBeDefined();
    expect(global.TEST_CONFIG.API_BASE_URL).toBeDefined();
  });
}); 