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
const Controller = require('../../../src/models/Controller');

describe('Controller Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        controller_id: 1,
        serial_number: 'SN-001',
        vendor: 'Siemens',
        model: 'S7-1200',
        building_id: 10,
        building_name: 'Building A',
        status: 'active',
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [mockRow] })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            const result = await Controller.findAll();

            expect(result.data).toHaveLength(1);
            expect(result.data[0].controller_id).toBe(1);
            expect(result.pagination).toEqual({
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('uses custom page and limit', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '20' }] });

            const result = await Controller.findAll(2, 5);

            const selectCall = db.query.mock.calls[0];
            expect(selectCall[1]).toEqual([5, 5]); // limit=5, offset=5
            expect(result.pagination.page).toBe(2);
            expect(result.pagination.totalPages).toBe(4);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.findAll()).rejects.toThrow('Failed to fetch controllers');
        });
    });

    describe('findById', () => {
        test('returns controller when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Controller.findById(1);

            expect(result).toBeDefined();
            expect(result.controller_id).toBe(1);
            expect(result.serial_number).toBe('SN-001');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.findById(1)).rejects.toThrow('Failed to fetch controller');
        });
    });

    describe('findByBuildingId', () => {
        test('returns controllers for given building', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, controller_id: 2 }] });

            const result = await Controller.findByBuildingId(10);

            expect(result).toHaveLength(2);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM controllers WHERE building_id = $1',
                [10]
            );
        });

        test('returns empty array when no controllers found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.findByBuildingId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.findByBuildingId(10)).rejects.toThrow('Failed to fetch controllers by building');
        });
    });

    describe('create', () => {
        test('creates and returns new controller', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Controller.create({
                serial_number: 'SN-001',
                vendor: 'Siemens',
                model: 'S7-1200',
                building_id: 10,
                status: 'active'
            });

            expect(result).toBeDefined();
            expect(result.controller_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO controllers');
            expect(db.query.mock.calls[0][1]).toEqual(['SN-001', 'Siemens', 'S7-1200', 10, 'active']);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(
                Controller.create({ serial_number: 'X', vendor: 'V', model: 'M', building_id: 1, status: 'active' })
            ).rejects.toThrow('Failed to create controller');
        });
    });

    describe('update', () => {
        test('updates and returns controller', async () => {
            const updated = { ...mockRow, serial_number: 'SN-002' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Controller.update(1, {
                serial_number: 'SN-002',
                vendor: 'Siemens',
                model: 'S7-1200',
                building_id: 10,
                status: 'active'
            });

            expect(result.serial_number).toBe('SN-002');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE controllers');
            expect(db.query.mock.calls[0][1]).toEqual(['SN-002', 'Siemens', 'S7-1200', 10, 'active', 1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.update(999, {
                serial_number: 'X', vendor: 'V', model: 'M', building_id: 1, status: 'active'
            });

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(
                Controller.update(1, { serial_number: 'X', vendor: 'V', model: 'M', building_id: 1, status: 'active' })
            ).rejects.toThrow('Failed to update controller');
        });
    });

    describe('updateStatus', () => {
        test('updates status and returns controller', async () => {
            const updated = { ...mockRow, status: 'inactive' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Controller.updateStatus(1, 'inactive');

            expect(result.status).toBe('inactive');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE controllers');
            expect(db.query.mock.calls[0][1]).toEqual(['inactive', 1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.updateStatus(999, 'inactive');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.updateStatus(1, 'inactive')).rejects.toThrow('Failed to update controller status');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed controller', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Controller.delete(1);

            expect(result).toBeDefined();
            expect(result.controller_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM controllers');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.delete(1)).rejects.toThrow('Failed to delete controller');
        });
    });

    describe('findBySerialNumber', () => {
        test('returns controller when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Controller.findBySerialNumber('SN-001');

            expect(result).toBeDefined();
            expect(result.serial_number).toBe('SN-001');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM controllers WHERE serial_number = $1',
                ['SN-001']
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Controller.findBySerialNumber('NONE');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Controller.findBySerialNumber('SN-001')).rejects.toThrow('Failed to fetch controller by serial number');
        });
    });
});
