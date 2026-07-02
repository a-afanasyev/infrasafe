// [ARCH-114] Inventory endpoint for UK's reconciliation safety-net.
// Returns the set of uk_request_number values we have on file so the UK
// management bot can set-diff against its local `requests` table and
// replay missing rows. Contract + rationale:
//   docs/audit/2026-05-24-ARCH-114-uk-requests-inventory-spec.md

'use strict';

const AlertRequestMap = require('../models/AlertRequestMap');
const logger = require('../utils/logger');

async function getRequestsInventory(req, res, next) {
    try {
        const rawLimit = req.query.limit;
        const { rows, limit } = await AlertRequestMap.listInventory({ limit: rawLimit });
        res.json({
            data: rows,
            total: rows.length,
            limit
        });
    } catch (error) {
        // [R2-05] Route through errorHandler for the canonical envelope
        // { success:false, error:{ message, status } } + 500-detail hiding.
        logger.error(`getRequestsInventory error: ${error.message}`);
        next(error);
    }
}

module.exports = { getRequestsInventory };
