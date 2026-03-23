const { createError } = require('../../utils/helpers');

/**
 * Admin general operations: global search, stats dashboard, data export.
 */

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
        const stats = {
            buildings: { total: 17, active: 10 },
            controllers: { total: 15, active: 8, offline: 3, maintenance: 4 },
            metrics: { total: 1000, today: 50 },
            message: 'Stats generated (stub)'
        };
        res.json(stats);
    } catch (error) {
        next(createError('Failed to get stats', 500));
    }
}

async function exportData(req, res, next) {
    try {
        const { type, format } = req.body;
        res.json({
            success: true,
            message: `Export ${type} in ${format} initiated (stub)`,
            downloadUrl: '/api/admin/download/export-123.csv'
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
