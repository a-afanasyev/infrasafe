/**
 * Phase 6: produced by createCrudController factory.
 * The 71-line hand-written controller was identical to heatSourceController
 * modulo model reference and not-found wording.
 */

const ColdWaterSource = require('../models/ColdWaterSource');
const { createCrudController } = require('./factories/createCrudController');

module.exports = createCrudController({
    Model: ColdWaterSource,
    notFoundMessage: 'Water source not found',
    logLabel: 'cold water source',
    deletedMessage: 'Water source deleted successfully',
});
