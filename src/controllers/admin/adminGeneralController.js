const { createError } = require('../../utils/helpers');
const db = require('../../config/database');

async function globalSearch(req, res, next) {
    try {
        const { query, type = 'all', limit = 50 } = req.query;
        res.json({
            results: [],
            total: 0,
            query,
            type,
            message: 'Search completed (stub)'
        });
    } catch (error) {
        next(createError('Search failed', 500));
    }
}

async function getAdminStats(req, res, next) {
    try {
        const [buildings, controllers, metrics, alerts] = await Promise.all([
            db.query('SELECT COUNT(*) FROM buildings'),
            db.query('SELECT COUNT(*) FROM controllers'),
            db.query('SELECT COUNT(*) FROM metrics'),
            db.query("SELECT COUNT(*) FROM alerts WHERE status = 'active'"),
        ]);

        res.json({
            buildings: { total: parseInt(buildings.rows[0].count, 10) },
            controllers: { total: parseInt(controllers.rows[0].count, 10) },
            metrics: { total: parseInt(metrics.rows[0].count, 10) },
            alerts: { active: parseInt(alerts.rows[0].count, 10) },
        });
    } catch (error) {
        next(createError('Failed to get stats', 500));
    }
}

async function exportData(req, res, next) {
    try {
        res.status(501).json({
            success: false,
            error: 'Export functionality not yet implemented',
        });
    } catch (error) {
        next(createError('Export failed', 500));
    }
}

module.exports = {
    globalSearch,
    getAdminStats,
    exportData
};
