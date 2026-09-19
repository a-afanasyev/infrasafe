'use strict';

/**
 * [FOUNTAIN] Сторожа доступа для `auth_request` на периметре.
 *
 * Панель фонтана встраивается в интерфейс InfraSafe и закрывается НАШЕЙ
 * авторизацией: nginx на каждый запрос делает подзапрос сюда и пускает дальше
 * только при 2xx. Кругов два — смотреть может любой вошедший, управлять только
 * администратор, — поэтому и сторожа два.
 *
 * Почему не переиспользуется `/auth/profile` и не берётся любой admin-маршрут:
 * оба ходят в базу и отдают тело, а подзапрос делается на КАЖДЫЙ запрос к
 * панели, включая долгоживущий поток событий. Сторожу нужен только вердикт.
 *
 * Отдельная забота — имя пользователя в заголовке. Оно нужно периметру, чтобы
 * записать в журнал, КТО нажал кнопку (для просмотра это терпимо, для
 * управления оборудованием — нет). Но заголовок HTTP обязан быть ASCII: имя с
 * кириллицей делает ответ невалидным, и падает не журнал, а весь запрос.
 * Ровно на этом я уже спотыкалась сегодня в другом месте — здесь проверено.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../../src/middleware/rateLimiter', () => {
    const passThrough = (_req, _res, next) => next();
    const limiterObj = { middleware: () => passThrough, destroy: () => {} };
    return {
        SimpleRateLimiter: jest.fn().mockImplementation(() => limiterObj),
        applyTelemetryRateLimit: passThrough,
        applyCrudRateLimit: passThrough,
        applyAnalyticsRateLimit: passThrough,
        applyAdminRateLimit: passThrough,
        applyUkInventoryRateLimit: passThrough,
        applyMapDataRateLimit: passThrough,
        rateLimitStrict: passThrough,
        authLimiter: limiterObj,
        refreshLimiter: limiterObj,
        twoFaLimiter: limiterObj,
        disable2faLimiter: limiterObj,
        registerLimiter: limiterObj,
        passwordChangeLimiter: limiterObj,
    };
});

jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockResolvedValue(true),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    close: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const db = require('../../../src/config/database');
const { setupQueryMock } = require('../helpers/dbMock');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-gate-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-gate-itest';

// Сентинел dbMock: user_id 999 разрешается как администратор, остальные — как
// обычный пользователь. Роль берётся ИЗ БАЗЫ, а не из токена.
const token = (userId) => jwt.sign(
    { user_id: userId, username: `u${userId}`, role: 'whatever' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;
let adminAuth;
let userAuth;

beforeAll(() => {
    setupQueryMock(db);
    app = require('../../../src/server');
    adminAuth = `Bearer ${token(999)}`;
    userAuth = `Bearer ${token(7)}`;
});

const GATE = '/api/auth/gate';
const ADMIN_GATE = '/api/auth/gate/admin';

describe('[FOUNTAIN] сторож чтения', () => {
    test('без сессии — отказ, а не пропуск', () => request(app).get(GATE).expect(401));

    test('вошедший пользователь проходит и получает 204 без тела', async () => {
        const res = await request(app).get(GATE).set('Authorization', userAuth);
        expect(res.status).toBe(204);
        // Тело подзапроса nginx выбрасывает — отдавать его значит греть канал зря.
        expect(res.text).toBeFalsy();
    });

    test('администратор тоже проходит: чтение шире управления', async () => {
        await request(app).get(GATE).set('Authorization', adminAuth).expect(204);
    });
});

describe('[FOUNTAIN] сторож управления', () => {
    test('без сессии — отказ', () => request(app).get(ADMIN_GATE).expect(401));

    test('обычный пользователь НЕ проходит', async () => {
        // Тот самый круг, ради которого сторожа два. Ошибка здесь — это не
        // «лишний доступ к странице», а возможность переключить насос.
        const res = await request(app).get(ADMIN_GATE).set('Authorization', userAuth);
        expect(res.status).toBe(403);
    });

    test('администратор проходит', async () => {
        await request(app).get(ADMIN_GATE).set('Authorization', adminAuth).expect(204);
    });
});

describe('[FOUNTAIN] личность для журнала', () => {
    test('сторож отдаёт периметру, кого он пустил', async () => {
        const res = await request(app).get(ADMIN_GATE).set('Authorization', adminAuth);
        expect(res.headers['x-auth-user']).toBe('999');
        expect(res.headers['x-auth-username']).toBeTruthy();
    });

    test('заголовки идентичны у обоих сторожей — периметр не должен знать разницы', async () => {
        const read = await request(app).get(GATE).set('Authorization', adminAuth);
        const admin = await request(app).get(ADMIN_GATE).set('Authorization', adminAuth);
        expect(read.headers['x-auth-user']).toBe(admin.headers['x-auth-user']);
    });

    test('имя с кириллицей не делает ответ невалидным', async () => {
        // HTTP-заголовок обязан быть ASCII. Имя вроде «Смотритель» роняет не
        // журнал, а ВЕСЬ запрос — то есть панель перестаёт открываться из-за
        // поля, которое нужно было только для записи в лог.
        // Перехватываем ИМЕННО поиск пользователя, а не «первый запрос»:
        // до него middleware успевает сходить в чёрный список, и
        // mockImplementationOnce съедался тем запросом — 401 вместо 204.
        const original = db.query.getMockImplementation();
        db.query.mockImplementation(async (sql, params) => {
            const text = String(sql);
            if (text.includes('FROM users') && text.includes('user_id = $1')) {
                return {
                    rows: [{
                        user_id: params[0], username: 'Смотритель фонтана', role: 'admin',
                        email: 'x@example.com', is_active: true,
                    }],
                    rowCount: 1,
                };
            }
            return original(sql, params);
        });
        const res = await request(app).get(GATE).set('Authorization', `Bearer ${token(42)}`);
        db.query.mockImplementation(original);
        expect(res.status).toBe(204);
        const name = res.headers['x-auth-username'];
        expect(name).toBeDefined();
        expect(/^[\x20-\x7E]*$/.test(name)).toBe(true);
    });
});
