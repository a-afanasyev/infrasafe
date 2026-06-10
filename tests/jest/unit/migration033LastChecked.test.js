/**
 * [AUD-001 PR-B] Static contract checks on migration 033.
 *
 * Real apply-and-verify needs a running PostgreSQL (E2E suite). Here we pin
 * the contract so a reviewer or future agent can't accidentally turn the
 * minimal additive column into something non-idempotent, or fold in the
 * PR-C dispatch/lease/sweep columns (those belong in migration 034).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/033_alert_verifications_last_checked.sql'),
    'utf8'
);

describe('[AUD-001 PR-B] migration 033 — last_checked_at contract', () => {
    test('adds last_checked_at column to alert_verifications', () => {
        expect(MIGRATION).toMatch(/ALTER TABLE\s+alert_verifications/i);
        expect(MIGRATION).toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+last_checked_at\s+TIMESTAMPTZ/i);
    });

    test('is idempotent (IF NOT EXISTS) with no backfill UPDATE', () => {
        expect(MIGRATION).toMatch(/IF NOT EXISTS/i);
        // Purely additive — must not mutate existing rows.
        expect(MIGRATION).not.toMatch(/\bUPDATE\s+alert_verifications\b/i);
    });

    test('does NOT add PR-C dispatch/lease/sweep columns (those are migration 034)', () => {
        expect(MIGRATION).not.toMatch(/next_dispatch_at/i);
        expect(MIGRATION).not.toMatch(/dispatch_lease_until/i);
        expect(MIGRATION).not.toMatch(/uk_notified_at/i);
        expect(MIGRATION).not.toMatch(/uk_notify_next_attempt_at/i);
    });
});
