// [B-001 / Sprint 11] Unit test for alertService.getActiveAlerts
// uk_requests payload extension.
//
// We assert two things:
// 1. The data query SQL JOINs alert_request_map and aggregates via
//    json_agg + FILTER + COALESCE so consumers always get an array.
// 2. The shape returned to callers includes uk_requests inline so the
//    admin-UI «Открыть в УК» button can decide at render time whether
//    a deep-link applies (vs. requiring a separate fetch).

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/circuitBreaker', () => ({
    CircuitBreakerFactory: {
        createDatabaseBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' }),
        createAnalyticsBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' })
    }
}));
jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn()
}));
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false)
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');

describe('alertService.getActiveAlerts — uk_requests aggregation (B-001)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    test('data SQL contains LEFT JOIN on alert_request_map + json_agg + COALESCE', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // count
            .mockResolvedValueOnce({ rows: [] });              // data

        await alertService.getActiveAlerts();

        const dataSql = db.query.mock.calls[1][0];
        expect(dataSql).toMatch(/LEFT JOIN alert_request_map arm/);
        expect(dataSql).toMatch(/arm\.infrasafe_alert_id = ia\.alert_id/);
        expect(dataSql).toMatch(/json_agg\s*\(/);
        expect(dataSql).toMatch(/FILTER\s*\(\s*WHERE\s+arm\.uk_request_number IS NOT NULL/);
        expect(dataSql).toMatch(/COALESCE\s*\(/);
        expect(dataSql).toMatch(/'\[\]'::json/);
        expect(dataSql).toMatch(/GROUP BY ia\.alert_id, u1\.username, u2\.username/);
    });

    test('passes through uk_requests array from DB to caller', async () => {
        const alertRow = {
            alert_id: 7,
            type: 'LEAK_DETECTED',
            severity: 'CRITICAL',
            uk_requests: [
                { uk_request_number: '260527-001', building_external_id: 'uuid-1', status: 'sent' }
            ]
        };
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '1' }] })
            .mockResolvedValueOnce({ rows: [alertRow] });

        const result = await alertService.getActiveAlerts();

        expect(result.data).toHaveLength(1);
        expect(result.data[0].uk_requests).toEqual([
            { uk_request_number: '260527-001', building_external_id: 'uuid-1', status: 'sent' }
        ]);
    });

    test('returns empty uk_requests when DB sends [] (no mappings)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '1' }] })
            .mockResolvedValueOnce({ rows: [{ alert_id: 8, uk_requests: [] }] });

        const result = await alertService.getActiveAlerts();

        expect(result.data[0].uk_requests).toEqual([]);
    });
});
