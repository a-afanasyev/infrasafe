const logger = require('./logger');

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 минута
        this.monitoringInterval = options.monitoringInterval || 10000; // 10 секунд
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = Date.now();
        this.name = options.name || 'Circuit Breaker';
        
        // Статистика
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            circuitOpened: 0,
            circuitClosed: 0,
            lastStateChange: Date.now()
        };
        
        // Запускаем мониторинг
        this.startMonitoring();
    }
    
    async execute(operation, fallback = null) {
        this.stats.totalRequests++;
        
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                logger.warn(`${this.name}: Circuit is OPEN, using fallback`);
                
                if (fallback && typeof fallback === 'function') {
                    try {
                        return await fallback();
                    } catch (fallbackError) {
                        logger.error(`${this.name}: Fallback failed:`, fallbackError.message);
                        throw new Error('Сервис временно недоступен');
                    }
                }
                
                throw new Error('Сервис временно недоступен');
            } else {
                // Переходим в полуоткрытое состояние
                this.state = 'HALF_OPEN';
                this.successCount = 0;
                logger.info(`${this.name}: Переход в состояние HALF_OPEN`);
            }
        }
        
        try {
            const startTime = Date.now();
            const result = await operation();
            const duration = Date.now() - startTime;
            
            this.onSuccess(duration);
            return result;
        } catch (error) {
            this.onFailure(error);
            
            // Если есть fallback и circuit открыт, используем его
            if ((this.state === 'OPEN' || this.state === 'HALF_OPEN') && fallback && typeof fallback === 'function') {
                try {
                    logger.info(`${this.name}: Using fallback after failure`);
                    return await fallback();
                } catch (fallbackError) {
                    logger.error(`${this.name}: Fallback failed:`, fallbackError.message);
                }
            }
            
            throw error;
        }
    }
    
    onSuccess(duration) {
        this.failureCount = 0;
        this.successCount++;
        this.stats.successfulRequests++;
        
        if (this.state === 'HALF_OPEN') {
            // В полуоткрытом состоянии требуется несколько успешных запросов
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
                this.stats.circuitClosed++;
                this.stats.lastStateChange = Date.now();
                logger.info(`${this.name}: Circuit CLOSED после ${this.successCount} успешных запросов`);
            }
        } else if (this.state === 'OPEN') {
            // Если был открыт, сразу закрываем при успешном запросе
            this.state = 'CLOSED';
            this.stats.circuitClosed++;
            this.stats.lastStateChange = Date.now();
            logger.info(`${this.name}: Circuit CLOSED после успешного запроса`);
        }
        
        logger.debug(`${this.name}: Успешный запрос за ${duration}ms, state: ${this.state}`);
    }
    
    onFailure(error) {
        this.failureCount++;
        this.stats.failedRequests++;
        this.lastFailureTime = Date.now();
        
        logger.warn(`${this.name}: Failure #${this.failureCount}: ${error.message}`);
        
        if (this.state === 'HALF_OPEN') {
            // В полуоткрытом состоянии любая ошибка открывает circuit
            this.openCircuit();
        } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.openCircuit();
        }
    }
    
    openCircuit() {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.resetTimeout;
        this.stats.circuitOpened++;
        this.stats.lastStateChange = Date.now();
        
        logger.error(`${this.name}: Circuit OPENED после ${this.failureCount} неудач. Следующая попытка через ${this.resetTimeout}ms`);
    }
    
    // Принудительный сброс circuit breaker
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = Date.now();
        this.stats.lastStateChange = Date.now();
        
        logger.info(`${this.name}: Принудительный сброс состояния`);
    }
    
    // Получение текущего состояния
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            nextAttempt: this.nextAttempt,
            timeUntilRetry: Math.max(0, this.nextAttempt - Date.now()),
            stats: { ...this.stats }
        };
    }
    
    // Проверка доступности
    isAvailable() {
        if (this.state === 'CLOSED') return true;
        if (this.state === 'HALF_OPEN') return true;
        if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) return true;
        return false;
    }
    
    // Мониторинг состояния
    startMonitoring() {
        setInterval(() => {
            const state = this.getState();
            
            // Логируем состояние только при изменениях или проблемах
            if (state.state !== 'CLOSED' || state.failureCount > 0) {
                logger.info(`${this.name} status:`, {
                    state: state.state,
                    failures: state.failureCount,
                    successes: state.successCount,
                    timeUntilRetry: state.timeUntilRetry,
                    totalRequests: state.stats.totalRequests,
                    successRate: state.stats.totalRequests > 0 ? 
                        (state.stats.successfulRequests / state.stats.totalRequests * 100).toFixed(2) + '%' : '0%'
                });
            }
        }, this.monitoringInterval);
    }
    
    // Установка нового порога отказов
    setFailureThreshold(threshold) {
        this.failureThreshold = threshold;
        logger.info(`${this.name}: Новый порог отказов: ${threshold}`);
    }
    
    // Установка нового timeout для сброса
    setResetTimeout(timeout) {
        this.resetTimeout = timeout;
        logger.info(`${this.name}: Новый timeout для сброса: ${timeout}ms`);
    }
}

// Фабрика для создания circuit breaker с предустановленными настройками
class CircuitBreakerFactory {
    static createAnalyticsBreaker(name = 'Analytics') {
        return new CircuitBreaker({
            name: name,
            failureThreshold: 3,
            resetTimeout: 30000, // 30 секунд
            monitoringInterval: 15000 // 15 секунд
        });
    }
    
    static createDatabaseBreaker(name = 'Database') {
        return new CircuitBreaker({
            name: name,
            failureThreshold: 5,
            resetTimeout: 60000, // 1 минута
            monitoringInterval: 20000 // 20 секунд
        });
    }
    
    static createExternalServiceBreaker(name = 'External Service') {
        return new CircuitBreaker({
            name: name,
            failureThreshold: 2,
            resetTimeout: 120000, // 2 минуты
            monitoringInterval: 30000 // 30 секунд
        });
    }
}

module.exports = {
    CircuitBreaker,
    CircuitBreakerFactory
}; 