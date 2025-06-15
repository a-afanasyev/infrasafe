const winston = require('winston');
const path = require('path');

// Определение форматов логирования
const formats = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Создание логгера
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: formats,
    defaultMeta: { service: 'infrasafe-api' },
    transports: [
        // Запись в консоль
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(
                    info => `${info.timestamp} ${info.level}: ${info.message}`
                )
            )
        }),
        // Запись всех логов в файл
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/combined.log')
        }),
        // Запись только ошибок в отдельный файл
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error'
        })
    ]
});

// Если не production, добавим дополнительное форматирование для консоли
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;