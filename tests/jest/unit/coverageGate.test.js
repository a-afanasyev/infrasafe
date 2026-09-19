'use strict';

/**
 * [CO-4] У фронтового кода появился порог покрытия — и он не врёт.
 *
 * Было: `collectCoverageFrom` = `src/**` и глобальный порог 80%. Весь `public/`
 * не собирался вовсе, то есть про него не было даже ОТЧЁТА. Следствие
 * измеримое: `domSecurity.js` — фронтовый рубеж против XSS — держался на 34%, а
 * `rateLimiter.js`, через который проходит каждый запрос карты, на 0%. Никакой
 * сигнал об этом прийти не мог.
 *
 * Стало: `public/utils/**` собирается, и у каталога свой порог. Он поставлен на
 * СЕГОДНЯШНЕМ уровне (≈77% операторов), а не на 80% — это храповик против
 * регресса, а не утверждение, что здесь всё хорошо. Четыре отстающих файла
 * названы поимённо со своими нижними границами: так каждый пробел виден в
 * конфиге, вместо того чтобы растворяться в среднем.
 *
 * Тонкость, которую стоит знать: порог по КАТАЛОГУ считает среднее по всем его
 * файлам, включая те, у которых есть собственный порог. Поимённые границы
 * защищают файл дополнительно, но из среднего его не вычитают (проверено
 * экспериментом: подъём каталожного порога до 95% даёт 77.55% — ровно общее
 * среднее). Поэтому каталожная цифра и есть настоящее текущее среднее.
 *
 * Монолиты `public/admin.js` и `public/script.js` (6228 строк вместе) в сборе
 * НЕ участвуют намеренно. Дорога к их покрытию — вынос логики в `public/utils/`
 * с тестами, как уже сделано с `buildingStatus`, `coordValidation`,
 * `buildingFormPayload` и `ukLinkBuilder`, а не снижение планки до их уровня.
 */

const fs = require('fs');
const path = require('path');

const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
const JEST = PKG.jest;

const UTILS_KEY = 'public/utils/';

describe('[CO-4] фронтовые утилиты попадают в покрытие', () => {
    test('public/utils собирается', () => {
        expect(JEST.collectCoverageFrom).toEqual(expect.arrayContaining(['public/utils/**/*.js']));
    });

    test('у каталога есть собственный порог', () => {
        // Без него файлы ушли бы в глобальный 80% и уронили бы его — или,
        // что хуже, кто-нибудь снизил бы глобальный порог ради них.
        expect(JEST.coverageThreshold[UTILS_KEY]).toBeDefined();
        for (const metric of ['statements', 'branches', 'functions', 'lines']) {
            expect([metric, JEST.coverageThreshold[UTILS_KEY][metric] > 0]).toEqual([metric, true]);
        }
    });

    test('глобальный порог не понижали ради фронта', () => {
        // Самый вероятный способ «починить» красный CI — и самый вредный.
        for (const metric of ['statements', 'branches', 'functions', 'lines']) {
            expect([metric, JEST.coverageThreshold.global[metric]]).toEqual([metric, 80]);
        }
    });

    test('монолиты не собираются — и это решение, а не забывчивость', () => {
        const patterns = JEST.collectCoverageFrom.join('\n');
        expect(patterns).not.toMatch(/public\/admin\.js/);
        expect(patterns).not.toMatch(/public\/script\.js/);
        // Дорога внутрь — вынос в public/utils/, а не снижение планки: в
        // каталоге уже лежат вынесенные из них модули.
        for (const extracted of ['buildingStatus.js', 'coordValidation.js', 'buildingFormPayload.js']) {
            expect([extracted, fs.existsSync(path.resolve(__dirname, '../../../public/utils', extracted))])
                .toEqual([extracted, true]);
        }
    });
});

describe('[CO-4] отстающие файлы названы поимённо', () => {
    const named = Object.keys(JEST.coverageThreshold).filter((k) => k.startsWith(`${UTILS_KEY}`) && k.endsWith('.js'));

    test('исключения существуют на диске — иначе jest падает на несуществующем пути', () => {
        expect(named.length).toBeGreaterThan(0);
        for (const key of named) {
            expect([key, fs.existsSync(path.resolve(__dirname, '../../..', key))]).toEqual([key, true]);
        }
    });

    test('каталожный порог не ниже, чем у названных исключений', () => {
        // Иначе исключение переставало бы быть исключением: каталог разрешал бы
        // ровно столько же, и поимённая строка превращалась бы в украшение.
        const dir = JEST.coverageThreshold[UTILS_KEY];
        const worst = named
            .map((k) => JEST.coverageThreshold[k].statements)
            .reduce((a, b) => Math.max(a, b), 0);
        expect(dir.statements).toBeGreaterThanOrEqual(worst);
    });
});
