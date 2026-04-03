require('dotenv').config();
const { validateEnv } = require('./config/env');
validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const apiRoutes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const correlationId = require('./middleware/correlationId');
const { destroyAllLimiters } = require('./middleware/rateLimiter');
const logger = require('./utils/logger');
const db = require('./config/database');
const cacheService = require('./services/cacheService');

// Создаем экземпляр приложения Express
const app = express();

// Настройка порта
const PORT = process.env.PORT || 3000;

// Middleware
// Настройка helmet с CSP: строгий режим в production, мягкий в development (для Swagger UI)
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: isProduction
                ? ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"]
                : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https:", "data:"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"]
        }
    }
})); // Безопасность
app.use(cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : 'http://localhost:8080',
    credentials: true
})); // CORS
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
})); // Парсинг JSON (rawBody preserved for HMAC webhook verification)
app.use(correlationId); // Correlation ID для трейсинга запросов
morgan.token('safepath', (req) => req.path); // path without query string
morgan.token('correlationId', (req) => req.correlationId || '-');
app.use(morgan(':method :safepath :status :response-time ms :correlationId', { stream: { write: message => logger.info(message.trim()) } })); // Логирование HTTP запросов

// Health check endpoint для Docker
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'healthy', db: 'connected' });
    } catch {
        res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
    }
});

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// Swagger документация (только в development)
if (process.env.NODE_ENV !== 'production') {
    const swaggerOptions = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Infrasafe API',
                version: '1.0.0',
                description: 'API документация для системы мониторинга зданий',
            },
            servers: [
                {
                    url: `http://localhost:${PORT}/api`,
                    description: 'Development server',
                },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description: 'Требуется для маршрутов, которые изменяют данные (POST, PUT, DELETE, PATCH)'
                    }
                }
            },
            security: [{ bearerAuth: [] }], // По умолчанию JWT требуется (default-deny)
        },
        apis: ['./src/routes/*.js'], // Пути к файлам с JSDoc комментариями
    };

    const swaggerSpec = swaggerJsdoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// API маршруты
app.use('/api', apiRoutes);

// Обработка SPA роутинга - только для маршрутов, которые не соответствуют статическим файлам
app.get('*', (req, res, next) => {
    // Проверяем, не запрашивается ли конкретный HTML-файл
    if (req.path.endsWith('.html') || req.path === '/admin' || req.path === '/') {
        next(); // Пропускаем обработку для HTML-файлов
    } else {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

// Обработчик ошибок
app.use(errorHandler);

// Инициализация базы данных и запуск сервера
let server;

db.init()
    .then(() => {
        server = app.listen(PORT, () => {
            logger.info(`Сервер запущен на порту ${PORT}`);
        });
        server.timeout = 30000; // 30s — максимальное время обработки запроса
        server.keepAliveTimeout = 65000; // Чуть больше чем типичный Nginx proxy_read_timeout (60s)
        server.headersTimeout = 66000; // Должен быть больше keepAliveTimeout
    })
    .catch((error) => {
        logger.error(`Ошибка инициализации базы данных: ${error.message}`);
        process.exit(1);
    });

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    const forceExit = setTimeout(() => {
        logger.error('Forced exit after timeout');
        process.exit(1);
    }, 10000);
    forceExit.unref();

    if (server) {
        await new Promise(resolve => server.close(resolve));
        logger.info('HTTP server closed');
    }

    // Очистка таймеров и ресурсов
    try { destroyAllLimiters(); } catch (e) { logger.error('Rate limiter cleanup error:', e.message); }
    try { await cacheService.close(); } catch (e) { logger.error('Cache close error:', e.message); }

    try {
        await db.close();
        logger.info('Database connection closed');
    } catch (e) {
        logger.error('DB close error:', e);
    }
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных исключений и обещаний
process.on('uncaughtException', (err) => {
    logger.error('Необработанное исключение:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Необработанное отклонение обещания:', reason);
    gracefulShutdown('unhandledRejection');
});

module.exports = app; // Для тестирования