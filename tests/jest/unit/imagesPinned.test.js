'use strict';

/**
 * [N-12] Образы закреплены: мажор/минор в теге и digest.
 *
 * `nginx:alpine` на периметре приезжал тем, что лежало в реестре в момент pull:
 * 28.09.2026 на profk работал nginx 1.31.2, на .105 — 1.29.3, то есть две
 * площадки из одного репозитория жили на разных версиях, и любой пересоздание
 * контейнера молча меняло мажор. Остальные образы шли тегом без digest, а
 * Dependabot compose-файлы не видел вовсе.
 *
 * Правило: у каждого внешнего образа в compose-файлах, Dockerfile'ах и скриптах
 * выкатки есть `@sha256:`. Свои образы (infrasafe-*) собираются здесь же.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const FILES = [
    'docker-compose.unified.yml',
    'docker-compose.dev.yml',
    'tests/migrate/docker-compose.migrate-test.yml',
    'Dockerfile.unified',
    'Dockerfile.dev',
    'Dockerfile.frontend.dev',
    'scripts/deploy-uk.sh',
];
const OWN = /^(infrasafe-|ghcr\.io\/a-afanasyev\/)/;

function imageRefs(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const refs = [];
    for (const line of src.split('\n')) {
        if (/^\s*#/.test(line)) continue;
        const m = /^\s*image:\s*["']?([^\s"']+)/.exec(line)
            || /^\s*FROM\s+(\S+)/i.exec(line)
            || /\b((?:[a-z0-9.-]+\/)?(?:nginx|node|redis|postgres|postgis\/postgis):[^\s@]+(?:@sha256:[a-f0-9]{64})?)\s+nginx\s+-t\b/.exec(line);
        if (m) refs.push(m[1]);
    }
    return refs.filter((r) => !OWN.test(r) && !r.includes('${'));
}

describe('[N-12] внешние образы закреплены digest-ом', () => {
    test.each(FILES)('%s', (file) => {
        const refs = imageRefs(file);
        expect(refs.length).toBeGreaterThan(0);
        expect(refs.filter((r) => !/@sha256:[a-f0-9]{64}$/.test(r))).toEqual([]);
    });

    test('периметр и фронтенд на одной версии nginx', () => {
        const nginx = new Set(FILES.flatMap(imageRefs).filter((r) => r.startsWith('nginx:')));
        expect(nginx.size).toBe(1);
    });

    test('Dependabot видит compose-файлы', () => {
        const cfg = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
        expect(cfg).toMatch(/package-ecosystem:\s*docker-compose/);
        expect(cfg).toMatch(/package-ecosystem:\s*docker\b/);
    });
});
