/**
 * [CO-3] Единственный источник байтов исходящего payload'а для УК.
 *
 * `_buildAlertEventBody` документирован как «canonical … so both paths build
 * byte-identical shapes», но фактически вызывался ТОЛЬКО из двух escalation-
 * путей. Основной путь `alert.created` собирал тот же JSON вручную — то есть
 * комментарий не соответствовал коду, и правка схемы в одном месте молча
 * разъехалась бы с прод-контрактом УК.
 *
 * Тест фиксирует байтовое равенство. Байты важны буквально: ukWebhookClient
 * подписывает HMAC именно эту строку и отправляет её verbatim — пересборка
 * JSON в другом месте сломала бы подпись.
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
jest.mock('../../../src/services/uk/webhookVerifier', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const UkOutbox = require('../../../src/models/UkOutbox');
const AlertRule = require('../../../src/models/AlertRule');
const configProxy = require('../../../src/services/uk/configProxy');
const forwarder = require('../../../src/services/uk/alertForwarder');

const BUILDING = { id: 4, external_id: '11111111-2222-3333-4444-555555555555' };
// 'Срочная' → канонический ключ 'high' (RU_URGENCY_TO_KEY). Значение вне карты
// даёт null, и bump на reopen стало бы непроверяемым.
const RULE = { id: 9, uk_urgency: 'Срочная', reopen_urgency_bump: true, enabled: true };

function baseAlert(extra = {}) {
    return {
        alert_id: 21,
        type: 'LEAK_DETECTED',
        severity: 'CRITICAL',
        infrastructure_type: 'controller',
        infrastructure_id: 1,
        message: 'Протечка',
        created_at: '2026-08-04T10:00:00.000Z',
        ...extra
    };
}

/** Прогоняет sendAlertToUK и возвращает строку, положенную в outbox. */
async function enqueuedBody(alertData) {
    configProxy.isEnabled.mockResolvedValue(true);
    AlertRule.findByTypeAndSeverity.mockResolvedValue(RULE);
    jest.spyOn(forwarder, 'resolveBuildingIds').mockResolvedValue([BUILDING]);
    AlertRequestMap.findByAlertAndBuilding.mockResolvedValue(null);
    AlertRequestMap.create.mockResolvedValue({ id: 77, idempotency_key: 'fixed-key-0001' });
    UkOutbox.enqueue.mockResolvedValue({ id: 5, status: 'pending' });

    process.env.UK_USE_WEBHOOK_SENDER = 'true';
    await forwarder.sendAlertToUK(alertData);

    expect(UkOutbox.enqueue).toHaveBeenCalled();
    const arg = UkOutbox.enqueue.mock.calls[0][0];
    return typeof arg === 'string' ? arg : (arg.payload_body || arg.payloadBody || arg.body);
}

describe('[CO-3] alert.created собирается тем же хелпером, что и escalation', () => {
    const ORIGINAL_SENDER = process.env.UK_USE_WEBHOOK_SENDER;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        // Замораживаем время: обе ветки зовут new Date() независимо, и без
        // фиксации отличалась бы только временная метка — а проверяем мы
        // именно побайтовое равенство.
        jest.useFakeTimers().setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        if (ORIGINAL_SENDER === undefined) delete process.env.UK_USE_WEBHOOK_SENDER;
        else process.env.UK_USE_WEBHOOK_SENDER = ORIGINAL_SENDER;
    });

    test('обычный алерт: байты совпадают с _buildAlertEventBody', async () => {
        const alertData = baseAlert();

        const actual = await enqueuedBody(alertData);
        // event_id код формирует сам (детерминированный UUIDv5), он не часть
        // контракта ФОРМЫ payload'а — подставляем фактический и сравниваем всё
        // остальное побайтово.
        const expected = forwarder._buildAlertEventBody(
            alertData, BUILDING, JSON.parse(actual).event_id, RULE, {}
        );

        expect(actual).toBe(expected);
    });

    test('reopen: bump срочности тоже совпадает побайтово', async () => {
        const alertData = baseAlert({
            reopen_chain_id: 'chain-1',
            reopen_sequence: 2,
            previous_uk_request_number: '260804-001'
        });

        const actual = await enqueuedBody(alertData);
        const expected = forwarder._buildAlertEventBody(
            alertData, BUILDING, JSON.parse(actual).event_id, RULE, {}
        );

        expect(actual).toBe(expected);
        // Bump сработал: 'Срочная' (high) на reopen поднялась до critical.
        expect(JSON.parse(actual).alert.uk_urgency_override).toBe('critical');
        // Значимые для УК поля reopen реально доехали.
        expect(JSON.parse(actual).alert.reopen_sequence).toBe(2);
        expect(JSON.parse(actual).alert.related_request_number).toBe('260804-001');
    });

    test('на обычном пути engineer-поля пусты (ветка была недостижима)', async () => {
        const body = JSON.parse(await enqueuedBody(baseAlert()));

        expect(body.event).toBe('alert.created');
        expect(body.alert.uk_category_override).toBeNull();
        expect(body.alert.engineer_required_reason).toBeNull();
    });
});
