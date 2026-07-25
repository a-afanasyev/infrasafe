/**
 * [M-17] Контракт redaction'а логов. Тестируется чистая функция — winston
 * подключает её тонкой обёрткой format(), и отдельный блок ниже проверяет, что
 * обёртка реально стоит в цепочке боевого логгера.
 */

const { redactLogInfo, isSensitiveKey, REDACTED } = require('../../../src/utils/logRedaction');

describe('redactLogInfo — deny-list', () => {
    test('маскирует секреты на верхнем уровне', () => {
        const out = redactLogInfo({ username: 'admin', password: 'hunter2' });
        expect(out).toEqual({ username: 'admin', password: REDACTED });
    });

    test('маскирует вложенные секреты, не трогая соседей', () => {
        const out = redactLogInfo({
            req: { headers: { authorization: 'Bearer abc', 'user-agent': 'jest' } }
        });
        expect(out.req.headers.authorization).toBe(REDACTED);
        expect(out.req.headers['user-agent']).toBe('jest');
    });

    test('нормализует регистр и разделители в имени ключа', () => {
        const out = redactLogInfo({
            AccessToken: 'a', access_token: 'b', 'ACCESS-TOKEN': 'c', refreshToken: 'd'
        });
        expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
    });

    test('покрывает реальные имена cookie и полей БД', () => {
        for (const key of ['access_token', 'refresh_token', 'password_hash',
            'totp_secret', 'recovery_codes', 'client_secret', 'api_key',
            'x-service-token', 'x-telemetry-signature', 'x-webhook-signature', 'set-cookie']) {
            expect(isSensitiveKey(key)).toBe(true);
        }
    });

    test('не маскирует безобидные ключи', () => {
        for (const key of ['username', 'building_id', 'status', 'passenger_count']) {
            expect(isSensitiveKey(key)).toBe(false);
        }
    });

    test('обходит массивы объектов', () => {
        const out = redactLogInfo({ users: [{ name: 'a', password: 'p1' }, { name: 'b', token: 't' }] });
        expect(out.users[0]).toEqual({ name: 'a', password: REDACTED });
        expect(out.users[1]).toEqual({ name: 'b', token: REDACTED });
    });

    test('объект без секретов эквивалентен входу', () => {
        const input = { a: 1, b: { c: [1, 2, 3] } };
        expect(redactLogInfo(input)).toEqual(input);
    });

    test('вход не мутируется', () => {
        const input = { password: 'hunter2', nested: { token: 'x' } };
        redactLogInfo(input);
        expect(input.password).toBe('hunter2');
        expect(input.nested.token).toBe('x');
    });

    test('не падает на не-объектах', () => {
        expect(redactLogInfo('string')).toBe('string');
        expect(redactLogInfo(null)).toBeNull();
    });
});

describe('redactLogInfo — структурные крайние случаи', () => {
    test('цикл заменяется на [Circular] и не уходит в копию', () => {
        const a = { name: 'a' };
        a.self = a;
        const out = redactLogInfo({ a });
        expect(out.a.self).toBe('[Circular]');
    });

    test('глубина > 6 схлопывается в [Truncated] — глубокий секрет не утекает', () => {
        const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: { password: 'deep' } } } } } } } };
        const out = redactLogInfo(deep);
        expect(JSON.stringify(out)).not.toContain('deep');
        expect(JSON.stringify(out)).toContain('[Truncated]');
    });

    test('Date, Buffer, Error и типизированные массивы не схлопываются в {}', () => {
        const date = new Date('2026-07-25T00:00:00Z');
        const buf = Buffer.from('abc');
        const err = new Error('boom');
        const typed = new Uint8Array([1, 2, 3]);

        const out = redactLogInfo({ date, buf, err, typed });

        expect(out.date).toBe(date);
        expect(out.buf).toBe(buf);
        expect(out.err).toBe(err);
        expect(out.err.stack).toBeDefined();
        expect(out.typed).toBe(typed);
    });

    test('одна и та же (нецикличная) ссылка дважды — не [Circular]', () => {
        const shared = { name: 'shared' };
        const out = redactLogInfo({ a: shared, b: shared });
        expect(out.a).toEqual({ name: 'shared' });
        expect(out.b).toEqual({ name: 'shared' });
    });
});

describe('redactLogInfo — символы winston', () => {
    test('переносит level/message/splat символы на копию', () => {
        const LEVEL = Symbol.for('level');
        const MESSAGE = Symbol.for('message');
        const SPLAT = Symbol.for('splat');

        const info = { level: 'error', message: 'oops', password: 'p' };
        info[LEVEL] = 'error';
        info[MESSAGE] = '{"level":"error"}';
        info[SPLAT] = [1, 2];

        const out = redactLogInfo(info);

        expect(out[LEVEL]).toBe('error');
        expect(out[MESSAGE]).toBe('{"level":"error"}');
        expect(out[SPLAT]).toEqual([1, 2]);
        expect(out.password).toBe(REDACTED);
    });
});

describe('[M-17] redaction подключён в боевую цепочку логгера', () => {
    const { Writable } = require('stream');

    test('запись через winston-транспорт выходит с замаскированным секретом и правильным уровнем', () => {
        jest.resetModules();
        // [R2-37] stdout-only — тест не должен создавать файлы в logs/.
        process.env.LOG_CONSOLE_ONLY = 'true';
        process.env.LOG_LEVEL = 'error';
        const logger = require('../../../src/utils/logger');
        const winston = require('winston');

        const lines = [];
        const sink = new Writable({
            write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); }
        });
        const streamTransport = new winston.transports.Stream({ stream: sink });
        logger.add(streamTransport);

        try {
            logger.error('login failed', { username: 'admin', password: 'hunter2' });
        } finally {
            logger.remove(streamTransport);
        }

        const out = lines.join('');
        expect(out).toContain(REDACTED);
        expect(out).not.toContain('hunter2');
        expect(out).toContain('"username":"admin"');
        // Символ уровня пережил redaction — иначе транспорт не смог бы отфильтровать запись.
        expect(out).toContain('"level":"error"');
    });
});
