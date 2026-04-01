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
const AlertRequestMap = require('../../../src/models/AlertRequestMap');

describe('AlertRequestMap Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        infrasafe_alert_id: 10,
        building_external_id: 'B-001',
        idempotency_key: 'idem-123',
        status: 'pending',
        uk_request_number: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
    };

    describe('findByAlertId', () => {
        test('returns rows for given alert id', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, id: 2 }] });

            const result = await AlertRequestMap.findByAlertId(10);

            expect(result).toHaveLength(2);
            expect(result[0].infrasafe_alert_id).toBe(10);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 ORDER BY created_at',
                [10]
            );
        });

        test('returns empty array when none found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByAlertId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.findByAlertId(10)).rejects.toThrow('DB error');
        });
    });

    describe('create', () => {
        test('creates and returns new mapping', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.create({
                infrasafe_alert_id: 10,
                building_external_id: 'B-001',
                idempotency_key: 'idem-123'
            });

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.status).toBe('pending');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO alert_request_map');
            expect(db.query.mock.calls[0][1]).toEqual([10, 'B-001', 'idem-123', 'pending']);
        });

        test('uses provided status', async () => {
            db.query.mockResolvedValue({ rows: [{ ...mockRow, status: 'active' }] });

            await AlertRequestMap.create({
                infrasafe_alert_id: 10,
                building_external_id: 'B-001',
                idempotency_key: 'idem-456',
                status: 'active'
            });

            expect(db.query.mock.calls[0][1][3]).toBe('active');
        });

        test('returns null on duplicate (23505)', async () => {
            const dupError = new Error('duplicate key');
            dupError.code = '23505';
            db.query.mockRejectedValue(dupError);

            const result = await AlertRequestMap.create({
                infrasafe_alert_id: 10,
                building_external_id: 'B-001',
                idempotency_key: 'idem-dup'
            });

            expect(result).toBeNull();
        });

        test('throws on non-duplicate database error', async () => {
            db.query.mockRejectedValue(new Error('connection error'));

            await expect(AlertRequestMap.create({
                infrasafe_alert_id: 10,
                building_external_id: 'B-001',
                idempotency_key: 'idem-err'
            })).rejects.toThrow('connection error');
        });
    });

    describe('findByAlertAndBuilding', () => {
        test('returns mapping when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.findByAlertAndBuilding(10, 'B-001');

            expect(result).toBeDefined();
            expect(result.infrasafe_alert_id).toBe(10);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 AND building_external_id = $2',
                [10, 'B-001']
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByAlertAndBuilding(999, 'B-999');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.findByAlertAndBuilding(10, 'B-001')).rejects.toThrow('DB error');
        });
    });

    describe('markSent', () => {
        test('updates status to sent and sets request number', async () => {
            const sentRow = { ...mockRow, status: 'sent', uk_request_number: 'REQ-100' };
            db.query.mockResolvedValue({ rows: [sentRow] });

            const result = await AlertRequestMap.markSent(1, 'REQ-100');

            expect(result.status).toBe('sent');
            expect(result.uk_request_number).toBe('REQ-100');
            expect(db.query.mock.calls[0][1]).toEqual(['sent', 'REQ-100', 1]);
        });

        test('returns null when id not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.markSent(999, 'REQ-999');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.markSent(1, 'REQ-100')).rejects.toThrow('DB error');
        });
    });

    describe('findByIdempotencyKey', () => {
        test('returns mapping when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await AlertRequestMap.findByIdempotencyKey('idem-123');

            expect(result).toBeDefined();
            expect(result.idempotency_key).toBe('idem-123');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM alert_request_map WHERE idempotency_key = $1',
                ['idem-123']
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByIdempotencyKey('nonexistent');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.findByIdempotencyKey('idem-123')).rejects.toThrow('DB error');
        });
    });

    describe('findByRequestNumber', () => {
        test('returns mapping when found', async () => {
            const sentRow = { ...mockRow, uk_request_number: 'REQ-100' };
            db.query.mockResolvedValue({ rows: [sentRow] });

            const result = await AlertRequestMap.findByRequestNumber('REQ-100');

            expect(result).toBeDefined();
            expect(result.uk_request_number).toBe('REQ-100');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM alert_request_map WHERE uk_request_number = $1',
                ['REQ-100']
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.findByRequestNumber('REQ-NONE');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.findByRequestNumber('REQ-100')).rejects.toThrow('DB error');
        });
    });

    describe('updateStatus', () => {
        test('updates status for valid status value', async () => {
            const updated = { ...mockRow, status: 'resolved' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await AlertRequestMap.updateStatus(1, 'resolved');

            expect(result.status).toBe('resolved');
            expect(db.query.mock.calls[0][1]).toEqual(['resolved', 1]);
        });

        test('accepts all valid statuses', async () => {
            const validStatuses = ['pending', 'active', 'sent', 'resolved', 'cancelled'];

            for (const status of validStatuses) {
                jest.clearAllMocks();
                db.query.mockResolvedValue({ rows: [{ ...mockRow, status }] });

                const result = await AlertRequestMap.updateStatus(1, status);
                expect(result.status).toBe(status);
            }
        });

        test('throws for invalid status', async () => {
            await expect(AlertRequestMap.updateStatus(1, 'invalid_status'))
                .rejects.toThrow("AlertRequestMap.updateStatus: invalid status 'invalid_status'");

            expect(db.query).not.toHaveBeenCalled();
        });

        test('returns null when id not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.updateStatus(999, 'active');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.updateStatus(1, 'sent')).rejects.toThrow('DB error');
        });
    });

    describe('areAllTerminal', () => {
        test('returns true when all requests are terminal', async () => {
            db.query.mockResolvedValue({ rows: [{ total: '3', terminal: '3' }] });

            const result = await AlertRequestMap.areAllTerminal(10);

            expect(result).toBe(true);
            expect(db.query.mock.calls[0][1]).toEqual([10]);
        });

        test('returns false when some requests are not terminal', async () => {
            db.query.mockResolvedValue({ rows: [{ total: '3', terminal: '1' }] });

            const result = await AlertRequestMap.areAllTerminal(10);

            expect(result).toBe(false);
        });

        test('returns false when no requests exist (total=0)', async () => {
            db.query.mockResolvedValue({ rows: [{ total: '0', terminal: '0' }] });

            const result = await AlertRequestMap.areAllTerminal(10);

            expect(result).toBe(false);
        });

        test('returns false when result row is null', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await AlertRequestMap.areAllTerminal(10);

            expect(result).toBe(false);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(AlertRequestMap.areAllTerminal(10)).rejects.toThrow('DB error');
        });
    });
});
