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

const { randomUUID } = require('crypto');
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
    // [AR-3(б)] `id` — NOT NULL без DEFAULT в БД, а фабрика подставляла null
    // всему, чего нет во входных данных. Из-за этого POST /api/cold-water-sources
    // падал 500-й на любом теле без `id` — а взять его клиенту неоткуда.
    // Admin-путь работал лишь потому, что генерировал UUID сам, сырым SQL;
    // теперь генерация живёт здесь, и оба пути ведут себя одинаково.
    defaults: { id: () => randomUUID(), status: 'active' },
});
