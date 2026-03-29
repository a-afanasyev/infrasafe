module.exports = {
  rootDir: '../../../',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/jest/e2e/**/*.test.js'],
  globalSetup: '<rootDir>/tests/jest/e2e/helpers/globalSetup.js',
  verbose: true,
};
