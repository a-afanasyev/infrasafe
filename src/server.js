require('dotenv').config();
const { validateEnv } = require('./config/env');
validateEnv();

const express = require('express');
const cookieParser = require('cookie-parser');
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
app.set('trust proxy', 1);
// [hotfix 2026-05-27] Disable Express auto-ETag generation globally.
// Conditional revalidation on session-bound JSON responses (e.g. /api/auth/profile)
// can return 304 to the browser, and Fetch API's `response.ok` is FALSE for 304 —
// downstream JS like admin-auth.js treats that as a failed auth → logout flip loop
// login.html ↔ admin.html. Route-level Cache-Control: no-store on authRoutes was
// not enough in practice (browsers can still cache JSON even with no-store under
// some conditions, then revalidate). Disabling ETag at the source removes the
// conditional path entirely. APIs are dynamic — ETag-based caching has no upside.
app.disable('etag');

// Настройка порта
const PORT = process.env.PORT || 3000;

// Middleware
// Настройка helmet с CSP: строгий режим в production, мягкий в development (для Swagger UI)
const isProduction = process.env.NODE_ENV === 'production';

// [P1-3] Helmet CSP — production drops 'unsafe-inline' / 'unsafe-eval'
// from script-src (inline <script> blocks were extracted in this PR).
// Development needs 'unsafe-inline' on style-src for Swagger UI styling,
// but no longer needs 'unsafe-eval' — Swagger UI 5.x doesn't use eval.
// 'unsafe-inline' on style-src is kept in both modes because the
// existing HTML uses `style="..."` attributes extensively; removing it
// is tracked as a separate item (CSS-only refactor, low security ROI).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: isProduction
                ? ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"]
                : ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            imgSrc: ["'self'", "data:", "https:", "https://*.tile.openstreetmap.org"],
            fontSrc: ["'self'", "https:", "data:"],
            connectSrc: ["'self'", "https://*.tile.openstreetmap.org"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            // [1A-FU-S-M2] CSP violations POST to /api/csp-report so a
            // bypass/misconfig becomes observable instead of silent.
            reportUri: ['/api/csp-report']
        }
    },
    // OpenStreetMap tile servers require Referer header — 'no-referrer' (helmet default) blocks it
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
})); // Безопасность
app.use(cors({
    // [Sprint 5 / P2-V3] Trim each origin so `a.com, b.com` works the same
    // as `a.com,b.com`; filter empty strings from trailing commas.
    origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
        : 'http://localhost:8080',
    credentials: true
})); // CORS
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
})); // Парсинг JSON (rawBody preserved for HMAC webhook verification)
// [P1-2] cookie-parser populates req.cookies — auth middleware reads
// access_token / refresh_token from HttpOnly cookies as a fallback to
// the Authorization header / req.body.refreshToken paths.
// [1A-FU2-S-L1] Sign cookies when COOKIE_SIGNING_SECRET is set. Today no
// code reads req.signedCookies, but future code that does will get a
// silent `false` instead of the signed value if the parser was constructed
// without a secret. Cheap insurance — supports zero, one, or rotated-pair
// secrets via a single env var (comma-separated for rotation).
const COOKIE_SIGNING_SECRET = process.env.COOKIE_SIGNING_SECRET || '';
const signingSecrets = COOKIE_SIGNING_SECRET
    ? COOKIE_SIGNING_SECRET.split(',').map(s => s.trim()).filter(Boolean)
    : null;
app.use(cookieParser(signingSecrets));
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

// [Sprint 0.1 / MEDIUM-5] Multi-replica nonce-dedup warning.
// P0-2 webhook replay protection uses an in-memory Map per process.
// If horizontally scaled (REPLICA_COUNT>1 or running behind a load
// balancer with REPLICAS env), a captured signature can be replayed
// against a different replica within the 300s timestamp tolerance.
// Phase 11.1 (Redis-backed dedup) is the proper fix; this warning
// makes the limitation visible to operators today.
const replicaCount = parseInt(process.env.REPLICA_COUNT || '1', 10);
if (process.env.NODE_ENV === 'production' && replicaCount > 1 && !process.env.REDIS_URL) {
    logger.warn(
        'P0-2: webhook nonce dedup is per-process — replay protection ' +
        `is broken in multi-replica mode (REPLICA_COUNT=${replicaCount}, ` +
        'no REDIS_URL). Plan Phase 11.1 (Redis-backed dedup) before scaling out.'
    );
}

db.init()
    .then(() => {
        server = app.listen(PORT, () => {
            logger.info(`Сервер запущен на порту ${PORT}`);
        });
        server.timeout = 30000; // 30s — максимальное время обработки запроса
        server.keepAliveTimeout = 65000; // Чуть больше чем типичный Nginx proxy_read_timeout (60s)
        server.headersTimeout = 66000; // Должен быть больше keepAliveTimeout

        // [Sprint 6 / P0-6] Start the materialized-view refresh scheduler
        // AFTER DB is ready. Lazy-require so test harness can shim it out
        // by setting MV_REFRESH_ENABLED=false in the env before requiring
        // server.js.
        try {
            require('./services/mvRefreshService').start();
        } catch (e) {
            logger.error('MV refresh scheduler failed to start:', e);
        }

        // [Sprint 9 / FIX-007] Start UK outbox drain worker. Dormant when
        // UK_USE_WEBHOOK_SENDER is unset/false (no interval started).
        try {
            require('./services/uk/ukOutboxService').start();
        } catch (e) {
            logger.error('UK outbox drain worker failed to start:', e);
        }

        // [Sprint 10 PR-2] Start alert verification drain worker. Dormant
        // when ALERT_VERIFICATION_ENABLED is unset/false (no interval).
        // Wakes up scheduled post-resolve verifications enqueued by
        // alertService.resolveAlert (system path, PR-3 wiring).
        try {
            require('./services/alertVerificationService').start();
        } catch (e) {
            logger.error('Alert verification drain worker failed to start:', e);
        }
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
    try { await require('./services/mvRefreshService').stop(); } catch (e) { logger.error('MV scheduler stop error:', e.message); }
    try { await require('./services/uk/ukOutboxService').stop(); } catch (e) { logger.error('UK outbox stop error:', e.message); }
    try { await require('./services/alertVerificationService').stop(); } catch (e) { logger.error('Alert verification stop error:', e.message); }

    // [Sprint 4] Close Redis after all consumers (rate-limiter / cache /
    // dedup) have stopped issuing commands.
    try {
        const redisClient = require('./utils/redisClient');
        await redisClient.close();
        logger.info('Redis connection closed');
    } catch (e) {
        logger.error('Redis close error:', e.message);
    }

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

process.on('unhandledRejection', (reason, _promise) => {
    logger.error('Необработанное отклонение обещания:', reason);
    gracefulShutdown('unhandledRejection');
});

module.exports = app; // Для тестирования