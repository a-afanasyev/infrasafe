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
        it('creates building with external_id and UK fields, lat/lng NULL when omitted', async () => {
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
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('INSERT INTO buildings');
            expect(sql).toContain('latitude');
            expect(sql).toContain('longitude');
            expect(params).toEqual(['ext-uuid-123', 'Дом 42', 'ул. Навои, 42', 'Ташкент', null, null]);
        });

        it('creates building with latitude/longitude when provided (PR PR-F/CR-4)', async () => {
            const ukData = {
                external_id: 'ext-uuid-456',
                name: 'Дом 14V',
                address: 'Olmazor 14V',
                town: 'Ташкент',
                latitude: 41.349151,
                longitude: 69.246436
            };
            db.query.mockResolvedValue({ rows: [{ building_id: 19, ...ukData }] });

            await Building.createFromUK(ukData);
            const params = db.query.mock.calls[0][1];
            expect(params[4]).toBe(41.349151);  // latitude
            expect(params[5]).toBe(69.246436);  // longitude
        });

        it('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate key'));
            await expect(Building.createFromUK({ external_id: 'x' }))
                .rejects.toThrow();
        });
    });

    describe('updateFromUK()', () => {
        it('updates UK-owned fields (name, address, town) + coords (PR PR-F/CR-4)', async () => {
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
            // PR-F/CR-4: coords now part of SQL (with COALESCE to preserve existing on null)
            expect(sql).toContain('latitude = COALESCE');
            expect(sql).toContain('longitude = COALESCE');
            expect(sql).not.toContain('management_company');
        });

        it('passes latitude/longitude to UPDATE when provided', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5 }] });
            await Building.updateFromUK(5, {
                name: 'X', address: 'Y', town: 'Z',
                latitude: 41.5, longitude: 69.5
            });
            const params = db.query.mock.calls[0][1];
            expect(params[3]).toBe(41.5);   // latitude
            expect(params[4]).toBe(69.5);   // longitude
        });

        it('passes nulls when coords omitted (COALESCE preserves existing in DB)', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5 }] });
            await Building.updateFromUK(5, { name: 'X', address: 'Y', town: 'Z' });
            const params = db.query.mock.calls[0][1];
            expect(params[3]).toBeNull();
            expect(params[4]).toBeNull();
        });

        it('clears uk_deleted_at on update (un-soft-delete)', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5 }] });
            await Building.updateFromUK(5, { name: 'X', address: 'Y', town: 'Z' });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('uk_deleted_at = NULL');
        });

        it('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await Building.updateFromUK(999, { name: 'X', address: 'Y', town: 'Z' });
            expect(result).toBeNull();
        });

        it('throws when required UK fields are missing', async () => {
            await expect(Building.updateFromUK(5, { name: 'X' }))
                .rejects.toThrow('UK sync requires name, address, and town fields');
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
