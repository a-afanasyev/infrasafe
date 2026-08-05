// [Sprint 10 PR-5] AlertRule.update + listWithStats unit tests
jest.mock('../../../src/config/database', () => {
    // [CO-2] safeRollback/releaseClient берём настоящие: они несут контракт
    // «упавший ROLLBACK ⇒ соединение уничтожается», и подделка его бы скрыла.
    const actual = jest.requireActual('../../../src/config/database');
    return {
        query: jest.fn(),
        getPool: jest.fn(),
        safeRollback: actual.safeRollback,
        releaseClient: actual.releaseClient
    };
});

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');

// Mock client for AlertRuleChange.createBatch (uses a transaction via
// db.getPool().connect()). Created fresh per test so jest.clearAllMocks
// doesn't wipe the implementation between tests.
let mockClient;

describe('AlertRule.update — Sprint 10 PR-5', () => {
    beforeEach(() => {
        // mockReset (not clearAllMocks) — also clears the
        // mockResolvedValueOnce queue from prior tests
        db.query.mockReset();
        db.getPool.mockReset();
        mockClient = { query: jest.fn(), release: jest.fn() };
        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });
    });

    const baseRule = {
        id: 4,
        alert_type: 'LEAK_DETECTED',
        severity: 'WARNING',
        enabled: true,
        min_persistence_seconds: 15,
        min_affected_buildings: 1,
        verification_grace_seconds: 300,
        verification_window_seconds: 600,
        max_reopens_per_24h: 3,
        reopen_cooldown_min: 30,
        reopen_urgency_bump: true,
        uk_category: 'Сантехника',
        uk_urgency: 'Срочная',
        description: 'Leak warning'
    };

    describe('validation', () => {
        test('rejects unknown field', async () => {
            db.query.mockResolvedValueOnce({ rows: [baseRule] });
            await expect(
                AlertRule.update(4, { not_a_real_field: 1 })
            ).rejects.toThrow('not editable');
        });

        test('rejects out-of-range integer', async () => {
            await expect(
                AlertRule.update(4, { min_persistence_seconds: 99999 })
            ).rejects.toThrow('must be ≤ 3600');
        });

        test('rejects negative integer', async () => {
            await expect(
                AlertRule.update(4, { min_persistence_seconds: -10 })
            ).rejects.toThrow('must be ≥ 1');
        });

        test('rejects boolean for integer field', async () => {
            await expect(
                AlertRule.update(4, { min_persistence_seconds: true })
            ).rejects.toThrow('must be integer');
        });

        test('rejects integer for boolean field', async () => {
            await expect(
                AlertRule.update(4, { enabled: 1 })
            ).rejects.toThrow('must be boolean');
        });

        test('rejects string exceeding maxLen', async () => {
            const longStr = 'x'.repeat(501);
            await expect(
                AlertRule.update(4, { description: longStr })
            ).rejects.toThrow('exceeds maxLen');
        });

        test('rejects empty fields object', async () => {
            await expect(AlertRule.update(4, {})).rejects.toThrow('at least one field required');
        });

        test('rejects missing id', async () => {
            await expect(AlertRule.update(null, { enabled: true })).rejects.toThrow('id is required');
        });
    });

    describe('no-op when value unchanged', () => {
        test('returns current rule + empty changes when value matches', async () => {
            db.query.mockResolvedValueOnce({ rows: [baseRule] });

            const result = await AlertRule.update(4, { min_persistence_seconds: 15 });

            expect(result.rule).toEqual(baseRule);
            expect(result.changes).toEqual([]);
            // Only the SELECT happened, no UPDATE
            expect(db.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('happy path — actual updates', () => {
        test('single field update writes UPDATE + audit row', async () => {
            const updated = { ...baseRule, min_persistence_seconds: 30 };
            db.query
                .mockResolvedValueOnce({ rows: [baseRule] })   // findById SELECT
                .mockResolvedValueOnce({ rows: [updated] });    // UPDATE
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ id: 1, field_name: 'min_persistence_seconds' }] }) // INSERT
                .mockResolvedValueOnce({}); // COMMIT

            const result = await AlertRule.update(4, { min_persistence_seconds: 30 }, 42, 'tuned');

            expect(result.rule.min_persistence_seconds).toBe(30);
            expect(result.changes).toHaveLength(1);
            // UPDATE SQL has the dynamic SET clause for just one field
            const updateSql = db.query.mock.calls[1][0];
            expect(updateSql).toContain('SET min_persistence_seconds = $2');
            expect(db.query.mock.calls[1][1]).toEqual([4, 30]);
        });

        test('multi-field update writes one audit row per changed field', async () => {
            const updated = {
                ...baseRule,
                min_persistence_seconds: 60,
                max_reopens_per_24h: 5
            };
            db.query
                .mockResolvedValueOnce({ rows: [baseRule] })
                .mockResolvedValueOnce({ rows: [updated] });
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ field_name: 'min_persistence_seconds' }] })
                .mockResolvedValueOnce({ rows: [{ field_name: 'max_reopens_per_24h' }] })
                .mockResolvedValueOnce({}); // COMMIT

            const result = await AlertRule.update(4, {
                min_persistence_seconds: 60,
                max_reopens_per_24h: 5,
                enabled: true  // unchanged - shouldn't audit
            }, 42);

            expect(result.changes).toHaveLength(2);
            // Only 2 INSERTs into audit (enabled wasn't changed)
            const auditInserts = mockClient.query.mock.calls.filter(
                (c) => c[0].includes('INSERT INTO alert_rule_changes')
            );
            expect(auditInserts).toHaveLength(2);
        });

        test('returns rule:null when id not found', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // findById returns empty

            const result = await AlertRule.update(999, { min_persistence_seconds: 30 });

            expect(result.rule).toBeNull();
            expect(result.changes).toEqual([]);
        });
    });

    describe('listWithStats', () => {
        test('returns rules with alert/escalated/reopen counts', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { ...baseRule, alert_count: 12, escalated_count: 5, reopen_count: 1 }
                ]
            });

            const result = await AlertRule.listWithStats(7);

            expect(result).toHaveLength(1);
            expect(result[0].alert_count).toBe(12);
            expect(result[0].escalated_count).toBe(5);
            expect(result[0].reopen_count).toBe(1);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('FROM alert_rules r');
            expect(sql).toContain('reopen_sequence > 1');
        });

        test('clamps days to [1, 365]', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertRule.listWithStats(9999);
            expect(db.query.mock.calls[0][1][0]).toBe(365);

            jest.clearAllMocks();
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertRule.listWithStats(0);
            expect(db.query.mock.calls[0][1][0]).toBe(7); // default
        });
    });

    describe('EDITABLE_FIELDS export', () => {
        test('contains expected fields', () => {
            const fields = Object.keys(AlertRule.EDITABLE_FIELDS);
            expect(fields).toEqual(expect.arrayContaining([
                'enabled', 'min_persistence_seconds', 'min_affected_buildings',
                'verification_grace_seconds', 'verification_window_seconds',
                'max_reopens_per_24h', 'reopen_urgency_bump'
            ]));
        });

        test('does not include immutable identity fields', () => {
            expect(AlertRule.EDITABLE_FIELDS).not.toHaveProperty('id');
            expect(AlertRule.EDITABLE_FIELDS).not.toHaveProperty('alert_type');
            expect(AlertRule.EDITABLE_FIELDS).not.toHaveProperty('severity');
            expect(AlertRule.EDITABLE_FIELDS).not.toHaveProperty('created_at');
        });

        test('[B-009] сезонное окно редактируемо и nullable', () => {
            expect(AlertRule.EDITABLE_FIELDS.season_from).toEqual({ type: 'mmdd', nullable: true });
            expect(AlertRule.EDITABLE_FIELDS.season_to).toEqual({ type: 'mmdd', nullable: true });
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // [B-009] Сезонное окно
    // ────────────────────────────────────────────────────────────────────
    describe('[B-009] season window', () => {
        const yearRound = { ...baseRule, season_from: null, season_to: null };
        const heating = { ...baseRule, season_from: '10-15', season_to: '04-15' };

        const expectRejected = async (fields, before, pattern) => {
            db.query.mockResolvedValueOnce({ rows: [before] });   // findById (если дойдёт)
            await expect(AlertRule.update(4, fields)).rejects.toThrow(pattern);
        };

        test('принимает валидную пару и пишет её одним UPDATE', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [yearRound] })                                  // findById
                .mockResolvedValueOnce({ rows: [{ ...heating }] });                            // UPDATE
            mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

            const { rule } = await AlertRule.update(4, { season_from: '10-15', season_to: '04-15' });

            expect(rule.season_from).toBe('10-15');
            const sql = db.query.mock.calls[1][0];
            expect(sql).toContain('season_from = $2');
            expect(sql).toContain('season_to = $3');
        });

        test('снимает окно, если оба поля null', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [heating] })
                .mockResolvedValueOnce({ rows: [{ ...yearRound }] });
            mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

            const { rule } = await AlertRule.update(4, { season_from: null, season_to: null });

            expect(rule.season_from).toBeNull();
            expect(db.query.mock.calls[1][1]).toEqual([4, null, null]);
        });

        test('частичный PATCH законен, если второе поле уже стоит в строке', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [heating] })                                    // season_from уже '10-15'
                .mockResolvedValueOnce({ rows: [{ ...heating, season_to: '04-30' }] });
            mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

            const { rule } = await AlertRule.update(4, { season_to: '04-30' });

            expect(rule.season_to).toBe('04-30');
        });

        test('половина пары на круглогодичном правиле → внятная ошибка, а не 500 от Postgres', async () => {
            await expectRejected({ season_from: '10-15' }, yearRound, /только вместе/);
        });

        test('снятие только одного поля тоже отвергается', async () => {
            await expectRejected({ season_to: null }, heating, /только вместе/);
        });

        test.each(['10/15', '2026-10-15', '13-01', '10-32', '0-1', 'октябрь', ''])(
            'отвергает мусорный формат %p до обращения к БД', async (bad) => {
                await expect(AlertRule.update(4, { season_from: bad, season_to: '04-15' }))
                    .rejects.toThrow(/must be MM-DD/);
                expect(db.query).not.toHaveBeenCalled();
            }
        );

        test('02-29 допустима (високосный год; длину месяца без года не проверить)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [yearRound] })
                .mockResolvedValueOnce({ rows: [{ ...yearRound, season_from: '02-01', season_to: '02-29' }] });
            mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

            const { rule } = await AlertRule.update(4, { season_from: '02-01', season_to: '02-29' });

            expect(rule.season_to).toBe('02-29');
        });

        test('null в поле без nullable по-прежнему отвергается', async () => {
            await expect(AlertRule.update(4, { min_persistence_seconds: null }))
                .rejects.toThrow(/must not be null/);
            expect(db.query).not.toHaveBeenCalled();
        });
    });
});
