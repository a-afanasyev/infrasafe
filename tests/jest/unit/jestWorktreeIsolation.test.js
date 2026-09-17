'use strict';

/**
 * [A-17] Вложенные рабочие деревья не должны попадать в прогон.
 *
 * `.claude/worktrees/*` — это копии РЕПОЗИТОРИЯ, а не сторонний код: в них
 * лежат и свои тесты, и свой `__mocks__`, и свой `package.json`. Пока каталог
 * пуст, всё выглядит нормально; как только там появляется дерево, jest
 * подхватывает его наравне с основным.
 *
 * Воспроизведено 17.09.2026 — положили в `.claude/worktrees/probe` копию
 * package.json, копию `__mocks__/otplib.js` и заведомо падающий тест:
 *
 *     jest-haste-map: duplicate manual mock found: otplib
 *     jest-haste-map: Haste module naming collision: infrasafe
 *     FAIL .claude/worktrees/probe/tests/jest/unit/foreign.test.js
 *
 * То есть прогон падал на ЧУЖОМ тесте другой ветки, а дубликат ручного мока
 * означал, что неизвестно, какой из двух подставится. Аудит называл находку
 * условной; условие достигается одной командой.
 *
 * Почему двух списков мало поодиночке: `testPathIgnorePatterns` убирает чужие
 * ТЕСТЫ, но дубликат мока и Haste-коллизия живут в карте МОДУЛЕЙ — её закрывает
 * `modulePathIgnorePatterns`.
 *
 * Проверка структурная: гонять jest внутри jest ради этого несоразмерно.
 * Поведение подтверждено воспроизведением выше — до правки прогон ловил чужой
 * тест, после (с тем же стендом на диске) 3283 теста прошли чисто.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const e2eConfig = require('../e2e/jest.e2e.config.js');

// Каталоги, содержимое которых — копии этого же репозитория.
const NESTED_COPIES = ['/.claude/worktrees/', '/.deploy/'];

describe('[A-17] вложенные рабочие деревья исключены из прогона', () => {
    test('основной конфиг исключает их и из тестов, и из карты модулей', () => {
        for (const pattern of NESTED_COPIES) {
            expect(packageJson.jest.testPathIgnorePatterns).toContain(pattern);
            expect(packageJson.jest.modulePathIgnorePatterns).toContain(pattern);
        }
    });

    test('конфиг E2E исключает их тоже', () => {
        // У E2E собственный конфиг с собственным rootDir — он не наследует
        // настройки из package.json, и это ровно тот случай, когда исключение
        // забывают во втором месте.
        for (const pattern of NESTED_COPIES) {
            expect(e2eConfig.testPathIgnorePatterns).toContain(pattern);
            expect(e2eConfig.modulePathIgnorePatterns).toContain(pattern);
        }
    });

    test('node_modules остаётся исключён — правка ничего не вытеснила', () => {
        expect(packageJson.jest.testPathIgnorePatterns).toContain('/node_modules/');
        expect(e2eConfig.testPathIgnorePatterns).toContain('/node_modules/');
    });
});
