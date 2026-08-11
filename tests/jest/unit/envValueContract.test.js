/**
 * [AR-9 / M-7 / M-11 / EN-6] Волна D — окружение проверяется по ЗНАЧЕНИЮ.
 *
 * `env.js` до сих пор отвечал на один вопрос: «переменная задана?». На вопрос
 * «задана осмысленно?» не отвечал никто, и типовой отказ выглядел так:
 *
 *     DB_POOL_MAX=twenty  →  parseInt → NaN  →  pg получает max: NaN
 *
 * Приложение при этом СТАРТУЕТ. Опечатка в одной букве становится не ошибкой
 * запуска, а странным поведением под нагрузкой через час — самый дорогой вид
 * дефекта из возможных.
 *
 * Проверяется контракт, а не реализация: какие значения обязаны быть отвергнуты
 * при старте и какие обязаны пройти. Как именно устроен разбор — дело кода.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const path = require('path');
const fs = require('fs');

const { validateEnv, PRODUCTION_REQUIRED_VARS } = require('../../../src/config/env');

/** Минимальный набор, при котором валидация доходит до проверки значений. */
function baseEnv(overrides = {}) {
    const secret = 'x'.repeat(40);
    return {
        NODE_ENV: 'development',
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_NAME: 'infrasafe',
        DB_USER: 'u',
        DB_PASSWORD: 'p',
        JWT_SECRET: secret,
        JWT_REFRESH_SECRET: `${secret}2`,
        TOTP_ENCRYPTION_KEY: `${secret}3`,
        ...overrides,
    };
}

describe('[AR-9] значения числовых переменных', () => {
    const ORIGINAL = process.env;
    afterEach(() => { process.env = ORIGINAL; });

    // Каждая из этих переменных сегодня уходит в parseInt без проверки.
    const NUMERIC = [
        'DB_POOL_MAX', 'DB_POOL_MIN', 'DB_POOL_IDLE_TIMEOUT', 'DB_POOL_CONNECT_TIMEOUT',
        'PORT', 'MV_REFRESH_INTERVAL_SECONDS', 'UK_OUTBOX_DRAIN_INTERVAL_MS',
        'UK_OUTBOX_MAX_AGE_HOURS', 'ALERT_VERIFICATION_TICK_MS',
    ];

    test.each(NUMERIC)('%s = "не число" валит старт', (name) => {
        process.env = baseEnv({ [name]: 'twenty' });
        expect(() => validateEnv()).toThrow(new RegExp(name));
    });

    test.each(NUMERIC)('%s = "" считается НЕзаданной и старт проходит', (name) => {
        // Пустое значение — это «переменная не выставлена», а не мусор.
        // Ронять на нём старт значило бы наказывать за пустую строку в .env.
        process.env = baseEnv({ [name]: '' });
        expect(() => validateEnv()).not.toThrow();
    });

    test('отрицательный размер пула отвергается', () => {
        process.env = baseEnv({ DB_POOL_MAX: '-5' });
        expect(() => validateEnv()).toThrow(/DB_POOL_MAX/);
    });

    test('DB_POOL_MIN больше DB_POOL_MAX отвергается', () => {
        // Поодиночке оба значения корректны — неверно их СОЧЕТАНИЕ. Пул с
        // min > max в pg не стартует внятно, а обнаруживается это под нагрузкой.
        process.env = baseEnv({ DB_POOL_MIN: '30', DB_POOL_MAX: '10' });
        expect(() => validateEnv()).toThrow(/DB_POOL_MIN/);
    });

    test('PORT вне диапазона портов отвергается', () => {
        process.env = baseEnv({ PORT: '70000' });
        expect(() => validateEnv()).toThrow(/PORT/);
    });

    test('корректные значения проходят', () => {
        process.env = baseEnv({
            DB_POOL_MIN: '2', DB_POOL_MAX: '20', PORT: '3000',
            MV_REFRESH_INTERVAL_SECONDS: '60', ALERT_VERIFICATION_TICK_MS: '15000',
        });
        expect(() => validateEnv()).not.toThrow();
    });
});

describe('[AR-9] значения булевых переменных', () => {
    const ORIGINAL = process.env;
    afterEach(() => { process.env = ORIGINAL; });

    const BOOLEAN = [
        'MV_REFRESH_ENABLED', 'ALERT_VERIFICATION_ENABLED', 'UK_USE_WEBHOOK_SENDER',
        'UK_USE_NEXT_SECRET', 'UK_ESCALATION_NOTIFY', 'SECURE_COOKIES',
        'LOG_CONSOLE_ONLY', 'AUTH_BLACKLIST_FAIL_OPEN',
    ];

    test.each(BOOLEAN)('%s = "yes" валит старт', (name) => {
        // Опаснее всего здесь молчание: код сравнивает с 'true', и 'yes'
        // тихо означает ВЫКЛЮЧЕНО. Оператор, написавший yes, уверен в обратном —
        // а выключенным окажется, например, воркер верификации алертов.
        process.env = baseEnv({ [name]: 'yes' });
        expect(() => validateEnv()).toThrow(new RegExp(name));
    });

    test.each(['true', 'false', '1', '0', 'TRUE', 'False', ''])(
        'значение %p принимается',
        (value) => {
            process.env = baseEnv({ MV_REFRESH_ENABLED: value });
            expect(() => validateEnv()).not.toThrow();
        }
    );
});

describe('[AR-9] LOG_LEVEL', () => {
    const ORIGINAL = process.env;
    afterEach(() => { process.env = ORIGINAL; });

    test('неизвестный уровень валит старт', () => {
        process.env = baseEnv({ LOG_LEVEL: 'verbose' });
        expect(() => validateEnv()).toThrow(/LOG_LEVEL/);
    });

    test.each(['error', 'warn', 'info', 'debug'])('уровень %s принимается', (level) => {
        process.env = baseEnv({ LOG_LEVEL: level });
        expect(() => validateEnv()).not.toThrow();
    });
});

describe('[M-7/M-11] REDIS_URL — гарантия, а не удача', () => {
    test('REDIS_URL обязателен в production', () => {
        // На нём держатся лимитер, кэш и дедуп вебхуков. Без него они молча
        // падают на per-process Map: счётчики перестают быть общими, а узнать
        // об этом можно было только по одной строке в логе.
        //
        // Обе площадки его уже задают (проверено 10.08.2026) — то есть
        // повышение до обязательного никого не ломает, а фиксирует факт.
        expect(PRODUCTION_REQUIRED_VARS).toContain('REDIS_URL');
    });

    test('невалидная схема URL отвергается', () => {
        const ORIGINAL = process.env;
        process.env = baseEnv({ REDIS_URL: 'http://redis:6379' });
        expect(() => validateEnv()).toThrow(/REDIS_URL/);
        process.env = ORIGINAL;
    });

    test.each(['redis://redis:6379', 'redis://:pass@redis:6379/0', 'rediss://redis:6380'])(
        'схема %s принимается',
        (url) => {
            const ORIGINAL = process.env;
            process.env = baseEnv({ REDIS_URL: url });
            expect(() => validateEnv()).not.toThrow();
            process.env = ORIGINAL;
        }
    );
});

describe('[EN-6] .env.example не умалчивает о переменных', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../../../.env.example'), 'utf8');

    test.each(['LOG_CONSOLE_ONLY', 'ADMIN_PASSWORD', 'REDIS_URL'])(
        '%s описан в .env.example',
        (name) => {
            // Достаточно упоминания: часть переменных намеренно закомментирована
            // (значение по умолчанию безопаснее), но узнать об их существовании
            // оператор должен из шаблона, а не из чтения исходников.
            expect(raw).toMatch(new RegExp(`\\b${name}\\b`));
        }
    );
});
