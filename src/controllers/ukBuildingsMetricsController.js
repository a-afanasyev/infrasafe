// [UK building reconcile — 2026-07-23] Buildings inventory for UK's
// reconciliation set-diff, sibling of the ARCH-114 requests inventory.
// Why it exists: the anonymous /buildings-metrics projection deliberately
// omits external_id (P-PENTEST-3), so UK's anonymous reconcile worker saw
// no hashes and "repaired" every building each cycle. This endpoint serves
// the external_id inventory behind the same x-service-token gate as
// /uk-requests-metrics.

'use strict';

const Building = require('../models/Building');
const logger = require('../utils/logger');

/**
 * GET /api/uk-buildings-metrics — building external_id inventory for UK's
 * reconciliation set-diff. Same envelope as the requests inventory:
 * { data: [{ external_id, uk_deleted_at }], total, limit }.
 */
async function getBuildingsInventory(req, res, next) {
    try {
        const rawLimit = req.query.limit;
        const { rows, limit } = await Building.listUkInventory({ limit: rawLimit });
        res.json({
            data: rows,
            total: rows.length,
            limit
        });
    } catch (error) {
        // [R2-05] Route through errorHandler for the canonical envelope.
        logger.error(`getBuildingsInventory error: ${error.message}`);
        next(error);
    }
}

module.exports = { getBuildingsInventory };
