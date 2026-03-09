/**
 * Admin controller barrel file.
 * Re-exports every method with the EXACT names that adminRoutes.js expects,
 * so switching the require path is the only change needed in the router.
 */

const adminBuildingController = require('./adminBuildingController');
const adminControllerController = require('./adminControllerController');
const adminMetricController = require('./adminMetricController');
const adminTransformerController = require('./adminTransformerController');
const adminLineController = require('./adminLineController');
const adminWaterLineController = require('./adminWaterLineController');
const adminColdWaterSourceController = require('./adminColdWaterSourceController');
const adminHeatSourceController = require('./adminHeatSourceController');
const adminGeneralController = require('./adminGeneralController');

module.exports = {
    // Buildings
    getOptimizedBuildings: adminBuildingController.getOptimizedBuildings,
    createBuilding: adminBuildingController.createBuilding,
    getBuildingById: adminBuildingController.getBuildingById,
    updateBuilding: adminBuildingController.updateBuilding,
    deleteBuilding: adminBuildingController.deleteBuilding,
    batchBuildingsOperation: adminBuildingController.batchBuildingsOperation,

    // Controllers
    getOptimizedControllers: adminControllerController.getOptimizedControllers,
    createController: adminControllerController.createController,
    getControllerById: adminControllerController.getControllerById,
    updateController: adminControllerController.updateController,
    deleteController: adminControllerController.deleteController,
    batchControllersOperation: adminControllerController.batchControllersOperation,

    // Metrics
    getOptimizedMetrics: adminMetricController.getOptimizedMetrics,
    createMetric: adminMetricController.createMetric,
    getMetricById: adminMetricController.getMetricById,
    updateMetric: adminMetricController.updateMetric,
    deleteMetric: adminMetricController.deleteMetric,
    batchMetricsOperation: adminMetricController.batchMetricsOperation,

    // Transformers
    getOptimizedTransformers: adminTransformerController.getOptimizedTransformers,
    createTransformer: adminTransformerController.createTransformer,
    getTransformerById: adminTransformerController.getTransformerById,
    updateTransformer: adminTransformerController.updateTransformer,
    deleteTransformer: adminTransformerController.deleteTransformer,
    batchTransformersOperation: adminTransformerController.batchTransformersOperation,

    // Power Lines
    getOptimizedLines: adminLineController.getOptimizedLines,
    createLine: adminLineController.createLine,
    getLineById: adminLineController.getLineById,
    updateLine: adminLineController.updateLine,
    deleteLine: adminLineController.deleteLine,
    batchLinesOperation: adminLineController.batchLinesOperation,

    // Water Lines
    getOptimizedWaterLines: adminWaterLineController.getOptimizedWaterLines,
    createWaterLine: adminWaterLineController.createWaterLine,
    getWaterLineById: adminWaterLineController.getWaterLineById,
    updateWaterLine: adminWaterLineController.updateWaterLine,
    deleteWaterLine: adminWaterLineController.deleteWaterLine,
    batchWaterLinesOperation: adminWaterLineController.batchWaterLinesOperation,

    // Cold Water Sources
    getOptimizedColdWaterSources: adminColdWaterSourceController.getOptimizedColdWaterSources,
    createColdWaterSource: adminColdWaterSourceController.createColdWaterSource,
    getColdWaterSourceById: adminColdWaterSourceController.getColdWaterSourceById,
    updateColdWaterSource: adminColdWaterSourceController.updateColdWaterSource,
    deleteColdWaterSource: adminColdWaterSourceController.deleteColdWaterSource,

    // Heat Sources
    getOptimizedHeatSources: adminHeatSourceController.getOptimizedHeatSources,
    createHeatSource: adminHeatSourceController.createHeatSource,
    getHeatSourceById: adminHeatSourceController.getHeatSourceById,
    updateHeatSource: adminHeatSourceController.updateHeatSource,
    deleteHeatSource: adminHeatSourceController.deleteHeatSource,

    // General (search, stats, export)
    globalSearch: adminGeneralController.globalSearch,
    getAdminStats: adminGeneralController.getAdminStats,
    exportData: adminGeneralController.exportData
};
