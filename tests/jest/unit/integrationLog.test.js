jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const IntegrationLog = require('../../../src/models/IntegrationLog');

describe('IntegrationLog Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        event_id: 'evt-abc-123',
        direction: 'inbound',
        entity_type: 'building',
        entity_id: 42,
        action: 'create',
        payload: '{"name":"Test Building"}',
        status: 'pending',
        error_message: null,
        retry_count: 0,
        created_at: '2026-03-24T10:00:00Z'
    };

    describe('create', () => {
        test('inserts with all fields and returns created entry', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const inputPayload = { name: 'Test Building' };
            const result = await IntegrationLog.create({
                event_id: 'evt-abc-123',
                direction: 'inbound',
                entity_type: 'building',
                entity_id: 42,
                action: 'create',
                payload: inputPayload,
                status: 'pending'
            });

            expect(result).toEqual(mockRow);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO integration_log');
            expect(db.query.mock.calls[0][0]).toContain('RETURNING *');
        });

        test('params include JSON.stringify(payload)', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const inputPayload = { name: 'Test Building' };
            await IntegrationLog.create({
                event_id: 'evt-abc-123',
                direction: 'inbound',
                entity_type: 'building',
                entity_id: 42,
                action: 'create',
                payload: inputPayload
            });

            const params = db.query.mock.calls[0][1];
            expect(params).toContain(JSON.stringify(inputPayload));
        });
    });

    describe('findByEventId', () => {
        test('returns entry when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await IntegrationLog.findByEventId('evt-abc-123');

            expect(result).toEqual(mockRow);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM integration_log WHERE event_id = $1',
                ['evt-abc-123']
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await IntegrationLog.findByEventId('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('findById', () => {
        test('returns entry when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await IntegrationLog.findById(1);

            expect(result).toEqual(mockRow);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM integration_log WHERE id = $1',
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await IntegrationLog.findById(999);

            expect(result).toBeNull();
        });
    });

    describe('updateStatus', () => {
        test('updates status and error_message, check params [status, errorMessage, id]', async () => {
            const updatedRow = { ...mockRow, status: 'failed', error_message: 'Timeout' };
            db.query.mockResolvedValue({ rows: [updatedRow] });

            const result = await IntegrationLog.updateStatus(1, 'failed', 'Timeout');

            expect(result).toEqual(updatedRow);
            const params = db.query.mock.calls[0][1];
            expect(params).toEqual(['failed', 'Timeout', 1]);
        });
    });

    describe('incrementRetry', () => {
        test('SQL contains retry_count + 1', async () => {
            const updatedRow = { ...mockRow, retry_count: 1 };
            db.query.mockResolvedValue({ rows: [updatedRow] });

            const result = await IntegrationLog.incrementRetry(1);

            expect(result).toEqual(updatedRow);
            expect(db.query.mock.calls[0][0]).toContain('retry_count + 1');
        });
    });

    describe('findAll', () => {
        test('returns paginated results with defaults (limit 20, offset 0)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '5' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            const result = await IntegrationLog.findAll();

            expect(result.total).toBe(5);
            expect(result.logs).toEqual([mockRow]);
            expect(db.query).toHaveBeenCalledTimes(2);

            const dataParams = db.query.mock.calls[1][1];
            expect(dataParams).toContain(20);  // default limit
            expect(dataParams).toContain(0);   // offset 0 for page 1
        });

        test('applies direction filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await IntegrationLog.findAll({ direction: 'inbound' });

            const countQuery = db.query.mock.calls[0][0];
            const countParams = db.query.mock.calls[0][1];
            expect(countQuery).toContain('direction');
            expect(countParams).toContain('inbound');
        });

        test('applies status filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '3' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await IntegrationLog.findAll({ status: 'pending' });

            const countQuery = db.query.mock.calls[0][0];
            const countParams = db.query.mock.calls[0][1];
            expect(countQuery).toContain('status');
            expect(countParams).toContain('pending');
        });

        test('applies entity_type filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await IntegrationLog.findAll({ entity_type: 'building' });

            const countQuery = db.query.mock.calls[0][0];
            const countParams = db.query.mock.calls[0][1];
            expect(countQuery).toContain('entity_type');
            expect(countParams).toContain('building');
        });

        test('applies date range filter (date_from and date_to)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '4' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            const dateFrom = '2026-03-01T00:00:00Z';
            const dateTo = '2026-03-31T23:59:59Z';

            await IntegrationLog.findAll({ date_from: dateFrom, date_to: dateTo });

            const countQuery = db.query.mock.calls[0][0];
            const countParams = db.query.mock.calls[0][1];
            expect(countQuery).toContain('created_at >=');
            expect(countQuery).toContain('created_at <=');
            expect(countParams).toContain(dateFrom);
            expect(countParams).toContain(dateTo);
        });
    });
});
