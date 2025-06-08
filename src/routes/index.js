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
const metricController = require('../controllers/metricController');
const { authenticateJWT } = require('../middleware/auth');
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
router.post('/metrics/telemetry', metricController.receiveTelementry);

// Определяем middleware для защищенных маршрутов - PUT, POST, DELETE
router.use((req, res, next) => {
    // Исключаем маршрут телеметрии из проверки
    if (req.path === '/metrics/telemetry' && req.method === 'POST') {
        return next();
    }
    
    // Исключаем маршруты авторизации из проверки
    if (req.path.startsWith('/auth/')) {
        return next();
    }
    
    // Защищаем только маршруты, которые изменяют данные
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
        authenticateJWT(req, res, next);
    } else {
        // Для GET запросов - разрешаем без аутентификации
        next();
    }
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
        version: '1.0.0',
        description: 'API для системы мониторинга зданий',
        endpoints: [
            '/api/auth - Авторизация и управление пользователями',
            '/api/buildings - Управление зданиями',
            '/api/controllers - Управление контроллерами',
            '/api/transformers - Управление трансформаторами',
            '/api/lines - Управление линиями электропередач',
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
router.use('/metrics', metricRoutes);
router.use('/buildings-metrics', buildingMetricsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/alerts', alertRoutes);
router.use('/admin', adminRoutes);

// Обработка 404 для API
router.use((req, res, next) => {
    next(createError(`Route ${req.originalUrl} not found`, 404));
});

module.exports = router;