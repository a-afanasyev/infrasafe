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

/** proxy_read_timeout у блоков location, проксирующих в приложение ($app_upstream). */
function appReadTimeoutsMs(file) {
    const conf = fs.readFileSync(path.join(__dirname, '../../../nginx-config', file), 'utf8');
    const blocks = conf.split(/\blocation\b/).slice(1).filter((b) => /proxy_pass\s+http:\/\/\$app_upstream/.test(b.split(/\blocation\b/)[0]));
    return blocks.map((b) => {
        const m = /proxy_read_timeout\s+(\d+)s;/.exec(b);
        // Без явного значения nginx ждёт 60 с.
        return (m ? Number(m[1]) : 60) * 1000;
    });
}

describe('[N-55] цепочка таймаутов', () => {
    test('HTTP-таймаут сервера больше таймаута БД с запасом на ответ', () => {
        expect(HTTP_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(STATEMENT_TIMEOUT_MS + RESPONSE_MARGIN_MS);
        expect(RESPONSE_MARGIN_MS).toBeGreaterThanOrEqual(5000);
    });

    test.each(EDGES)('%s: периметр ждёт дольше, чем сервер', (file) => {
        const timeouts = appReadTimeoutsMs(file);
        expect(timeouts.length).toBeGreaterThan(0);
        for (const t of timeouts) {
            expect(t).toBeGreaterThan(HTTP_REQUEST_TIMEOUT_MS);
        }
    });

    test('database.js и server.js берут значения из одного места', () => {
        const dbSrc = fs.readFileSync(path.join(__dirname, '../../../src/config/database.js'), 'utf8');
        const serverSrc = fs.readFileSync(path.join(__dirname, '../../../src/server.js'), 'utf8');
        expect(dbSrc).toMatch(/statement_timeout:\s*STATEMENT_TIMEOUT_MS/);
        expect(serverSrc).toMatch(/server\.timeout\s*=\s*HTTP_REQUEST_TIMEOUT_MS/);
        expect(serverSrc).not.toMatch(/server\.timeout\s*=\s*\d/);
    });
});
