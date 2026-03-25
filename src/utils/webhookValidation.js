'use strict';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DIRECTIONS = ['from_uk', 'to_uk'];
const VALID_STATUSES = ['pending', 'success', 'error', 'failed'];
const VALID_ENTITY_TYPES = ['building', 'alert', 'request'];
const VALID_BUILDING_EVENTS = ['building.created', 'building.updated', 'building.deleted'];
const VALID_REQUEST_EVENTS = ['request.created', 'request.status_changed'];

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

module.exports = {
    isValidUUID,
    isValidDirection,
    isValidStatus,
    isValidEntityType,
    isValidBuildingEvent,
    isValidRequestEvent,
    UUID_REGEX,
    VALID_DIRECTIONS,
    VALID_STATUSES,
    VALID_ENTITY_TYPES,
    VALID_BUILDING_EVENTS,
    VALID_REQUEST_EVENTS
};
