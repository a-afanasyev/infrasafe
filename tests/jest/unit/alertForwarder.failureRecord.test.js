/**
 * [AUD-034] Запись отказа доставки в УК — одна функция, не две копии.
 *
 * Оба event-листенера (`ALERT_CREATED` и engineer-эскалация) при падении
 * `sendAlertToUK` дописывают отказ в `infrastructure_alerts.data
 * .notification_failures`. Тела catch-блоков были байт-идентичны — здесь
 * закрепляется и поведение (отказ реально записывается), и структура
 * (SQL-литерал существует в файле один раз, в общем хелпере).
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertAndBuilding: jest.fn(),
    create: jest.fn(),
    findByIdempotencyKey: jest.fn()
}));
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn(),
    findByEventId: jest.fn(),
    reviveDead: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/services/uk/configProxy', () => ({ isEnabled: jest.fn() }));
jest.mock('../../../src/services/uk/webhookVerifier', () => ({
    logEvent: jest.fn().mockResolvedValue(undefined)
}));

const fs = require('fs');
const path = require('path');
const db = require('../../../src/config/database');
const configProxy = require('../../../src/services/uk/configProxy');
const alertEvents = require('../../../src/events/alertEvents');
const forwarder = require('../../../src/services/uk/alertForwarder');

const flushListeners = () => new Promise((resolve) => setImmediate(resolve));

describe('[AUD-034] запись notification_failures', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configProxy.isEnabled.mockResolvedValue(true);
    });

    test('падение доставки на ALERT_CREATED дописывает отказ в data алерта', async () => {
        jest.spyOn(forwarder, 'sendAlertToUK').mockRejectedValueOnce(new Error('UK down'));
        db.query.mockResolvedValue({ rows: [] });

        alertEvents.emit(alertEvents.EVENTS.ALERT_CREATED, {
            alertData: { type: 'LEAK_DETECTED', severity: 'CRITICAL' },
            alertId: 33
        });
        await flushListeners();

        const call = db.query.mock.calls.find(
            (c) => /notification_failures/.test(c[0])
        );
        expect(call).toBeDefined();
        const [, params] = call;
        expect(params[1]).toBe(33);
        const recorded = JSON.parse(params[0]);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({ channel: 'uk_integration', error: 'UK down' });
    });

    test('SQL-литерал notification_failures живёт в файле ровно один раз (общий хелпер)', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../src/services/uk/alertForwarder.js'),
            'utf8'
        );
        const occurrences = source.match(/\{notification_failures\}/g) || [];
        expect(occurrences).toHaveLength(1);
    });
});
