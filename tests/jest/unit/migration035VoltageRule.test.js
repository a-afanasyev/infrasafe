// PR-3 (AUD-006): migration 035 content guard. The CRITICAL VOLTAGE_ANOMALY rule
// is what escalate-in-place fail-closes on when absent, so pin its shape: own
// transaction (roll-forward-only), CRITICAL severity, urgency=critical,
// min_persistence_seconds=10 (matches 024's CRITICAL intent), idempotent insert.

const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/035_voltage_critical_rule.sql'),
    'utf8'
);

describe('migration 035 — CRITICAL VOLTAGE_ANOMALY rule', () => {
    test('is wrapped in its own transaction (forward-policy)', () => {
        expect(SQL).toMatch(/^\s*BEGIN;/m);
        expect(SQL).toMatch(/^\s*COMMIT;/m);
    });

    test('inserts the CRITICAL VOLTAGE_ANOMALY rule with urgency=critical', () => {
        expect(SQL).toMatch(/INSERT INTO alert_rules/);
        expect(SQL).toMatch(/'VOLTAGE_ANOMALY'\s*,\s*'CRITICAL'/);
        expect(SQL).toMatch(/'critical'/);
    });

    test('sets min_persistence_seconds explicitly to 10 (not the column default 60)', () => {
        // first numeric value in the VALUES tuple is min_persistence_seconds = 10
        expect(SQL).toMatch(/'Критическая аномалия напряжения'\s*,\s*10\b/);
    });

    test('is idempotent via ON CONFLICT (alert_type, severity) DO NOTHING', () => {
        expect(SQL).toMatch(/ON CONFLICT\s*\(\s*alert_type\s*,\s*severity\s*\)\s*DO NOTHING/i);
    });
});
