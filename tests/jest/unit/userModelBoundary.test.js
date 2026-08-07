/**
 * [AR-3(а)] Сторож границы: SQL по таблице `users` живёт только в модели.
 *
 * Обычный тест проверяет поведение и молчит, когда рядом появляется вторая
 * дорога к тем же данным. Здесь предмет проверки — именно граница: пока
 * запросы к `users` были разбросаны по сервисам, корректность держалась на
 * том, вспомнит ли автор следующего UPDATE сбросить чужой кэш. Один раз это
 * уже стоило хелпера `invalidateUserCache` в totpService.
 *
 * Тест сканирует исходники и падает, если SQL по `users` появился вне
 * `models/User.js`. Он не заменяет ревью, но ловит отступление в тот момент,
 * когда оно ещё стоит одну строку.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../../src');

/**
 * Разрешённые исключения — с причиной, а не «так исторически».
 *
 * `models/AccountLockout.js`: два UPDATE по `users` входят в один CTE-запрос
 * вместе с изменением `account_lockout`. Вынести их в модель значит разбить
 * атомарный запрос на два и получить окно, в котором счётчик неудачных
 * попыток и зеркальная колонка `users.account_locked_until` расходятся.
 * Атомарность здесь важнее единообразия слоёв.
 *
 * `cli/create-admin.js`: все запросы идут в ОДНОЙ транзакции на собственном
 * соединении под advisory-локом — так устроена защита от гонки при
 * bootstrap-создании первого администратора. Методы модели работают через пул
 * и оказались бы вне этой транзакции. Правильное снятие исключения — научить
 * модель принимать executor (как это сделано в alertVerificationService), но
 * это отдельная правка, а не довесок к переносу сервисов.
 */
const ALLOWED = new Set([
    path.join(SRC, 'models', 'User.js'),
    path.join(SRC, 'models', 'AccountLockout.js'),
    path.join(SRC, 'cli', 'create-admin.js'),
]);

// Запросы, где `users` — ГЛАВНАЯ таблица: чтение строки пользователя, вставка,
// изменение. Именно они создают второй путь к данным и рискуют разойтись с
// кэшем.
//
// `JOIN users` намеренно не считается нарушением: подтягивание имени
// подтвердившего в запрос по алертам (`alertService`) не владеет строкой
// пользователя, ничего в ней не меняет и потому не может протухнуть. Запретить
// такой join значило бы либо разбивать один запрос на два, либо заводить в
// модели метод, которым пользуется ровно один SELECT из другой таблицы.
const USERS_SQL = /\b(?:FROM|INTO|UPDATE)\s+users\b/i;

function collectJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectJsFiles(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/** Убрать комментарии, чтобы упоминание таблицы в пояснении не считалось кодом. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('[AR-3] граница модели пользователей', () => {
    test('SQL по таблице users не встречается вне models/User.js', () => {
        const offenders = [];

        for (const file of collectJsFiles(SRC)) {
            if (ALLOWED.has(file)) continue;
            const code = stripComments(fs.readFileSync(file, 'utf8'));
            code.split('\n').forEach((line, i) => {
                if (USERS_SQL.test(line)) {
                    offenders.push(`${path.relative(SRC, file)}:${i + 1} — ${line.trim().slice(0, 90)}`);
                }
            });
        }

        expect(offenders).toEqual([]);
    });

    test('модель отдаёт весь набор операций, которым пользуются вызывающие', () => {
        const User = require('../../../src/models/User');
        const required = [
            'findAuthProjection', 'findByLogin', 'getPasswordHash', 'getActivePasswordHash',
            'getTotpState', 'getRole', 'findAnyAdmin', 'findByUsername', 'findByEmail',
            'create', 'updatePassword', 'updateLastLogin', 'setTotpSecret',
            'enableTotp', 'setRecoveryCodes', 'disableTotp',
        ];
        for (const name of required) {
            expect(typeof User[name]).toBe('function');
        }
    });
});
