'use strict';

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn(() => ({
        connect: jest.fn()
    }))
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');

describe('Building UK Sync Methods', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('findByExternalId()', () => {
        it('returns building when found', async () => {
            const mockBuilding = { building_id: 5, external_id: 'aaaa-bbbb', name: 'Test' };
            db.query.mockResolvedValue({ rows: [mockBuilding] });

            const result = await Building.findByExternalId('aaaa-bbbb');
            expect(result).toEqual(mockBuilding);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('external_id = $1'),
                ['aaaa-bbbb']
            );
        });

        it('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.findByExternalId('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('createFromUK()', () => {
        it('creates building with external_id and UK fields, lat/lng NULL', async () => {
            const ukData = {
                external_id: 'ext-uuid-123',
                name: 'Дом 42',
                address: 'ул. Навои, 42',
                town: 'Ташкент'
            };
            const created = { building_id: 18, ...ukData, latitude: null, longitude: null };
            db.query.mockResolvedValue({ rows: [created] });

            const result = await Building.createFromUK(ukData);
            expect(result).toEqual(created);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO buildings'),
                expect.arrayContaining(['ext-uuid-123', 'Дом 42', 'ул. Навои, 42', 'Ташкент'])
            );
        });

        it('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate key'));
            await expect(Building.createFromUK({ external_id: 'x' }))
                .rejects.toThrow();
        });
    });

    describe('updateFromUK()', () => {
        it('updates only UK-owned fields (name, address, town)', async () => {
            const updated = { building_id: 5, name: 'New Name', address: 'New Addr', town: 'Ташкент' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Building.updateFromUK(5, {
                name: 'New Name',
                address: 'New Addr',
                town: 'Ташкент'
            });
            expect(result).toEqual(updated);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('name = $1');
            expect(sql).toContain('address = $2');
            expect(sql).toContain('town = $3');
            expect(sql).not.toContain('latitude');
            expect(sql).not.toContain('longitude');
            expect(sql).not.toContain('management_company');
        });

        it('clears uk_deleted_at on update (un-soft-delete)', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5 }] });
            await Building.updateFromUK(5, { name: 'X', address: 'Y', town: 'Z' });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('uk_deleted_at = NULL');
        });

        it('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.updateFromUK(999, { name: 'X' });
            expect(result).toBeNull();
        });
    });

    describe('softDelete()', () => {
        it('sets uk_deleted_at to current timestamp', async () => {
            const deleted = { building_id: 5, uk_deleted_at: '2026-03-25T10:00:00Z' };
            db.query.mockResolvedValue({ rows: [deleted] });

            const result = await Building.softDelete(5);
            expect(result).toEqual(deleted);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('uk_deleted_at = NOW()'),
                [5]
            );
        });

        it('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.softDelete(999);
            expect(result).toBeNull();
        });
    });
});
