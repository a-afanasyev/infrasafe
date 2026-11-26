/**
 * [A12-10] В `integration_log` пишется минимум полей заявки УК.
 *
 * Раньше в журнал уходил весь payload вебхука — вместе со всем, что УК
 * положит в `request` (заявитель, телефон, адрес, текст обращения), и
 * хранился бессрочно. Обработке нужны пять полей; остальное не сохраняется.
 */

jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(),
    updateStatus: jest.fn(),
    reclaimErrorByEventId: jest.fn(),
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByRequestNumber: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    markSent: jest.fn(),
    updateStatus: jest.fn(),
    areAllTerminal: jest.fn(),
}));
jest.mock('../../../src/models/UkRequest', () => ({ reconcile: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../../../src/services/uk/configProxy', () => ({ invalidateRequestCache: jest.fn() }));

const IntegrationLog = require('../../../src/models/IntegrationLog');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const requestProcessor = require('../../../src/services/uk/requestProcessor');

const EVENT_ID = 'aabbccdd-1122-3344-5566-778899001122';

const loggedPayload = async (payload) => {
    await requestProcessor.handleRequestWebhook(payload);
    return IntegrationLog.create.mock.calls[0][0].payload;
};

beforeEach(() => {
    jest.clearAllMocks();
    IntegrationLog.create.mockResolvedValue({ id: 10 });
    IntegrationLog.updateStatus.mockResolvedValue({});
    AlertRequestMap.findByRequestNumber.mockResolvedValue(null);
    AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);
});

describe('[A12-10] payload заявки в integration_log', () => {
    test('персональные и свободные поля заявки в журнал не попадают', async () => {
        const stored = await loggedPayload({
            event_id: EVENT_ID,
            event: 'request.status_changed',
            request: {
                request_number: '261125-007',
                status: 'В работе',
                new_status: 'Принято',
                building_external_id: 'b-17',
                source_event_id: 'src-1',
                applicant_name: 'Иванов Иван',
                applicant_phone: '+998901234567',
                address: 'ул. Фараби, 5, кв. 12',
                description: 'Течёт кран, звоните после 18:00',
                executor: { name: 'Петров', phone: '+998907654321' },
            },
            signature_debug: 'x',
        });

        expect(stored).toEqual({
            event_id: EVENT_ID,
            event: 'request.status_changed',
            request: {
                request_number: '261125-007',
                status: 'В работе',
                new_status: 'Принято',
                building_external_id: 'b-17',
                source_event_id: 'src-1',
            },
        });
        expect(JSON.stringify(stored)).not.toMatch(/Иванов|99890|Фараби|Течёт|Петров/);
    });

    test('в разрешённое поле нельзя пронести вложенный объект или длинный текст', async () => {
        const stored = await loggedPayload({
            event_id: EVENT_ID,
            event: 'request.status_changed',
            request: {
                request_number: '261125-008',
                status: { note: 'Иванов Иван, +998901234567' },
                new_status: 'x'.repeat(5000),
            },
        });

        expect(stored.request.status).toBeUndefined();
        expect(stored.request.new_status.length).toBeLessThanOrEqual(100);
        expect(JSON.stringify(stored)).not.toMatch(/Иванов|99890/);
    });

    test('отсутствующие поля не превращаются в null-заглушки', async () => {
        const stored = await loggedPayload({
            event_id: EVENT_ID,
            event: 'request.created',
            request: { request_number: '261125-009' },
        });

        expect(stored).toEqual({ event_id: EVENT_ID, event: 'request.created', request: { request_number: '261125-009' } });
    });

    test('обработка по-прежнему видит полный payload — урезается только запись в журнал', async () => {
        AlertRequestMap.findByRequestNumber.mockResolvedValue({ id: 3, infrasafe_alert_id: 9, status: 'active' });
        AlertRequestMap.areAllTerminal.mockResolvedValue(false);

        await requestProcessor.handleRequestWebhook({
            event_id: EVENT_ID,
            event: 'request.status_changed',
            request: { request_number: '261125-010', new_status: 'В работе', applicant_phone: '+998901234567' },
        });

        expect(AlertRequestMap.findByRequestNumber).toHaveBeenCalledWith('261125-010');
        expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(3, 'active');
    });
});
