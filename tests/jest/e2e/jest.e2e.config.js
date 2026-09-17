module.exports = {
  rootDir: '../../../',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/jest/e2e/**/*.test.js'],
  // [A-17] Вложенные рабочие деревья — копии РЕПОЗИТОРИЯ, а не сторонний код:
  // в них лежат и свои тесты, и свой `__mocks__`, и свой package.json. Без
  // этих исключений jest подхватывает их наравне с основным деревом — на
  // прогоне это дубликат ручного мока otplib, Haste-коллизия по имени пакета
  // и ЧУЖОЙ тест другой ветки в отчёте. Воспроизведено 17.09.2026.
  //
  // `testPathIgnorePatterns` убирает чужие тесты, а `modulePathIgnorePatterns`
  // — чужие модули из карты: одного первого мало, дубликат мока живёт именно
  // в карте модулей.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/worktrees/', '/.deploy/'],
  modulePathIgnorePatterns: ['/.claude/worktrees/', '/.deploy/'],
  globalSetup: '<rootDir>/tests/jest/e2e/helpers/globalSetup.js',
  verbose: true,
};
