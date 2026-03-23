/**
 * Rate Limiter для защиты от DoS атак
 * Ограничивает количество запросов в единицу времени
 * 
 * Использование:
 *   const limiter = new RateLimiter(10, 60000); // 10 запросов в минуту
 *   if (limiter.canMakeRequest()) {
 *       // выполнить запрос
 *   }
 */

class RateLimiter {
    /**
     * Конструктор rate limiter
     * @param {number} maxRequests - Максимальное количество запросов
     * @param {number} windowMs - Временное окно в миллисекундах
     */
    constructor(maxRequests = 10, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }
    
    /**
     * Проверяет можно ли сделать запрос
     * @returns {boolean} true если можно, false если лимит превышен
     */
    canMakeRequest() {
        const now = Date.now();
        
        // Удаляем старые запросы вне окна
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        // Проверяем лимит
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        
        // Добавляем текущий запрос
        this.requests.push(now);
        return true;
    }
    
    /**
     * Сбрасывает счетчик запросов
     */
    reset() {
        this.requests = [];
    }
    
    /**
     * Возвращает количество оставшихся запросов
     * @returns {number}
     */
    getRemainingRequests() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        return Math.max(0, this.maxRequests - this.requests.length);
    }
    
    /**
     * Возвращает время до следующего доступного запроса в секундах
     * @returns {number} Время в секундах или 0 если можно сделать запрос сразу
     */
    getTimeUntilNextRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        if (this.requests.length < this.maxRequests) {
            return 0;
        }
        
        // Находим самый старый запрос в окне
        const oldestRequest = Math.min(...this.requests);
        const timeUntilOldestExpires = this.windowMs - (now - oldestRequest);
        
        return Math.ceil(timeUntilOldestExpires / 1000);
    }
}

// Глобальный экземпляр для API запросов
// 10 запросов в минуту - достаточно для большинства случаев
window.apiRateLimiter = new RateLimiter(10, 60000);

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RateLimiter;
}



