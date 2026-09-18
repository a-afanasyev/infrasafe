'use strict';

/**
 * [CO-11] Минимальный разбор nginx-конфига — ровно под одну ловушку.
 *
 * Ловушка: `add_header` НЕ складывается. Любой `add_header` внутри `location`
 * отменяет наследование ВСЕХ `add_header` родительского `server`-блока. То есть
 * location, добавивший себе безобидный `Cache-Control`, молча теряет весь набор
 * заголовков безопасности — и конфиг при этом валиден, `nginx -t` доволен, а
 * грep по файлу находит нужные строки (они есть, просто не там).
 *
 * Чего этот разбор НЕ знает и знать не может: правил ВЫБОРА location. У nginx
 * своя иерархия (`=`, `^~`, регулярные, префиксные), поэтому «в этом блоке
 * потеряны заголовки» не равно «по такому URL заголовков не будет» — URL может
 * попасть в другой блок. Поэтому вывод разбора СВЕРЕН с живым периметром,
 * см. шапку `nginxHeaderInheritance.test.js`.
 */

/** Комментарии выкусываются построчно: внутри строковых значений '#' не встречается. */
function stripComments(source) {
    return source.split('\n').map((line) => line.replace(/#.*$/, '')).join('\n');
}

/** Тело блока по индексу открывающей скобки → [start, end) без самих скобок. */
function blockBody(source, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return [openIndex + 1, i];
        }
    }
    throw new Error('nginxConfig: несбалансированные скобки');
}

/**
 * Настоящие TLS-вхосты. `server_name _` — это catch-all, который обрывает
 * соединение, у него нет и не должно быть заголовков; включи его в разбор — и
 * «server-level набор» окажется пустым, а тест зелёным по недоразумению.
 */
function tlsVhosts(rawSource) {
    const source = stripComments(rawSource);
    const re = /\bserver\s*\{/g;
    const out = [];
    let match;
    while ((match = re.exec(source))) {
        const [start, end] = blockBody(source, match.index + match[0].length - 1);
        const body = source.slice(start, end);
        if (!/listen\s+443/.test(body) || /server_name\s+_\s*;/.test(body)) continue;
        const named = /server_name\s+([^;]+);/.exec(body);
        out.push({ name: named ? named[1].trim().split(/\s+/)[0] : '<без имени>', body });
    }
    return out;
}

/** location-блоки ПЕРВОГО уровня внутри переданного тела. */
function topLevelLocations(vhostBody) {
    const re = /\blocation\s+([^{]+?)\s*\{/g;
    const out = [];
    let match;
    while ((match = re.exec(vhostBody))) {
        const [start, end] = blockBody(vhostBody, match.index + match[0].length - 1);
        if (out.some((prev) => match.index > prev.start && match.index < prev.end)) continue;
        out.push({ name: match[1].trim(), start, end, body: vhostBody.slice(start, end) });
    }
    return out;
}

/** Имена заголовков из `add_header` (кавычки у CORS-заголовков сняты). */
function addHeaderNames(text) {
    const re = /\badd_header\s+'?([A-Za-z0-9-]+)'?/g;
    const out = [];
    let match;
    while ((match = re.exec(text))) out.push(match[1]);
    return out;
}

/** Имена подключаемых security-снипетов: `include …/security-headers.<slug>.conf;`. */
function includedSnippets(text) {
    const re = /\binclude\s+\S*?security-headers\.([A-Za-z0-9_-]+)\.conf\s*;/g;
    const out = [];
    let match;
    while ((match = re.exec(text))) out.push(match[1]);
    return out;
}

/**
 * Заголовки блока с УЧЁТОМ include'ов. Без этого разбор считал бы, что блок с
 * одним `include` не ставит ничего, — то есть врал бы ровно в ту сторону, ради
 * которой снипет и заведён.
 */
function effectiveHeaders(text, snippets) {
    const out = new Set(addHeaderNames(text));
    for (const slug of includedSnippets(text)) {
        const fromSnippet = snippets[slug];
        if (!fromSnippet) throw new Error(`nginxConfig: не найден снипет security-headers.${slug}.conf`);
        for (const header of fromSnippet) out.add(header);
    }
    return out;
}

/**
 * Сводка по одному вхосту: что ставит сам server-блок и что ставит каждый
 * location, у которого есть СВОЙ add_header (только такие теряют наследование).
 */
function summarizeVhost(vhostBody, snippets = {}) {
    const locations = topLevelLocations(vhostBody);
    // Вырезаем location-тела, чтобы остались только директивы самого server'а.
    let bare = vhostBody;
    for (const loc of locations.slice().reverse()) bare = bare.slice(0, loc.start) + bare.slice(loc.end);

    return {
        serverHeaders: effectiveHeaders(bare, snippets),
        // Наследование отменяет сам факт `add_header` в блоке; `include` со
        // снипетом — это тоже add_header, просто из другого файла.
        locations: locations
            .map((loc) => ({ name: loc.name, headers: effectiveHeaders(loc.body, snippets) }))
            .filter((loc) => loc.headers.size > 0),
    };
}

module.exports = { stripComments, tlsVhosts, topLevelLocations, addHeaderNames, includedSnippets, effectiveHeaders, summarizeVhost };
