/**
 * [M-6] Отзыв всех сессий пользователя.
 *
 * Что было не так
 * ---------------
 * Реплей refresh-токена ловился (UNIQUE на `token_hash` в `token_blacklist`)
 * и отдавал 401 — но ровно на этот один хэш. Ротация refresh-токенов
 * означает, что вор, укравший токен, получает при первом же использовании
 * СВЕЖУЮ пару и дальше живёт со своим семейством до истечения 7 суток.
 * Реплей — это сигнал «у кого-то из двоих токен украден», и отвечать на него
 * блокировкой одной строки бессмысленно.
 *
 * Отдельно не было и явного «выйти на всех устройствах».
 *
 * Почему timestamp, а не token_version
 * ------------------------------------
 * Механизм массовой инвалидации в проекте уже есть: `_isIssuedBeforeCutoff`
 * отвергает любой токен, чей `iat` старше `users.password_changed_at`, и он
 * уже подключён во всех трёх ветках middleware, в `refreshToken` и в
 * `verifyTempToken`. Достаточно добавить второй рубеж — `sessions_revoked_at`
 * — и взять максимум. `token_version` требовал бы нового claim'а в payload и
 * ответа на вопрос «что делать с уже выданными токенами без него»; здесь же
 * `iat` есть в каждом токене по стандарту.
 *
 * Цена реплей-ответа
 * ------------------
 * Отличить вора от жертвы невозможно, поэтому отзыв выкидывает обоих. Это
 * осознанная плата и стандартное поведение для rotation-схем. Смягчение —
 * окно на добросовестную гонку: две вкладки, обновляющие токен одновременно,
 * или ретрай после потерянного ответа дают тот же UNIQUE-конфликт, и
 * выкидывать за это всю сессию нельзя.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    invalidate: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../src/models/User', () => ({
    findAuthProjection: jest.fn(),
    revokeSessions: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const User = require('../../../src/models/User');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-session-revocation';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-revocation';

const jwt = require('jsonwebtoken');
const authService = require('../../../src/services/authService');

const USER = {
    user_id: 11,
    username: 'operator',
    email: 'op@example.com',
    role: 'user',
    is_active: true,
    account_locked_until: null,
    password_changed_at: null,
    sessions_revoked_at: null
};

/** Валидный refresh-токен с заданным моментом выпуска. */
function refreshTokenIssuedAt(secondsAgo = 0) {
    return jwt.sign(
        { user_id: USER.user_id, type: 'refresh', iat: Math.floor(Date.now() / 1000) - secondsAgo },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    User.findAuthProjection.mockResolvedValue({ ...USER });
});

describe('[M-6] cutoff учитывает sessions_revoked_at', () => {
    test('токен, выпущенный до отзыва, признаётся протухшим', () => {
        const decoded = { iat: Math.floor(Date.now() / 1000) - 3600 };
        const user = { ...USER, sessions_revoked_at: new Date() };

        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(true);
    });

    test('токен, выпущенный после отзыва, остаётся годным', () => {
        const user = { ...USER, sessions_revoked_at: new Date(Date.now() - 3600_000) };
        const decoded = { iat: Math.floor(Date.now() / 1000) };

        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(false);
    });

    test('берётся ПОЗДНЕЙШИЙ из двух рубежей', () => {
        // Пароль сменили давно, сессии отозвали только что: токен между этими
        // событиями обязан умереть. Если бы код смотрел лишь на первый рубеж,
        // отзыв не работал бы для тех, кто когда-либо менял пароль.
        const user = {
            ...USER,
            password_changed_at: new Date(Date.now() - 86_400_000),
            sessions_revoked_at: new Date()
        };
        const decoded = { iat: Math.floor(Date.now() / 1000) - 600 };

        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(true);
    });

    test('оба рубежа пусты — рубежа нет вовсе', () => {
        expect(authService._isIssuedBeforeCutoff({ iat: 1 }, { ...USER })).toBe(false);
    });
});

describe('[M-6] revokeAllSessions', () => {
    test('проставляет отметку отзыва и сбрасывает кэш строки', async () => {
        await authService.revokeAllSessions(11, 'manual');

        expect(User.revokeSessions).toHaveBeenCalledWith(11);
    });

    test('отказ БД пробрасывается, а не глотается', async () => {
        // Молчаливый провал здесь означал бы «мы сказали пользователю, что
        // выкинули всех, а на деле нет» — худший исход из возможных.
        User.revokeSessions.mockRejectedValueOnce(new Error('БД недоступна'));

        await expect(authService.revokeAllSessions(11, 'manual')).rejects.toThrow('БД недоступна');
    });
});

describe('[M-6] реплей refresh-токена отзывает всё семейство', () => {
    /** Ответ БД: INSERT в чёрный список падает по UNIQUE, строка помечена `agoMs` назад. */
    function replayedAfter(agoMs) {
        db.query.mockImplementation(async (sql) => {
            if (String(sql).includes('INSERT INTO token_blacklist')) {
                const err = new Error('duplicate key');
                err.code = '23505';
                throw err;
            }
            if (String(sql).includes('blacklisted_at')) {
                return { rows: [{ blacklisted_at: new Date(Date.now() - agoMs) }] };
            }
            return { rows: [] };
        });
    }

    test('реплей спустя минуту после ротации отзывает все сессии', async () => {
        replayedAfter(60_000);

        await expect(authService.refreshToken(refreshTokenIssuedAt(120)))
            .rejects.toMatchObject({ code: 'TOKEN_REUSE' });

        expect(User.revokeSessions).toHaveBeenCalledWith(11);
    });

    test('повторная отправка в пределах окна гонки НЕ отзывает сессии', async () => {
        replayedAfter(1_000);

        await expect(authService.refreshToken(refreshTokenIssuedAt(120)))
            .rejects.toMatchObject({ code: 'TOKEN_REUSE' });

        // Две вкладки, обновляющие токен одновременно, дают тот же UNIQUE-
        // конфликт. Выкидывать за это пользователя со всех устройств значило
        // бы менять кражу токена на регулярные разлогины на ровном месте.
        expect(User.revokeSessions).not.toHaveBeenCalled();
    });

    test('реплей в любом случае остаётся 401 — окно гонки не пропускает токен', async () => {
        replayedAfter(1_000);

        await expect(authService.refreshToken(refreshTokenIssuedAt(120)))
            .rejects.toMatchObject({ code: 'TOKEN_REUSE' });
    });

    test('неизвестный момент блокировки трактуется как кража', async () => {
        // Строка есть (UNIQUE сработал), а `blacklisted_at` прочитать не
        // удалось. Выбор в пользу отзыва: ложный разлогин восстанавливается
        // входом, пропущенная кража — нет.
        db.query.mockImplementation(async (sql) => {
            if (String(sql).includes('INSERT INTO token_blacklist')) {
                const err = new Error('duplicate key');
                err.code = '23505';
                throw err;
            }
            return { rows: [] };
        });

        await expect(authService.refreshToken(refreshTokenIssuedAt(120)))
            .rejects.toMatchObject({ code: 'TOKEN_REUSE' });

        expect(User.revokeSessions).toHaveBeenCalledWith(11);
    });

    test('сбой самого отзыва не подменяет причину отказа', async () => {
        replayedAfter(60_000);
        User.revokeSessions.mockRejectedValueOnce(new Error('БД недоступна'));

        // Клиент обязан увидеть TOKEN_REUSE, а не ошибку БД: иначе реплей
        // выглядел бы как временный сбой и клиент бы его повторил.
        await expect(authService.refreshToken(refreshTokenIssuedAt(120)))
            .rejects.toMatchObject({ code: 'TOKEN_REUSE' });
    });
});
