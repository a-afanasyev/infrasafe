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
 * reaches `maxAttempts`.
 *
 * @param {string} login
 * @param {number} maxAttempts
 * @param {number} lockoutMs
 * @returns {Promise<{ failed_attempts: number, locked_until: Date | null }>}
 */
async function recordFailedAttempt(login, maxAttempts, lockoutMs) {
    const { rows } = await db.query(
        `
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
        `,
        [login, maxAttempts, String(lockoutMs)]
    );
    return rows[0];
}

/**
 * Remove the lockout record for the given login.
 * Called after a successful authentication.
 */
async function clearAttempts(login) {
    await db.query('DELETE FROM account_lockout WHERE login = $1', [login]);
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
