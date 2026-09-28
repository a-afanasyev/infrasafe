'use strict';

/**
 * [N-11] gitleaks не исключает целиком документацию и тесты.
 *
 * В `.gitleaks.toml` стояли исключения по пути для `docs/*.md`, `README.md`,
 * `CLAUDE.md` и тестов — ровно там, где секреты утекают чаще всего (ранбуки с
 * командами, прецедент 623a059). 28.09.2026 после снятия исключений нашлись
 * значения настоящих, хоть и ротированных, секретов в трёх документах.
 * Плейсхолдеры теперь исключаются по значению; путь — только для файлов, где
 * секрета быть не может по устройству.
 */
const fs = require('fs');
const path = require('path');

const CONFIG = fs.readFileSync(path.join(__dirname, '../../../.gitleaks.toml'), 'utf8');

const block = (name) => {
    const m = new RegExp(`^${name}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm').exec(CONFIG);
    return m ? [...m[1].matchAll(/'''(.+?)'''/g)].map((x) => x[1]) : [];
};

describe('[N-11] исключения gitleaks', () => {
    const paths = block('paths');
    const regexes = block('regexes');

    test('конфиг разобран', () => {
        expect(paths.length).toBeGreaterThan(0);
        expect(regexes.length).toBeGreaterThan(0);
    });

    test.each([
        ['docs/runbook.md'],
        ['docs/audit/plan.md'],
        ['README.md'],
        ['CLAUDE.md'],
        ['tests/jest/unit/foo.test.js'],
        ['tests/jest/jest.config.js'],
        ['src/services/foo.js'],
    ])('путь %s не исключён целиком', (file) => {
        expect(paths.filter((p) => new RegExp(p).test(file))).toEqual([]);
    });

    test('ни одно исключение по значению не прячет «просто 64 hex» или длинный base64', () => {
        const hex64 = 'a'.repeat(8) + '0123456789abcdef'.repeat(3) + 'b'.repeat(8);
        const b64 = 'Q2hhbmdlZE15U2VjcmV0S2V5Rm9yVGVzdGluZ09ubHk';
        for (const r of regexes) {
            expect([r, new RegExp(r).test(hex64)]).toEqual([r, false]);
            expect([r, new RegExp(r).test(b64)]).toEqual([r, false]);
            // Настоящий секрет, обрезанный в ранбуке многоточием, — тоже находка.
            expect([r, new RegExp(r).test(`${hex64}...`)]).toEqual([r, false]);
            expect([r, new RegExp(r).test(`${b64}...`)]).toEqual([r, false]);
        }
    });
});
