'use strict';

// Tests the REAL webhookValidation module (webhookRoutesTest.test.js mocks
// it wholesale, so the actual event whitelist is otherwise untested).

const {
    isValidRequestEvent,
    VALID_REQUEST_EVENTS
} = require('../../../src/utils/webhookValidation');

describe('webhookValidation — request event whitelist', () => {
    test.each(['request.created', 'request.status_changed', 'request.reconcile'])(
        'accepts %s',
        (event) => {
            expect(isValidRequestEvent(event)).toBe(true);
        }
    );

    test('rejects unknown request events', () => {
        expect(isValidRequestEvent('request.deleted')).toBe(false);
        expect(isValidRequestEvent('')).toBe(false);
        expect(isValidRequestEvent(undefined)).toBe(false);
    });

    test('whitelist is exactly the three contract events', () => {
        expect([...VALID_REQUEST_EVENTS].sort()).toEqual([
            'request.created',
            'request.reconcile',
            'request.status_changed'
        ]);
    });
});
