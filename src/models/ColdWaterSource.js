/**
 * ColdWaterSource — produced by the createCrudModel factory.
 * Phase 6: the 152-line hand-written class was byte-for-byte identical
 * to HeatSource modulo table/column names. Both are now generated.
 *
 * createCrudModel handles findAll / findById / create / update / delete
 * plus the standard { data, pagination: { total, page, limit, totalPages } }
 * shape expected by existing controllers.
 *
 * Legacy create path accepts a pre-supplied `id` (UUID string); INSERT uses
 * gen_random_uuid() at the DB level elsewhere (admin-path) — this model
 * preserves whatever value the caller passes.
 */

const { createCrudModel } = require('./factories/createCrudModel');

const FIELDS = [
    'id', 'name', 'address', 'latitude', 'longitude', 'source_type',
    'capacity_m3_per_hour', 'operating_pressure_bar', 'installation_date',
    'status', 'maintenance_contact', 'notes',
];

module.exports = createCrudModel({
    tableName: 'cold_water_sources',
    idColumn: 'id',
    entityName: 'cold water source',
    entityType: 'water_sources',
    fields: FIELDS,
    createColumns: FIELDS,      // includes id (caller-provided UUID)
    updateColumns: FIELDS.filter(f => f !== 'id'),
    defaults: { status: 'active' },
});
