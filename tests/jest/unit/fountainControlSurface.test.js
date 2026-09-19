'use strict';

/**
 * [FOUNTAIN] Поверхность управления фонтаном — ровно та, что согласована.
 *
 * Управление включает физическое оборудование, поэтому список путей — это не
 * настройка, а граница. Разработчик прислал её поимённо и отдельно оговорил:
 * подстановки не нужны. Подстановка здесь опасна не тем, что широка сегодня, а
 * тем, что молча расширится завтра: в прошивке появится новое реле, и оно
 * окажется доступно снаружи без единой правки конфига и без обсуждения.
 *
 * Тест сверяет три вещи, каждая из которых ломается независимо:
 *   1. открыт ровно согласованный набор путей — ни больше, ни меньше;
 *   2. у каждой управляющей локации есть ВСЕ три барьера (роль, Origin,
 *      признак панели) — общий include физически не даёт им разойтись, но
 *      подключить его забыть можно;
 *   3. закрытое остаётся закрытым: OTA и штатные ветки ESPHome.
 */

const fs = require('fs');
const path = require('path');

const CONF = fs.readFileSync(
    path.resolve(__dirname, '../../../nginx-config/nginx.production.conf'), 'utf8'
);
const CONTROL_INCLUDE = fs.readFileSync(
    path.resolve(__dirname, '../../../nginx-config/fountain-control.conf'), 'utf8'
);

/** Согласовано письмом разработчика 20.09.2026 (тестовый режим стенда). */
const RELAYS = ['jet_1', 'jet_2', 'circulation_1', 'circulation_2'];
const CONTROL_PATHS = [
    ...RELAYS.flatMap((r) => [`/fountain/control/${r}/start`, `/fountain/control/${r}/stop`]),
    '/fountain/control/stop_all',
];
const READ_PATHS = ['/fountain/', '/fountain/events'];

/** Тело локации `location = <path> { … }` из конфига. */
function locationBody(conf, exactPath) {
    const marker = `location = ${exactPath} {`;
    const start = conf.indexOf(marker);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start + marker.length - 1; i < conf.length; i++) {
        if (conf[i] === '{') depth++;
        else if (conf[i] === '}') {
            depth--;
            if (depth === 0) return conf.slice(start, i + 1);
        }
    }
    return null;
}

describe('[FOUNTAIN] открыт ровно согласованный набор', () => {
    test.each(READ_PATHS)('%s открыт на чтение', (p) => {
        const body = locationBody(CONF, p);
        expect([p, body !== null]).toEqual([p, true]);
        expect(body).toMatch(/limit_except GET/);
        expect(body).toMatch(/auth_request \/__fountain_gate_read/);
    });

    test.each(CONTROL_PATHS)('%s открыт на POST и только админу', (p) => {
        const body = locationBody(CONF, p);
        expect([p, body !== null]).toEqual([p, true]);
        expect(body).toMatch(/limit_except POST/);
        expect(body).toMatch(/include .*fountain-control\.conf/);
    });

    test('лишних управляющих путей нет', () => {
        // Перечисление в конфиге обязано совпадать с согласованным списком.
        // Появление двенадцатого пути — повод для разговора, а не для молчания.
        const found = [...CONF.matchAll(/location = (\/fountain\/control\/[^\s]+) \{/g)]
            .map((m) => m[1])
            .sort();
        const expected = [...CONTROL_PATHS, '/fountain/control/capabilities'].sort();
        expect(found).toEqual(expected);
    });

    test('подстановок в путях фонтана нет', () => {
        // Ни regex-локаций, ни префиксных `^~` под /fountain/control/.
        expect(CONF).not.toMatch(/location\s+~\s*\^?\/fountain/);
        expect(CONF).not.toMatch(/location\s+\^~\s*\/fountain\/control/);
    });
});

describe('[FOUNTAIN] у управления три барьера, и ни один не потерян', () => {
    test('общая часть требует роль, Origin и признак панели', () => {
        expect(CONTROL_INCLUDE).toMatch(/auth_request \/__fountain_gate_admin/);
        expect(CONTROL_INCLUDE).toMatch(/\$http_origin != "https:\/\/infrasafe\.uz"/);
        expect(CONTROL_INCLUDE).toMatch(/\$http_x_fountain_control != "1"/);
    });

    test('общая часть НЕ ставит add_header', () => {
        // [CO-11] Любой add_header внутри location обнуляет весь серверный
        // набор заголовков безопасности. Одна строка про кеш стоила бы шести
        // про защиту, причём молча.
        const directives = CONTROL_INCLUDE
            .split('\n')
            .filter((l) => /^\s*add_header\s/.test(l));
        expect(directives).toEqual([]);
    });

    test('каждая управляющая локация подключает общую часть', () => {
        // Барьеры живут в одном файле именно ради этого: разойтись они не
        // могут, но забыть подключить — можно.
        for (const p of [...CONTROL_PATHS, '/fountain/control/capabilities']) {
            const body = locationBody(CONF, p);
            expect([p, /include .*fountain-control\.conf/.test(body)]).toEqual([p, true]);
        }
    });

    test('команды не повторяются автоматически при отказе апстрима', () => {
        // Повтор POST — это вторая команда реле. Требование разработчика.
        const upstream = fs.readFileSync(
            path.resolve(__dirname, '../../../nginx-config/fountain-upstream.conf'), 'utf8'
        );
        expect(upstream).toMatch(/proxy_next_upstream off/);
    });
});

describe('[FOUNTAIN] закрытое осталось закрытым', () => {
    test('клиентский Authorization до устройства не доходит', () => {
        // Иначе пользователь подставил бы свои учётные данные устройства и
        // обошёл нашу проверку роли.
        const upstream = fs.readFileSync(
            path.resolve(__dirname, '../../../nginx-config/fountain-upstream.conf'), 'utf8'
        );
        expect(upstream).toMatch(/proxy_set_header Authorization ""/);
    });

    test('вызов Basic от устройства не доходит до браузера', () => {
        // Иначе поверх страницы всплывёт системное окно ввода пароля, а внутри
        // iframe браузер его заблокирует и оставит пустую рамку.
        const upstream = fs.readFileSync(
            path.resolve(__dirname, '../../../nginx-config/fountain-upstream.conf'), 'utf8'
        );
        expect(upstream).toMatch(/proxy_hide_header WWW-Authenticate/);
    });

    test('OTA и штатные ветки ESPHome не опубликованы', () => {
        for (const closed of ['/update', '/switch/', '/button/', '/light/']) {
            expect([closed, CONF.includes(`location = /fountain${closed}`)]).toEqual([closed, false]);
        }
    });
});
