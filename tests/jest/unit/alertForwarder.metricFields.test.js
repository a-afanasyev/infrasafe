/**
 * [FE-119] UK asked for metric/infrastructure context inside the `alert` block of
 * the outbound webhook so the operator sees WHY an alert fired (value + bounds +
 * which device). The payload schema already carried metric_id/value/unit +
 * infrastructure_type/id; this adds metric_label, metric_normal_min,
 * metric_normal_max and infrastructure_label, all optional pass-throughs from
 * alertData. These tests pin the contract on the shared payload builder.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({}));
jest.mock('../../../src/models/UkOutbox', () => ({}));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/services/uk/configProxy', () => ({ isEnabled: jest.fn() }));
jest.mock('../../../src/services/uk/webhookVerifier', () => ({ logEvent: jest.fn() }));

const forwarder = require('../../../src/services/uk/alertForwarder');

const building = { external_id: 'ext-1' };
const rule = { uk_urgency: 'high', reopen_urgency_bump: false };

// A fully-enriched transformer-overload alertData (Phase 1).
const enriched = {
    alert_id: 42,
    type: 'TRANSFORMER_OVERLOAD',
    severity: 'WARNING',
    message: 'Высокая загрузка',
    infrastructure_type: 'transformer',
    infrastructure_id: 10,
    infrastructure_label: 'Трансформатор №10',
    metric_id: 'load_percent',
    metric_label: 'Загрузка трансформатора',
    metric_value: 95.2,
    metric_unit: '%',
    metric_normal_min: 0,
    metric_normal_max: 80,
};

describe('[FE-119] _buildAlertEventBody — metric/infrastructure context', () => {
    test('passes through all metric + infrastructure fields into alert block', () => {
        const body = JSON.parse(forwarder._buildAlertEventBody(enriched, building, 'evt-1', rule, {}));
        expect(body.alert.infrastructure_type).toBe('transformer');
        expect(body.alert.infrastructure_id).toBe(10);
        expect(body.alert.infrastructure_label).toBe('Трансформатор №10');
        expect(body.alert.metric_id).toBe('load_percent');
        expect(body.alert.metric_label).toBe('Загрузка трансформатора');
        expect(body.alert.metric_value).toBe(95.2);
        expect(body.alert.metric_unit).toBe('%');
        expect(body.alert.metric_normal_min).toBe(0);
        expect(body.alert.metric_normal_max).toBe(80);
    });

    test('metric_value 0 is preserved (nullish-coalescing, not ||)', () => {
        const body = JSON.parse(forwarder._buildAlertEventBody(
            { ...enriched, metric_value: 0 }, building, 'evt-2', rule, {}));
        expect(body.alert.metric_value).toBe(0);
    });

    test('absent optional fields serialize as null, not undefined (stable shape)', () => {
        const bare = {
            alert_id: 1, type: 'LEAK_DETECTED', severity: 'CRITICAL', message: 'leak',
            infrastructure_type: 'controller', infrastructure_id: 3,
            metric_label: 'Протечка', // LEAK is label-only per UK FE-119
        };
        const body = JSON.parse(forwarder._buildAlertEventBody(bare, building, 'evt-3', rule, {}));
        expect(body.alert.metric_label).toBe('Протечка');
        // numeric metric fields omitted for LEAK → explicit null (UK ignores them)
        expect(body.alert.metric_value).toBeNull();
        expect(body.alert.metric_normal_min).toBeNull();
        expect(body.alert.metric_normal_max).toBeNull();
        expect(body.alert.infrastructure_label).toBeNull();
    });
});
