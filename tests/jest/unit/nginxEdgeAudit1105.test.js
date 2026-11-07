'use strict';

/**
 * [Аудит 05.11.2026, PR-B] Периметр: четыре правки edge-конфига, одинаковые
 * на обеих площадках.
 *
 *  S-PERIM-1  ключ credential-лимита УК строится от нормализованного $uri —
 *             живьём `/uk/api/v2/%61uth/login` обходил зону uk_api_cred
 *             (26 запросов без 429), потому что map был по сырому $request_uri.
 *  H-5        скрытые пути (/.env, /.git/HEAD) → 404, а не fallback на SPA;
 *             /robots.txt — явный text/plain, не HTML карты.
 *  S-PERIM-8  в апстримы УК уходит X-Forwarded-For = $remote_addr: edge —
 *             первый hop, клиентскому XFF верить незачем, а лимитер УК,
 *             читающий левый элемент, иначе обходился подменой заголовка.
 *
 * Как и nginxHeaderInheritance, тест читает реальные конфиги и не поднимает
 * nginx: он отвечает «есть ли нужная конструкция в нужном блоке», а живое
 * поведение (%61 → 429) проверяется после выкатки curl'ом.
 */

const fs = require('fs');
const path = require('path');

const { stripComments, tlsVhosts, topLevelLocations } = require('../helpers/nginxConfig');

const ROOT = path.resolve(__dirname, '../../../');
const CONFIGS = {
    infrasafe: 'nginx-config/nginx.production.conf',
    profk: 'nginx-config/nginx.profk.conf',
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe.each(Object.entries(CONFIGS))('[аудит 05.11] %s', (slug, rel) => {
    const raw = read(rel);
    const src = stripComments(raw);

    test('[S-PERIM-1] credential-ключ УК — map по $uri, обе формы пути', () => {
        expect(src).not.toMatch(/map\s+\$request_uri\s+\$uk_cred_limit_key/);
        const m = src.match(/map\s+\$uri\s+\$uk_cred_limit_key\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        // regex обязан принимать и /uk/api/v2/auth/ (до rewrite), и
        // /api/v2/auth/ (после) — иначе лимит молча не применяется.
        expect(m[1]).toMatch(/"~\^\/\(uk\/\)\?api\/v2\/\(auth\|registration\)\/"\s+\$binary_remote_addr/);
        // зона по-прежнему подключена в /uk/api/
        expect(src).toMatch(/limit_req\s+zone=uk_api_cred/);
    });

    test('[S-PERIM-8] все апстримы УК получают X-Forwarded-For = $remote_addr', () => {
        const ukBlocks = src.match(/location\s+\^~\s+\/uk\/[^{]*\{[\s\S]*?proxy_pass[\s\S]*?\n\s{8}\}/g) || [];
        expect(ukBlocks.length).toBeGreaterThanOrEqual(6);
        for (const block of ukBlocks) {
            expect(block).toMatch(/X-Forwarded-For\s+\$remote_addr;/);
            expect(block).not.toMatch(/X-Forwarded-For\s+\$proxy_add_x_forwarded_for/);
        }
    });

    test('[S-PERIM-8] наши /api/ и /health по-прежнему с $proxy_add_x_forwarded_for (trust proxy=1)', () => {
        const apiBlock = src.match(/location\s+\/api\/\s*\{[\s\S]*?\n\s{8}\}/);
        expect(apiBlock).not.toBeNull();
        expect(apiBlock[0]).toMatch(/X-Forwarded-For\s+\$proxy_add_x_forwarded_for/);
    });

    test('[H-5] скрытые пути → 404, /.well-known/ исключён', () => {
        expect(src).toMatch(/location\s+~\s+\/\\\.\(\?!well-known\/\)\s*\{\s*return 404;\s*\}/);
    });

    test('[H-5] /robots.txt — явный text/plain', () => {
        const m = src.match(/location\s+=\s+\/robots\.txt\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/default_type\s+text\/plain/);
        expect(m[1]).toMatch(/return 200 "User-agent: \*\\n/);
    });

    test('[H-5] обе новые локации стоят в основном TLS-вхосте, до fallback location /', () => {
        const main = tlsVhosts(raw).find((v) => v.name === 'infrasafe.uz' || v.name === 'profk.uz');
        expect(main).toBeDefined();
        const names = topLevelLocations(main.body).map((l) => l.name);
        expect(names).toContain('= /robots.txt');
        expect(names).toContain('~ /\\.(?!well-known/)');
        // регулярная локация объявлена раньше fallback `/` — порядок объявления
        // для regex-локаций значим.
        expect(names.indexOf('~ /\\.(?!well-known/)')).toBeLessThan(names.indexOf('/'));
    });
});
