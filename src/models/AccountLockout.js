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
                -- [N-03] Истёкшая блокировка сбрасывается здесь же, в том же
                -- атомарном запросе: счёт начинается заново, как с чистого
                -- листа. Отдельное «прочитать → очистить → записать» теряло
                -- параллельно выставленную свежую блокировку.
                failed_attempts = CASE
                    WHEN account_lockout.locked_until <= NOW() THEN 1
                    ELSE account_lockout.failed_attempts + 1
                END,
                first_attempt_at = CASE
                    WHEN account_lockout.locked_until <= NOW() THEN NOW()
                    ELSE account_lockout.first_attempt_at
                END,
                last_attempt_at = NOW(),
                locked_until = CASE
                    WHEN (CASE WHEN account_lockout.locked_until <= NOW() THEN 1
                               ELSE account_lockout.failed_attempts + 1 END) >= $2
                    THEN NOW() + ($3 || ' milliseconds')::interval
                    WHEN account_lockout.locked_until <= NOW() THEN NULL
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
 * [Q-11] Зарезервировать попытку входа ДО сверки пароля: один атомарный UPSERT
 * увеличивает счётчик и возвращает новое значение. Вызывающий пропускает
 * попытку к bcrypt, только если `failed_attempts <= maxAttempts`, — поэтому
 * параллельная пачка не может обогнать счётчик, как при «прочитал → сверил →
 * записал». На `maxAttempts`-й резервации ставится блокировка; успешный вход
 * снимает её через clearAttempts.
 *
 * Отличия от recordFailedAttempt: действующая блокировка НЕ продлевается
 * (иначе отбитые попытки держали бы её вечно — для общего тормоза это
 * анонимный DoS), а `users` не трогается (парольный промах на учётную запись
 * целиком не влияет). Истёкшая блокировка, как и там, сбрасывает счёт на 1.
 *
 * @returns {Promise<{ failed_attempts: number, locked_until: Date | null }>}
 */
async function reserveAttempt(login, maxAttempts, lockoutMs) {
    const { rows } = await db.query(
        `
        INSERT INTO account_lockout (login, failed_attempts, first_attempt_at, last_attempt_at, locked_until)
        VALUES ($1, 1, NOW(), NOW(),
                CASE WHEN 1 >= $2 THEN NOW() + ($3 || ' milliseconds')::interval END)
        ON CONFLICT (login) DO UPDATE SET
            failed_attempts = CASE
                WHEN account_lockout.locked_until <= NOW() THEN 1
                ELSE account_lockout.failed_attempts + 1
            END,
            first_attempt_at = CASE
                WHEN account_lockout.locked_until <= NOW() THEN NOW()
                ELSE account_lockout.first_attempt_at
            END,
            last_attempt_at = NOW(),
            locked_until = CASE
                WHEN account_lockout.locked_until > NOW() THEN account_lockout.locked_until
                WHEN (CASE WHEN account_lockout.locked_until <= NOW() THEN 1
                           ELSE account_lockout.failed_attempts + 1 END) >= $2
                THEN NOW() + ($3 || ' milliseconds')::interval
                ELSE NULL
            END
        RETURNING failed_attempts, locked_until
        `,
        [login, maxAttempts, String(lockoutMs)]
    );
    return rows[0];
}

/**
 * [Q-11] Вернуть резервацию, по которой пароль так и не сверялся (попытку
 * отбил другой счётчик). Снимает блокировку, если без этой попытки порог
 * не достигнут.
 */
async function releaseAttempt(login, maxAttempts) {
    await db.query(
        `UPDATE account_lockout SET
             failed_attempts = failed_attempts - 1,
             locked_until = CASE WHEN failed_attempts - 1 < $2 THEN NULL ELSE locked_until END
         WHERE login = $1 AND failed_attempts > 0`,
        [login, maxAttempts]
    );
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
    reserveAttempt,
    releaseAttempt,
    clearAttempts,
    cleanup,
};
