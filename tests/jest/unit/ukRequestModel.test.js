'use strict';

// [request.reconcile — UK contract 2026-07-23] Unit tests for the UkRequest
// model: atomic upsert keyed on uk_request_number so repeated reconcile
// cycles (each with a fresh event_id by design) converge to one row.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const UkRequest = require('../../../src/models/UkRequest');

describe('UkRequest Model (request.reconcile)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        uk_request_number: '260723-014',
        status: 'Принято',
        building_external_id: '3f2a9c1e-1111-2222-3333-b6c4d5e6f7a8',
        first_seen_at: '2026-07-23T10:00:00Z',
        last_reconciled_at: '2026-07-23T10:00:00Z'
    };

    describe('reconcile', () => {
        test('atomic upsert: INSERT ... ON CONFLICT (uk_request_number) DO UPDATE, params [number, status, building]', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await UkRequest.reconcile({
                requestNumber: '260723-014',
                status: 'Принято',
                buildingExternalId: '3f2a9c1e-1111-2222-3333-b6c4d5e6f7a8'
            });

            expect(result).toEqual(mockRow);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('INSERT INTO uk_requests');
            expect(sql).toContain('ON CONFLICT (uk_request_number) DO UPDATE');
            expect(params).toEqual(['260723-014', 'Принято', '3f2a9c1e-1111-2222-3333-b6c4d5e6f7a8']);
        });

        test('null building_external_id is accepted (yard/legacy requests) and COALESCE keeps a previously known building', async () => {
            db.query.mockResolvedValue({ rows: [{ ...mockRow, building_external_id: null }] });

            await UkRequest.reconcile({
                requestNumber: '260723-015',
                status: 'Новая',
                buildingExternalId: null
            });

            const [sql, params] = db.query.mock.calls[0];
            // A later reconcile without a building must not erase one we
            // already stored — COALESCE(EXCLUDED..., existing).
            expect(sql).toMatch(/COALESCE\(EXCLUDED\.building_external_id,\s*uk_requests\.building_external_id\)/);
            expect(params).toEqual(['260723-015', 'Новая', null]);
        });

        test('bumps last_reconciled_at on conflict so repeated cycles are observable', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await UkRequest.reconcile({
                requestNumber: '260723-014',
                status: 'Принято',
                buildingExternalId: null
            });

            expect(db.query.mock.calls[0][0]).toContain('last_reconciled_at = NOW()');
        });

        // [review fix, defense-in-depth] status is persisted and later served
        // by a public JSON endpoint — strip control characters at write time,
        // mirroring the safeLogValue convention.
        test('strips control characters from status before persisting', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await UkRequest.reconcile({
                requestNumber: '260723-016',
                status: 'Принято\r\n\x00есть',
                buildingExternalId: null
            });

            expect(db.query.mock.calls[0][1][1]).toBe('Принято есть');
        });

        test('propagates db errors to caller (handler marks integration_log error → variant A retry)', async () => {
            db.query.mockRejectedValue(new Error('DB down'));

            await expect(UkRequest.reconcile({
                requestNumber: '260723-014',
                status: 'Принято',
                buildingExternalId: null
            })).rejects.toThrow('DB down');
        });
    });
});
