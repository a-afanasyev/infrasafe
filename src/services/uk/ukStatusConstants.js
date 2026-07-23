'use strict';

/**
 * [review fix 2026-07-23] Single source of truth for the two status
 * vocabularies of the UK integration. Previously the UK terminal pair was
 * hardcoded independently in requestProcessor + two configProxy SQL literals —
 * a drift risk given UK's vocabulary has changed before (see migration 032).
 *
 * UK_TERMINAL_STATUSES — UK's production dictionary values that close a
 * request (request.status_changed / request.reconcile payloads).
 * ARM_TERMINAL_STATUSES — InfraSafe-internal alert_request_map states that
 * mark a mapping closed (see AlertRequestMap.areAllTerminal).
 */

const UK_TERMINAL_STATUSES = ['Принято', 'Отменена'];
const ARM_TERMINAL_STATUSES = ['resolved', 'cancelled'];

module.exports = { UK_TERMINAL_STATUSES, ARM_TERMINAL_STATUSES };
