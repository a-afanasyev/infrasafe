/**
 * Режим обслуживания ProFK: имя флага живёт в трёх файлах — в edge-конфиге
 * (`if (-f …)`) и в двух скриптах, которые его ставят и снимают. Переименовать
 * его в одном месте и забыть про остальные — значит получить переключатель,
 * который «срабатывает» без единого эффекта: скрипт создаст файл, nginx будет
 * смотреть на другой, сайт останется жив.
 *
 * Тест сверяет ровно это совпадение, а поведение самого гейта проверяется
 * поднятием реального конфига в контейнере (см. docs/MAINTENANCE-MODE-PROFK.md).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const CONF = read('nginx-config/nginx.profk.conf');
const ON = read('scripts/profk-maintenance-on.sh');
const OFF = read('scripts/profk-maintenance-off.sh');

// Имя файла-флага, как его видит nginx: /srv/frontend-html/<имя>
const confFlag = CONF.match(/if \(-f \/srv\/frontend-html\/([^)\s]+)\)/);

describe('режим обслуживания ProFK', () => {
    test('конфиг проверяет флаг в примонтированном каталоге', () => {
        expect(confFlag).not.toBeNull();
        expect(confFlag[1]).toBe('.maintenance');
    });

    test('оба скрипта работают с тем же именем флага', () => {
        const name = confFlag[1];
        expect(ON).toContain(`frontend-html/${name}`);
        expect(OFF).toContain(`frontend-html/${name}`);
    });

    test('«включить» снимает флаг, «выключить» ставит', () => {
        expect(ON).toMatch(/^touch "\$FLAG"/m);
        expect(OFF).toMatch(/^rm -f "\$FLAG"/m);
    });

    test('оба скрипта проверяют результат, а не рапортуют по факту touch/rm', () => {
        // Без этой проверки скрипт молча «успешен», даже когда правка конфига
        // ещё не доехала до хоста и флаг ни на что не влияет.
        for (const [name, src] of [['on', ON], ['off', OFF]]) {
            expect(src).toMatch(/curl .*%\{http_code\}/);
            expect(`${name}:${src.includes('exit 1')}`).toBe(`${name}:true`);
        }
    });

    test('страница-заглушка существует и самодостаточна (ни одного внешнего запроса)', () => {
        const page = read('frontend-html/maintenance.html');
        expect(page).toContain('Сайт временно не работает');
        // Единственная разрешённая внешняя ссылка — favicon из /brand/,
        // который из режима исключён. Ни script-, ни link rel=stylesheet.
        expect(page).not.toMatch(/<script/i);
        expect(page).not.toMatch(/rel=["']stylesheet["']/i);
        expect(page).not.toMatch(/https?:\/\//);
    });

    test('исключения гейта перечислены в конфиге (предохранители не потеряны)', () => {
        const exempt = CONF.slice(CONF.indexOf('map $uri $maint_exempt'));
        for (const p of ['/health', '/\\.well-known/', '/brand/', 'access']) {
            expect(exempt).toContain(p);
        }
    });
});
