#!/usr/bin/env node
/**
 * [A-01] Аварийный сброс 2FA.
 *
 * Зачем он появился. Закрытие A-01 запретило выдавать новый TOTP-секрет
 * аккаунту с уже включённой 2FA — раньше этим путём («знаю пароль → получаю
 * новый секрет → вхожу по свежему OTP») второй фактор обходился целиком.
 * Но тот же путь был единственным способом восстановиться, потеряв телефон, и
 * закрыть его, не дав замены, значило бы запереть владельца:
 *
 *   - `POST /auth/disable-2fa` требует ПОЛНОЙ сессии, то есть уже пройденной
 *     2FA, и админам запрещён в принципе (`totpService.disable`);
 *   - коды восстановления помогают, только если они сохранены (и до A-11 они
 *     вообще не работали);
 *   - админского сброса в приложении нет и намеренно не заводится: точка,
 *     снимающая второй фактор по HTTP, — это ровно то, что мы только что
 *     закрыли.
 *
 * Поэтому сброс живёт вне HTTP: он требует доступа к хосту и контейнеру, то
 * есть привилегии уровня «и так может всё». Запуск (scripts/ в образ не
 * попадает по SEC-14, поэтому файл лежит в src/):
 *
 *   docker compose -f docker-compose.unified.yml exec app \
 *     node src/cli/reset-2fa.js <username>
 *
 * Что делает: снимает секрет, флаг и коды восстановления И отзывает все сессии
 * пользователя — одним запросом (`User.resetTotpByUsername`). Отзыв входит в
 * операцию не для порядка: сброс делают, когда подозревают угон, и оставить
 * живыми прежние сессии значило бы сбросить замок, не выгнав гостя.
 *
 * Идемпотентен: повторный запуск для того же логина снова вернёт «сброшено»
 * (строка уже чистая, вреда нет). Ничего чувствительного в argv не передаётся.
 */

const db = require('../config/database');
const User = require('../models/User');

/**
 * @param {string} username
 * @returns {Promise<{status:'reset'|'not-found', user?: object}>}
 */
async function resetTwoFactor(username) {
    await db.init();
    try {
        const user = await User.resetTotpByUsername(username);
        if (!user) return { status: 'not-found' };
        return { status: 'reset', user };
    } finally {
        await db.close();
    }
}

async function main() {
    const [username] = process.argv.slice(2);
    if (!username) {
        process.stderr.write(
            'Usage: node src/cli/reset-2fa.js <username>\n' +
            '  Снимает 2FA (секрет, флаг, коды восстановления) и отзывает все сессии пользователя.\n'
        );
        process.exit(2);
        return;
    }

    try {
        const result = await resetTwoFactor(username);
        if (result.status === 'not-found') {
            process.stderr.write(`reset-2fa: пользователь "${username}" не найден. Ничего не изменено.\n`);
            process.exit(1);
            return;
        }
        process.stdout.write(
            `2FA сброшена: ${result.user.username} (user_id=${result.user.user_id}, role=${result.user.role}). ` +
            'Все сессии отозваны. Следующий вход потребует пройти настройку 2FA заново.\n'
        );
        process.exit(0);
    } catch (err) {
        process.stderr.write(`reset-2fa failed: ${err.message}\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { resetTwoFactor };
