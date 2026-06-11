// PR-1a (AUD-002): per-path equivalence guard for fresh-bootstrap self-declare.
//
// database/init/99_schema_migrations_baseline.sql hardcodes a (filename, checksum)
// manifest for migrations 003-017 (the set baked by init files 01-09). This test
// keeps that manifest honest:
//   * every declared checksum == the real sha256 of the migration file content
//     (the value the runner computes), so a fresh-bootstrapped DB + `up` correctly
//     SKIPS them instead of re-applying;
//   * the declared set is EXACTLY 003-017 (16 files, both 012s) — no more, no less;
//   * database.sql (the unified path) carries NO manifest, so fresh-unified
//     fail-closes by design.

const fs = require('fs');
const path = require('path');
const { checksum } = require('../../../scripts/lib/migrate-discover');

const ROOT = path.resolve(__dirname, '../../../');
const INIT_MANIFEST = path.join(ROOT, 'database/init/99_schema_migrations_baseline.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database/migrations');
const DATABASE_SQL = path.join(ROOT, 'database.sql');

// The migrations init files 01-09 bake (003-017, both 012s).
const EXPECTED_INIT_SET = [
    '003_power_calculation_v2.sql',
    '004_add_coordinates_and_extended_fields.sql',
    '005_add_paths_to_lines.sql',
    '006_cleanup_infrastructure_lines.sql',
    '007_add_metrics_compound_index.sql',
    '008_remove_duplicate_hot_water.sql',
    '009_token_blacklist_hash_index.sql',
    '010_add_missing_indexes.sql',
    '011_uk_integration.sql',
    '012_fix_materialized_view.sql',
    '012_totp_2fa.sql',
    '013_account_lockout.sql',
    '014_performance_indexes.sql',
    '015_alert_dedup_constraint.sql',
    '016_password_changed_at.sql',
    '017_runtime_role.sql',
];

// extract ('name.sql', 'hexchecksum') pairs from the manifest INSERT
function parseManifest(sql) {
    const re = /\(\s*'([0-9]{3}_[A-Za-z0-9._-]+\.sql)'\s*,\s*'([0-9a-f]{64})'\s*\)/g;
    const out = [];
    let m;
    while ((m = re.exec(sql)) !== null) out.push({ filename: m[1], checksum: m[2] });
    return out;
}

describe('fresh-bootstrap self-declare manifest', () => {
    const manifestSql = fs.readFileSync(INIT_MANIFEST, 'utf8');
    const manifest = parseManifest(manifestSql);

    test('declares exactly the 003-017 init set (16 files, both 012s)', () => {
        expect(manifest.map((e) => e.filename).sort()).toEqual([...EXPECTED_INIT_SET].sort());
    });

    test('every declared checksum equals the real migration file checksum', () => {
        for (const entry of manifest) {
            const content = fs.readFileSync(path.join(MIGRATIONS_DIR, entry.filename));
            expect(`${entry.filename}:${entry.checksum}`).toBe(`${entry.filename}:${checksum(content)}`);
        }
    });

    test('does NOT declare any migration 018 or later (those must run via `up`)', () => {
        const beyond = manifest.filter((e) => parseInt(e.filename.slice(0, 3), 10) >= 18);
        expect(beyond).toEqual([]);
    });

    test('creates both runner tables and revokes runtime DML, in one transaction', () => {
        expect(manifestSql).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
        expect(manifestSql).toMatch(/CREATE TABLE IF NOT EXISTS migrate_lock/);
        expect(manifestSql).toMatch(/REVOKE ALL ON schema_migrations\s+FROM infrasafe_runtime/);
        expect(manifestSql).toMatch(/^BEGIN;/m);
        expect(manifestSql).toMatch(/^COMMIT;/m);
    });
});

describe('database.sql unified bootstrap', () => {
    const dbSql = fs.readFileSync(DATABASE_SQL, 'utf8');

    test('does NOT create the runner tables (fresh-unified fail-closes by design)', () => {
        expect(dbSql).not.toMatch(/CREATE TABLE[^;]*schema_migrations/i);
        expect(dbSql).not.toMatch(/CREATE TABLE[^;]*migrate_lock/i);
    });

    test('does NOT self-declare any migrations', () => {
        expect(dbSql).not.toMatch(/INSERT INTO schema_migrations/i);
    });
});
