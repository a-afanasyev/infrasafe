/**
 * HeatSource — produced by the createCrudModel factory.
 * See ColdWaterSource.js for the rationale.
 */

const { randomUUID } = require('crypto');
const { createCrudModel } = require('./factories/createCrudModel');

const FIELDS = [
    'id', 'name', 'address', 'latitude', 'longitude', 'source_type',
    'capacity_mw', 'fuel_type', 'installation_date',
    'status', 'maintenance_contact', 'notes',
];

module.exports = createCrudModel({
    tableName: 'heat_sources',
    idColumn: 'id',
    entityName: 'heat source',
    entityType: 'heat_sources',
    fields: FIELDS,
    createColumns: FIELDS,
    updateColumns: FIELDS.filter(f => f !== 'id'),
    // [AR-3(б)] См. ColdWaterSource: `id` NOT NULL без DEFAULT, генерация здесь.
    defaults: { id: () => randomUUID(), status: 'active' },
});
