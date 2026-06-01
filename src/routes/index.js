const express = require('express');
const buildingRoutes = require('./buildingRoutes');
const controllerRoutes = require('./controllerRoutes');
const metricRoutes = require('./metricRoutes');
const authRoutes = require('./authRoutes');
const buildingMetricsRoutes = require('./buildingMetricsRoutes');
const ukRequestsMetricsRoutes = require('./ukRequestsMetricsRoutes');
const mapLayerCountsRoutes = require('./mapLayerCountsRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const alertRoutes = require('./alertRoutes');
const adminRoutes = require('./adminRoutes');
const transformerRoutes = require('./transformerRoutes');
const lineRoutes = require('./lineRoutes');
const waterSourceRoutes = require('./waterSourceRoutes');
const heatSourceRoutes = require('./heatSourceRoutes');
const waterLineRoutes = require('./waterLineRoutes');
const waterSupplierRoutes = require('./waterSupplierRoutes');
const powerAnalyticsRoutes = require('./powerAnalyticsRoutes');
const webhookRoutes = require('./webhookRoutes');
const integrationRoutes = require('./integrationRoutes');
// [1A-FU-S-M2] CSP violation reports — public, rate-limited, log-only.
const cspReportRoutes = require('./cspReportRoutes');
const metricController = require('../controllers/metricController');
const { authenticateJWT } = require('../middleware/auth');
const { applyTelemetryRateLimit } = require('../middleware/rateLimiter');
const { createError } = require('../utils/helpers');

const router = express.Router();

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 * security:
 *   - bearerAuth: []
 *
 * paths:
 *   /metrics/telemetry:
 *     post:
 *       summary: Получить телеметрию от устройства
 *       description: Принимает данные телеметрии от контроллера и сохраняет их как метрику
 *       security: []  # Отключаем требование авторизации для этого маршрута
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - controller_id
 *               properties:
 *                 controller_id:
 *                   type: integer
 *                 temperature:
 *                   type: number
 *                 humidity:
 *                   type: number
 *                 pressure:
 *                   type: number
 *                 co2_level:
 *                   type: number
 *                 voltage:
 *                   type: number
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       responses:
 *         201:
 *           description: Телеметрия успешно получена и сохранена
 *         400:
 *           description: Ошибка валидации данных
 *         404:
 *           description: Контроллер не найден
 */
// Специальные маршруты, для которых не требуется аутентификация
// Маршрут телеметрии должен быть доступен без аутентификации
router.post('/metrics/telemetry', applyTelemetryRateLimit, metricController.receiveTelemetry);

// [1A-FU-S-M2] CSP violation sink. MUST be mounted BEFORE the
// default-deny authenticateJWT middleware below — the browser cannot
// attach an Authorization header to report-uri POSTs by spec.
router.use('/csp-report', cspReportRoutes);

// Default-deny: все маршруты требуют JWT, кроме явного allowlist
const PUBLIC_ROUTES = [
    { method: 'POST', path: '/auth/login' },
    { method: 'POST', path: '/auth/register' },
    { method: 'POST', path: '/auth/refresh' },
    { method: 'POST', path: '/auth/verify-2fa' },
    { method: 'POST', path: '/auth/setup-2fa' },
    { method: 'POST', path: '/auth/confirm-2fa' },
    { method: 'POST', path: '/metrics/telemetry' },
    { method: 'GET',  path: '/buildings-metrics' },
    // [ARCH-114] UK reconciliation safety-net — set-diff inventory of
    // uk_request_number values we've stored. Mirror of buildings-metrics:
    // read-only, internal docker network reachable, returns identifiers
    // UK already owns. Spec: docs/audit/2026-05-24-ARCH-114-uk-requests-
    // inventory-spec.md
    { method: 'GET',  path: '/uk-requests-metrics' },
    // [B-024] Public aggregate layer counts (integers only, no row detail) so
    // anonymous map visitors see honest counts instead of (0) for auth-gated
    // layers. Mounted at /map-layer-counts below.
    { method: 'GET',  path: '/map-layer-counts' },
    { method: 'GET',  path: '/' },
    { method: 'POST', path: '/webhooks/uk/building' },
    { method: 'POST', path: '/webhooks/uk/request' },
    // [1A-FU2-C-L2] /csp-report is mounted at line 85, BEFORE the
    // default-deny middleware below — so this PUBLIC_ROUTES entry was
    // redundant. Removed to avoid confusing future maintainers about
    // which mount is load-bearing.
];

const isPublicRoute = (method, path) => {
    // Normalize trailing slash: /buildings-metrics/ → /buildings-metrics
    const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    return PUBLIC_ROUTES.some(r =>
        r.method === method && normalizedPath === r.path
    );
};

router.use((req, res, next) => {
    if (isPublicRoute(req.method, req.path)) {
        return next();
    }
    authenticateJWT(req, res, next);
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: Информация об API
 *     description: Возвращает основную информацию о версии API и доступных эндпоинтах
 *     responses:
 *       200:
 *         description: Информация об API
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 version:
 *                   type: string
 *                 description:
 *                   type: string
 *                 endpoints:
 *                   type: array
 *                   items:
 *                     type: string
 */
// Корневой маршрут API
router.get('/', (req, res) => {
    res.json({
        name: 'InfraSafe Habitat IQ API',
        version: '1.0.1',
        description: 'API для системы мониторинга зданий',
        endpoints: [
            '/api/auth - Авторизация и управление пользователями',
            '/api/buildings - Управление зданиями',
            '/api/controllers - Управление контроллерами',
            '/api/transformers - Управление трансформаторами',
            '/api/lines - Управление линиями электропередач',
            '/api/cold-water-sources - Управление источниками воды',
            '/api/heat-sources - Управление источниками тепла',
            '/api/water-lines - Управление водными линиями',
            '/api/water-suppliers - Управление поставщиками воды',
            '/api/infrastructure-lines - Управление линиями инфраструктуры (ХВС, ГВС, электричество)',
            '/api/metrics - Получение метрик',
            '/api/analytics - Аналитика и инфраструктурные объекты',
            '/api/alerts - Система алертов и уведомлений',
            '/api/admin - Оптимизированные админские API',
            '/api-docs - Документация API'
        ],
        status: 'healthy'
    });
});

// Маршруты API
router.use('/auth', authRoutes);
router.use('/buildings', buildingRoutes);
router.use('/controllers', controllerRoutes);
router.use('/transformers', transformerRoutes);
router.use('/lines', lineRoutes);
router.use('/cold-water-sources', waterSourceRoutes);
router.use('/heat-sources', heatSourceRoutes);
router.use('/water-lines', waterLineRoutes);
router.use('/water-suppliers', waterSupplierRoutes);
router.use('/metrics', metricRoutes);
router.use('/buildings-metrics', buildingMetricsRoutes);
router.use('/uk-requests-metrics', ukRequestsMetricsRoutes);
router.use('/map-layer-counts', mapLayerCountsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/alerts', alertRoutes);
router.use('/admin', adminRoutes);
router.use('/power-analytics', powerAnalyticsRoutes);
router.use('/webhooks/uk', webhookRoutes);
router.use('/integration', integrationRoutes);

// Обработка 404 для API
router.use((req, res, next) => {
    next(createError(`Route ${req.originalUrl} not found`, 404));
});

module.exports = router;