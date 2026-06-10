// [AUD-001 PR-B] VERIFY_* listener wiring — the reconnect.
//
// alertVerificationService emits VERIFY_<TYPE> after grace; alertService now
// subscribes and runs the matching checker in verify mode, acking via
// AlertVerification.markChecked only when the checker actually evaluated the
// fault (result.checked === true). Before this PR nothing subscribed → the
// whole reopen subsystem was dead. These tests pin the wiring + the ack gate.

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
jest.mock('../../../src/services/analyticsService', () => ({ getTransformerLoad: jest.fn() }));
jest.mock('../../../src/services/ukIntegrationService', () => ({ isEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('../../../src/services/uk/alertForwarder', () => ({ resolveBuildingIds: jest.fn().mockResolvedValue([]) }));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/models/AlertVerification', () => ({ markChecked: jest.fn().mockResolvedValue({ id: 1 }) }));

const flush = () => new Promise((resolve) => setImmediate(resolve));

const alertEvents = require('../../../src/events/alertEvents');
const alertService = require('../../../src/services/alertService'); // registers the listeners
const AlertVerification = require('../../../src/models/AlertVerification');

const basePayload = {
    infraType: 'controller',
    infraId: 42,
    alertType: 'LEAK_DETECTED',
    bypassCooldown: true,
    reopenChainId: 'chain-1',
    reopenSequence: 2,
    originalAlertId: 21,
    previousUkRequestNumber: '260610-001',
    verificationId: 99,
    observationSince: '2026-06-10T00:00:00Z'
};

describe('[AUD-001 PR-B] VERIFY_* listeners', () => {
    const cases = [
        [alertEvents.EVENTS.VERIFY_LEAK,        'checkLeak'],
        [alertEvents.EVENTS.VERIFY_VOLTAGE,     'checkVoltage'],
        [alertEvents.EVENTS.VERIFY_HEATING,     'checkHeating'],
        [alertEvents.EVENTS.VERIFY_TRANSFORMER, 'checkTransformerLoad'],
    ];

    let spies;
    beforeEach(() => {
        jest.clearAllMocks();
        spies = {};
        for (const m of ['checkLeak', 'checkVoltage', 'checkHeating', 'checkTransformerLoad']) {
            spies[m] = jest.spyOn(alertService, m).mockResolvedValue({ checked: true, alert: null });
        }
    });
    afterEach(() => Object.values(spies).forEach((s) => s.mockRestore()));

    test.each(cases)('%s → runs %s in verify mode with the reopenContext', async (event, method) => {
        alertEvents.emit(event, basePayload);
        await flush();

        expect(spies[method]).toHaveBeenCalledTimes(1);
        const [infraId, opts] = spies[method].mock.calls[0];
        expect(infraId).toBe(42);
        expect(opts.bypassCooldown).toBe(true);
        expect(opts.reopenContext).toEqual({
            chainId: 'chain-1',
            sequence: 2,
            previousAlertId: 21,
            previousUkRequestNumber: '260610-001',
            observationSince: '2026-06-10T00:00:00Z'
        });
    });

    test('result.checked === true → AlertVerification.markChecked(verificationId)', async () => {
        spies.checkLeak.mockResolvedValue({ checked: true, alert: { alert_id: 1 } });
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, basePayload);
        await flush();
        expect(AlertVerification.markChecked).toHaveBeenCalledWith(99);
    });

    test('result.checked === false → markChecked NOT called', async () => {
        spies.checkLeak.mockResolvedValue({ checked: false, alert: null });
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, basePayload);
        await flush();
        expect(AlertVerification.markChecked).not.toHaveBeenCalled();
    });

    test('missing infraId → checker NOT called', async () => {
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, { ...basePayload, infraId: null });
        await flush();
        expect(spies.checkLeak).not.toHaveBeenCalled();
        expect(AlertVerification.markChecked).not.toHaveBeenCalled();
    });

    test('missing reopenChainId → checker NOT called', async () => {
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, { ...basePayload, reopenChainId: null });
        await flush();
        expect(spies.checkLeak).not.toHaveBeenCalled();
    });

    test('null payload → no throw, checker NOT called', async () => {
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, null);
        await flush();
        expect(spies.checkLeak).not.toHaveBeenCalled();
    });

    test('checker rejection is caught (not unhandled), no markChecked', async () => {
        spies.checkLeak.mockRejectedValue(new Error('boom'));
        alertEvents.emit(alertEvents.EVENTS.VERIFY_LEAK, basePayload);
        await flush();
        expect(AlertVerification.markChecked).not.toHaveBeenCalled();
    });
});
