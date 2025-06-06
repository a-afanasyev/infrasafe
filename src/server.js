require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const apiRoutes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const db = require('./config/database');

// Создаем экземпляр приложения Express
const app = express();

// Настройка порта
const PORT = process.env.PORT || 3000;

// Middleware
// Настройка helmet с более мягким CSP для Swagger UI
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
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
app.use(cors()); // CORS
app.use(express.json()); // Парсинг JSON
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } })); // Логирование HTTP запросов

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// Swagger документация
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
        security: [], // По умолчанию авторизация не требуется для GET запросов
    },
    apis: ['./src/routes/*.js'], // Пути к файлам с JSDoc комментариями
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
db.init()
    .then(() => {
        app.listen(PORT, () => {
            logger.info(`Сервер запущен на порту ${PORT}`);
            logger.info(`Документация API доступна по адресу http://localhost:${PORT}/api-docs`);
        });
    })
    .catch(err => {
        logger.error('Ошибка инициализации базы данных:', err);
        process.exit(1);
    });

// Обработка необработанных исключений и обещаний
process.on('uncaughtException', (err) => {
    logger.error('Необработанное исключение:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Необработанное отклонение обещания:', reason);
});

module.exports = app; // Для тестирования 