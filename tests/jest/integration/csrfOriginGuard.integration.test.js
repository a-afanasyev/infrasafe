// [SEC-23] Integration test — proves the CSRF Origin guard is actually MOUNTED
// in the real /api pipeline (unit tests alone can't: the guard could be left
// unmounted and unit tests stay green). Drives real cookie-auth + Origin header.

const request = require('supertest');
const { ApiTestHelper } = require('../helpers/testHelper');

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

// Must be set BEFORE requiring server (cors() captures the allowlist at boot).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-csrf-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-csrf-itest';
const ALLOWED = 'https://allowed.test';
const EVIL = 'https://evil.test';
process.env.CORS_ORIGINS = ALLOWED;

let app;
let testHelper;
let accessCookie;   // "access_token=..."
let refreshCookie;  // "refresh_token=..."

const cookieStr = (raw, name) => {
    const arr = Array.isArray(raw) ? raw : [raw];
    const c = arr.find((x) => new RegExp(`^${name}=`).test(x || ''));
    const m = c && c.match(new RegExp(`^(${name}=[^;]+)`));
    return m ? m[1] : null;
};

describe('SEC-23 CSRF Origin guard — mounted in /api pipeline', () => {
    beforeAll(async () => {
        setupQueryMock(db);
        app = require('../../../src/server');
        testHelper = new ApiTestHelper(app);
        const login = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testuser', password: 'TestPass123' });
        const sc = login.headers['set-cookie'] || [];
        accessCookie = cookieStr(sc, 'access_token');
        refreshCookie = cookieStr(sc, 'refresh_token');
        expect(accessCookie).toBeTruthy();
        expect(refreshCookie).toBeTruthy();
    });

    beforeEach(() => setupQueryMock(db));

    test('cookie-auth mutation + EVIL Origin → 403', async () => {
        const res = await request(app)
            .post('/api/buildings')
            .set('Cookie', accessCookie)
            .set('Origin', EVIL)
            .send(testHelper.createTestBuilding());
        expect(res.status).toBe(403);
    });

    test('cookie-auth mutation + ALLOWED Origin → 201 (concrete success, not just "not 403")', async () => {
        const res = await request(app)
            .post('/api/buildings')
            .set('Cookie', accessCookie)
            .set('Origin', ALLOWED)
            .send(testHelper.createTestBuilding());
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('building_id');
    });

    test('POST /api/auth/refresh/ (trailing slash) with ONLY refresh_token cookie + EVIL Origin → 403', async () => {
        // Explicitly NO access_token cookie — otherwise it would pass via the
        // access branch and not exercise the refresh-path normalization.
        const res = await request(app)
            .post('/api/auth/refresh/')
            .set('Cookie', refreshCookie)
            .set('Origin', EVIL)
            .send({});
        expect(res.status).toBe(403);
    });

    test('GET with EVIL Origin is NOT blocked (non-mutation)', async () => {
        const res = await request(app)
            .get('/api/buildings')
            .set('Cookie', accessCookie)
            .set('Origin', EVIL);
        expect(res.status).not.toBe(403);
    });
});
