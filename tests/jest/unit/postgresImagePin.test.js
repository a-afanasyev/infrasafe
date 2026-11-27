/**
 * Образ PostgreSQL/PostGIS: один и тот же на всех контурах, кроме площадки,
 * которая ещё не прошла окно перехода.
 *
 * Аудит #12 (16.11.2026): образ `postgis/postgis:15-3.5` давал PostgreSQL 15.13
 * при актуальной 15.19/15.20. Тег 15-3.5 проект больше не пересобирает; новые
 * минорные версии сервера приходят только с тегами 15-3.6 / 15-3.7, а вместе с
 * ними — другой Debian (glibc 2.31 → 2.41) и другой PostGIS.
 *
 * Поэтому смена образа — НЕ правка одной строки: на старом томе нужны REINDEX,
 * обновление версии collation и расширений (`scripts/pg-image-upgrade.sh`).
 * Отсюда два сторожа:
 *   * dev-стек и CI обязаны гонять тесты на том же образе, что идёт в прод, —
 *     иначе SQL проверяется на версии, которой в бою нет;
 *   * площадка, не прошедшая окно, должна быть ЯВНО закреплена на старом образе
 *     в своём оверлее: общий compose уже указывает на новый, и случайный
 *     `compose up -d postgres` молча сменил бы образ без REINDEX.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const compose = (rel) => yaml.load(read(rel));

const NEW = /^postgis\/postgis:15-3\.7@sha256:[0-9a-f]{64}$/;
const OLD = 'postgis/postgis:15-3.5@sha256:2a60827705ad26af212f31ca6ed4884f9fa95fffbe7eed5be516fece1bca25f8';

const unified = compose('docker-compose.unified.yml').services.postgres.image;

describe('образ PostgreSQL/PostGIS', () => {
    test('общий compose: 15-3.7, закреплён digest', () => {
        expect(unified).toMatch(NEW);
    });

    test('dev-стек (и его одноразовый dev-seed) — на том же образе, что прод', () => {
        const dev = compose('docker-compose.dev.yml').services;
        expect(dev.postgres.image).toBe(unified);
        expect(dev['dev-seed'].image).toBe(unified);
    });

    test('CI гоняет SQL-тесты на том же образе, что прод', () => {
        const ci = yaml.load(read('.github/workflows/ci.yml'));
        expect(ci.jobs.test.services.postgres.image).toBe(unified);
    });

    test('profk до своего окна явно закреплён на прежнем образе', () => {
        // Убрать строку из оверлея можно только вместе с прохождением окна:
        // snapshot → смена образа → finalize → verify (scripts/pg-image-upgrade.sh).
        expect(compose('docker-compose.profk.yml').services.postgres.image).toBe(OLD);
    });

    test('скрипт перехода на месте и исполняемый', () => {
        const file = path.join(root, 'scripts/pg-image-upgrade.sh');
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.statSync(file).mode & 0o111).not.toBe(0);
        const script = read('scripts/pg-image-upgrade.sh');
        for (const step of ['REINDEX DATABASE', 'REFRESH COLLATION VERSION', 'postgis_extensions_upgrade', 'bt_index_check']) {
            expect(script).toContain(step);
        }
    });
});
