'use strict';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DIRECTIONS = ['from_uk', 'to_uk'];
const VALID_STATUSES = ['pending', 'success', 'error', 'failed'];
const VALID_ENTITY_TYPES = ['building', 'alert', 'request'];
const VALID_BUILDING_EVENTS = ['building.created', 'building.updated', 'building.deleted'];
// [request.reconcile — UK contract 2026-07-23] Reconciliation replay for
// UK-originated requests our inventory doesn't know; same envelope/endpoint
// as the other request.* events.
const VALID_REQUEST_EVENTS = ['request.created', 'request.status_changed', 'request.reconcile'];

function isValidUUID(value) {
    if (!value || typeof value !== 'string') return false;
    return UUID_REGEX.test(value);
}

function isValidDirection(value) {
    return VALID_DIRECTIONS.includes(value);
}

function isValidStatus(value) {
    return VALID_STATUSES.includes(value);
}

function isValidEntityType(value) {
    return VALID_ENTITY_TYPES.includes(value);
}

function isValidBuildingEvent(value) {
    return VALID_BUILDING_EVENTS.includes(value);
}

function isValidRequestEvent(value) {
    return VALID_REQUEST_EVENTS.includes(value);
}

/**
 * Validate optional GPS coordinate. Accepts null/undefined (means "not set").
 * Returns { ok: boolean, message?: string }.
 * Range: latitude -90..90, longitude -180..180.
 */
function validateCoordinate(value, axis) {
    if (value === undefined || value === null) return { ok: true };
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: `Invalid ${axis}: must be a finite number` };
    }
    const max = axis === 'latitude' ? 90 : 180;
    if (value < -max || value > max) {
        return { ok: false, message: `Invalid ${axis}: must be in [-${max}, ${max}]` };
    }
    return { ok: true };
}

module.exports = {
    isValidUUID,
    isValidDirection,
    isValidStatus,
    isValidEntityType,
    isValidBuildingEvent,
    isValidRequestEvent,
    validateCoordinate,
    UUID_REGEX,
    VALID_DIRECTIONS,
    VALID_STATUSES,
    VALID_ENTITY_TYPES,
    VALID_BUILDING_EVENTS,
    VALID_REQUEST_EVENTS
};
