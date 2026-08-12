#!/usr/bin/env node
/**
 * [SEC-13] Bootstrap-admin CLI.
 *
 * Closes the disaster-recovery bootstrap-gap: user registration hardcodes
 * role='user' (authController.js), so on a fresh production database (the
 * prod bootstrap from database.sql ships NO seed users) there is no
 * application path to create the very first admin. This CLI provides one.
 *
 * SCOPE: works on the CANONICAL / migrated schema only
 * (users.password_hash + users.is_active). The raw `database.sql` legacy
 * schema (users.password / users.active) is deliberately fail-close and is a
 * separate follow-up — run migrations first.
 *
 * Run inside the immutable app container (node is present there; scripts/ is
 * NOT shipped, so this lives under src/):
 *   docker compose -f docker-compose.unified.yml exec \
 *     -e ADMIN_PASSWORD='...' app node src/cli/create-admin.js <username> <email>
 *
 * Semantics (enforced under a transaction + advisory lock so two concurrent
 * runs cannot both insert):
 *   - no admin yet, username/email free      → INSERT role='admin' (created)
 *   - admin exists, same username AND email   → already-exists (idempotent)
 *   - admin exists, same username, diff email → error (likely operator typo)
 *   - a different admin already exists         → error (use the app for more)
 *   - username taken by a non-admin            → error
 *   - email already in use                     → error
 *
 * Password is read from ADMIN_PASSWORD or an interactive muted prompt — NEVER
 * from argv (argv is visible in `ps`/process listings).
 */

const readline = require('readline');

const db = require('../config/database');
const authService = require('../services/authService');
// [CO-2] logger больше не нужен здесь: единственное сообщение (сбой ROLLBACK)
// пишет общий db.safeRollback.

// Arbitrary, stable advisory-lock key namespaced to the admin bootstrap.
// Two concurrent `create-admin` runs serialize on this key.
const ADMIN_BOOTSTRAP_LOCK_KEY = 776699; // SEC-13

/**
 * Create the first admin user. Idempotent on (username, email).
 *
 * @param {{username: string, email: string, password: string}} input
 * @returns {Promise<{status: 'created'|'already-exists', user: object}>}
 */
async function createAdmin({ username, email, password }) {
    // Fail fast on bad input BEFORE opening any DB connection. Reuses the same
    // validation (incl. password strength) as normal registration.
    authService.validateUserData({ username, email, password });

    await db.init();
    try {
        // [AR-11] Транзакция через общий хелпер. BEGIN он выдаёт ПЕРВЫМ, а
        // advisory-xact-lock берётся уже внутри — порядок сохранён: в
        // autocommit такой лок отпустило бы в конце собственного оператора.
        return await db.withTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_BOOTSTRAP_LOCK_KEY]);

        // 1. Is there already an admin?
        const adminRes = await client.query(
            "SELECT user_id, username, email FROM users WHERE role = 'admin' LIMIT 1"
        );
        if (adminRes.rows.length > 0) {
            const existing = adminRes.rows[0];
            if (existing.username === username && existing.email === email) {
                // Возврат из колбэка = успешное завершение: COMMIT выдаст хелпер.
                return {
                    status: 'already-exists',
                    user: {
                        user_id: existing.user_id,
                        username: existing.username,
                        email: existing.email,
                        role: 'admin',
                    },
                };
            }
            if (existing.username === username && existing.email !== email) {
                const err = new Error(
                    `Admin "${username}" already exists with a different email (${existing.email}). ` +
                    'Refusing — this is likely a typo. Manage admins via the app.'
                );
                err.code = 'ADMIN_EMAIL_MISMATCH';
                throw err;
            }
            const err = new Error(
                `An admin already exists (${existing.username}). ` +
                'Create further admins via the application, not this bootstrap CLI.'
            );
            err.code = 'ADMIN_EXISTS';
            throw err;
        }

        // 2. Username taken by a non-admin?
        const usernameRes = await client.query(
            'SELECT user_id, role FROM users WHERE username = $1 LIMIT 1',
            [username]
        );
        if (usernameRes.rows.length > 0) {
            const err = new Error(`Username "${username}" is already taken by a non-admin user.`);
            err.code = 'USERNAME_TAKEN';
            throw err;
        }

        // 3. Email already in use?
        const emailRes = await client.query(
            'SELECT user_id FROM users WHERE email = $1 LIMIT 1',
            [email]
        );
        if (emailRes.rows.length > 0) {
            const err = new Error(`Email "${email}" is already in use.`);
            err.code = 'EMAIL_TAKEN';
            throw err;
        }

        // 4. Insert the first admin.
        const passwordHash = await authService.hashPassword(password);
        const insertRes = await client.query(
            `INSERT INTO users (username, email, password_hash, role, created_at, is_active)
             VALUES ($1, $2, $3, 'admin', NOW(), true)
             RETURNING user_id, username, email, role, is_active`,
            [username, email, passwordHash]
        );
        return { status: 'created', user: insertRes.rows[0] };
        }, { context: 'create-admin' });
    } finally {
        await db.close();
    }
}

/**
 * Prompt for a secret on the TTY with the echo muted. Falls back to a normal
 * (visible) read when stdin is not a TTY (e.g. piped input).
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
function promptHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        // Mute everything the readline would echo for this question.
        let muted = false;
        rl._writeToOutput = function (str) {
            if (!muted) {
                rl.output.write(str);
            }
        };
        process.stdout.write(question);
        muted = true;
        rl.question('', (value) => {
            muted = false;
            rl.output.write('\n');
            rl.close();
            resolve(value);
        });
    });
}

async function main() {
    const [username, email] = process.argv.slice(2);
    if (!username || !email) {
        process.stderr.write(
            'Usage: node src/cli/create-admin.js <username> <email>\n' +
            '  Password is read from ADMIN_PASSWORD env or an interactive prompt (never argv).\n'
        );
        process.exit(2);
        return;
    }

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
        password = await promptHidden('Admin password (min 8 chars, upper+lower+digit): ');
    }

    try {
        const result = await createAdmin({ username, email, password });
        if (result.status === 'created') {
            process.stdout.write(
                `Admin created: ${result.user.username} <${result.user.email}> (user_id=${result.user.user_id}). ` +
                'Log in, complete 2FA setup, then change the password.\n'
            );
        } else {
            process.stdout.write(
                `Admin already exists: ${result.user.username} <${result.user.email}> (user_id=${result.user.user_id}). No change.\n`
            );
        }
        process.exit(0);
    } catch (err) {
        // Never log the password; the error messages above carry no secret.
        process.stderr.write(`create-admin failed: ${err.message}\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { createAdmin, ADMIN_BOOTSTRAP_LOCK_KEY };
