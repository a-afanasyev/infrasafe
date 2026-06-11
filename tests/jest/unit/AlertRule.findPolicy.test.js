// PR-3 (AUD-006): AlertRule.findPolicyByTypeAndSeverity — an enabled-AGNOSTIC
// lookup. _escalateAlert needs the policy row even when the rule is disabled
// (it still escalates the alert in place; it just doesn't notify UK), so unlike
// findByTypeAndSeverity this must NOT filter on `enabled = true` and must surface
// the `enabled` flag to the caller.

jest.mock('../../../src/config/database', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');

describe('AlertRule.findPolicyByTypeAndSeverity', () => {
    beforeEach(() => jest.clearAllMocks());

    test('queries by type+severity WITHOUT an enabled=true filter', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1, alert_type: 'VOLTAGE_ANOMALY', severity: 'CRITICAL', enabled: false }] });

        await AlertRule.findPolicyByTypeAndSeverity('VOLTAGE_ANOMALY', 'CRITICAL');

        const sql = db.query.mock.calls[0][0];
        expect(sql).not.toMatch(/enabled\s*=\s*true/i);
        expect(sql).toMatch(/alert_type\s*=\s*\$1/);
        expect(sql).toMatch(/severity\s*=\s*\$2/);
        expect(db.query.mock.calls[0][1]).toEqual(['VOLTAGE_ANOMALY', 'CRITICAL']);
    });

    test('returns a DISABLED rule (does not hide it)', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 9, enabled: false, uk_urgency: 'critical' }] });
        const rule = await AlertRule.findPolicyByTypeAndSeverity('VOLTAGE_ANOMALY', 'CRITICAL');
        expect(rule).toMatchObject({ id: 9, enabled: false });
    });

    test('returns null when no policy row exists (fail-close basis)', async () => {
        db.query.mockResolvedValue({ rows: [] });
        const rule = await AlertRule.findPolicyByTypeAndSeverity('VOLTAGE_ANOMALY', 'CRITICAL');
        expect(rule).toBeNull();
    });
});
