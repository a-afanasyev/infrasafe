// [ARCH-114] Unit tests for the inventory controller.

jest.mock('../../../src/models/AlertRequestMap', () => ({
    listInventory: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const { getRequestsInventory } = require('../../../src/controllers/ukRequestsMetricsController');

const mkRes = () => {
    const res = {};
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    return res;
};

describe('ukRequestsMetricsController.getRequestsInventory (ARCH-114)', () => {
    beforeEach(() => {
        AlertRequestMap.listInventory.mockReset();
    });

    test('returns the documented envelope on success', async () => {
        const rows = [
            { uk_request_number: '260523-004', status: 'resolved', building_external_id: 'b7f6', updated_at: '2026-05-23T14:32:08Z' },
            { uk_request_number: '260524-001', status: 'active',   building_external_id: 'c2a1', updated_at: '2026-05-24T07:42:11Z' }
        ];
        AlertRequestMap.listInventory.mockResolvedValue({ rows, limit: 5000 });

        const req = { query: {} };
        const res = mkRes();

        await getRequestsInventory(req, res);

        expect(AlertRequestMap.listInventory).toHaveBeenCalledWith({ limit: undefined });
        expect(res.json).toHaveBeenCalledWith({
            data: rows,
            total: 2,
            limit: 5000
        });
        // [SEC-19] internal PK must not appear in the public envelope.
        expect(res.json.mock.calls[0][0].data[0]).not.toHaveProperty('infrasafe_alert_id');
        expect(res.status).not.toHaveBeenCalled();
    });

    test('forwards the limit query param to the model', async () => {
        AlertRequestMap.listInventory.mockResolvedValue({ rows: [], limit: 250 });

        await getRequestsInventory({ query: { limit: '250' } }, mkRes());

        expect(AlertRequestMap.listInventory).toHaveBeenCalledWith({ limit: '250' });
    });

    test('[R2-05] delegates model errors to next() (errorHandler emits the canonical 500)', async () => {
        AlertRequestMap.listInventory.mockRejectedValue(new Error('db down'));

        const res = mkRes();
        const next = jest.fn();
        await getRequestsInventory({ query: {} }, res, next);

        // Hands off to the error middleware → { success:false, error:{ message, status } }
        // with the 500 detail hidden; no inline error JSON here.
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(res.status).not.toHaveBeenCalledWith(500);
    });
});
