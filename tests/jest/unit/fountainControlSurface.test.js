'use strict';

/**
 * [FOUNTAIN] Фонтан снят с публикации — и обязан остаться снятым.
 *
 * 20.09.2026 решением владельца обе внешние поверхности убраны: поддомен
 * fountain.infrasafe.uz и путь /fountain/ на основном хосте вместе с
 * одиннадцатью управляющими путями. Наружу фонтан будет показан состоянием на
 * карте через MQTT, а не проксированием чужой веб-страницы.
 *
 * Раньше этот файл сторожил ОБРАТНОЕ: что открыт ровно согласованный набор
 * путей и что у каждого есть все три барьера. Инвариант перевернулся, и
 * перевернулся сторож — но не исчез, потому что вернуть поверхность легко:
 * это несколько строк конфига и одна перезагрузка. `nginx -t` такой возврат
 * пропустит, а снаружи он означает путь к физическому оборудованию.
 *
 * Что здесь проверяется:
 *   1. ни одна локация не проксирует к контроллеру;
 *   2. внутренних сторожей auth_request для фонтана не осталось;
 *   3. бывшие адреса отвечают 410, а не проваливаются в раздачу статики;
 *   4. имя поддомена сохранено там, где оно нужно сертификату, — и только там.
 */

const fs = require('fs');
const path = require('path');
const { tlsVhosts, topLevelLocations, stripComments } = require('../helpers/nginxConfig');

const CONF = fs.readFileSync(
    path.resolve(__dirname, '../../../nginx-config/nginx.production.conf'), 'utf8'
);

/** Снипеты проксирования к контроллеру: их подключение = открытая поверхность. */
const FOUNTAIN_SNIPPETS = [
    'fountain-upstream.conf',
    'fountain-gateway-auth.conf',
    'fountain-control.conf',
];

describe('[FOUNTAIN] к контроллеру из периметра пути нет', () => {
    test('ни один вхост не подключает снипеты фонтана', () => {
        const offenders = [];
        for (const vhost of tlsVhosts(CONF)) {
            for (const snippet of FOUNTAIN_SNIPPETS) {
                if (vhost.body.includes(snippet)) offenders.push(`${vhost.name} → ${snippet}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('апстрим фонтана нигде не адресуется', () => {
        // Переменная объявлялась в снипете, но проксировать можно и напрямую
        // по адресу в туннеле — эту форму регулярка выше не ловит.
        const source = stripComments(CONF);
        expect(source).not.toMatch(/\$fountain_upstream/);
        expect(source).not.toMatch(/10\.13\.13\.12/);
    });

    test('внутренних сторожей фонтана не осталось', () => {
        // Сторожа были `internal` и снаружи недостижимы, но их наличие
        // означало бы, что рядом живёт локация, ради которой они заведены.
        const source = stripComments(CONF);
        expect(source).not.toMatch(/__fountain_gate/);
        expect(source).not.toMatch(/fountain_audit/);
    });

    test('управляющих путей нет ни одного', () => {
        const source = stripComments(CONF);
        expect([...source.matchAll(/location[^{]*\/fountain\/control/g)].map((m) => m[0])).toEqual([]);
    });
});

describe('[FOUNTAIN] бывшие адреса отвечают 410', () => {
    const main = tlsVhosts(CONF).find((v) => v.name === 'infrasafe.uz');

    test('основной вхост найден', () => {
        expect(main).toBeDefined();
    });

    test.each(['= /fountain', '^~ /fountain/'])('location %s → 410', (selector) => {
        const loc = topLevelLocations(main.body).find((l) => l.name === selector);
        expect([selector, loc !== undefined]).toEqual([selector, true]);
        expect(loc.body).toMatch(/return 410;/);
    });

    test('410, а не проваливание в раздачу статики', () => {
        // Без явной локации `/fountain/` попал бы в `location /` с try_files и
        // ответил 200 на index.html — то есть адрес выглядел бы рабочим.
        const loc = topLevelLocations(main.body).find((l) => l.name === '^~ /fountain/');
        expect(loc.body).not.toMatch(/try_files|proxy_pass|root\s/);
    });
});

describe('[FOUNTAIN] поддомен запаркован', () => {
    const vhost = tlsVhosts(CONF).find((v) => v.name === 'fountain.infrasafe.uz');

    test('вхост существует — имя остаётся в сертификате, отвечать оно обязано', () => {
        // Удалить блок целиком тоже можно, но тогда имя провалится в catch-all,
        // а в сертификате останется SAN, про который никто уже не вспомнит.
        expect(vhost).toBeDefined();
    });

    test('единственная локация отдаёт 410', () => {
        const locations = topLevelLocations(vhost.body);
        expect(locations.map((l) => l.name)).toEqual(['/']);
        expect(locations[0].body).toMatch(/return 410;/);
    });

    test('имя по-прежнему обслуживается ACME-вхостом на :80', () => {
        // Иначе обновление сертификата ОБЩЕГО имени начнёт падать на
        // недостижимом домене и утянет за собой infrasafe.uz.
        //
        // Искать имя по всему файлу здесь НЕЛЬЗЯ: оно есть и в запаркованном
        // 443-вхосте выше, то есть проверка проходила бы, даже если из
        // ACME-блока имя удалили. Сужаем до блока, который слушает :80.
        const source = stripComments(CONF);
        const acmeNames = [...source.matchAll(/\bserver\s*\{([\s\S]*?)\n {4}\}/g)]
            .map((m) => m[1])
            .filter((body) => /listen\s+80\b/.test(body))
            .flatMap((body) => [...body.matchAll(/server_name\s+([^;]+);/g)].map((m) => m[1]));

        expect(acmeNames.join(' ')).toContain('fountain.infrasafe.uz');
    });
});
