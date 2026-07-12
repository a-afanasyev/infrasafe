const db = require('../config/database');

/**
 * Persistent account lockout store (SEC-NEW-004 / Phase 12B.3).
 *
 * Keyed by `login` (username or email as used at authentication time).
 * Does NOT reference users(user_id) on purpose — lockout must be enforceable
 * BEFORE the user exists (e.g. for nonexistent accounts, to prevent
 * enumeration timing attacks).
 */

/**
 * Read current lockout record.
 * @returns {Promise<null | { failed_attempts: number, first_attempt_at: Date,
 *   last_attempt_at: Date, locked_until: Date | null }>}
 */
async function get(login) {
    const { rows } = await db.query(
        `SELECT failed_attempts, first_attempt_at, last_attempt_at, locked_until
         FROM account_lockout
         WHERE login = $1`,
        [login]
    );
    return rows[0] || null;
}

/**
 * Atomically record a failed attempt. Lock the account if `failed_attempts`
 * reaches `maxAttempts`. When `userId` is known (the login resolved to a
 * real user), the same statement mirrors the resulting `locked_until` onto
 * `users.account_locked_until` — H-1: this is what authenticateJWT/
 * authenticateRefresh actually enforce, so it MUST land atomically with the
 * lockout row itself. A single CTE statement (not two sequential queries)
 * means a mid-write failure can never leave the lockout recorded here but
 * not reflected on `users` — the caller either sees both applied or the
 * whole statement throws and nothing is applied.
 *
 * @param {string} login
 * @param {number} maxAttempts
 * @param {number} lockoutMs
 * @param {number | null} [userId] — when null (unresolved login), only the
 *   `account_lockout` row is written; `users` is untouched.
 * @returns {Promise<{ failed_attempts: number, locked_until: Date | null }>}
 */
async function recordFailedAttempt(login, maxAttempts, lockoutMs, userId = null) {
    const { rows } = await db.query(
        `
        WITH lock_state AS (
            INSERT INTO account_lockout (login, failed_attempts, first_attempt_at, last_attempt_at, locked_until)
            VALUES ($1, 1, NOW(), NOW(), NULL)
            ON CONFLICT (login) DO UPDATE SET
                failed_attempts = account_lockout.failed_attempts + 1,
                last_attempt_at = NOW(),
                locked_until = CASE
                    WHEN account_lockout.failed_attempts + 1 >= $2
                    THEN NOW() + ($3 || ' milliseconds')::interval
                    ELSE account_lockout.locked_until
                END
            RETURNING failed_attempts, locked_until
        ),
        user_update AS (
            UPDATE users
            SET account_locked_until = lock_state.locked_until
            FROM lock_state
            WHERE users.user_id = $4 AND lock_state.locked_until IS NOT NULL
        )
        SELECT failed_attempts, locked_until FROM lock_state
        `,
        [login, maxAttempts, String(lockoutMs), userId]
    );
    return rows[0];
}

/**
 * Remove the lockout record for the given login. Called after a successful
 * authentication. When `userId` is known, also clears
 * `users.account_locked_until` in the same statement (hygiene — an expired
 * lock already self-heals via the NOW()-comparison in auth middleware, so
 * this is not itself security-critical, but keeps the mirrored column tidy).
 */
async function clearAttempts(login, userId = null) {
    await db.query(
        `
        WITH del AS (
            DELETE FROM account_lockout WHERE login = $1
        )
        UPDATE users
        SET account_locked_until = NULL
        WHERE user_id = $2 AND account_locked_until IS NOT NULL
        `,
        [login, userId]
    );
}

/**
 * Housekeeping: drop records whose lockout expired AND last attempt is older
 * than `staleAfterMs` (default 24h). Keeps the table small without exposing
 * a denial-of-service vector via infinite-login-name floods.
 *
 * @param {number} staleAfterMs — default 24 hours
 * @returns {Promise<number>} deleted rows
 */
async function cleanup(staleAfterMs = 24 * 60 * 60 * 1000) {
    const { rowCount } = await db.query(
        `DELETE FROM account_lockout
         WHERE (locked_until IS NULL OR locked_until < NOW())
           AND last_attempt_at < NOW() - ($1 || ' milliseconds')::interval`,
        [String(staleAfterMs)]
    );
    return rowCount;
}

module.exports = {
    get,
    recordFailedAttempt,
    clearAttempts,
    cleanup,
};
