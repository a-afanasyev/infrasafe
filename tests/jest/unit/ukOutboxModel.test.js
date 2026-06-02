'use strict';

/**
 * [Sprint 9 / FIX-007] UkOutbox model unit tests.
 *
 * Covers:
 *   - Idempotent enqueue via ON CONFLICT DO NOTHING
 *   - pickNext FOR UPDATE SKIP LOCKED query shape
 *   - Status transitions (markSent / markFailed / markDead / resetForSkip)
 *   - Validation (event_id required, payload_body required+string)
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const UkOutbox = require('../../../src/models/UkOutbox');

describe('UkOutbox model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('enqueue()', () => {
        it('inserts a pending row and returns it', async () => {
            const newRow = { id: 42, event_id: 'evt-1', payload_body: '{"e":1}', status: 'pending' };
            db.query.mockResolvedValue({ rows: [newRow] });

            const result = await UkOutbox.enqueue({ event_id: 'evt-1', payload_body: '{"e":1}' });

            expect(result).toEqual(newRow);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('ON CONFLICT (event_id) DO NOTHING'),
                ['evt-1', '{"e":1}']
            );
        });

        it('returns null on duplicate event_id (idempotent retry)', async () => {
            // ON CONFLICT DO NOTHING + RETURNING * returns zero rows on conflict
            db.query.mockResolvedValue({ rows: [] });

            const result = await UkOutbox.enqueue({ event_id: 'evt-1', payload_body: '{"e":1}' });
            expect(result).toBeNull();
        });

        it('throws if event_id is missing', async () => {
            await expect(UkOutbox.enqueue({ payload_body: '{}' })).rejects.toThrow(/event_id is required/);
            expect(db.query).not.toHaveBeenCalled();
        });

        it('throws if payload_body is not a string', async () => {
            await expect(UkOutbox.enqueue({ event_id: 'evt-1', payload_body: { e: 1 } }))
                .rejects.toThrow(/payload_body must be a non-empty string/);
            expect(db.query).not.toHaveBeenCalled();
        });

        it('throws if payload_body is empty string', async () => {
            await expect(UkOutbox.enqueue({ event_id: 'evt-1', payload_body: '' }))
                .rejects.toThrow(/payload_body must be a non-empty string/);
        });

        it('rethrows on unexpected DB error', async () => {
            db.query.mockRejectedValue(new Error('connection lost'));
            await expect(UkOutbox.enqueue({ event_id: 'evt-1', payload_body: '{}' }))
                .rejects.toThrow('connection lost');
        });
    });

    describe('pickNext()', () => {
        it('selects pending row with FOR UPDATE SKIP LOCKED', async () => {
            const row = { id: 1, event_id: 'evt-1', payload_body: '{}', status: 'pending' };
            db.query.mockResolvedValue({ rows: [row] });

            const result = await UkOutbox.pickNext();

            expect(result).toEqual(row);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
            expect(sql).toMatch(/status = 'pending'/);
            expect(sql).toMatch(/next_attempt_at <= NOW\(\)/);
            expect(sql).toMatch(/LIMIT 1/);
        });

        it('returns null when no rows ready', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await UkOutbox.pickNext();
            expect(result).toBeNull();
        });
    });

    describe('markSent()', () => {
        it('sets status=sent, last_response_code, sent_at', async () => {
            const updated = { id: 1, status: 'sent', last_response_code: 202 };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await UkOutbox.markSent(1, 202);

            expect(result).toEqual(updated);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/SET status = 'sent'/);
            expect(sql).toMatch(/sent_at = NOW\(\)/);
            expect(sql).toMatch(/last_error = NULL/);
            expect(params).toEqual([1, 202]);
        });
    });

    describe('markFailed()', () => {
        it('bumps attempt_count and sets next_attempt_at via interval', async () => {
            const updated = { id: 1, attempt_count: 2, next_attempt_at: '...' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await UkOutbox.markFailed(1, 'UK 429', 429, 8);

            expect(result).toEqual(updated);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/attempt_count = attempt_count \+ 1/);
            // [SEC-29] interval via integer multiplication, not string concat
            expect(sql).toMatch(/next_attempt_at = NOW\(\) \+ \(\$4 \* INTERVAL '1 second'\)/);
            expect(params).toEqual([1, 'UK 429', 429, 8]);
        });

        it('clamps negative backoff to 1 second', async () => {
            db.query.mockResolvedValue({ rows: [{}] });
            await UkOutbox.markFailed(1, 'x', null, -100);
            const [, params] = db.query.mock.calls[0];
            expect(params[3]).toBe(1);
        });

        it('floors fractional backoff', async () => {
            db.query.mockResolvedValue({ rows: [{}] });
            await UkOutbox.markFailed(1, 'x', null, 8.7);
            const [, params] = db.query.mock.calls[0];
            expect(params[3]).toBe(8);
        });
    });

    describe('markDead()', () => {
        it('sets status=dead and bumps attempt_count', async () => {
            const updated = { id: 1, status: 'dead' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await UkOutbox.markDead(1, 'UK 401: bad signature', 401);

            expect(result).toEqual(updated);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/SET status = 'dead'/);
            expect(sql).toMatch(/attempt_count = attempt_count \+ 1/);
            expect(params).toEqual([1, 'UK 401: bad signature', 401]);
        });
    });

    describe('resetForSkip()', () => {
        it('pushes next_attempt_at without bumping attempt_count', async () => {
            db.query.mockResolvedValue({ rows: [{ id: 1 }] });

            await UkOutbox.resetForSkip(1, 60);

            const [sql, params] = db.query.mock.calls[0];
            // [SEC-29] interval via integer multiplication, not string concat
            expect(sql).toMatch(/next_attempt_at = NOW\(\) \+ \(\$2 \* INTERVAL '1 second'\)/);
            expect(sql).not.toMatch(/attempt_count = attempt_count \+ 1/);
            expect(params[1]).toBe(60);
            expect(params[2]).toContain('skipped');
        });

        it('defaults to 60-second skip', async () => {
            db.query.mockResolvedValue({ rows: [{}] });
            await UkOutbox.resetForSkip(1);
            const [, params] = db.query.mock.calls[0];
            expect(params[1]).toBe(60);
        });
    });

    describe('countByStatus()', () => {
        it('aggregates rows into a status→count object', async () => {
            db.query.mockResolvedValue({
                rows: [
                    { status: 'pending', count: 3 },
                    { status: 'sent', count: 10 },
                    { status: 'dead', count: 1 }
                ]
            });

            const result = await UkOutbox.countByStatus();
            expect(result).toEqual({ pending: 3, sent: 10, dead: 1 });
        });

        it('returns empty object when no rows', async () => {
            db.query.mockResolvedValue({ rows: [] });
            const result = await UkOutbox.countByStatus();
            expect(result).toEqual({});
        });
    });

    describe('MAX_ATTEMPTS constant', () => {
        it('is exposed for callers to compute attempt-cap logic', () => {
            expect(UkOutbox.MAX_ATTEMPTS).toBe(5);
        });
    });
});
