jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { validateEnv } = require('../../../src/config/env');

describe('validateEnv — NODE_ENV assertion (SEC-12)', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
        jest.clearAllMocks();
    });

    it('rejects an unknown NODE_ENV value', () => {
        process.env.NODE_ENV = 'staging';
        expect(() => validateEnv()).toThrow(/NODE_ENV/);
    });

    it('rejects an empty/unset NODE_ENV value', () => {
        delete process.env.NODE_ENV;
        expect(() => validateEnv()).toThrow(/NODE_ENV/);
    });

    it('accepts NODE_ENV=test without throwing', () => {
        process.env.NODE_ENV = 'test';
        expect(() => validateEnv()).not.toThrow();
    });
});
