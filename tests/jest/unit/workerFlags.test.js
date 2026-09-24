/**
 * [N-23] Флаги воркеров читаются одним парсером — `utils/envFlags`.
 *
 * Хвост A-18. A-18 завёл общий парсер, но пять воркеров остались на своих:
 *
 *   - у двух планировщиков с умолчанием «включено» выключали только `false`,
 *     `0` и пустая строка, поэтому `CONTROLLER_STATUS_SCHEDULER_ENABLED=off`
 *     оставлял планировщик ВКЛЮЧЁННЫМ. Этот флаг и
 *     `UK_INTENT_RECONCILE_ENABLED` не входили в `envSchema.RULES`, так что
 *     опечатку не ловил и старт;
 *   - `UK_USE_WEBHOOK_SENDER` разбирался двумя способами: `env.js` через
 *     envFlags (`yes` = включено, требует UK_API_ALLOWED_HOSTS), а сам outbox —
 *     локально (`yes` = выключено). Конфигурация и воркер расходились молча.
 *
 * Пустая строка теперь значит «не задано», как объявляют envSchema и envFlags,
 * а не «выключено».
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const envFlags = require('../../../src/utils/envFlags');
const { validate } = require('../../../src/config/envSchema');

const WORKERS = [
    { name: 'CONTROLLER_STATUS_SCHEDULER_ENABLED', def: true, mod: '../../../src/services/controllerStatusScheduler' },
    { name: 'MV_REFRESH_ENABLED', def: true, mod: '../../../src/services/mvRefreshService' },
    { name: 'UK_INTENT_RECONCILE_ENABLED', def: true, mod: '../../../src/services/uk/alertIntentReconciler' },
    { name: 'ALERT_VERIFICATION_ENABLED', def: false, mod: '../../../src/services/alertVerificationService' },
    { name: 'UK_USE_WEBHOOK_SENDER', def: false, mod: '../../../src/services/uk/ukOutboxService' },
];

const VALUES = ['true', '1', 'yes', 'on', 'TRUE', 'false', '0', 'no', 'off', 'OFF', '', '  ', 'garbage'];

const saved = {};
beforeAll(() => WORKERS.forEach(({ name }) => { saved[name] = process.env[name]; }));
afterEach(() => WORKERS.forEach(({ name }) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
}));

describe.each(WORKERS)('[N-23] $name', ({ name, def, mod }) => {
    const worker = require(mod);

    test('без переменной — умолчание', () => {
        delete process.env[name];
        expect(worker.isEnabled()).toBe(def);
    });

    test.each(VALUES)('значение %p читается так же, как envFlags', (value) => {
        process.env[name] = value;
        expect(worker.isEnabled()).toBe(envFlags.isEnabled(name, def));
    });

    test('off/no выключают, yes/on включают', () => {
        for (const v of ['off', 'no']) {
            process.env[name] = v;
            expect(worker.isEnabled()).toBe(false);
        }
        for (const v of ['on', 'yes']) {
            process.env[name] = v;
            expect(worker.isEnabled()).toBe(true);
        }
    });

    test('опечатку ловит валидатор на старте', () => {
        expect(validate({ [name]: 'off' })).toEqual([expect.stringContaining(name)]);
        expect(validate({ [name]: 'true' })).toEqual([]);
    });
});

describe('[N-23] рубеж: в воркерах нет своих булевых парсеров', () => {
    const SERVICES = path.join(__dirname, '../../../src/services');
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return files(full);
        return e.name.endsWith('.js') ? [full] : [];
    });
    // Прежняя форма: `(process.env.X ?? 'true').toString().toLowerCase()` и
    // сравнение с литералом. Числовые переменные разбираются через Number и
    // правилу не подпадают.
    const LOCAL_PARSE = /process\.env\.[A-Z0-9_]+\s*\?\?\s*'[^']*'\s*\)\s*\.toString\(\)\s*\.toLowerCase\(\)/;

    test('ни один файл src/services не разбирает флаг вручную', () => {
        const offenders = files(SERVICES)
            .filter((f) => LOCAL_PARSE.test(fs.readFileSync(f, 'utf8').replace(/\s+/g, ' ')))
            .map((f) => path.relative(SERVICES, f));
        expect(offenders).toEqual([]);
    });

    test('регулярка ловит прежнюю форму', () => {
        const old = "const flag = (process.env.MV_REFRESH_ENABLED ?? 'true').toString().toLowerCase();";
        expect(LOCAL_PARSE.test(old)).toBe(true);
    });
});
