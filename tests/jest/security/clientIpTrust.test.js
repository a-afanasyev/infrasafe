/**
 * [A13-18, аудит 25.11.2026] Адрес клиента нельзя подменить заголовком.
 *
 * Находка: в блоках /api/ и /health edge собирает X-Forwarded-For через
 * `$proxy_add_x_forwarded_for`, то есть ДОПИСЫВАЕТ свой `$remote_addr` к тому,
 * что прислал клиент. Вопрос был — не берёт ли приложение левый (клиентский)
 * элемент.
 *
 * Вывод: нет, подмены нет, edge и приложение не тронуты. Держится это на трёх
 * фактах, и каждый закреплён ниже, потому что по отдельности они выглядят
 * безобидными для «упрощения»:
 *
 *   1. `trust proxy` = 1 — Express доверяет ровно ОДНОМУ прокси и берёт
 *      ПРАВЫЙ элемент X-Forwarded-For, который дописал edge. `true` вместо 1
 *      вернул бы левый, клиентский;
 *   2. edge → приложение — один переход (`proxy_pass` прямо на app:3000).
 *      Второй прокси в цепочке сделал бы правым элементом адрес первого;
 *   3. код нигде не читает заголовок сам — только `req.ip`. Лимитер, счётчик
 *      промахов входа и журнал аутентификации получают адрес оттуда.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const root = path.join(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const serverSource = read('src/server.js');

/** Значение `trust proxy` из настоящего server.js — без запуска сервера и БД. */
const trustProxySetting = () => {
    const match = /app\.set\('trust proxy',\s*([^)]+)\)/.exec(serverSource);
    if (!match) throw new Error("в src/server.js не найден app.set('trust proxy', …)");
    return JSON.parse(match[1].trim());
};

const echoApp = () => {
    const app = express();
    app.set('trust proxy', trustProxySetting());
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    return app;
};

describe('A13-18 — приложение берёт адрес, дописанный edge', () => {
    test("trust proxy — ровно 1 (не true и не список)", () => {
        expect(trustProxySetting()).toBe(1);
    });

    test('клиентский X-Forwarded-For не становится адресом клиента', async () => {
        // Так заголовок выглядит после edge: слева — что прислал клиент,
        // справа — $remote_addr, дописанный nginx.
        const res = await request(echoApp()).get('/ip').set('X-Forwarded-For', '10.66.66.66, 203.0.113.7');
        expect(res.body.ip).toBe('203.0.113.7');
    });

    test('цепочка из нескольких поддельных адресов — всё равно правый', async () => {
        const res = await request(echoApp()).get('/ip').set('X-Forwarded-For', '1.1.1.1, 2.2.2.2, 127.0.0.1, 203.0.113.7');
        expect(res.body.ip).toBe('203.0.113.7');
    });

    test('X-Real-IP и Forwarded приложением не учитываются', async () => {
        const res = await request(echoApp()).get('/ip')
            .set('X-Forwarded-For', '203.0.113.7')
            .set('X-Real-IP', '10.66.66.66')
            .set('Forwarded', 'for=10.66.66.66');
        expect(res.body.ip).toBe('203.0.113.7');
    });
});

describe('A13-18 — код не читает заголовки адреса в обход req.ip', () => {
    const jsFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(rel);
        return entry.name.endsWith('.js') ? [rel] : [];
    });

    test('в src/ нет обращений к x-forwarded-for / x-real-ip / req.ips', () => {
        const offenders = jsFiles('src').filter((file) => {
            const code = read(file).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
            return /x-forwarded-for|x-real-ip|\breq\.ips\b/i.test(code);
        });
        expect(offenders).toEqual([]);
    });
});

describe.each(['nginx.production.conf', 'nginx.profk.conf'])('A13-18 — %s: edge → приложение в один переход', (file) => {
    const conf = read(`nginx-config/${file}`).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

    test('/api/ и /health проксируются прямо на app:3000 и дописывают $remote_addr', () => {
        for (const upstreamVar of ['app_upstream', 'health_upstream']) {
            expect(conf).toMatch(new RegExp(`set\\s+\\$${upstreamVar}\\s+"app:3000";`));
        }
        // $proxy_add_x_forwarded_for = клиентское значение + ", $remote_addr":
        // правым элементом всегда оказывается адрес, который видел сам nginx.
        const appended = conf.match(/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/g) || [];
        expect(appended.length).toBe(2);
    });

    test('ни один блок не пробрасывает клиентский X-Forwarded-For как есть', () => {
        expect(conf).not.toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$http_x_forwarded_for/);
    });
});
