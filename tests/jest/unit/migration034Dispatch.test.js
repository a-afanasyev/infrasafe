/**
 * [AUD-001 PR-C] Static contract checks on migration 034.
 *
 * Real apply-and-verify needs a running PostgreSQL (E2E suite). Here we pin
 * the contract so a reviewer or future agent can't accidentally:
 *   - turn the additive columns into something non-idempotent,
 *   - drop the historical uk_notified_at backfill OUT of its column-guard DO
 *     block (a bare UPDATE re-run would mark post-deploy NULL escalations
 *     "notified" and the sweep would lose them — the exact bug the guard
 *     prevents, mirrors migration 031's idempotency contract),
 *   - or forget the partial index the engineer sweep relies on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/034_alert_verifications_dispatch.sql'),
    'utf8'
);

describe('[AUD-001 PR-C] migration 034 — dispatch/lease/sweep contract', () => {
    test('adds the four dispatch/lease/sweep columns', () => {
        expect(MIGRATION).toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+next_dispatch_at\s+TIMESTAMPTZ/i);
        expect(MIGRATION).toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+dispatch_lease_until\s+TIMESTAMPTZ/i);
        expect(MIGRATION).toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+uk_notify_next_attempt_at\s+TIMESTAMPTZ/i);
        // uk_notified_at is added inside the guarded DO-block (NOT IF NOT EXISTS),
        // so assert the column name appears in an ALTER ... ADD COLUMN.
        expect(MIGRATION).toMatch(/ADD COLUMN\s+uk_notified_at\s+TIMESTAMPTZ/i);
    });

    test('uk_notified_at backfill lives INSIDE a column-existence DO guard', () => {
        // The backfill UPDATE must be guarded by a NOT EXISTS column check so a
        // re-apply is a true no-op (post-deploy NULL escalations untouched).
        expect(MIGRATION).toMatch(/information_schema\.columns/i);
        expect(MIGRATION).toMatch(/column_name\s*=\s*'uk_notified_at'/i);
        const backfill = /UPDATE\s+alert_verifications\s+SET\s+uk_notified_at\s*=\s*NOW\(\)\s+WHERE\s+status\s*=\s*'engineer_required'/i;
        expect(MIGRATION).toMatch(backfill);

        // Structural guard: the backfill UPDATE must appear AFTER the
        // information_schema guard opens (i.e. it is inside the IF branch),
        // not as a top-level bare statement.
        const guardIdx = MIGRATION.search(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM information_schema\.columns/i);
        const updateIdx = MIGRATION.search(backfill);
        expect(guardIdx).toBeGreaterThanOrEqual(0);
        expect(updateIdx).toBeGreaterThan(guardIdx);
    });

    test('creates the engineer-sweep partial index (idempotent)', () => {
        expect(MIGRATION).toMatch(/CREATE INDEX\s+IF NOT EXISTS/i);
        expect(MIGRATION).toMatch(/WHERE\s+status\s*=\s*'engineer_required'\s+AND\s+uk_notified_at\s+IS\s+NULL/i);
    });

    test('is transactional and idempotent', () => {
        expect(MIGRATION).toMatch(/^\s*BEGIN\s*;/im);
        expect(MIGRATION).toMatch(/COMMIT\s*;/i);
        expect(MIGRATION).toMatch(/IF NOT EXISTS/i);
    });
});
