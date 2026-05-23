jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');

describe('AlertRule Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRule = {
        id: 1,
        alert_type: 'voltage_low',
        severity: 'WARNING',
        threshold_min: 200,
        threshold_max: 210,
        enabled: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
    };

    describe('findAll', () => {
        test('returns all alert rules ordered by type and severity', async () => {
            db.query.mockResolvedValue({ rows: [mockRule, { ...mockRule, id: 2, alert_type: 'voltage_high' }] });

            const result = await AlertRule.findAll();

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY alert_type')
            );
        });

        test('returns empty array when no rules exist', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRule.findAll();

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRule.findAll()).rejects.toThrow('DB error');
        });
    });

    describe('findById', () => {
        test('returns rule when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRule] });

            const result = await AlertRule.findById(1);

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.alert_type).toBe('voltage_low');
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE id = $1'),
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRule.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRule.findById(1)).rejects.toThrow('DB error');
        });
    });

    describe('toggleEnabled', () => {
        // [Sprint 10 PR-5] toggleEnabled now does findById first (audit-log
        // friendly: skip UPDATE + audit if value unchanged). Tests use
        // mockResolvedValueOnce for proper sequencing.
        test('enables rule and returns updated record', async () => {
            const before = { ...mockRule, enabled: false };       // SELECT (findById)
            const after  = { ...mockRule, enabled: true };        // UPDATE returning
            db.query
                .mockResolvedValueOnce({ rows: [before] })
                .mockResolvedValueOnce({ rows: [after] })
                .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // audit INSERT

            const result = await AlertRule.toggleEnabled(1, true);

            expect(result).toBeDefined();
            expect(result.enabled).toBe(true);
            // Call 0 is findById SELECT, call 1 is UPDATE
            expect(db.query.mock.calls[1][0]).toContain('UPDATE alert_rules SET enabled = $1');
            expect(db.query.mock.calls[1][1]).toEqual([true, 1]);
        });

        test('disables rule and returns updated record', async () => {
            const before = { ...mockRule, enabled: true };
            const after  = { ...mockRule, enabled: false };
            db.query
                .mockResolvedValueOnce({ rows: [before] })
                .mockResolvedValueOnce({ rows: [after] })
                .mockResolvedValueOnce({ rows: [{ id: 100 }] });

            const result = await AlertRule.toggleEnabled(1, false);

            expect(result).toBeDefined();
            expect(result.enabled).toBe(false);
            expect(db.query.mock.calls[1][1]).toEqual([false, 1]);
        });

        test('returns null when rule not found', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // findById returns empty

            const result = await AlertRule.toggleEnabled(999, true);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRule.toggleEnabled(1, true)).rejects.toThrow('DB error');
        });
    });

    describe('findByTypeAndSeverity', () => {
        test('returns matching enabled rule', async () => {
            db.query.mockResolvedValue({ rows: [mockRule] });

            const result = await AlertRule.findByTypeAndSeverity('voltage_low', 'WARNING');

            expect(result).toBeDefined();
            expect(result.alert_type).toBe('voltage_low');
            expect(result.severity).toBe('WARNING');
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('enabled = true'),
                ['voltage_low', 'WARNING']
            );
        });

        test('returns null when no matching rule found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRule.findByTypeAndSeverity('nonexistent', 'CRITICAL');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRule.findByTypeAndSeverity('voltage_low', 'WARNING')).rejects.toThrow('DB error');
        });
    });
});
