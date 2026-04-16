/**
 * Phase 6: produced by createCrudController factory. See coldWaterSourceController.
 */

const HeatSource = require('../models/HeatSource');
const { createCrudController } = require('./factories/createCrudController');

module.exports = createCrudController({
    Model: HeatSource,
    notFoundMessage: 'Heat source not found',
    logLabel: 'heat source',
    deletedMessage: 'Heat source deleted successfully',
});
