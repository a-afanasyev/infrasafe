/**
 * [SE-1] asset-web вынесен на отдельный origin.
 *
 * Пока карта имущества жила по адресу profk.uz/assets/, она делила origin с
 * InfraSafe. Куки авторизации выставлены с `path: '/'` (src/utils/authCookies.js),
 * поэтому браузер слал их на ЛЮБОЙ same-origin запрос — включая инициированные
 * скриптом из /assets/. CSRF Origin-guard такой запрос пропускает (Origin
 * совпадает с allowlist), SameSite=strict тоже не помеха. Итог: XSS в стороннем
 * asset-web давал authenticated fetch к /api/* от имени администратора.
 * CSP на той локации вдобавок разрешал `script-src 'unsafe-inline'`.
 *
 * Вынос на assets.profk.uz закрывает вектор по определению: другой origin —
 * другие куки. На старом пути остаётся только 301, то есть с нашего origin
 * больше не отдаётся НИ ОДНОГО байта стороннего приложения.
 */

const fs = require('fs');
const path = require('path');

const CONFIG = fs.readFileSync(
    path.join(__dirname, '../../../nginx-config/nginx.profk.conf'),
    'utf8'
);

/** Тело server-блока по его server_name. */
function serverBlock(serverName) {
    const marker = `server_name ${serverName};`;
    const at = CONFIG.indexOf(marker);
    if (at === -1) return null;
    const start = CONFIG.lastIndexOf('server {', at);
    // Ищем закрывающую скобку блока по балансу — вложенные location мешают
    // наивному indexOf('}').
    let depth = 0;
    for (let i = start; i < CONFIG.length; i++) {
        if (CONFIG[i] === '{') depth++;
        else if (CONFIG[i] === '}') {
            depth--;
            if (depth === 0) return CONFIG.slice(start, i + 1);
        }
    }
    return null;
}

describe('[SE-1] карта имущества не делит origin с InfraSafe', () => {
    test('появился отдельный server-блок assets.profk.uz', () => {
        expect(CONFIG).toContain('server_name assets.profk.uz;');
    });

    test('поддомен проксирует именно asset-web', () => {
        const block = serverBlock('assets.profk.uz');
        expect(block).not.toBeNull();
        expect(block).toMatch(/proxy_pass\s+http:\/\/\$?\w+/);
        expect(block).toContain('asset-web');
    });

    test('на основном домене стороннее приложение больше не проксируется', () => {
        const main = serverBlock('profk.uz');
        expect(main).not.toBeNull();
        // Ни одного proxy_pass на asset-web из основного origin.
        const assetsProxy = /location\s+\^~\s+\/assets\/\s*\{[^}]*proxy_pass/s.test(main);
        expect(assetsProxy).toBe(false);
    });

    test('старый путь /assets/ отвечает редиректом на поддомен', () => {
        const main = serverBlock('profk.uz');
        expect(main).toMatch(/assets\.profk\.uz/);
        expect(main).toMatch(/permanent|301/);
    });

    test('ACME-челлендж работает и для поддомена (иначе сертификат не выпустить)', () => {
        // Порт 80 обслуживает оба имени: без этого certbot --expand не пройдёт
        // http-01 для нового SAN.
        expect(CONFIG).toMatch(/server_name\s+profk\.uz\s+assets\.profk\.uz;/);
    });

    test('поддомен не получает CORS-заголовков основного приложения', () => {
        const block = serverBlock('assets.profk.uz');
        expect(block).not.toMatch(/Access-Control-Allow-Credentials/);
    });
});
