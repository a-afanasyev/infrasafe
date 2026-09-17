'use strict';

/**
 * [A-24] Именованный том генератора монтируется на КАТАЛОГ, а не на файл.
 *
 * Дефект: `- generator_data:/app/generator-data.json`. Именованный том,
 * смонтированный на путь ФАЙЛА, Docker создаёт как КАТАЛОГ. Дальше
 * `existsSync` отвечает true, `readFileSync` падает с `EISDIR`,
 * `writeFileSync` тоже — а обе ошибки глотались пустыми `catch`. API отвечал
 * «сохранено», и настройки исчезали при каждом перезапуске.
 *
 * Проверено запуском настоящего store на обеих формах монтирования
 * (17.09.2026): на каталоге `saved: true` и файл на месте; на старой схеме —
 * `EISDIR` на чтении и записи и `saved: false`.
 *
 * Здесь закрепляется структурная часть: путь монтирования. Она и съехала.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');

const COMPOSE = YAML.load(fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.generator.yml'),
    'utf8'
));

/** Строки томов вида `имя:/путь[:режим]`. */
const volumeTargets = (service) => (service.volumes || []).map((v) => (
    typeof v === 'string' ? v.split(':')[1] : v.target
));

describe('[A-24] том генератора монтируется на каталог', () => {
    const generator = COMPOSE.services.generator;

    test('сервис и том объявлены', () => {
        // Сторож сторожа: при переименовании сервиса проверки ниже начали бы
        // проходить на пустом массиве.
        expect(generator).toBeDefined();
        expect(volumeTargets(generator).length).toBeGreaterThan(0);
    });

    test('ни один том не смонтирован на путь, похожий на файл', () => {
        for (const target of volumeTargets(generator)) {
            expect(path.extname(target)).toBe('');
        }
    });

    test('именованный том generator_data смонтирован на /app/data', () => {
        const mounts = (generator.volumes || []).filter(
            (v) => typeof v === 'string' && v.startsWith('generator_data:')
        );
        expect(mounts).toEqual(['generator_data:/app/data']);
    });

    test('store пишет ВНУТРЬ каталога, а не по пути тома', () => {
        // Иначе правка compose осталась бы половинчатой: том на каталоге, а
        // файл по-прежнему в корне рабочего каталога и вне тома — то есть
        // настройки снова не переживают перезапуск, но уже молча и по другой
        // причине.
        const store = fs.readFileSync(
            path.resolve(__dirname, '../../../generator/src/store.js'),
            'utf8'
        );
        expect(store).toMatch(/GENERATOR_DATA_DIR/);
        expect(store).toMatch(/path\.join\(STORAGE_DIR, 'generator-data\.json'\)/);
    });
});
