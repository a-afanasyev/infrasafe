/**
 * [аудит #12, п. 11] Нижняя граница версии вендорного DOMPurify.
 *
 * `public/libs/dompurify/purify.min.js` лежит в репозитории файлом, а не
 * зависимостью: `npm audit` и Dependabot его не видят, и версия 3.2.7 с
 * известными уязвимостями прожила так полгода. Этот тест — единственное место,
 * где устаревание вендорного файла становится красным.
 *
 * Когда выходит исправление безопасности DOMPurify: обновить файл (dist из
 * npm-пакета, сверив integrity) и поднять MIN_VERSION здесь. Поведение
 * санитайзера на тех же байтах проверяет domSecurity.sanitize.test.js.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const PURIFY = path.join(root, 'public/libs/dompurify/purify.min.js');
const MIN_VERSION = [3, 5, 0];

const PAGES = ['frontend-html/index.html', 'frontend-html/admin.html', 'frontend-html/login.html'];

const banner = () => /@license DOMPurify (\d+)\.(\d+)\.(\d+)/.exec(fs.readFileSync(PURIFY, 'utf8').slice(0, 300));

describe('вендорный DOMPurify', () => {
    test(`версия не ниже ${MIN_VERSION.join('.')}`, () => {
        const match = banner();
        expect(match).not.toBeNull();
        const version = match.slice(1, 4).map(Number);
        const cmp = version.map((n, i) => n - MIN_VERSION[i]).find((d) => d !== 0) ?? 0;
        expect([version.join('.'), cmp >= 0]).toEqual([version.join('.'), true]);
    });

    test('заявленная в баннере версия совпадает с той, что отдаёт сам модуль', () => {
        // Баннер — комментарий; подменить его, не обновив код, было бы самообманом.
        const [, major, minor, patch] = banner();
        const factory = require(PURIFY);
        expect(factory.version).toBe(`${major}.${minor}.${patch}`);
    });

    test.each(PAGES)('%s подключает файл с версией в cache-buster', (page) => {
        // .js на edge кэшируется надолго: без смены `?v=` браузеры продолжили бы
        // исполнять старую, уязвимую копию.
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        const [, major, minor, patch] = banner();
        expect(html).toContain(`public/libs/dompurify/purify.min.js?v=${major}.${minor}.${patch}"`);
    });
});
