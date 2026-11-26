/**
 * [A12-10] Планировщик очистки integration_log: срок, рубильник, устойчивость.
 * Сам DELETE проверяется на живой БД — tests/jest/db/integrationLogRetention.db.test.js.
 */

jest.mock('../../../src/models/IntegrationLog', () => ({ deleteOlderThan: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const IntegrationLog = require('../../../src/models/IntegrationLog');
const logger = require('../../../src/utils/logger');
const retention = require('../../../src/services/uk/integrationLogRetention');

const ENV = ['INTEGRATION_LOG_RETENTION_DAYS', 'INTEGRATION_LOG_RETENTION_ENABLED'];

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    for (const k of ENV) delete process.env[k];
    IntegrationLog.deleteOlderThan.mockResolvedValue(0);
});

afterEach(async () => {
    await retention.stop();
    jest.useRealTimers();
});

describe('[A12-10] срок хранения', () => {
    test('по умолчанию 90 дней', () => {
        expect(retention.retentionDays()).toBe(90);
    });

    test.each([['30', 30], ['45', 45], ['365', 365]])('INTEGRATION_LOG_RETENTION_DAYS=%s → %d', (raw, days) => {
        process.env.INTEGRATION_LOG_RETENTION_DAYS = raw;
        expect(retention.retentionDays()).toBe(days);
    });

    test.each([['1', 30], ['0', 90], ['-7', 90], ['abc', 90], ['', 90], ['100000', 365]])(
        'значение вне диапазона %p не даёт стереть свежий журнал → %d',
        (raw, days) => {
            // Нижняя граница — 30 дней: журнал держит дедупликацию event_id,
            // и опечатка в переменной не должна её обнулить.
            process.env.INTEGRATION_LOG_RETENTION_DAYS = raw;
            expect(retention.retentionDays()).toBe(days);
        }
    );
});

describe('[A12-10] запуск по расписанию', () => {
    test('первый проход — вскоре после старта, дальше раз в сутки', async () => {
        retention.start();
        expect(IntegrationLog.deleteOlderThan).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(IntegrationLog.deleteOlderThan).toHaveBeenCalledTimes(1);
        expect(IntegrationLog.deleteOlderThan).toHaveBeenCalledWith(90);

        await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(IntegrationLog.deleteOlderThan).toHaveBeenCalledTimes(2);
    });

    test('рубильник INTEGRATION_LOG_RETENTION_ENABLED=false — таймеры не заводятся', async () => {
        process.env.INTEGRATION_LOG_RETENTION_ENABLED = 'false';
        retention.start();
        await jest.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
        expect(IntegrationLog.deleteOlderThan).not.toHaveBeenCalled();
    });

    test('повторный start не удваивает расписание', async () => {
        retention.start();
        retention.start();
        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(IntegrationLog.deleteOlderThan).toHaveBeenCalledTimes(1);
    });

    test('сбой БД не роняет процесс и не останавливает расписание', async () => {
        IntegrationLog.deleteOlderThan.mockRejectedValueOnce(new Error('connection refused'));
        retention.start();

        await jest.advanceTimersByTimeAsync(60 * 1000);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'));

        await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(IntegrationLog.deleteOlderThan).toHaveBeenCalledTimes(2);
    });

    test('после stop проходов больше нет', async () => {
        retention.start();
        await retention.stop();
        await jest.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
        expect(IntegrationLog.deleteOlderThan).not.toHaveBeenCalled();
    });
});
