jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const db = require('../../../src/config/database');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');

describe('IntegrationConfig Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('get', () => {
        test('returns value for existing key', async () => {
            db.query.mockResolvedValue({ rows: [{ value: 'true' }] });

            const result = await IntegrationConfig.get('uk_integration_enabled');

            expect(result).toBe('true');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT value FROM integration_config WHERE key = $1',
                ['uk_integration_enabled']
            );
        });

        test('returns defaultValue when key not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await IntegrationConfig.get('missing_key', 'default_val');

            expect(result).toBe('default_val');
        });

        test('returns null when key not found and no default provided', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await IntegrationConfig.get('missing_key');

            expect(result).toBeNull();
        });
    });

    describe('set', () => {
        test('upserts key-value pair', async () => {
            const mockRow = { key: 'my_key', value: 'my_value', updated_at: new Date() };
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await IntegrationConfig.set('my_key', 'my_value');

            expect(result).toEqual(mockRow);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('INSERT');
            expect(sql).toContain('ON CONFLICT');
            expect(params).toEqual(['my_key', 'my_value']);
        });
    });

    describe('getAll', () => {
        test('returns all config as key-value object', async () => {
            db.query.mockResolvedValue({
                rows: [
                    { key: 'uk_integration_enabled', value: 'true' },
                    { key: 'api_timeout', value: '5000' }
                ]
            });

            const result = await IntegrationConfig.getAll();

            expect(result).toEqual({
                uk_integration_enabled: 'true',
                api_timeout: '5000'
            });
        });
    });

    describe('isEnabled', () => {
        test('returns true when uk_integration_enabled is "true"', async () => {
            db.query.mockResolvedValue({ rows: [{ value: 'true' }] });

            const result = await IntegrationConfig.isEnabled();

            expect(result).toBe(true);
        });

        test('returns false when uk_integration_enabled is "false"', async () => {
            db.query.mockResolvedValue({ rows: [{ value: 'false' }] });

            const result = await IntegrationConfig.isEnabled();

            expect(result).toBe(false);
        });

        test('returns false when uk_integration_enabled is missing', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await IntegrationConfig.isEnabled();

            expect(result).toBe(false);
        });
    });

    describe('delete', () => {
        test('returns true when key was deleted', async () => {
            db.query.mockResolvedValue({ rowCount: 1 });

            const result = await IntegrationConfig.delete('my_key');

            expect(result).toBe(true);
            expect(db.query).toHaveBeenCalledWith(
                'DELETE FROM integration_config WHERE key = $1',
                ['my_key']
            );
        });

        test('returns false when key was not found', async () => {
            db.query.mockResolvedValue({ rowCount: 0 });

            const result = await IntegrationConfig.delete('nonexistent_key');

            expect(result).toBe(false);
        });
    });

    describe('error handling', () => {
        test('get throws on DB error', async () => {
            db.query.mockRejectedValue(new Error('DB connection failed'));

            await expect(IntegrationConfig.get('any_key')).rejects.toThrow('DB connection failed');
        });

        test('set throws on DB error', async () => {
            db.query.mockRejectedValue(new Error('DB write failed'));

            await expect(IntegrationConfig.set('any_key', 'any_value')).rejects.toThrow('DB write failed');
        });
    });
});
