// Set required env vars before requiring authService (constructor reads them)
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests';

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
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

const cacheService = require('../../../src/services/cacheService');

describe('AuthService.findUserById', () => {
    const authService = require('../../../src/services/authService');
    const db = require('../../../src/config/database');

    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.get.mockResolvedValue(null);
    });

    test('should NOT cache password_hash', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{
                user_id: 1,
                username: 'admin',
                email: 'admin@test.com',
                role: 'admin',
                password_hash: '$2b$12$secrethash',
                is_active: true
            }],
            rowCount: 1
        });

        await authService.findUserById(1);

        expect(cacheService.set).toHaveBeenCalled();
        const cachedUser = cacheService.set.mock.calls[0][1];
        expect(cachedUser).not.toHaveProperty('password_hash');
        expect(cachedUser.username).toBe('admin');
    });

    test('should return user data when found', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{
                user_id: 1,
                username: 'admin',
                email: 'admin@test.com',
                role: 'admin',
                password_hash: '$2b$12$secrethash',
                is_active: true
            }],
            rowCount: 1
        });

        const user = await authService.findUserById(1);

        expect(user).toBeDefined();
        expect(user.user_id).toBe(1);
        expect(user.username).toBe('admin');
    });

    test('should return null when user not found', async () => {
        db.query.mockResolvedValueOnce({
            rows: [],
            rowCount: 0
        });

        const user = await authService.findUserById(999);

        expect(user).toBeNull();
        expect(cacheService.set).not.toHaveBeenCalled();
    });

    test('should return cached user when available', async () => {
        const cachedUser = {
            user_id: 1,
            username: 'admin',
            email: 'admin@test.com',
            role: 'admin',
            is_active: true
        };
        cacheService.get.mockResolvedValueOnce(cachedUser);

        const user = await authService.findUserById(1);

        expect(user).toEqual(cachedUser);
        expect(db.query).not.toHaveBeenCalled();
    });
});
