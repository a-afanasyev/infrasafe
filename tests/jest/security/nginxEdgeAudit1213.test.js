/**
 * Аудиты безопасности #12 (2026-11-16) и #13 (2026-11-25) — правки edge nginx.
 *
 *   A13-19  телефоны жителей в access-логе: колл-центр УК передаёт цифры номера
 *           в query (`q`, `phone`), а строка запроса писалась целиком;
 *   A13-17  assets.profk.uz отдавал резервные копии (`*.bak*`) без входа;
 *   #12     /health без лимита запросов;
 *   #14     429 от edge без Retry-After; несуществующий путь отвечал 200 на
 *           profk и 301 на .105 — теперь честный 404 на обеих площадках.
 *
 * Оба боевых конфига проверяются одним набором: расхождение между ними — уже
 * дефект. Как и соседние наборы, это проверка текста директив; поведение
 * (`nginx -t` и живые пробы в контейнере той же версии) — в описании PR.
 */

const fs = require('fs');
const path = require('path');
const { stripComments, tlsVhosts, topLevelLocations, summarizeVhost, addHeaderNames } = require('../helpers/nginxConfig');

const root = path.join(__dirname, '../../..');
const read = (name) => fs.readFileSync(path.join(root, 'nginx-config', name), 'utf8');

const CONFS = {
    'nginx.production.conf': { domain: 'infrasafe.uz', snippet: 'infrasafe' },
    'nginx.profk.conf': { domain: 'profk.uz', snippet: 'profk' },
};

/** Тело `map <from> <to> { … }` или null. */
const mapBody = (conf, from, to) => {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`map\\s+${esc(from)}\\s+${esc(to)}\\s*\\{([^}]*)\\}`).exec(conf);
    return m ? m[1] : null;
};

/** Регулярки-ключи map'а (`"~…"` / `"~*…"`) как RegExp. */
const mapRegexes = (body) => [...body.matchAll(/"~(\*?)([^"]+)"/g)].map((m) => new RegExp(m[2], m[1] ? 'i' : ''));

describe.each(Object.entries(CONFS))('%s', (file, { domain, snippet }) => {
    const conf = stripComments(read(file));
    const httpLevel = conf.slice(0, conf.search(/^\s{4}server\s*\{/m));
    const mainVhost = tlsVhosts(read(file)).find((v) => v.name === domain);
    const location = (name) => topLevelLocations(mainVhost.body).find((l) => l.name === name);

    describe('A13-19 — query-string колл-центра УК не попадает в access-лог', () => {
        const strip = mapBody(httpLevel, '$uri', '$log_strip_query');

        test('решение принимается по нормализованному $uri (а не по сырой строке запроса)', () => {
            // $request_uri клиент может закодировать (`%63allcenter`) — регулярка
            // по нему промахнулась бы, а апстрим путь всё равно раскодирует.
            expect(strip).not.toBeNull();
            expect(strip).toMatch(/default\s+0;/);
        });

        test('префикс колл-центра совпадает в обеих формах — до и после rewrite в /uk/api/', () => {
            const res = mapRegexes(strip);
            const hit = (uri) => res.some((re) => re.test(uri));
            expect(hit('/uk/api/v2/callcenter/search-resident')).toBe(true);
            expect(hit('/uk/api/v2/callcenter/residents/17/apartments')).toBe(true);
            // rewrite срезает /uk — в фазе логирования $uri уже такой:
            expect(hit('/api/v2/callcenter/search-resident')).toBe(true);
            expect(hit('/uk/api/v2/CallCenter/search-resident')).toBe(true);
            // остальной трафик логируется как раньше
            expect(hit('/uk/api/v2/requests')).toBe(false);
            expect(hit('/api/buildings')).toBe(false);
            expect(hit('/uk/api/v2/callcenter-other/x')).toBe(false);
        });

        test('для колл-центра пишется метод + путь без query, для остального — $request', () => {
            const logged = mapBody(httpLevel, '$log_strip_query', '$log_request');
            expect(logged).not.toBeNull();
            expect(logged).toMatch(/default\s+\$request;/);
            const redacted = /1\s+"([^"]+)";/.exec(logged);
            expect(redacted).not.toBeNull();
            expect(redacted[1]).toContain('$uri');
            expect(redacted[1]).not.toMatch(/\$request_uri|\$args|\$query_string|\$is_args|\$request\b/);
        });

        test('ни один log_format не пишет сырую строку запроса или аргументы', () => {
            const formats = [...httpLevel.matchAll(/log_format\s+\w+\s+([^;]+);/g)].map((m) => m[1]);
            expect(formats.length).toBeGreaterThan(0);
            for (const f of formats) {
                expect(f).toContain('$log_request');
                expect(f).not.toMatch(/\$request\b|\$request_uri|\$args|\$query_string/);
            }
        });
    });

    describe('#12 — /health под лимитом запросов', () => {
        test('зона объявлена, лимит применён в location /health', () => {
            expect(httpLevel).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=health:\d+m\s+rate=\d+r\/s;/);
            expect(location('/health').body).toMatch(/limit_req\s+zone=health\s+burst=\d+\s+nodelay;/);
        });
    });

    describe('#14 — 429 от edge несёт Retry-After', () => {
        test('значение выставляется только для 429, рождённого самим edge', () => {
            // Пустой $upstream_status = ответ сформировал nginx. У 429 от
            // приложения свой Retry-After — второй заголовок был бы дублем.
            const body = mapBody(httpLevel, '"$status:$upstream_status"', '$edge_retry_after');
            expect(body).not.toBeNull();
            expect(body).toMatch(/default\s+"";/);
            expect(body).toMatch(/"429:"\s+\$edge_retry_secs;/);
        });

        test('каждый location с limit_req отдаёт Retry-After (свой или унаследованный)', () => {
            const snippets = { [snippet]: addHeaderNames(stripComments(read(`security-headers.${snippet}.conf`))) };
            const summary = summarizeVhost(mainVhost.body, snippets);
            const limited = topLevelLocations(mainVhost.body).filter((l) => /\blimit_req\s/.test(l.body));
            expect(limited.length).toBeGreaterThanOrEqual(6);
            for (const loc of limited) {
                const own = summary.locations.find((l) => l.name === loc.name);
                // Свой add_header отменяет наследование → нужен свой Retry-After.
                const effective = own ? own.headers : summary.serverHeaders;
                expect([loc.name, effective.has('Retry-After')]).toEqual([loc.name, true]);
            }
        });
    });

    describe('#14 — несуществующий путь отвечает 404 одинаково на обеих площадках', () => {
        test('fallback не подменяет ответ главной страницей', () => {
            const fallback = location('/');
            expect(fallback.body).toMatch(/try_files\s+\$uri\s+\$uri\/\s+=404;/);
            expect(fallback.body).not.toMatch(/index\.html/);
        });
    });
});

describe('A13-17 — assets.profk.uz не раздаёт резервные копии', () => {
    const assets = tlsVhosts(read('nginx.profk.conf')).find((v) => v.name === 'assets.profk.uz');
    const bak = topLevelLocations(assets.body).find((l) => /bak/.test(l.name));

    test('регулярный location на *.bak* отвечает 404 и ничего не проксирует', () => {
        expect(bak).toBeDefined();
        expect(bak.body).toMatch(/return\s+404;/);
        expect(bak.body).not.toMatch(/proxy_pass/);
    });

    test('регулярка ловит копии в любом регистре и не задевает обычные файлы', () => {
        const m = /^~\*\s+(\S+)$/.exec(bak.name);
        expect(m).not.toBeNull();
        const re = new RegExp(m[1], 'i');
        for (const uri of ['/data/inventory.csv.bak-20261101', '/data/inventory.csv.bak', '/data/x.BAK', '/a.bak/b', '/data/inventory.csv.bak_old']) {
            expect([uri, re.test(uri)]).toEqual([uri, true]);
        }
        for (const uri of ['/', '/data/inventory.csv', '/js/app.js', '/img/bakery.png', '/data/tobak.csv']) {
            expect([uri, re.test(uri)]).toEqual([uri, false]);
        }
    });
});

describe('#14 — ссылка /map из общей разметки не зависит от fallback', () => {
    // about.html (общая для обеих площадок) ведёт на `/map`. На profk маршрут
    // держался только на fallback'е; с честным 404 он обязан быть объявлен явно.
    test.each(Object.entries(CONFS))('%s: location = /map отдаёт index.html', (file, { domain }) => {
        const vhost = tlsVhosts(read(file)).find((v) => v.name === domain);
        const map = topLevelLocations(vhost.body).find((l) => l.name === '= /map');
        expect(map).toBeDefined();
        expect(map.body).toMatch(/try_files\s+\/index\.html\s+=404;/);
    });

    test('общая разметка действительно ссылается на /map', () => {
        const about = fs.readFileSync(path.join(root, 'frontend-html/about.html'), 'utf8');
        expect(about).toMatch(/href="\/map"/);
    });
});
