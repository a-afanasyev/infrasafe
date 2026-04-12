const express = require('express');
const buildingRoutes = require('./buildingRoutes');
const controllerRoutes = require('./controllerRoutes');
const metricRoutes = require('./metricRoutes');
const authRoutes = require('./authRoutes');
const buildingMetricsRoutes = require('./buildingMetricsRoutes');
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
    { method: 'GET',  path: '/' },
    { method: 'POST', path: '/webhooks/uk/building' },
    { method: 'POST', path: '/webhooks/uk/request' },
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