// [Sprint 10 PR-2] AlertVerification model unit tests
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
const AlertVerification = require('../../../src/models/AlertVerification');

describe('AlertVerification model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('enqueue', () => {
        const validData = {
            original_alert_id: 21,
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            alert_type: 'LEAK_DETECTED',
            run_at: '2026-05-23T15:00:00Z',
            window_until: '2026-05-23T15:10:00Z'
        };

        test('inserts row with auto-generated reopen_chain_id when omitted', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ id: 1, ...validData, reopen_chain_id: 'auto-uuid', reopen_sequence: 1, status: 'pending' }]
            });

            const result = await AlertVerification.enqueue(validData);

            expect(result.id).toBe(1);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('INSERT INTO alert_verifications');
            expect(sql).toContain('ON CONFLICT (original_alert_id) WHERE status = \'pending\' DO NOTHING');
            // reopen_chain_id at index 1 — randomly generated UUID
            expect(params[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            // reopen_sequence default = 1
            expect(params[2]).toBe(1);
        });

        test('preserves provided reopen_chain_id and reopen_sequence', async () => {
            const chainId = '550e8400-e29b-41d4-a716-446655440000';
            db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

            await AlertVerification.enqueue({
                ...validData,
                reopen_chain_id: chainId,
                reopen_sequence: 3
            });

            const params = db.query.mock.calls[0][1];
            expect(params[1]).toBe(chainId);
            expect(params[2]).toBe(3);
        });

        test('returns null when ON CONFLICT prevents insert (idempotent)', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const result = await AlertVerification.enqueue(validData);

            expect(result).toBeNull();
        });

        test('throws when required fields missing', async () => {
            await expect(AlertVerification.enqueue({})).rejects.toThrow('original_alert_id is required');
            await expect(AlertVerification.enqueue({ original_alert_id: 1 })).rejects.toThrow('infrastructure_type/id and alert_type are required');
            await expect(AlertVerification.enqueue({
                original_alert_id: 1,
                infrastructure_type: 'controller',
                infrastructure_id: 1,
                alert_type: 'LEAK_DETECTED'
            })).rejects.toThrow('run_at and window_until are required');
        });
    });

    describe('pickDue', () => {
        test('returns next pending row with FOR UPDATE SKIP LOCKED', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ id: 5, status: 'pending', original_alert_id: 21 }]
            });

            const result = await AlertVerification.pickDue();

            expect(result.id).toBe(5);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain("status = 'pending'");
            expect(sql).toContain('run_at <= NOW()');
            expect(sql).toContain('FOR UPDATE SKIP LOCKED');
            expect(sql).toContain('LIMIT 1');
        });

        test('returns null when no rows due', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            expect(await AlertVerification.pickDue()).toBeNull();
        });
    });

    describe('status transition helpers', () => {
        // [B-020 review] All terminal mark* methods carry a `status='pending'`
        // guard so a crash-retry (finalize-first leaves the row pending, the
        // next drain re-runs mark*) is a true no-op rather than re-stamping
        // processed_at / re-bumping attempts. Mirrors markDispatched's guard.
        test('markPassed updates status + stamps processed_at + bumps attempts (pending guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'passed', attempts: 1 }] });

            await AlertVerification.markPassed(1);

            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain("status = 'passed'");
            expect(sql).toContain('attempts = attempts + 1');
            expect(sql).toContain('processed_at = NOW()');
            expect(sql).toContain("status = 'pending'");
        });

        test('markReopened requires newAlertId and links it (pending guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, new_alert_id: 99 }] });

            await AlertVerification.markReopened(1, 99);

            const params = db.query.mock.calls[0][1];
            expect(params).toEqual([1, 99]);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain("status = 'reopened'");
            expect(sql).toContain('new_alert_id = $2');
            expect(sql).toContain("status = 'pending'");
        });

        test('markReopened throws when newAlertId missing', async () => {
            await expect(AlertVerification.markReopened(1, null)).rejects.toThrow('newAlertId is required');
        });

        test('markSuppressed sets suppressed status (pending guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'suppressed' }] });
            await AlertVerification.markSuppressed(1);
            expect(db.query.mock.calls[0][0]).toContain("status = 'suppressed'");
            expect(db.query.mock.calls[0][0]).toContain("status = 'pending'");
        });

        test('markEngineerRequired sets engineer_required status (pending guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'engineer_required' }] });
            await AlertVerification.markEngineerRequired(1);
            expect(db.query.mock.calls[0][0]).toContain("status = 'engineer_required'");
            expect(db.query.mock.calls[0][0]).toContain("status = 'pending'");
        });

        test('markSkipped sets skipped status (pending guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'skipped' }] });
            await AlertVerification.markSkipped(1, 'test reason');
            expect(db.query.mock.calls[0][0]).toContain("status = 'skipped'");
            expect(db.query.mock.calls[0][0]).toContain("status = 'pending'");
        });

        // [AUD-001 PR-B] markChecked stamps last_checked_at when a checker
        // actually evaluated the condition. It must NOT terminate the row
        // (status stays 'pending') and NOT bump attempts — it only records
        // that a real check happened, so the window-expired branch can tell
        // 'passed' (checked, no fault) from 'skipped' (never completed).
        test('markChecked stamps last_checked_at, keeps status pending, does not bump attempts', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, last_checked_at: '2026-06-10T00:00:00Z' }] });

            await AlertVerification.markChecked(1);

            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('last_checked_at = NOW()');
            expect(sql).toContain("status = 'pending'");      // guard only
            expect(sql).not.toContain("status = 'checked'");  // does not terminate
            expect(sql).not.toContain('attempts = attempts + 1');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('markChecked returns null when row not pending (idempotent guard)', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            expect(await AlertVerification.markChecked(1)).toBeNull();
        });
    });

    describe('countRecentReopensForChain', () => {
        test('returns count for last 24h by default', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ count: 3 }] });

            const count = await AlertVerification.countRecentReopensForChain('chain-uuid');

            expect(count).toBe(3);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain("status = 'reopened'");
            expect(sql).toContain("INTERVAL '1 hour'");
            expect(params[1]).toBe(24);
        });

        test('respects custom withinHours', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });
            await AlertVerification.countRecentReopensForChain('chain-uuid', 6);
            expect(db.query.mock.calls[0][1][1]).toBe(6);
        });
    });

    describe('findByChainId', () => {
        test('returns ordered chain history', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { id: 1, reopen_sequence: 1, status: 'reopened' },
                    { id: 2, reopen_sequence: 2, status: 'reopened' },
                    { id: 3, reopen_sequence: 3, status: 'passed' }
                ]
            });

            const chain = await AlertVerification.findByChainId('chain-uuid');

            expect(chain).toHaveLength(3);
            expect(chain[2].status).toBe('passed');
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('ORDER BY reopen_sequence ASC');
        });
    });
});
