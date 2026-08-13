// PR-1a (AUD-002): unit tests for the migration-runner discovery/validation
// library. This is the pure, testable logic the bash runner (scripts/migrate.sh)
// shells out to: strict path validation, _superseded exclusion, lexicographic
// ordering (dup-012 → both, fix before totp), sha256 content checksum, and the
// frozen baseline allowlist guard.
//
// TDD: written before scripts/lib/migrate-discover.js exists (RED).

const crypto = require('crypto');
const {
    isValidMigrationPath,
    discover,
    checksum,
    validateBaseline,
    BASELINE_ALLOWLIST,
    MigrationDiscoveryError,
} = require('../../../scripts/lib/migrate-discover');

// helper: build git-ls-tree-style entries from paths
const entries = (...paths) => paths.map((path, i) => ({ oid: `oid${i}`, path }));

describe('migrate-discover', () => {
    describe('isValidMigrationPath', () => {
        test('accepts a canonical NNN_snake.sql migration path', () => {
            expect(isValidMigrationPath('database/migrations/003_power_calculation_v2.sql')).toBe(true);
            expect(isValidMigrationPath('database/migrations/034_alert_verifications_dispatch.sql')).toBe(true);
        });

        test('accepts both duplicate-012 filenames', () => {
            expect(isValidMigrationPath('database/migrations/012_totp_2fa.sql')).toBe(true);
            expect(isValidMigrationPath('database/migrations/012_fix_materialized_view.sql')).toBe(true);
        });

        test('rejects _superseded/ subdirectory files', () => {
            expect(isValidMigrationPath('database/migrations/_superseded/003_power_calculation_system.sql')).toBe(false);
        });

        test('rejects non-.sql and non-NNN files', () => {
            expect(isValidMigrationPath('database/migrations/README.md')).toBe(false);
            expect(isValidMigrationPath('database/migrations/migrate.sh')).toBe(false);
            expect(isValidMigrationPath('database/migrations/abc_foo.sql')).toBe(false);
        });

        test('rejects unsafe charset (space, quote, shell metachar)', () => {
            expect(isValidMigrationPath('database/migrations/003 evil.sql')).toBe(false);
            expect(isValidMigrationPath("database/migrations/003_e'vil.sql")).toBe(false);
            expect(isValidMigrationPath('database/migrations/003_$(rm).sql')).toBe(false);
        });

        test('rejects paths outside database/migrations/', () => {
            expect(isValidMigrationPath('database/init/01_init_database.sql')).toBe(false);
            expect(isValidMigrationPath('003_power_calculation_v2.sql')).toBe(false);
        });
    });

    describe('discover', () => {
        test('filters to valid migrations and excludes _superseded + README', () => {
            const result = discover(entries(
                'database/migrations/003_power_calculation_v2.sql',
                'database/migrations/_superseded/003_power_calculation_system.sql',
                'database/migrations/README.md',
                'database/migrations/011_uk_integration.sql',
            ));
            expect(result.map((r) => r.filename)).toEqual([
                '003_power_calculation_v2.sql',
                '011_uk_integration.sql',
            ]);
        });

        test('sorts lexicographically; 012_fix before 012_totp', () => {
            const result = discover(entries(
                'database/migrations/012_totp_2fa.sql',
                'database/migrations/003_power_calculation_v2.sql',
                'database/migrations/012_fix_materialized_view.sql',
                'database/migrations/010_add_missing_indexes.sql',
            ));
            expect(result.map((r) => r.filename)).toEqual([
                '003_power_calculation_v2.sql',
                '010_add_missing_indexes.sql',
                '012_fix_materialized_view.sql',
                '012_totp_2fa.sql',
            ]);
        });

        test('returns filename + path for each entry', () => {
            const result = discover(entries('database/migrations/022_uk_outbox.sql'));
            expect(result[0]).toMatchObject({
                filename: '022_uk_outbox.sql',
                path: 'database/migrations/022_uk_outbox.sql',
            });
        });

        test('THROWS on a direct .sql child that fails the strict charset (refuse, not ignore)', () => {
            expect(() => discover(entries('database/migrations/003 evil.sql')))
                .toThrow(MigrationDiscoveryError);
            expect(() => discover(entries("database/migrations/00x_bad.sql")))
                .toThrow(MigrationDiscoveryError);
        });

        test('does NOT throw on subdirectory or non-sql entries (ignored)', () => {
            expect(() => discover(entries(
                'database/migrations/_superseded/003_power_calculation_system.sql',
                'database/migrations/README.md',
            ))).not.toThrow();
        });
    });

    describe('checksum', () => {
        test('is sha256 hex of the exact content bytes', () => {
            const content = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
            const expected = crypto.createHash('sha256').update(content).digest('hex');
            expect(checksum(content)).toBe(expected);
            expect(checksum(content)).toMatch(/^[0-9a-f]{64}$/);
        });

        test('is stable and content-sensitive', () => {
            expect(checksum('a')).toBe(checksum('a'));
            expect(checksum('a')).not.toBe(checksum('b'));
        });

        test('accepts a Buffer identically to its string', () => {
            expect(checksum(Buffer.from('hello'))).toBe(checksum('hello'));
        });
    });

    // [OPS-002] checksumBatch parses a `git cat-file --batch` stream and returns
    // every blob's sha256 in ONE pass. Раньше migrate.sh считал суммы по одной:
    // на проде (node только в образе) это 42 последовательных `docker run` —
    // минуты на шаге `up`, который выглядел зависшим. Формат записи batch-потока:
    //   "<oid> SP <type> SP <size> LF <size байт содержимого> LF"
    // и "<oid> SP missing LF" для несуществующего объекта.
    describe('checksumBatch (OPS-002)', () => {
        const { checksumBatch } = require('../../../scripts/lib/migrate-discover');

        const sha = (content) => crypto.createHash('sha256').update(content).digest('hex');
        const record = (oid, content) => {
            const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
            return Buffer.concat([
                Buffer.from(`${oid} blob ${body.length}\n`),
                body,
                Buffer.from('\n'),
            ]);
        };

        test('один блоб → его oid и sha256 содержимого', () => {
            const content = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
            const out = checksumBatch(record('a'.repeat(40), content));
            expect(out).toEqual([{ oid: 'a'.repeat(40), sha256: sha(content) }]);
        });

        test('несколько блобов — в порядке потока', () => {
            const buf = Buffer.concat([
                record('a'.repeat(40), 'first'),
                record('b'.repeat(40), 'second'),
                record('c'.repeat(40), 'third'),
            ]);
            const out = checksumBatch(buf);
            expect(out.map((r) => r.oid)).toEqual(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]);
            expect(out.map((r) => r.sha256)).toEqual([sha('first'), sha('second'), sha('third')]);
        });

        test('разбор ведётся ПО РАЗМЕРУ, а не по строкам: LF внутри содержимого не рвёт запись', () => {
            // Миграция — это SQL: переводы строк в каждой. Наивный split('\n')
            // дал бы неверную сумму — ровно этот дефект тест и караулит.
            const content = 'line1\nline2\nccccccccc blob 5\nline4\n';
            const out = checksumBatch(record('d'.repeat(40), content));
            expect(out).toEqual([{ oid: 'd'.repeat(40), sha256: sha(content) }]);
        });

        test('двоичное содержимое хешируется байт-в-байт', () => {
            const body = Buffer.from([0x00, 0xff, 0x0a, 0x0d, 0x80, 0x00]);
            const out = checksumBatch(record('e'.repeat(40), body));
            expect(out[0].sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
        });

        test('"<oid> missing" → исключение, не тихий пропуск', () => {
            // Отсутствующий блоб при закреплённом коммите — это порча репозитория
            // или рассинхрон discovery; посчитать «что смогли» значило бы записать
            // в schema_migrations сумму не того набора.
            const buf = Buffer.concat([
                record('a'.repeat(40), 'ok'),
                Buffer.from(`${'f'.repeat(40)} missing\n`),
            ]);
            expect(() => checksumBatch(buf)).toThrow(/missing/);
        });

        test('оборванный поток (заявлен размер больше фактического) → исключение', () => {
            const buf = Buffer.from(`${'a'.repeat(40)} blob 100\nshort\n`);
            expect(() => checksumBatch(buf)).toThrow(/truncated|оборван/i);
        });

        test('пустой ввод → пустой список (в дереве нет миграций — не ошибка)', () => {
            expect(checksumBatch(Buffer.alloc(0))).toEqual([]);
        });
    });

    describe('BASELINE_ALLOWLIST', () => {
        test('has exactly 33 frozen names (003-034 with two 012s)', () => {
            expect(BASELINE_ALLOWLIST).toHaveLength(33);
        });

        test('contains both duplicate-012 filenames', () => {
            expect(BASELINE_ALLOWLIST).toContain('012_totp_2fa.sql');
            expect(BASELINE_ALLOWLIST).toContain('012_fix_materialized_view.sql');
        });

        test('spans 003 through 034 inclusive at the boundaries', () => {
            expect(BASELINE_ALLOWLIST).toContain('003_power_calculation_v2.sql');
            expect(BASELINE_ALLOWLIST).toContain('034_alert_verifications_dispatch.sql');
        });

        test('does not contain 035+ or any _superseded name', () => {
            expect(BASELINE_ALLOWLIST.some((f) => f.startsWith('035'))).toBe(false);
            expect(BASELINE_ALLOWLIST).not.toContain('003_power_calculation_system.sql');
        });

        test('is frozen (immutable)', () => {
            expect(Object.isFrozen(BASELINE_ALLOWLIST)).toBe(true);
        });
    });

    describe('validateBaseline', () => {
        test('ok when every discovered filename is in the allowlist', () => {
            const result = validateBaseline([...BASELINE_ALLOWLIST]);
            expect(result.ok).toBe(true);
            expect(result.unknown).toEqual([]);
        });

        test('NOT ok when a discovered file is outside the allowlist (e.g. 035)', () => {
            const result = validateBaseline([
                '003_power_calculation_v2.sql',
                '035_voltage_critical_rule.sql',
            ]);
            expect(result.ok).toBe(false);
            expect(result.unknown).toContain('035_voltage_critical_rule.sql');
        });
    });
});
