// PR-3 (AUD-006): configProxy.isEscalationNotifyEnabled — env parser gating the
// new alert.escalated UK notification. Default off; only the exact strings
// "true"/"1" enable it (so a stray "false" is never truthy).

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const configProxy = require('../../../src/services/uk/configProxy');

describe('configProxy.isEscalationNotifyEnabled', () => {
    const orig = process.env.UK_ESCALATION_NOTIFY;
    afterEach(() => {
        if (orig === undefined) delete process.env.UK_ESCALATION_NOTIFY;
        else process.env.UK_ESCALATION_NOTIFY = orig;
    });

    test('false when unset', () => {
        delete process.env.UK_ESCALATION_NOTIFY;
        expect(configProxy.isEscalationNotifyEnabled()).toBe(false);
    });

    test('false for the literal string "false"', () => {
        process.env.UK_ESCALATION_NOTIFY = 'false';
        expect(configProxy.isEscalationNotifyEnabled()).toBe(false);
    });

    test('false for "0"', () => {
        process.env.UK_ESCALATION_NOTIFY = '0';
        expect(configProxy.isEscalationNotifyEnabled()).toBe(false);
    });

    test('true for "true" (any case)', () => {
        process.env.UK_ESCALATION_NOTIFY = 'TRUE';
        expect(configProxy.isEscalationNotifyEnabled()).toBe(true);
    });

    test('true for "1"', () => {
        process.env.UK_ESCALATION_NOTIFY = '1';
        expect(configProxy.isEscalationNotifyEnabled()).toBe(true);
    });
});
