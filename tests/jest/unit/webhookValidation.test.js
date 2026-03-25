'use strict';

const { isValidUUID, isValidDirection, isValidStatus, isValidEntityType, isValidBuildingEvent } = require('../../../src/utils/webhookValidation');

describe('webhookValidation', () => {
    describe('isValidUUID', () => {
        it('accepts valid v4 UUID', () => {
            expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
        });
        it('rejects empty string', () => {
            expect(isValidUUID('')).toBe(false);
        });
        it('rejects non-UUID string', () => {
            expect(isValidUUID('not-a-uuid')).toBe(false);
        });
        it('rejects null/undefined', () => {
            expect(isValidUUID(null)).toBe(false);
            expect(isValidUUID(undefined)).toBe(false);
        });
        it('rejects UUID with wrong length', () => {
            expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
        });
    });

    describe('isValidDirection', () => {
        it('accepts from_uk', () => {
            expect(isValidDirection('from_uk')).toBe(true);
        });
        it('accepts to_uk', () => {
            expect(isValidDirection('to_uk')).toBe(true);
        });
        it('rejects unknown direction', () => {
            expect(isValidDirection('incoming')).toBe(false);
        });
    });

    describe('isValidStatus', () => {
        it('accepts all valid statuses', () => {
            ['pending', 'success', 'error', 'failed'].forEach(s =>
                expect(isValidStatus(s)).toBe(true)
            );
        });
        it('rejects unknown status', () => {
            expect(isValidStatus('unknown')).toBe(false);
        });
    });

    describe('isValidEntityType', () => {
        it('accepts all valid entity types', () => {
            ['building', 'alert', 'request'].forEach(t =>
                expect(isValidEntityType(t)).toBe(true)
            );
        });
        it('rejects unknown type', () => {
            expect(isValidEntityType('user')).toBe(false);
        });
    });

    describe('isValidBuildingEvent', () => {
        it('accepts building.created', () => {
            expect(isValidBuildingEvent('building.created')).toBe(true);
        });
        it('accepts building.updated', () => {
            expect(isValidBuildingEvent('building.updated')).toBe(true);
        });
        it('accepts building.deleted', () => {
            expect(isValidBuildingEvent('building.deleted')).toBe(true);
        });
        it('rejects unknown event', () => {
            expect(isValidBuildingEvent('building.unknown')).toBe(false);
        });
    });
});
