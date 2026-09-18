'use strict';

/**
 * [A-26] README описывает слои честно.
 *
 * Находка аудита 08.09.2026: README утверждал строгую цепочку
 * Controllers → Services → Models, а в коде DB-хелперы зовутся прямо из
 * админ-контроллеров, SQL живёт и в сервисах, а модель `User` зависит от
 * кэш-сервиса. Схема была не описанием, а пожеланием.
 *
 * Правка — не введение repository-слоя (он дороже проблемы), а фиксация трёх
 * отступлений с владельцами. Но зафиксированное в документе расходится с кодом
 * ровно так же молча, как разошлась исходная схема. Поэтому тест связывает обе
 * половины: каждое названное отступление должно быть НАЗВАНО в README и
 * по-прежнему ВЕРНО в коде.
 *
 * Тест сработает и когда отступление исчезнет — это тоже правда, которую надо
 * донести до README, а не «ложное срабатывание».
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const README = read('README.md');

describe('[A-26] отступления от слоёв названы в README', () => {
    test('генератор списков в админ-контроллерах', () => {
        expect(README).toMatch(/adminQueryBuilder/);
    });

    test('SQL в сервисах', () => {
        expect(README).toMatch(/SQL живёт и в сервисах/);
    });

    test('зависимость модели от кэш-сервиса', () => {
        expect(README).toMatch(/models\/User\.js.*cacheService/);
    });

    test('сказано, что repository-слоя нет и не планируется', () => {
        // Иначе следующий читатель примет отсутствие слоя за недоделку.
        expect(README).toMatch(/[Rr]epository-слоя[\s\S]{0,40}не планируется/);
    });
});

describe('[A-26] названные отступления всё ещё верны в коде', () => {
    test('админ-контроллер зовёт buildPaginatedList с пулом', () => {
        const ctrl = read('src/controllers/admin/adminBuildingController.js');
        expect(ctrl).toMatch(/buildPaginatedList\(\s*pool/);
    });

    test('модель User требует cacheService', () => {
        const user = read('src/models/User.js');
        expect(user).toMatch(/require\('\.\.\/services\/cacheService'\)/);
    });

    test('сервис из списка действительно содержит SQL', () => {
        const svc = read('src/services/buildingMetricsService.js');
        expect(svc).toMatch(/db\.query\(/);
    });
});
