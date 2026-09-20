'use strict';

/**
 * [CO-11] Заголовки безопасности не теряются по дороге в location.
 *
 * Бэклог формулировал претензию к `p1-3-csp-sri.test.js` так: он «проверяет
 * текст конфига регулярками, не поднимая ни nginx, ни helmet — битый конфиг с
 * конфликтующими add_header не отличит». Претензия оказалась не теоретической.
 *
 * ИЗМЕРЕНО НА ЖИВОМ ПЕРИМЕТРЕ 18.09.2026 (infrasafe.uz, ответы 200):
 *
 *   /login.html            7 из 7 заголовков
 *   /css/style.css         ТОЛЬКО x-content-type-options
 *   /public/dist/theme-toggle.js   ТОЛЬКО x-content-type-options
 *   /brand/brand.css       ТОЛЬКО x-content-type-options
 *   /brand/favicon.svg     ТОЛЬКО x-content-type-options
 *   /api/buildings-metrics 6 из 7 — нет Permissions-Policy
 *
 * То есть весь статический ассет уходит без CSP, HSTS, X-Frame-Options и
 * Referrer-Policy. Причина в самом конфиге и прямо в нём описана: комментарии
 * `[R2-17] Re-emit nosniff — the add_header above drops the server-level…`
 * стоят в шести местах, но переизлучили в них ОДИН nosniff, а не набор.
 * Прежний тест этого увидеть не мог: нужные строки в файле есть — просто не в
 * тех блоках.
 *
 * Интереснее прочего здесь SVG: это документ, а не картинка. Открытый прямой
 * ссылкой `.svg` исполняется в нашем origin, и сейчас — без CSP.
 *
 * ЧЕГО ЭТОТ ТЕСТ НЕ ДЕЛАЕТ. Он не поднимает nginx и не знает правил ВЫБОРА
 * location (`=` / `^~` / регулярные / префиксные). Он отвечает на один вопрос:
 * «если этот блок сработает, потеряет ли он унаследованные заголовки». Именно
 * поэтому его вывод сверен с измерением выше: для классов ассетов модель и
 * живой периметр совпали.
 *
 * Исключения объявляются ЯВНО и со своей причиной. Смысл не в том, чтобы
 * запретить отступления, а в том, чтобы отступление было решением, а не
 * побочным следствием чужого `Cache-Control`.
 */

const fs = require('fs');
const path = require('path');

const { tlsVhosts, summarizeVhost, addHeaderNames } = require('../helpers/nginxConfig');

const ROOT = path.resolve(__dirname, '../../../');
const CONFIGS = ['nginx-config/nginx.production.conf', 'nginx-config/nginx.profk.conf'];
const SNIPPETS = { infrasafe: 'nginx-config/security-headers.infrasafe.conf', profk: 'nginx-config/security-headers.profk.conf' };

// Канонический набор — тот, что стоит на уровне server-блока.
const SECURITY_HEADERS = Object.freeze([
    'Strict-Transport-Security',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Content-Security-Policy',
    'Permissions-Policy',
]);

/**
 * Обоснованные отступления: location → {omit, why}. Всё, чего нет в этом
 * списке, тест считает случайной потерей.
 */
const snippetHeaders = Object.fromEntries(
    Object.entries(SNIPPETS).map(([slug, rel]) => [slug, new Set(addHeaderNames(fs.readFileSync(path.join(ROOT, rel), 'utf8')))])
);

/** Отступления на уровне ЦЕЛОГО вхоста — по `server_name`. */
const ALLOWED_VHOSTS = Object.freeze({
    'fountain.infrasafe.uz': {
        omit: ['Content-Security-Policy'],
        why: 'вхост запаркован 20.09.2026: отвечает 404 на всё, проксирования нет, страниц не отдаёт. '
            + 'CSP защищает содержимое документа — защищать здесь нечего. Остальные шесть заголовков '
            + 'оставлены: они относятся к транспорту и к самому имени, а не к странице. Панель живёт '
            + 'на основном хосте, её боевую политику сторожит отдельный тест ниже.',
    },
    'assets.profk.uz': {
        omit: ['X-XSS-Protection', 'Permissions-Policy'],
        why: 'отдельный origin под чужую SPA asset-web. Permissions-Policy не ставим намеренно: она '
            + 'режет доступ к камере/микрофону, а это не наше приложение и не нам решать, что ему нужно. '
            + 'X-XSS-Protection — отменённый заголовок, значение "0" ничего не добавляет.',
    },
});

/** Отступления на уровне location — по его записи в конфиге. */
const ALLOWED = Object.freeze({
    '/api/': {
        omit: ['X-Content-Type-Options', 'X-XSS-Protection', 'Referrer-Policy', 'Content-Security-Policy'],
        why: 'ответ проксируется из приложения, и эти четыре ставит helmet — дубль от nginx дал бы два '
            + 'разных CSP в одном ответе (браузер применил бы пересечение).',
    },
    '^~ /uk/': {
        omit: ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection', 'Referrer-Policy', 'Permissions-Policy'],
        why: 'чужая SPA УК со своим CSP (PENT-F16); её заголовки приходят от их апстрима, наш набор '
            + 'сузил бы её работу. M-21 в бэклоге — про то, чтобы зафиксировать это осознанно.',
    },
    '@maintenance': {
        omit: [],
        why: 'страница обслуживания переизлучает набор целиком и сознательно НЕ подключает общий '
            + 'снипет: у неё своя, более строгая CSP — общий притащил бы вторую.',
    },
});

describe('[CO-11] ни один location не теряет заголовки безопасности молча', () => {
    for (const rel of CONFIGS) {
        describe(rel, () => {
            const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            const vhosts = tlsVhosts(source);

            test('каждый TLS-вхост несёт полный набор на уровне server', () => {
                expect(vhosts.length).toBeGreaterThan(0);
                const gaps = [];
                for (const vhost of vhosts) {
                    const { serverHeaders } = summarizeVhost(vhost.body, snippetHeaders);
                    const allowed = ALLOWED_VHOSTS[vhost.name] ? ALLOWED_VHOSTS[vhost.name].omit : [];
                    const missing = SECURITY_HEADERS
                        .filter((h) => !serverHeaders.has(h) && !allowed.includes(h));
                    if (missing.length) gaps.push(`${vhost.name} → ${missing.join(', ')}`);
                }
                expect(gaps).toEqual([]);
            });

            test('location со своим add_header переизлучает набор или объявлен исключением', () => {
                const offenders = [];
                for (const vhost of vhosts) {
                    const { serverHeaders, locations } = summarizeVhost(vhost.body, snippetHeaders);
                    for (const loc of locations) {
                        const lost = SECURITY_HEADERS
                            .filter((h) => serverHeaders.has(h) && !loc.headers.has(h));
                        const allowed = ALLOWED[loc.name] ? ALLOWED[loc.name].omit : [];
                        const unexplained = lost.filter((h) => !allowed.includes(h));
                        if (unexplained.length) offenders.push(`${loc.name} → ${unexplained.join(', ')}`);
                    }
                }
                expect(offenders).toEqual([]);
            });
        });
    }

    test('[FOUNTAIN-CSP] боевая политика панели несёт настоящие хеши, а не послабления', () => {
        // Самый вероятный способ «починить» сломавшуюся панель — дописать
        // 'unsafe-inline'. С хешем он игнорируется браузером, но остаётся в
        // политике и однажды переживёт хеш, который его нейтрализовал.
        //
        // Раньше этот сторож смотрел на Report-Only поддомена. Поддомен
        // запаркован (20.09.2026), режим наблюдения своё отработал и дал новые
        // хеши; панель живёт на основном хосте под БОЕВЫМ заголовком, и сторож
        // переехал туда же. Ищем в локации, а не по файлу: политик в конфиге
        // много, и совпадение с чужой означало бы проверку, которая не падает.
        const prod = fs.readFileSync(path.join(ROOT, 'nginx-config/nginx.production.conf'), 'utf8');
        const start = prod.indexOf('location = /fountain/ {');
        expect(start).toBeGreaterThan(-1);
        const body = prod.slice(start, prod.indexOf('\n        }', start));

        const csp = /\n\s*add_header Content-Security-Policy\s+"([^"]+)"/.exec(body);
        expect(csp).not.toBeNull();
        expect(csp[1]).toMatch(/script-src 'sha256-[A-Za-z0-9+/]+='/);
        expect(csp[1]).toMatch(/style-src 'sha256-[A-Za-z0-9+/]+='/);
        expect(csp[1]).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
        // Встраивание в наш интерфейс: рамка своя, чужой быть не должно.
        expect(csp[1]).toMatch(/frame-ancestors 'self'/);
    });

    test('у каждого исключения записана причина', () => {
        // Список исключений без причин через полгода неотличим от списка недочётов.
        for (const [name, rule] of [...Object.entries(ALLOWED), ...Object.entries(ALLOWED_VHOSTS)]) {
            expect([name, rule.why.length > 40]).toEqual([name, true]);
        }
    });
});
