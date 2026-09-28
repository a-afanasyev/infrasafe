'use strict';

/**
 * [N-55] Цепочка таймаутов: БД < HTTP-сервер < периметр.
 *
 * `server.timeout` стоял 30 с — ровно столько же, сколько `statement_timeout`.
 * Сокет простаивал столько же, сколько запрос ждал базу, и Node закрывал его
 * раньше, чем errorHandler успевал ответить: вживую 24.09 три запроса из пяти
 * под блокировкой таблицы получили `curl: (52) Empty reply from server`. За
 * nginx это 502 вместо осмысленной ошибки.
 *
 * Порядок обязан быть строгим с запасом:
 *   statement_timeout (БД)  <  server.timeout (Node)  <  proxy_read_timeout (nginx)
 * Иначе ответ не успевает: при равенстве справа клиент получает 504 от nginx.
 * Значения nginx читаются из настоящих конфигов обоих периметров.
 */

const fs = require('fs');
const path = require('path');
const { STATEMENT_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS, RESPONSE_MARGIN_MS } = require('../../../src/config/timeouts');

const EDGES = ['nginx.profk.conf', 'nginx.production.conf'];

// Location, которые ходят в приложение, но ждать его НЕ должны. /health —
// проба живости: быстрый отказ (5 с) там правилен, иначе монитор ждал бы
// зависшее приложение дольше, чем имеет смысл.
const EXEMPT = new Set(['/health']);

/**
 * Все location, проксирующие в приложение (`app:3000` — напрямую или через
 * переменную `set $x "app:3000"`), с их proxy_read_timeout. Имя переменной не
 * важно: новый location под другой переменной не должен проскочить мимо.
 */
function appLocations(file) {
    const conf = fs.readFileSync(path.join(__dirname, '../../../nginx-config', file), 'utf8');
    // Только настоящие директивы в начале строки: слово «location» встречается
    // и в комментариях внутри блоков.
    const heads = [...conf.matchAll(/^[ \t]*location\s+([^{\n]+?)\s*\{/gm)];
    return heads
        .map((m, i) => ({ name: m[1].replace(/^[=~^*\s]+/, ''), body: conf.slice(m.index, heads[i + 1] ? heads[i + 1].index : undefined) }))
        .filter(({ body }) => /set\s+\$\w+\s+"app:3000"|proxy_pass\s+http:\/\/app:3000/.test(body))
        .map(({ name, body }) => {
            const t = /proxy_read_timeout\s+(\d+)s;/.exec(body);
            // Без явного значения nginx ждёт 60 с.
            return { name, ms: (t ? Number(t[1]) : 60) * 1000 };
        });
}

describe('[N-55] цепочка таймаутов', () => {
    test('HTTP-таймаут сервера больше таймаута БД с запасом на ответ', () => {
        expect(HTTP_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(STATEMENT_TIMEOUT_MS + RESPONSE_MARGIN_MS);
        expect(RESPONSE_MARGIN_MS).toBeGreaterThanOrEqual(5000);
    });

    test.each(EDGES)('%s: периметр ждёт дольше, чем сервер', (file) => {
        const locations = appLocations(file);
        expect(locations.map((l) => l.name)).toEqual(expect.arrayContaining(['/api/', '/health']));
        const tooShort = locations
            .filter((l) => !EXEMPT.has(l.name))
            .filter((l) => l.ms <= HTTP_REQUEST_TIMEOUT_MS)
            .map((l) => `${l.name}: ${l.ms} мс`);
        expect(tooShort).toEqual([]);
    });

    test('database.js и server.js берут значения из одного места', () => {
        const dbSrc = fs.readFileSync(path.join(__dirname, '../../../src/config/database.js'), 'utf8');
        const serverSrc = fs.readFileSync(path.join(__dirname, '../../../src/server.js'), 'utf8');
        expect(dbSrc).toMatch(/statement_timeout:\s*STATEMENT_TIMEOUT_MS/);
        expect(serverSrc).toMatch(/server\.timeout\s*=\s*HTTP_REQUEST_TIMEOUT_MS/);
        expect(serverSrc).not.toMatch(/server\.timeout\s*=\s*\d/);
    });
});
