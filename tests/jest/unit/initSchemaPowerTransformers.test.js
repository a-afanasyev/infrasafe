/**
 * [INIT-SCHEMA-PT] Связь канонического init и миграции 036.
 *
 * В `database/init/` создаётся и сеется таблица `power_transformers`, которую
 * миграция 037 затем ДРОПАЕТ. Со стороны это выглядит бессмыслицей, и соблазн
 * «прибраться» — убрать её из init — возникает у каждого, кто это читает
 * (в том числе возник при разборе бэклога 12.09.2026).
 *
 * Убирать НЕЛЬЗЯ. Миграция 036 переносит строки в каноническую `transformers`
 * запросом `FROM power_transformers` БЕЗ какой-либо защиты от отсутствия
 * таблицы, а миграции неизменяемы (roll-forward only, сверка контрольных сумм)
 * — поправить 036 задним числом нельзя. Удаление таблицы из init даст на
 * свежем bootstrap «relation power_transformers does not exist» и потерю
 * четырёх засеянных трансформаторов.
 *
 * Тест держит эту связь: пока 036 читает таблицу, init обязан её создавать и
 * наполнять. Без него поломка вылезла бы только в ночном e2e на свежем
 * bootstrap — и выглядела бы загадочно.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MIGRATION_036 = 'database/migrations/036_canonicalize_transformers.sql';
const MIGRATION_037 = 'database/migrations/037_drop_power_transformers.sql';
const INIT_SCHEMA = 'database/init/01_init_database.sql';
const INIT_SEED = 'database/init/02_seed_data.sql';

describe('[INIT-SCHEMA-PT] power_transformers: init ↔ миграция 036', () => {
    const m036 = read(MIGRATION_036);

    test('036 действительно читает power_transformers и делает это без guard-а', () => {
        expect(m036).toMatch(/FROM\s+power_transformers/i);
        // Если однажды появится защита (to_regclass / IF EXISTS вокруг переноса),
        // связь ослабнет и этот тест можно будет пересмотреть — но пока её нет.
        expect(m036).not.toMatch(/to_regclass\s*\(\s*'[^']*power_transformers/i);
    });

    test('init СОЗДАЁТ таблицу — иначе 036 упадёт на свежем bootstrap', () => {
        expect(read(INIT_SCHEMA)).toMatch(/CREATE TABLE IF NOT EXISTS power_transformers/i);
    });

    test('init НАПОЛНЯЕТ таблицу — иначе перенос 036 принесёт ноль строк', () => {
        const seeded = (read(INIT_SEED).match(/INSERT INTO public\.power_transformers/gi) || []).length;
        expect(seeded).toBeGreaterThan(0);
    });

    test('037 дропает её — то есть в рабочей схеме таблицы не остаётся', () => {
        expect(read(MIGRATION_037)).toMatch(/DROP TABLE IF EXISTS public\.power_transformers|DROP TABLE IF EXISTS power_transformers/i);
    });
});
