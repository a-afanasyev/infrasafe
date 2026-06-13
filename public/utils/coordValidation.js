/**
 * Coordinate-integrity guards for the admin edit/add forms.
 *
 * The forms build a PUT/POST body with `latitude: parseFloat(field.value)`. A
 * blank or non-numeric field yields NaN; `JSON.stringify` serializes NaN as
 * `null`; the partial UPDATE then writes `null` and SILENTLY ERASES the stored
 * coordinate (buildUpdateQuery only skips `undefined`, not `null`; Building.update
 * uses fixed-position params so an omitted field also lands as null). These pure
 * validators let each handler abort (with a toast) BEFORE sending such a body.
 *
 * Exposed both as a browser global (esbuild bundle:false keeps it global) and as
 * a CommonJS module for jsdom/node unit tests.
 */
(function (root) {
    'use strict';

    /** @returns {boolean} true only for a real, finite JS number (rejects NaN/Infinity/null/strings). */
    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Validate a latitude/longitude pair destined for a PUT/POST body.
     * @param {number} latitude  result of parseFloat(field.value)
     * @param {number} longitude
     * @returns {{ valid: boolean, error: (string|null) }}
     */
    function validateCoordinatePair(latitude, longitude) {
        if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
            return {
                valid: false,
                error: 'Укажите корректные координаты — широта и долгота не должны быть пустыми',
            };
        }
        if (latitude < -90 || latitude > 90) {
            return { valid: false, error: 'Широта должна быть в диапазоне [-90, 90]' };
        }
        if (longitude < -180 || longitude > 180) {
            return { valid: false, error: 'Долгота должна быть в диапазоне [-180, 180]' };
        }
        return { valid: true, error: null };
    }

    const api = { isFiniteNumber, validateCoordinatePair };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CoordValidation = api;
    }
})(typeof window !== 'undefined' ? window : this);
