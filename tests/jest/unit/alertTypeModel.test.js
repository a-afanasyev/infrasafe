jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertType = require('../../../src/models/AlertType');

describe('AlertType Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockAlertType = {
        alert_type_id: 1,
        type_name: 'Temperature Alert',
        description: 'Triggered when temperature exceeds threshold'
    };

    describe('findAll', () => {
        test('returns all alert types', async () => {
            db.query.mockResolvedValue({ rows: [mockAlertType, { ...mockAlertType, alert_type_id: 2 }] });

            const result = await AlertType.findAll();

            expect(result).toHaveLength(2);
            expect(result[0].type_name).toBe('Temperature Alert');
            expect(db.query.mock.calls[0][0]).toContain('SELECT * FROM alert_types ORDER BY type_name ASC');
        });

        test('returns empty array when no types exist', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertType.findAll();

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertType.findAll()).rejects.toThrow('Failed to fetch alert types');
        });
    });

    describe('findById', () => {
        test('returns alert type when found', async () => {
            db.query.mockResolvedValue({ rows: [mockAlertType] });

            const result = await AlertType.findById(1);

            expect(result).toBeDefined();
            expect(result.alert_type_id).toBe(1);
            expect(result.type_name).toBe('Temperature Alert');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM alert_types WHERE alert_type_id = $1',
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertType.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertType.findById(1)).rejects.toThrow('Failed to fetch alert type');
        });
    });

    describe('create', () => {
        test('creates and returns new alert type', async () => {
            db.query.mockResolvedValue({ rows: [mockAlertType] });

            const result = await AlertType.create({
                type_name: 'Temperature Alert',
                description: 'Triggered when temperature exceeds threshold'
            });

            expect(result).toBeDefined();
            expect(result.alert_type_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO alert_types');
            expect(db.query.mock.calls[0][1]).toEqual([
                'Temperature Alert',
                'Triggered when temperature exceeds threshold'
            ]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(AlertType.create({
                type_name: 'Dup', description: 'Dup'
            })).rejects.toThrow('Failed to create alert type');
        });
    });

    describe('update', () => {
        test('updates and returns alert type', async () => {
            const updated = { ...mockAlertType, type_name: 'Updated Type' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await AlertType.update(1, {
                type_name: 'Updated Type',
                description: 'Updated desc'
            });

            expect(result.type_name).toBe('Updated Type');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE alert_types');
            expect(db.query.mock.calls[0][1]).toEqual(['Updated Type', 'Updated desc', 1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertType.update(999, {
                type_name: 'X', description: 'Y'
            });

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertType.update(1, {
                type_name: 'X', description: 'Y'
            })).rejects.toThrow('Failed to update alert type');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed alert type', async () => {
            db.query.mockResolvedValue({ rows: [mockAlertType] });

            const result = await AlertType.delete(1);

            expect(result).toBeDefined();
            expect(result.alert_type_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM alert_types');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertType.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertType.delete(1)).rejects.toThrow('Failed to delete alert type');
        });
    });
});
