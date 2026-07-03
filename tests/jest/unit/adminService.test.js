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

        test('rejects untrusted table name', async () => {
            await expect(adminService.batchDelete('users; DROP TABLE --', 'id', [1]))
                .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
        });

        test('rejects untrusted column name', async () => {
            await expect(adminService.batchDelete('buildings', 'id; DROP TABLE --', [1]))
                .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
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

        test('rejects untrusted column for update', async () => {
            await expect(adminService.batchUpdateColumn('buildings', 'building_id', [1], 'col; DROP TABLE --', 'val'))
                .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
        });
    });

    // [R2-04] Dashboard stats moved out of adminGeneralController into the service.
    describe('getDashboardStats', () => {
        test('aggregates the four entity counts into the dashboard shape', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '17' }] })   // buildings
                .mockResolvedValueOnce({ rows: [{ count: '15' }] })   // controllers
                .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // metrics
                .mockResolvedValueOnce({ rows: [{ count: '5' }] });   // alerts

            const stats = await adminService.getDashboardStats();

            expect(stats).toEqual({
                buildings:   { total: 17 },
                controllers: { total: 15 },
                metrics:     { total: 1000 },
                alerts:      { active: 5 },
            });
            expect(db.query).toHaveBeenCalledTimes(4);
        });

        // AUD-007: active count must come from infrastructure_alerts (active +
        // acknowledged), not the legacy `alerts` table dropped in migration 028.
        test('counts active alerts from infrastructure_alerts (active + acknowledged)', async () => {
            db.query.mockResolvedValue({ rows: [{ count: '0' }] });
            await adminService.getDashboardStats();

            const alertSql = db.query.mock.calls.map((c) => c[0]).find((sql) => /alert/i.test(sql));
            expect(alertSql).toMatch(/infrastructure_alerts/);
            expect(alertSql).not.toMatch(/FROM\s+alerts\b/);
            expect(alertSql).toMatch(/'active'/);
            expect(alertSql).toMatch(/'acknowledged'/);
        });

        test('propagates a DB error to the caller (controller maps it to 500)', async () => {
            db.query.mockRejectedValueOnce(new Error('DB down'));
            await expect(adminService.getDashboardStats()).rejects.toThrow('DB down');
        });
    });
});
