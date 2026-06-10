// [AUD-001 PR-C] Engineer-escalation durable ack — the ALERT_ENGINEER_REQUIRED
// listener stamps uk_notified_at via AlertVerification.markUkNotified ONLY when
// sendAlertToUK reports delivered (true). A non-delivery (false) must NOT ack,
// so the engineer sweep keeps re-emitting until UK actually receives it.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertAndBuilding: jest.fn(), create: jest.fn(), findByIdempotencyKey: jest.fn()
}));
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn(), findByEventId: jest.fn(), reviveDead: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/services/uk/configProxy', () => ({ isEnabled: jest.fn() }));
jest.mock('../../../src/services/uk/webhookVerifier', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/models/AlertVerification', () => ({ markUkNotified: jest.fn() }));

const alertEvents = require('../../../src/events/alertEvents');
const configProxy = require('../../../src/services/uk/configProxy');
const AlertVerification = require('../../../src/models/AlertVerification');
const forwarder = require('../../../src/services/uk/alertForwarder'); // singleton; registers the listener at load

// Let the async listener microtasks drain.
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

const alertData = { alert_id: 5, type: 'LEAK_DETECTED', severity: 'CRITICAL', infrastructure_type: 'controller', infrastructure_id: 1 };

describe('[AUD-001 PR-C] ALERT_ENGINEER_REQUIRED durable ack', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configProxy.isEnabled.mockResolvedValue(true);
        AlertVerification.markUkNotified.mockResolvedValue({ id: 99 });
    });

    afterEach(() => { jest.restoreAllMocks(); });

    test('delivered=true → markUkNotified(verificationId)', async () => {
        jest.spyOn(forwarder, 'sendAlertToUK').mockResolvedValue(true);

        alertEvents.emit(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, { alertData, alertId: 5, verificationId: 99 });
        await flush();

        expect(AlertVerification.markUkNotified).toHaveBeenCalledWith(99);
    });

    test('delivered=false → NOT acked (sweep will retry)', async () => {
        jest.spyOn(forwarder, 'sendAlertToUK').mockResolvedValue(false);

        alertEvents.emit(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, { alertData, alertId: 5, verificationId: 99 });
        await flush();

        expect(AlertVerification.markUkNotified).not.toHaveBeenCalled();
    });
});
