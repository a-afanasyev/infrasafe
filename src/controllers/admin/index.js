/**
 * Admin controller barrel file.
 * Re-exports every method with the EXACT names that adminRoutes.js expects,
 * so switching the require path is the only change needed in the router.
 *
 * Phase 5 (2026-04-17): for Buildings / Controllers / Metrics, CRUD
 * methods (create / getById / update / delete) are sourced directly from
 * the non-admin controllers rather than from dead-delegation proxies.
 * Auth + rate-limit guards remain at the route layer in adminRoutes.js.
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

// Non-admin CRUD controllers (Phase 5 proxy removal)
const buildingController = require('../buildingController');
const controllerController = require('../controllerController');
const metricController = require('../metricController');

module.exports = {
    // Buildings
    getOptimizedBuildings: adminBuildingController.getOptimizedBuildings,
    createBuilding: buildingController.createBuilding,
    getBuildingById: buildingController.getBuildingById,
    updateBuilding: buildingController.updateBuilding,
    deleteBuilding: buildingController.deleteBuilding,
    batchBuildingsOperation: adminBuildingController.batchBuildingsOperation,

    // Controllers
    getOptimizedControllers: adminControllerController.getOptimizedControllers,
    createController: controllerController.createController,
    getControllerById: controllerController.getControllerById,
    updateController: controllerController.updateController,
    deleteController: controllerController.deleteController,
    batchControllersOperation: adminControllerController.batchControllersOperation,

    // Metrics — note: non-admin metricController intentionally exposes no
    // updateMetric; the prior admin proxy was dead-code (called undefined).
    // PUT /admin/metrics/:id route is removed accordingly in Phase 5.
    getOptimizedMetrics: adminMetricController.getOptimizedMetrics,
    createMetric: metricController.createMetric,
    getMetricById: metricController.getMetricById,
    deleteMetric: metricController.deleteMetric,
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

    // General (admin dashboard)
    // Phase 9.3: globalSearch and exportData stubs removed (YAGNI-007/008).
    getAdminStats: adminGeneralController.getAdminStats,
};
