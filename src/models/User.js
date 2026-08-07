'use strict';

/**
 * [AR-3(а)] Единственное место, где живёт SQL по таблице `users`.
 *
 * До этого запросы к `users` были разбросаны по authService (9 мест),
 * totpService (8) и CLI создания администратора (4) — модели у таблицы не
 * было вовсе. Симптом уже материализовался: `totpService` держал собственный
 * хелпер `invalidateUserCache` и обязан был звать его после КАЖДОГО UPDATE,
 * иначе логин до пяти минут читал устаревший `totp_enabled` из кэша
 * authService. То есть корректность зависела от того, вспомнит ли автор
 * следующего UPDATE про чужой кэш.
 *
 * Здесь инвалидация — не обязанность вызывающего, а часть операции записи:
 * любой метод, меняющий строку пользователя, сбрасывает кэш сам. Забыть
 * нельзя, потому что забывать больше нечего.
 *
 * Проекции сохранены ровно те, что были на местах вызова:
 *   - `AUTH_PROJECTION` — без `password_hash`, для решений об аутентификации;
 *   - `findByLogin` возвращает строку целиком, включая хеш: он нужен для
 *     сверки пароля при входе;
 *   - хеш пароля отдаётся только точечными методами и никогда не кэшируется.
 *
 * Намеренное исключение: два UPDATE по `users` в `models/AccountLockout.js`
 * остаются там. Они — часть одного CTE-запроса вместе с изменением
 * `account_lockout`; вынести их сюда значит разбить атомарный запрос на два
 * и получить окно, в котором счётчик попыток и зеркальная колонка
 * расходятся. Исключение зафиксировано в тесте-стороже.
 */

const db = require('../config/database');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

// Совпадает с ключом, которым пользуется authService (`${cachePrefix}:user:`).
// Держим строку здесь: раз инвалидация переехала в модель, то и знание о
// форме ключа должно жить рядом с ней.
const CACHE_KEY = (userId) => `auth:user:${userId}`;

// Проекция для решений об аутентификации. Без `password_hash` — он не должен
// попадать ни в кэш, ни в ответ.
const AUTH_PROJECTION = `user_id, username, email, role, is_active,
    account_locked_until, created_at, updated_at, password_changed_at`;

/**
 * Сбросить кэш строки пользователя.
 *
 * Best-effort: промах кэша хуже, чем шум в логе, но упасть здесь нельзя —
 * запись в БД уже состоялась, и исключение отсюда превратило бы успешную
 * операцию в ошибку для клиента.
 */
async function invalidateCache(userId) {
    if (userId == null) return;
    try {
        await cacheService.invalidate(CACHE_KEY(userId));
    } catch (err) {
        logger.error(`User: не удалось сбросить кэш ${CACHE_KEY(userId)}: ${err.message}`);
    }
}

// --- Чтение ---------------------------------------------------------------

/**
 * Строка пользователя без хеша пароля — для проверок аутентификации.
 *
 * Хеш отсекается ДВАЖДЫ: его нет в списке колонок и он снимается с результата.
 * Второе не избыточность: этот объект уходит в кэш и в ответ, и гарантия
 * «хеш отсюда не выйдет» не должна зависеть от того, не добавит ли кто-нибудь
 * когда-нибудь звёздочку в проекцию.
 */
async function findAuthProjection(userId) {
    const { rows } = await db.query(
        `SELECT ${AUTH_PROJECTION} FROM users WHERE user_id = $1`,
        [userId]
    );
    if (!rows.length) return null;
    // eslint-disable-next-line no-unused-vars
    const { password_hash, ...user } = rows[0];
    return user;
}

/**
 * Поиск по логину или почте — вход. Возвращает строку ЦЕЛИКОМ, включая
 * `password_hash`: он нужен для сверки пароля и потому не кэшируется.
 */
async function findByLogin(login, email = null) {
    const useSeparateEmail = email && email !== login;
    const { rows } = useSeparateEmail
        ? await db.query('SELECT * FROM users WHERE username = $1 OR email = $2', [login, email])
        : await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [login]);
    return rows[0] || null;
}

/** Хеш пароля. Отдельным методом, чтобы он не попадал в общие проекции. */
async function getPasswordHash(userId) {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
    return rows.length ? rows[0].password_hash : null;
}

/** Хеш пароля только для активного пользователя — вторичные проверки (SEC-105). */
async function getActivePasswordHash(userId) {
    const { rows } = await db.query(
        'SELECT password_hash FROM users WHERE user_id = $1 AND is_active = true',
        [userId]
    );
    return rows[0]?.password_hash ?? null;
}

/** Состояние 2FA. `withRecoveryCodes` — только там, где коды действительно нужны. */
async function getTotpState(userId, { withRecoveryCodes = false } = {}) {
    const columns = withRecoveryCodes
        ? 'totp_secret, totp_enabled, recovery_codes'
        : 'totp_secret, totp_enabled';
    const { rows } = await db.query(`SELECT ${columns} FROM users WHERE user_id = $1`, [userId]);
    return rows[0] || null;
}

/** Роль пользователя. */
async function getRole(userId) {
    const { rows } = await db.query('SELECT role FROM users WHERE user_id = $1', [userId]);
    return rows.length ? rows[0].role : null;
}

/** Первый попавшийся администратор — bootstrap-проверка в CLI. */
async function findAnyAdmin() {
    const { rows } = await db.query(
        "SELECT user_id, username, email FROM users WHERE role = 'admin' LIMIT 1"
    );
    return rows[0] || null;
}

/** Проверка занятости логина — CLI. */
async function findByUsername(username) {
    const { rows } = await db.query(
        'SELECT user_id, role FROM users WHERE username = $1 LIMIT 1',
        [username]
    );
    return rows[0] || null;
}

/** Проверка занятости почты — CLI. */
async function findByEmail(email) {
    const { rows } = await db.query(
        'SELECT user_id FROM users WHERE email = $1 LIMIT 1',
        [email]
    );
    return rows[0] || null;
}

// --- Запись (каждый метод сам сбрасывает кэш) ------------------------------

/** Создать пользователя. Возвращает строку без хеша пароля. */
async function create({ username, email, passwordHash, role }) {
    const { rows } = await db.query(
        `INSERT INTO users (username, email, password_hash, role, created_at, is_active)
         VALUES ($1, $2, $3, $4, NOW(), true)
         RETURNING user_id, username, email, role, created_at, is_active`,
        [username, email, passwordHash, role]
    );
    return rows[0];
}

/** Сменить пароль. `password_changed_at` двигается вместе с ним — на нём
 *  держится отсечение токенов, выпущенных до смены (Phase 13). */
async function updatePassword(userId, passwordHash) {
    await db.query(
        'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2',
        [passwordHash, userId]
    );
    await invalidateCache(userId);
}

/** Отметить успешный вход. */
async function updateLastLogin(userId) {
    await db.query('UPDATE users SET last_login = NOW() WHERE user_id = $1', [userId]);
    await invalidateCache(userId);
}

/** Записать секрет 2FA и коды восстановления (этап настройки, до подтверждения). */
async function setTotpSecret(userId, encryptedSecret, recoveryCodes) {
    await db.query(
        'UPDATE users SET totp_secret = $1, recovery_codes = $2 WHERE user_id = $3',
        [encryptedSecret, recoveryCodes, userId]
    );
    await invalidateCache(userId);
}

/** Включить 2FA — подтверждение настройки. */
async function enableTotp(userId) {
    await db.query('UPDATE users SET totp_enabled = true WHERE user_id = $1', [userId]);
    await invalidateCache(userId);
}

/** Переписать коды восстановления (один израсходован). */
async function setRecoveryCodes(userId, recoveryCodes) {
    await db.query('UPDATE users SET recovery_codes = $1 WHERE user_id = $2', [recoveryCodes, userId]);
    await invalidateCache(userId);
}

/** Полностью снять 2FA. */
async function disableTotp(userId) {
    await db.query(
        'UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = NULL WHERE user_id = $1',
        [userId]
    );
    await invalidateCache(userId);
}

module.exports = {
    AUTH_PROJECTION,
    invalidateCache,
    findAuthProjection,
    findByLogin,
    getPasswordHash,
    getActivePasswordHash,
    getTotpState,
    getRole,
    findAnyAdmin,
    findByUsername,
    findByEmail,
    create,
    updatePassword,
    updateLastLogin,
    setTotpSecret,
    enableTotp,
    setRecoveryCodes,
    disableTotp,
};
