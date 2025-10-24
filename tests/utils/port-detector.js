const http = require('http');

// Конфигурация
const CONFIG = {
    DEFAULT_PORT: 3000,
    ALTERNATIVE_PORT: 8080,
    TIMEOUT: 3000,
    HEALTH_ENDPOINT: '/api/health'
};

// Функция для проверки доступности порта
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}${CONFIG.HEALTH_ENDPOINT}`, (res) => {
            resolve(res.statusCode === 200);
        });
        
        req.on('error', () => {
            resolve(false);
        });
        
        req.setTimeout(CONFIG.TIMEOUT, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// Функция для определения рабочего порта
async function detectApiPort() {
    // Проверка порта по умолчанию
    if (await checkPort(CONFIG.DEFAULT_PORT)) {
        return CONFIG.DEFAULT_PORT;
    }
    
    // Проверка альтернативного порта
    if (await checkPort(CONFIG.ALTERNATIVE_PORT)) {
        return CONFIG.ALTERNATIVE_PORT;
    }
    
    // Fallback на порт по умолчанию
    return CONFIG.DEFAULT_PORT;
}

// Функция для настройки переменных окружения
async function setupApiEnvironment() {
    const detectedPort = await detectApiPort();
    
    process.env.API_PORT = detectedPort.toString();
    process.env.API_URL = `http://localhost:${detectedPort}`;
    
    return {
        port: detectedPort,
        url: process.env.API_URL
    };
}

// Функция для проверки доступности API
async function verifyApiAvailability(port) {
    return await checkPort(port);
}

// Функция для получения конфигурации
function getConfig() {
    return {
        ...CONFIG,
        currentPort: process.env.API_PORT || CONFIG.DEFAULT_PORT,
        currentUrl: process.env.API_URL || `http://localhost:${CONFIG.DEFAULT_PORT}`
    };
}

module.exports = {
    detectApiPort,
    setupApiEnvironment,
    checkPort,
    verifyApiAvailability,
    getConfig
}; 