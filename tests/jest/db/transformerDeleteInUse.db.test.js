/**
 * [N-62] Удаление трансформатора, к которому привязаны здания.
 * [N-63] …и у которого есть линии: только с явным подтверждением.
 *
 * 07.10 на infrasafe.uz `DELETE /api/transformers/12` → 500: внешний ключ
 * `fk_buildings_primary_transformer` (ON DELETE NO ACTION) не дал удалить
 * трансформатор, а `Transformer.delete` превращал ЛЮБУЮ ошибку БД в 500 с
 * текстом драйвера. Оператор видел «Ошибка удаления трансформатора» без
 * причины. Это не сбой сервера, а конфликт с данными — 409 и понятный текст.
 *
 * Против живой БД: отказ рождается во внешнем ключе, мок его не воспроизведёт.
 * DDL и ключи — из канонического файла схемы.
 *
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const Transformer = require('../../../src/models/Transformer');
const Line = require('../../../src/models/Line');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(`[N-62] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу.`);
}

const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);

function extract(re, what) {
    const found = INIT_SQL.match(re);
    if (!found || !found.length) throw new Error(`[N-62] не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extract(/CREATE TABLE IF NOT EXISTS transformers \([\s\S]*?\n\);/i, 'transformers'),
    extract(/CREATE TABLE IF NOT EXISTS buildings \([\s\S]*?\n\);/i, 'buildings'),
    extract(/^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:primary|backup)_transformer_id .*$/gm,
        'buildings.*_transformer_id'),
    extract(/ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_transformer\s+FOREIGN KEY[^;]*;/,
        'fk_buildings_primary_transformer'),
    extract(/ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_transformer\s+FOREIGN KEY[^;]*;/,
        'fk_buildings_backup_transformer'),
    extract(/CREATE TABLE IF NOT EXISTS lines \([\s\S]*?\n\);/i, 'lines'),
].join('\n');

// [N-63] Миграция применяется к стенду как есть — тот же файл, что раннер на проде.
const MIGRATION_045 = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/045_lines_transformer_required.sql'),
    'utf8'
);

async function transformerExists(id) {
    const { rows } = await db.query('SELECT 1 FROM transformers WHERE transformer_id = $1', [id]);
    return rows.length === 1;
}

describe('[N-62] Transformer.delete при привязанных зданиях', () => {
    let transformerId;

    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS lines CASCADE');
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.query(DDL);
        await db.query(MIGRATION_045);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS lines CASCADE');
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('DELETE FROM lines');
        await db.query('DELETE FROM buildings');
        await db.query('DELETE FROM transformers');
        const { rows } = await db.query(
            "INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-1', 400, 10) RETURNING transformer_id"
        );
        transformerId = rows[0].transformer_id;
    });

    const linkBuilding = (column) => db.query(
        `INSERT INTO buildings (name, address, town, latitude, longitude, ${column})
         VALUES ('Дом 1', 'ул. Пример, 1', 'Ташкент', 41.3, 69.2, $1)`,
        [transformerId]
    );

    test.each(['primary_transformer_id', 'backup_transformer_id'])(
        'здание ссылается через %s → 409 с причиной, трансформатор на месте',
        async (column) => {
            await linkBuilding(column);

            const error = await Transformer.delete(transformerId).catch((e) => e);

            expect(error).toBeInstanceOf(Error);
            expect(error.statusCode).toBe(409);
            expect(error.apiCode).toBe('TRANSFORMER_HAS_BUILDINGS');
            expect(error.message).toMatch(/привязан/i);
            // Текст драйвера наружу не уходит.
            expect(error.message).not.toMatch(/foreign key|violates/i);
            expect(await transformerExists(transformerId)).toBe(true);
        }
    );

    test('без привязанных зданий удаляется как раньше', async () => {
        const deleted = await Transformer.delete(transformerId);
        expect(deleted.transformer_id).toBe(transformerId);
        expect(await transformerExists(transformerId)).toBe(false);
    });

    const addLine = (name) => db.query(
        `INSERT INTO lines (name, voltage_kv, length_km, transformer_id) VALUES ($1, 10, 1.5, $2) RETURNING line_id`,
        [name, transformerId]
    );
    const lineCount = async () => (await db.query('SELECT count(*)::int AS n FROM lines')).rows[0].n;

    test('[N-63] есть линии, подтверждения нет → 409 со списком линий, ничего не удалено', async () => {
        await addLine('ЛЭП-1');
        await addLine('ЛЭП-2');

        const error = await Transformer.delete(transformerId).catch((e) => e);

        expect(error.statusCode).toBe(409);
        expect(error.apiCode).toBe('TRANSFORMER_HAS_LINES');
        expect(error.apiMeta.lines.map((l) => l.name)).toEqual(['ЛЭП-1', 'ЛЭП-2']);
        expect(await transformerExists(transformerId)).toBe(true);
        expect(await lineCount()).toBe(2);
    });

    test('[N-63] с подтверждением удаляются трансформатор и его линии', async () => {
        const { rows: [{ line_id: lineId }] } = await addLine('ЛЭП-1');

        const deleted = await Transformer.delete(transformerId, { cascadeLines: true });

        expect(deleted.transformer_id).toBe(transformerId);
        expect(deleted.deleted_lines).toEqual([{ line_id: lineId, name: 'ЛЭП-1' }]);
        expect(await transformerExists(transformerId)).toBe(false);
        expect(await lineCount()).toBe(0);
    });

    test('[N-63] здания блокируют удаление даже с подтверждением линий', async () => {
        await addLine('ЛЭП-1');
        await linkBuilding('primary_transformer_id');

        const error = await Transformer.delete(transformerId, { cascadeLines: true }).catch((e) => e);

        expect(error.apiCode).toBe('TRANSFORMER_HAS_BUILDINGS');
        expect(await lineCount()).toBe(1);
    });

    test('[N-63] миграция 045: линию без трансформатора БД не примет', async () => {
        await expect(db.query(
            "INSERT INTO lines (name, voltage_kv, length_km) VALUES ('Сирота', 10, 1)"
        )).rejects.toMatchObject({ code: '23502' });
    });

    test('[N-63] миграция 045 отказывает, если сироты уже есть', async () => {
        // Отдельный клиент: упавшая миграция оставляет открытый блок BEGIN,
        // и такое соединение нельзя возвращать в общий пул без ROLLBACK.
        const client = await db.getPool().connect();
        try {
            await client.query('ALTER TABLE lines ALTER COLUMN transformer_id DROP NOT NULL');
            await client.query("INSERT INTO lines (name, voltage_kv, length_km) VALUES ('Сирота', 10, 1)");
            await expect(client.query(MIGRATION_045)).rejects.toThrow(/1 линий без трансформатора/);
            await client.query('ROLLBACK');
        } finally {
            await client.query('DELETE FROM lines WHERE transformer_id IS NULL');
            await client.query(MIGRATION_045);
            client.release();
        }
    });

    test('[N-63] Line.create с несуществующим трансформатором → 400, а не 500', async () => {
        const error = await Line.create({ name: 'ЛЭП-X', voltage_kv: 10, length_km: 1, transformer_id: 999999 })
            .catch((e) => e);
        expect(error.statusCode).toBe(400);
        expect(error.message).toMatch(/трансформатор не найден/i);
    });

    test('[N-63] Line.create без трансформатора → 400', async () => {
        const error = await Line.create({ name: 'ЛЭП-X', voltage_kv: 10, length_km: 1 }).catch((e) => e);
        expect(error.statusCode).toBe(400);
        expect(error.message).toMatch(/трансформатор/i);
    });

    test('[N-63] Line.update не снимает трансформатор', async () => {
        const { rows: [{ line_id: lineId }] } = await addLine('ЛЭП-1');
        const error = await Line.update(lineId, { transformer_id: null }).catch((e) => e);
        expect(error.statusCode).toBe(400);
        const { rows } = await db.query('SELECT transformer_id FROM lines WHERE line_id = $1', [lineId]);
        expect(rows[0].transformer_id).toBe(transformerId);
    });

    test('[N-63] findWithDependents: здания и линии — да, свободный — нет', async () => {
        const free = (await db.query(
            "INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-2', 400, 10) RETURNING transformer_id"
        )).rows[0].transformer_id;
        const withLine = (await db.query(
            "INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-3', 400, 10) RETURNING transformer_id"
        )).rows[0].transformer_id;
        await db.query(
            "INSERT INTO lines (name, voltage_kv, length_km, transformer_id) VALUES ('ЛЭП', 10, 1, $1)", [withLine]
        );
        await linkBuilding('backup_transformer_id');

        const inUse = await Transformer.findWithDependents([transformerId, free, withLine]);

        expect(inUse).toEqual([transformerId, withLine].sort((a, b) => a - b));
    });
});
