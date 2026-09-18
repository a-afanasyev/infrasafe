'use strict';

/**
 * [A-20] CSRF-запрос CodeQL не исключается глобально.
 *
 * Исключение `js/missing-token-validation` стояло с обоснованием «проект
 * использует JWT в заголовке Authorization, а НЕ cookie-сессии». На момент
 * написания это было верно. Сегодня — нет: с [P1-2] токены живут в
 * HttpOnly-куках, и middleware читает их оттуда. Браузер снова отправляет
 * учётные данные автоматически — ровно условие, при котором CSRF работает.
 *
 * Настоящая защита — Origin-guard (SEC-23). Но защита и АНАЛИЗ — разные вещи:
 * глобальное исключение делало слепой зоной весь класс находок.
 *
 * Тест связывает три факта, которые разошлись молча: куки-аутентификация,
 * наличие guard'а и состав фильтров CodeQL. Разойдись они снова — и
 * обоснование опять переживёт условия, при которых было верным.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');

const ROOT = path.resolve(__dirname, '../../../');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CONFIG_RAW = read('.github/codeql/codeql-config.yml');
const CONFIG = YAML.load(CONFIG_RAW);
const excludedIds = (CONFIG['query-filters'] || [])
    .map((f) => f.exclude && f.exclude.id)
    .filter(Boolean);

describe('[A-20] CSRF-анализ не выключен глобально', () => {
    test('js/missing-token-validation НЕ в списке исключений', () => {
        expect(excludedIds).not.toContain('js/missing-token-validation');
    });

    test('остальные исключения на месте — снято ровно одно', () => {
        // Чтобы правка не оказалась случайной зачисткой всего файла.
        expect(excludedIds).toEqual(
            expect.arrayContaining(['js/user-controlled-bypass', 'js/missing-rate-limiting'])
        );
    });

    test('условие, отменившее прежнее обоснование, всё ещё верно', () => {
        // Аутентификация действительно читает токен из куки.
        const auth = read('src/middleware/auth.js');
        expect(auth).toMatch(/extractAccessToken/);
        const cookies = read('src/utils/authCookies.js');
        expect(cookies).toMatch(/httpOnly/i);
    });

    test('Origin-guard подключён — он и есть защита', () => {
        const routes = read('src/routes/index.js');
        expect(routes).toMatch(/csrfOriginGuard/);
        expect(routes).toMatch(/router\.use\(csrfOriginGuard\)/);
    });

    test('в конфиге записано, почему исключение снято', () => {
        // Иначе следующий, кто увидит шум находок, вернёт исключение обратно.
        expect(CONFIG_RAW).toMatch(/A-20/);
        expect(CONFIG_RAW).toMatch(/поштучно|Security-вкладке/i);
    });
});
