jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const adminService = require('../../../src/services/adminService');

describe('AdminService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('batchDelete', () => {
        test('deletes rows by IDs and returns result', async () => {
            const mockResult = { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
            db.query.mockResolvedValue(mockResult);

            const result = await adminService.batchDelete('buildings', 'building_id', [1, 2]);

            expect(result.rowCount).toBe(2);
            expect(db.query).toHaveBeenCalledWith(
                'DELETE FROM buildings WHERE building_id = ANY($1) RETURNING building_id',
                [[1, 2]]
            );
        });

        test('handles empty result', async () => {
            db.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const result = await adminService.batchDelete('buildings', 'id', [999]);
            expect(result.rowCount).toBe(0);
        });

        test('propagates database errors', async () => {
            db.query.mockRejectedValue(new Error('FK constraint'));

            await expect(
                adminService.batchDelete('buildings', 'id', [1])
            ).rejects.toThrow('FK constraint');
        });
    });

    describe('batchUpdateColumn', () => {
        test('updates column for multiple rows', async () => {
            const mockResult = { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
            db.query.mockResolvedValue(mockResult);

            const result = await adminService.batchUpdateColumn(
                'controllers', 'controller_id', [1, 2], 'status', 'offline'
            );

            expect(result.rowCount).toBe(2);
            expect(db.query).toHaveBeenCalledWith(
                'UPDATE controllers SET status = $1, updated_at = NOW() WHERE controller_id = ANY($2) RETURNING controller_id',
                ['offline', [1, 2]]
            );
        });

        test('handles no matching rows', async () => {
            db.query.mockResolvedValue({ rows: [], rowCount: 0 });

            const result = await adminService.batchUpdateColumn(
                'controllers', 'id', [999], 'status', 'active'
            );
            expect(result.rowCount).toBe(0);
        });
    });
});
