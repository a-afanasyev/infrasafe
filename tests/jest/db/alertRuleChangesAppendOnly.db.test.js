/**
 * [Q-29] Журнал alert_rule_changes для роли рантайма — только на дозапись.
 *
 * Права — свойство самой базы: мок их не видит вовсе. Цепочка воспроизводится
 * целиком и текстами из репозитория: default privileges из 017, таблица и
 * GRANT из 029, REVOKE из 046. Всё — в одной транзакции с ROLLBACK, в
 * отдельной схеме: роли и объекты после теста не остаются.
 *
 * Запуск: npm run test:db.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(`[Q-29] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу.`);
}

const migration = (name) => fs.readFileSync(path.join(__dirname, '../../../database/migrations', name), 'utf8');
const pick = (sql, re, what) => {
    const m = re.exec(sql);
    if (!m) throw new Error(`[Q-29] не найдено: ${what}`);
    return m[0];
};

const SCHEMA = 'q29_append_only';
// 017: default privileges на таблицы — та самая строка, только в схеме теста.
const DEFAULT_PRIVS = pick(migration('017_runtime_role.sql'),
    /ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES\s+TO infrasafe_runtime;/,
    '017 default privileges').replace('IN SCHEMA public', `IN SCHEMA ${SCHEMA}`);
const M029 = migration('029_alert_rule_changes.sql');
const CREATE_029 = pick(M029, /CREATE TABLE IF NOT EXISTS alert_rule_changes \([\s\S]*?\n\);/, '029 CREATE TABLE');
const GRANT_029 = pick(M029, /DO \$grant_runtime\$[\s\S]*?\$grant_runtime\$;/, '029 GRANT');
const REVOKE_046 = pick(migration('046_alert_rule_changes_append_only.sql'),
    /DO \$revoke_runtime\$[\s\S]*?\$revoke_runtime\$;/, '046 REVOKE');

let client;
const priv = async (p) => (await client.query(
    'SELECT has_table_privilege($1, $2, $3) AS ok', ['infrasafe_runtime', `${SCHEMA}.alert_rule_changes`, p],
)).rows[0].ok;

beforeAll(async () => {
    await db.init();
    client = await db.getPool().connect();
    await client.query('BEGIN');
    await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_app') THEN CREATE ROLE infrasafe_app NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN CREATE ROLE infrasafe_runtime NOLOGIN; END IF;
    END $$`);
    await client.query(`CREATE SCHEMA ${SCHEMA} AUTHORIZATION infrasafe_app`);
    await client.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO infrasafe_runtime`);
    await client.query(`SET LOCAL search_path = ${SCHEMA}`);
    await client.query(DEFAULT_PRIVS);
    // Миграции на проде гоняет infrasafe_app — от него и создаём.
    await client.query('SET LOCAL ROLE infrasafe_app');
    await client.query('CREATE TABLE users (user_id SERIAL PRIMARY KEY)');
    await client.query('CREATE TABLE alert_rules (id SERIAL PRIMARY KEY)');
    await client.query(CREATE_029);
    await client.query(GRANT_029);
});

afterAll(async () => {
    if (client) {
        await client.query('ROLLBACK');
        client.release();
    }
    await db.close();
});

describe('[Q-29] alert_rule_changes', () => {
    test('без 046 default privileges дают рантайму UPDATE и DELETE (находка воспроизводится)', async () => {
        expect(await priv('UPDATE')).toBe(true);
        expect(await priv('DELETE')).toBe(true);
    });

    test('после 046: SELECT и INSERT остаются, UPDATE/DELETE/TRUNCATE — нет', async () => {
        await client.query(REVOKE_046);
        expect(await priv('SELECT')).toBe(true);
        expect(await priv('INSERT')).toBe(true);
        expect(await priv('UPDATE')).toBe(false);
        expect(await priv('DELETE')).toBe(false);
        expect(await priv('TRUNCATE')).toBe(false);
    });

    test('046 идемпотентна', async () => {
        await client.query(REVOKE_046);
        expect(await priv('DELETE')).toBe(false);
    });

    test('рантайм пишет журнал, но стереть его не может', async () => {
        const rule = (await client.query('INSERT INTO alert_rules DEFAULT VALUES RETURNING id')).rows[0].id;
        await client.query('SET LOCAL ROLE infrasafe_runtime');
        await client.query(
            "INSERT INTO alert_rule_changes (rule_id, field_name, old_value, new_value) VALUES ($1, 'enabled', 'true', 'false')",
            [rule],
        );
        await client.query('SAVEPOINT s');
        await expect(client.query('DELETE FROM alert_rule_changes')).rejects.toMatchObject({ code: '42501' });
        await client.query('ROLLBACK TO SAVEPOINT s');
        await expect(client.query("UPDATE alert_rule_changes SET new_value = 'x'")).rejects.toMatchObject({ code: '42501' });
        await client.query('ROLLBACK TO SAVEPOINT s');
        await client.query('SET LOCAL ROLE infrasafe_app');
    });

    test('ON DELETE CASCADE от alert_rules работает и для роли рантайма', async () => {
        const rule = (await client.query('INSERT INTO alert_rules DEFAULT VALUES RETURNING id')).rows[0].id;
        await client.query("INSERT INTO alert_rule_changes (rule_id, field_name) VALUES ($1, 'enabled')", [rule]);
        await client.query('SET LOCAL ROLE infrasafe_runtime');
        await client.query('DELETE FROM alert_rules WHERE id = $1', [rule]);
        const left = (await client.query('SELECT count(*)::int AS n FROM alert_rule_changes WHERE rule_id = $1', [rule])).rows[0].n;
        expect(left).toBe(0);
        await client.query('SET LOCAL ROLE infrasafe_app');
    });
});
