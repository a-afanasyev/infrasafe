'use strict';

/**
 * [R2-24] AccountLockout model — contract tests.
 *
 * The persistent lockout store (migration 013, Phase 12B.3) had ZERO direct
 * coverage — it was only exercised transitively through auth middleware with a
 * fully-mocked db. These tests pin the SQL contract each method depends on:
 * the exact parameter order/shape, the ON CONFLICT upsert-and-lock structure,
 * and the return shape callers rely on.
 *
 * SCOPE CAVEAT (AUD-039 lesson): db.query is mocked, so these tests verify the
 * JS↔SQL wiring (param binding, statement shape, return plumbing) — NOT that
 * the SQL executes the intended semantics against real Postgres (e.g. that the
 * ON CONFLICT threshold actually flips `locked_until`). Real-DB verification of
 * the lockout arithmetic remains a follow-up integration test.
 */

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

const db = require('../../../src/config/database');
const AccountLockout = require('../../../src/models/AccountLockout');

describe('AccountLockout model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('get', () => {
        test('selects the lockout row by login and returns it', async () => {
            const row = {
                failed_attempts: 2,
                first_attempt_at: new Date('2026-01-01T00:00:00Z'),
                last_attempt_at: new Date('2026-01-01T00:05:00Z'),
                locked_until: null
            };
            db.query.mockResolvedValueOnce({ rows: [row] });

            const result = await AccountLockout.get('alice');

            expect(result).toEqual(row);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/FROM account_lockout/i);
            expect(sql).toMatch(/WHERE login = \$1/i);
            expect(params).toEqual(['alice']);
        });

        test('returns null when there is no row for the login', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            const result = await AccountLockout.get('nobody');
            expect(result).toBeNull();
        });
    });

    describe('recordFailedAttempt', () => {
        test('upserts with (login, maxAttempts, lockoutMs) and returns attempt/lock state', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ failed_attempts: 5, locked_until: new Date('2026-01-01T01:00:00Z') }]
            });

            const result = await AccountLockout.recordFailedAttempt('alice', 5, 900000);

            expect(result).toEqual({
                failed_attempts: 5,
                locked_until: expect.any(Date)
            });
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/INSERT INTO account_lockout/i);
            expect(sql).toMatch(/ON CONFLICT \(login\) DO UPDATE/i);
            // The lock is only set once the incremented counter reaches the max.
            expect(sql).toMatch(/failed_attempts \+ 1 >= \$2/i);
            // lockoutMs is bound as a string for the interval cast (not a number).
            expect(params).toEqual(['alice', 5, '900000']);
            expect(typeof params[2]).toBe('string');
        });

        test('binds the interval milliseconds as a string even for a large value', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ failed_attempts: 1, locked_until: null }] });

            await AccountLockout.recordFailedAttempt('bob', 3, 86400000);

            const [, params] = db.query.mock.calls[0];
            expect(params[2]).toBe('86400000');
        });
    });

    describe('clearAttempts', () => {
        test('deletes the lockout row for the login', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 1 });

            await AccountLockout.clearAttempts('alice');

            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/DELETE FROM account_lockout/i);
            expect(sql).toMatch(/WHERE login = \$1/i);
            expect(params).toEqual(['alice']);
        });
    });

    describe('cleanup', () => {
        test('deletes only expired-and-stale rows and returns the deleted count', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 7 });

            const deleted = await AccountLockout.cleanup(1000);

            expect(deleted).toBe(7);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/DELETE FROM account_lockout/i);
            // Guard: never delete a row whose lock is still active.
            expect(sql).toMatch(/locked_until IS NULL OR locked_until < NOW\(\)/i);
            expect(sql).toMatch(/last_attempt_at < NOW\(\)/i);
            expect(params).toEqual(['1000']);
        });

        test('defaults the stale window to 24h when no argument is given', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 0 });

            await AccountLockout.cleanup();

            const [, params] = db.query.mock.calls[0];
            expect(params).toEqual([String(24 * 60 * 60 * 1000)]);
        });
    });
});
