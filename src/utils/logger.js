const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');
const { redactLogInfo } = require('./logRedaction');
const envFlags = require('./envFlags');
const { buildConsoleFormat } = require('./loggerConsoleFormat');

// [M-17] Вычищаем секреты из метаданных ПЕРЕД сериализацией. Ставится после
// errors({stack:true}) — стек к этому моменту уже развёрнут — и перед json().
const redactFormat = winston.format((info) => redactLogInfo(info));

// Определение форматов логирования
const formats = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    redactFormat(),
    winston.format.json()
);

const logsDir = path.join(__dirname, '../../logs');

// [R2-37] 12-factor: the container's stdout is already captured by docker's
// json-log (and can be shipped to an aggregator). The two DailyRotateFile
// transports below are then redundant double-storage inside a named volume. Set
// LOG_CONSOLE_ONLY=true (or 1) to emit to stdout only. Default (unset/anything
// else) keeps the console + 2 rotating files, so existing single-host prod
// behaviour is unchanged.
// [A-18] Через общий парсер булевых флагов — здесь был шестой самодельный.
const consoleOnly = envFlags.isEnabled('LOG_CONSOLE_ONLY');

// Запись в консоль
const transports = [
    // [A-19] Формат живёт в отдельном модуле и проверяется напрямую — см.
    // loggerConsoleFormat.js. Прежде транспорт печатал только
    // `timestamp level: message`, и при LOG_CONSOLE_ONLY=true метаданные
    // исчезали совсем: файловых транспортов в этом режиме нет.
    new winston.transports.Console({ format: buildConsoleFormat(consoleOnly) })
];

if (!consoleOnly) {
    transports.push(
        // Запись всех логов в файл с ротацией
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
        }),
        // Запись только ошибок в отдельный файл с ротацией
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d'
        })
    );
}

// Создание логгера
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: formats,
    defaultMeta: { service: 'infrasafe-api' },
    transports
});

module.exports = logger;
