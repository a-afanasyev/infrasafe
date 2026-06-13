/**
 * @jest-environment node
 *
 * [code-review batch] Coordinate-integrity guard. The admin edit forms build a
 * PUT body with `latitude: parseFloat(field.value)`. A blank/non-numeric field
 * yields NaN; JSON.stringify serializes NaN as null; the partial UPDATE then
 * writes null and silently ERASES the stored coordinate. These pure validators
 * let each form abort (with a toast) BEFORE sending such a body.
 */

const { validateCoordinatePair, isFiniteNumber } = require('../../../../public/utils/coordValidation.js');

describe('isFiniteNumber', () => {
    test('accepts finite numbers (incl. 0 and negatives)', () => {
        expect(isFiniteNumber(0)).toBe(true);
        expect(isFiniteNumber(41.35)).toBe(true);
        expect(isFiniteNumber(-69.25)).toBe(true);
    });
    test('rejects NaN, Infinity, null, undefined, strings', () => {
        expect(isFiniteNumber(NaN)).toBe(false);
        expect(isFiniteNumber(Infinity)).toBe(false);
        expect(isFiniteNumber(-Infinity)).toBe(false);
        expect(isFiniteNumber(null)).toBe(false);
        expect(isFiniteNumber(undefined)).toBe(false);
        expect(isFiniteNumber('41.35')).toBe(false);
    });
});

describe('validateCoordinatePair', () => {
    test('valid Tashkent coordinates pass', () => {
        expect(validateCoordinatePair(41.351, 69.252)).toEqual({ valid: true, error: null });
    });

    test('NaN latitude (the parseFloat("") wipe vector) is rejected', () => {
        const r = validateCoordinatePair(NaN, 69.252);
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/координат/i);
    });

    test('NaN longitude is rejected', () => {
        expect(validateCoordinatePair(41.351, NaN).valid).toBe(false);
    });

    test('both NaN rejected (blank lat & lng)', () => {
        expect(validateCoordinatePair(NaN, NaN).valid).toBe(false);
    });

    test('out-of-range latitude rejected', () => {
        expect(validateCoordinatePair(91, 69).valid).toBe(false);
        expect(validateCoordinatePair(-91, 69).valid).toBe(false);
    });

    test('out-of-range longitude rejected', () => {
        expect(validateCoordinatePair(41, 181).valid).toBe(false);
        expect(validateCoordinatePair(41, -181).valid).toBe(false);
    });

    test('boundary values (±90 lat, ±180 lng) pass', () => {
        expect(validateCoordinatePair(90, 180).valid).toBe(true);
        expect(validateCoordinatePair(-90, -180).valid).toBe(true);
    });

    test('null/undefined coordinates rejected (defends the wipe path)', () => {
        expect(validateCoordinatePair(null, null).valid).toBe(false);
        expect(validateCoordinatePair(undefined, undefined).valid).toBe(false);
    });
});
