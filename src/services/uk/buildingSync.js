'use strict';

/**
 * [P1-14 split] UK → InfraSafe building sync.
 *
 * Owns:
 *   - handleBuildingWebhook — processes building.created / building.updated /
 *     building.deleted events with TOCTOU race protection via the UNIQUE
 *     constraint on integration_log.event_id.
 *   - _generateExternalId — deterministic SHA-256-derived UUID for UK
 *     buildings. Matches the algorithm UK reconciliation uses on its side,
 *     so both ends arrive at the same external_id without coordinating.
 *
 * No module-level state.
 */

const crypto = require('crypto');
const IntegrationLog = require('../../models/IntegrationLog');
const Building = require('../../models/Building');
const logger = require('../../utils/logger');
const { isValidBuildingEvent, isValidUUID, validateCoordinate } = require('../../utils/webhookValidation');

class UKBuildingSync {
    /**
     * Generate a deterministic external_id for a UK building.
     * NOT a UUID v4/v5 — a SHA-256 hash of "uk-building-{id}" formatted as a
     * UUID string so PostgreSQL UUID columns accept it. The same UK
     * building.id always produces the same external_id, enabling idempotent
     * create/update operations.
     */
    _generateExternalId(ukBuildingId) {
        const hash = crypto.createHash('sha256').update(`uk-building-${ukBuildingId}`).digest('hex');
        return [
            hash.substring(0, 8),
            hash.substring(8, 12),
            hash.substring(12, 16),
            hash.substring(16, 20),
            hash.substring(20, 32)
        ].join('-');
    }

    /**
     * Process a building webhook from UK system.
     * Handles building.created, building.updated, building.deleted events.
     */
    async handleBuildingWebhook(payload) {
        const { event, building: ukBuilding, event_id } = payload;

        if (!isValidBuildingEvent(event)) {
            throw new Error('Invalid building event type');
        }

        // [Sprint 6 / CR-2] Accept a deterministic `external_id` from the UK
        // payload when present. UK can compute it as `uuid5(NAMESPACE, str(id))`
        // and ship it in the webhook so reconciliation matches both sides
        // without coordinating algorithms. Backward-compatible: payloads
        // without the field continue to use InfraSafe's internal SHA-256 hash.
        let externalId;
        if (isValidUUID(ukBuilding.external_id)) {
            externalId = ukBuilding.external_id;
        } else {
            if (ukBuilding.external_id !== undefined && ukBuilding.external_id !== null) {
                // [Sprint 7 / M-sec-1] Strip CR/LF/TAB and cap length so a
                // crafted uk_building_id can't forge extra log lines.
                const safeId = String(ukBuilding.id ?? '').replace(/[\r\n\t]/g, '_').slice(0, 64);
                logger.warn(
                    `handleBuildingWebhook: invalid building.external_id received, ` +
                    `falling back to internal hash (uk_building_id=${safeId})`
                );
            }
            externalId = this._generateExternalId(ukBuilding.id);
        }

        // Insert pending log entry first — UNIQUE constraint on event_id
        // prevents concurrent processing of the same event (TOCTOU race protection)
        let logEntry;
        try {
            logEntry = await IntegrationLog.create({
                event_id,
                direction: 'from_uk',
                entity_type: 'building',
                entity_id: ukBuilding.id?.toString(),
                action: event,
                payload,
                status: 'pending'
            });
        } catch (logError) {
            // UNIQUE violation means another request is already processing this event
            if (logError.code === '23505') {
                logger.info(`Concurrent duplicate event_id ${event_id}, skipping`);
                return;
            }
            throw logError;
        }

        try {
            const existing = await Building.findByExternalId(externalId);

            if (event === 'building.deleted') {
                if (existing) {
                    await Building.softDelete(existing.building_id);
                    logger.info(`Soft-deleted building ${existing.building_id} (UK building ${ukBuilding.id})`);
                } else {
                    logger.warn(`Building with external_id ${externalId} not found for deletion, ignoring`);
                }
            } else {
                // building.created or building.updated — upsert logic
                // Note: UK webhook also sends `contacts` but InfraSafe's buildings table
                // does not have a contacts column — contacts are managed via management_company.
                // The contacts field is intentionally not stored.
                //
                // Coords (optional): UK PR-F (2026-05-20) added latitude/longitude
                // to the payload. PostGIS trigger trig_buildings_geom recomputes
                // geom from latitude/longitude on every INSERT/UPDATE — we don't
                // touch geom directly. Validated upfront so bad data fails fast
                // before DB roundtrip.
                const latCheck = validateCoordinate(ukBuilding.latitude, 'latitude');
                if (!latCheck.ok) throw new Error(latCheck.message);
                const lngCheck = validateCoordinate(ukBuilding.longitude, 'longitude');
                if (!lngCheck.ok) throw new Error(lngCheck.message);

                const ukFields = {
                    name: ukBuilding.name,
                    address: ukBuilding.address,
                    town: ukBuilding.town,
                    latitude: ukBuilding.latitude ?? null,
                    longitude: ukBuilding.longitude ?? null
                };

                if (existing) {
                    await Building.updateFromUK(existing.building_id, ukFields);
                    logger.info(`Updated building ${existing.building_id} from UK (event: ${event})`);
                } else {
                    await Building.createFromUK({ external_id: externalId, ...ukFields });
                    logger.info(`Created building from UK building ${ukBuilding.id} (event: ${event})`);
                }
            }

            await IntegrationLog.updateStatus(logEntry.id, 'success');
        } catch (error) {
            logger.error(`handleBuildingWebhook error: ${error.message}`);
            try {
                await IntegrationLog.updateStatus(logEntry.id, 'error', error.message);
            } catch (logError) {
                logger.error(`Failed to update integration log error: ${logError.message}`);
            }
            throw error;
        }
    }
}

const singleton = new UKBuildingSync();
module.exports = singleton;
module.exports.UKBuildingSync = UKBuildingSync;
