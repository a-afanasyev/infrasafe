/**
 * PENT-F12 / F14 / F15 / F16 / F17 — правки edge nginx по заявке УК от 2026-09-02.
 *
 * Оба боевых конфига (infrasafe.uz и profk.uz) проверяются одним набором:
 * заявка общая для двух доменов, и расхождение между ними — уже дефект
 * (residents на infrasafe.uz был сломан месяц именно из-за такого дрейфа).
 *
 * Как и nginxEdgeHardening.test.js, это проверка текста директив, а не
 * поведения: `nginx -t` и живые пробы против настоящего nginx делаются
 * отдельно (см. описание PR). Комментарии вырезаются, чтобы прозу нельзя
 * было принять за директиву.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');

const CONFS = {
    'nginx.production.conf': 'infrasafe.uz',
    'nginx.profk.conf': 'profk.uz',
};

const stripComments = (raw) => raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const load = (name) => stripComments(fs.readFileSync(path.join(root, 'nginx-config', name), 'utf8'));

// server-блоки объявлены с отступом в 4 пробела; делим по ним.
const serverBlocks = (conf) => conf.split(/^\s{4}server\s*\{/m).slice(1);

// location с отступом в 8 пробелов и закрывающей скобкой на том же уровне.
const locationBlock = (conf, header) => {
    const start = conf.indexOf(header);
    if (start === -1) return null;
    const end = conf.indexOf('\n        }', start);
    return conf.slice(start, end);
};

describe.each(Object.entries(CONFS))('%s (%s)', (file, domain) => {
    const conf = load(file);

    describe('PENT-F15 — server_tokens off покрывает и порт 80', () => {
        test('директива стоит в http-контексте, до первого server-блока', () => {
            const httpLevel = conf.slice(0, conf.search(/^\s{4}server\s*\{/m));
            expect(httpLevel).toMatch(/^\s*server_tokens\s+off;/m);
        });
    });

    describe('PENT-F12 — произвольный Host не обслуживается', () => {
        const blocks = serverBlocks(conf);

        test('server_names_hash_bucket_size задан явно (на .105 дефолт 32 ронял nginx -t)', () => {
            const httpLevel = conf.slice(0, conf.search(/^\s{4}server\s*\{/m));
            expect(httpLevel).toMatch(/^\s*server_names_hash_bucket_size\s+64;/m);
        });
        const catchAll = blocks.filter((b) => /default_server/.test(b));
        const named = blocks.filter((b) => !/default_server/.test(b) && /listen\s+443\s+ssl;/.test(b));

        test('catch-all на 80 и 443 отвечает 444 и ничего не проксирует', () => {
            expect(catchAll.length).toBe(2);
            expect(conf).toMatch(/listen\s+80\s+default_server;/);
            expect(conf).toMatch(/listen\s+443\s+ssl\s+default_server;/);
            for (const b of catchAll) {
                expect(b).toMatch(/return\s+444;/);
                expect(b).not.toMatch(/proxy_pass|root\s/);
            }
        });

        test('443 catch-all отбивает TLS-handshake без известного SNI', () => {
            const tls = catchAll.find((b) => /listen\s+443/.test(b));
            expect(tls).toMatch(/ssl_reject_handshake\s+on;/);
        });

        test('каждый именованный 443-vhost возвращает 421 на чужой Host', () => {
            // По SNI nginx уже выбрал vhost; Host-mismatch остаётся на нём, а
            // не уходит в default_server — поэтому проверка нужна внутри блока.
            expect(named.length).toBeGreaterThan(0);
            for (const b of named) {
                // Условие может быть строкой (!= "x") или регуляркой в кавычках
                // (!~ "^(a|b)$") — до открывающей фигурной скобки.
                expect(b).toMatch(/if\s*\(\$host\s*(!=|!~\*?)\s*[^{]+?\)\s*\{\s*return\s+421;\s*\}/);
            }
        });

        test(`основной vhost сравнивает Host с ${domain}`, () => {
            // В регулярке точка экранирована (infrasafe\.uz), в строке — нет.
            const hostPattern = domain.split('.').join('\\\\?\\.');
            const main = named.find((b) => new RegExp(`server_name\\s+${domain.replace('.', '\\.')}`).test(b));
            expect(main).toBeDefined();
            expect(main).toMatch(new RegExp(`if\\s*\\(\\$host\\s*(!=|!~\\*?)\\s*[^{]*${hostPattern}`));
        });
    });

    describe('PENT-F16 — edge единственный владелец HSTS и X-Frame-Options', () => {
        const named = serverBlocks(conf).filter((b) => !/default_server/.test(b) && /listen\s+443\s+ssl;/.test(b));

        test('в каждом 443-vhost заголовки апстрима снимаются на уровне server', () => {
            for (const b of named) {
                const beforeFirstLocation = b.slice(0, b.search(/^\s{8}location\s/m));
                expect(beforeFirstLocation).toMatch(/proxy_hide_header\s+Strict-Transport-Security;/);
                expect(beforeFirstLocation).toMatch(/proxy_hide_header\s+X-Frame-Options;/);
            }
        });

        test('/api/ (свой add_header ⇒ наследование выключено) ставит HSTS и XFO ровно по разу', () => {
            const api = locationBlock(conf, 'location /api/ {');
            expect(api).not.toBeNull();
            expect(api.match(/add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains; preload"\s+always;/g)).toHaveLength(1);
            expect(api.match(/add_header\s+X-Frame-Options\s+"SAMEORIGIN"\s+always;/g)).toHaveLength(1);
        });

        test('/uk/ (SPA УК) ставит HSTS, но НЕ XFO — clickjacking там через frame-ancestors (F-08)', () => {
            const uk = locationBlock(conf, 'location ^~ /uk/ {');
            expect(uk).not.toBeNull();
            expect(uk.match(/add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains; preload"\s+always;/g)).toHaveLength(1);
            expect(uk).not.toMatch(/add_header\s+X-Frame-Options/);
            expect(uk).toMatch(/frame-ancestors 'self' https:\/\/web\.telegram\.org/);
        });

        test('/uk/api/ не переопределяет add_header — наследует канон server-блока', () => {
            const ukApi = locationBlock(conf, 'location ^~ /uk/api/ {');
            expect(ukApi).not.toBeNull();
            expect(ukApi).not.toMatch(/add_header/);
        });
    });

    describe('PENT-F17 — /uk/api/health открыт точным совпадением', () => {
        test('в allowlist есть якорная строка health', () => {
            expect(conf).toMatch(/"~\^\/uk\/api\/health\$"\s+1;/);
        });

        test('префиксной формы нет — /health/ratelimit и /health/outbox остаются закрыты', () => {
            expect(conf).not.toMatch(/"~\^\/uk\/api\/health\/"/);
            expect(conf).not.toMatch(/"~\^\/uk\/api\/health\(\/\|\$\)"/);
        });
    });

    describe('PENT-F14 — /.well-known/security.txt', () => {
        const loc = locationBlock(conf, 'location = /.well-known/security.txt {');

        test('точный location из персистентного каталога', () => {
            expect(loc).not.toBeNull();
            expect(loc).toMatch(/root\s+\/srv\/frontend-html;/);
            expect(loc).toMatch(/default_type\s+text\/plain;/);
        });

        test('без add_header — иначе пропадут все заголовки server-блока', () => {
            expect(loc).not.toMatch(/add_header/);
        });
    });
});

describe('SEC-22 — allowlist /uk/api/ одинаков на обеих площадках', () => {
    // Дрейф карт уже стоил месяца сломанного раздела «Жители» на infrasafe.uz
    // (residents стоял только на profk). УК шлют заявки на оба домена сразу —
    // разный набор ключей означает, что одну площадку забыли.
    const keys = (name) => (load(name).match(/"~\^\/uk\/api\/[^"]+"/g) || []).sort();

    test('наборы ключей map $uk_api_allowed совпадают', () => {
        expect(keys('nginx.profk.conf')).toEqual(keys('nginx.production.conf'));
    });
});

describe('PENT-F14 — файл security.txt (один на оба домена)', () => {
    const txt = fs.readFileSync(path.join(root, 'frontend-html/.well-known/security.txt'), 'utf8');

    test('обязательные поля RFC 9116 — Contact и Expires', () => {
        expect(txt).toMatch(/^Contact: https:\/\/t\.me\/infrasafe$/m);
        const expires = txt.match(/^Expires: (.+)$/m);
        expect(expires).not.toBeNull();
        expect(new Date(expires[1]).getTime()).toBeGreaterThan(Date.now());
    });

    test('Canonical для обоих доменов и языки', () => {
        expect(txt).toMatch(/^Canonical: https:\/\/profk\.uz\/\.well-known\/security\.txt$/m);
        expect(txt).toMatch(/^Canonical: https:\/\/infrasafe\.uz\/\.well-known\/security\.txt$/m);
        expect(txt).toMatch(/^Preferred-Languages: ru, uz, en$/m);
    });
});
