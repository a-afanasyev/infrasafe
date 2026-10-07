/**
 * [N-62] Удаление трансформатора, к которому привязаны здания.
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
].join('\n');

async function transformerExists(id) {
    const { rows } = await db.query('SELECT 1 FROM transformers WHERE transformer_id = $1', [id]);
    return rows.length === 1;
}

describe('[N-62] Transformer.delete при привязанных зданиях', () => {
    let transformerId;

    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.close();
    });

    beforeEach(async () => {
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
});
