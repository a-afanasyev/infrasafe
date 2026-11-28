// [Q-20] Пакетные операции админки проверяли значения только на истинность:
// `"abc"`, `-5` или `[]` доезжали до UPDATE и падали 500-й (22P02 / CHECK > 0),
// а `power_kva` участвует в расчёте загрузки. Теперь — те же правила полей,
// что у одиночной записи (validatorFields), и 400 с указанием поля.
//
// Авторизация — Bearer admin (dbMock-сентинел user_id 999), как в
// waterLineStatus.integration.test.js.

const request = require('supertest');

jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockResolvedValue(true),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    close: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const { setupQueryMock } = require('../helpers/dbMock');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-batch-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-batch-itest';

const adminToken = () => jwt.sign(
    { user_id: 999, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;
let auth;

beforeAll(() => {
    setupQueryMock(db);
    app = require('../../../src/server');
    auth = `Bearer ${adminToken()}`;
});

const batch = (entity, body) => request(app)
    .post(`/api/admin/${entity}/batch`)
    .set('Authorization', auth)
    .send({ ids: [1], ...body });

describe('[Q-20] POST /api/admin/transformers/batch — значения полей', () => {
    test.each([
        ['update_voltage', { voltage_kv: 'abc' }],
        ['update_voltage', { voltage_kv: -5 }],
        ['update_power', { power_kva: 0 }],
        ['update_power', { power_kva: 'lots' }],
        ['update_power', { power_kva: null }],
    ])('%s %j → 400', async (action, data) => {
        const res = await batch('transformers', { action, data });
        expect(res.status).toBe(400);
    });

    test('допустимые значения проходят', async () => {
        expect((await batch('transformers', { action: 'update_voltage', data: { voltage_kv: 10 } })).status).toBe(200);
        expect((await batch('transformers', { action: 'update_power', data: { power_kva: '630' } })).status).toBe(200);
    });
});

describe('[Q-20] POST /api/admin/lines/batch', () => {
    test.each([[{ voltage_kv: 'abc' }], [{ voltage_kv: -1 }]])('update_voltage %j → 400', async (data) => {
        const res = await batch('lines', { action: 'update_voltage', data });
        expect(res.status).toBe(400);
    });

    test('update_voltage с допустимым значением проходит', async () => {
        expect((await batch('lines', { action: 'update_voltage', data: { voltage_kv: 0.4 } })).status).toBe(200);
    });

    // Столбца `lines.maintenance_date` нет в схеме: действие всегда падало 500-й.
    test('set_maintenance — неизвестное действие, 400', async () => {
        const res = await batch('lines', { action: 'set_maintenance', data: { maintenance_date: '2026-05-01' } });
        expect(res.status).toBe(400);
    });
});
