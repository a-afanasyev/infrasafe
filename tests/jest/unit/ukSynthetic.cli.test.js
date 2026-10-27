// src/cli/uk-synthetic.js — синтетика для совместной проверки с УК. Тест держит
// две вещи: разбор аргументов отклоняет мусор до похода в БД, и payload
// собирается БОЕВЫМ builder'ом с полями, которые УК проверяет в сценариях.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const { parseArgs, buildAlertData } = require('../../../src/cli/uk-synthetic');
const forwarder = require('../../../src/services/uk/alertForwarder');

const CHAIN = '11111111-2222-4333-8444-555555555555';
const BUILDING = { building_id: 14, external_id: 'bac1c6fc-1ec4-9497-42c6-e5001e27df70' };
const RULE = { uk_urgency: 'high', reopen_urgency_bump: true };

const body = (scenario, extra = []) => {
    const opts = parseArgs([scenario, '--chain', CHAIN, ...extra]);
    const json = forwarder._buildAlertEventBody(buildAlertData(opts), BUILDING, 'evt-1', RULE, {
        engineerRequired: scenario === 'engineer'
    });
    return JSON.parse(json);
};

describe('uk-synthetic parseArgs', () => {
    test('defaults per scenario', () => {
        expect(parseArgs(['reopen'])).toMatchObject({
            building: 14, type: 'LEAK_DETECTED', severity: 'CRITICAL', sequence: 2, dryRun: false, wait: 120
        });
        expect(parseArgs(['engineer']).sequence).toBe(3);
        expect(parseArgs(['reopen']).chain).toMatch(/^[0-9a-f-]{36}$/);
    });

    test.each([
        [[]],
        [['bogus']],
        [['reopen', '--chain', 'not-a-uuid']],
        [['reopen', '--severity', 'INFO']],
        [['reopen', '--sequence', '0']],
        [['reopen', '--building', '-1']],
        [['reopen', '--wat', '1']],
        [['reopen', '--building']]
    ])('rejects %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow();
    });
});

describe('uk-synthetic payload (real builder)', () => {
    test('engineer: alert.engineer_required, no category override, critical', () => {
        const { event, alert } = body('engineer');
        expect(event).toBe('alert.engineer_required');
        expect(alert.uk_category_override).toBeNull();
        expect(alert.uk_urgency_override).toBe('critical');
        expect(alert.engineer_required_reason).toBe('max_reopens_per_24h');
        expect(alert.reopen_sequence).toBe(3);
        expect(alert.reopen_chain_id).toBe(CHAIN);
        expect(alert.external_id).toBe(BUILDING.external_id);
        expect(alert.message).toMatch(/^\[ТЕСТ ИНТЕГРАЦИИ\]/);
    });

    test('reopen: alert.created with sequence 2, chain, related request, bumped urgency', () => {
        const { event, alert } = body('reopen', ['--related', '261027-001']);
        expect(event).toBe('alert.created');
        expect(alert.reopen_sequence).toBe(2);
        expect(alert.reopen_chain_id).toBe(CHAIN);
        expect(alert.related_request_number).toBe('261027-001');
        expect(alert.uk_category_override).toBeNull();
        expect(alert.uk_urgency_override).toBe('critical'); // high + reopen bump
    });

    test('synthetic alert_id stays above the real-id range', () => {
        expect(buildAlertData(parseArgs(['reopen'])).alert_id).toBeGreaterThanOrEqual(900000000);
    });
});
