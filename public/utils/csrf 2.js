/**
 * Утилиты для работы с CSRF токенами
 * 
 * Защищает от Cross-Site Request Forgery (CSRF) атак
 * 
 * Использование:
 *   const options = window.csrfProtection.addToHeaders(options);
 *   fetch(url, options);
 */

class CSRFProtection {
    constructor() {
        this.token = this.getToken();
    }
    
    /**
     * Получает CSRF токен из мета-тега
     * @returns {string|null}
     */
    getToken() {
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        return metaTag ? metaTag.content : null;
    }
    
    /**
     * Обновляет CSRF токен (например, после успешного запроса)
     * @param {string} newToken - Новый токен
     */
    updateToken(newToken) {
        this.token = newToken;
        
        // Обновляем мета-тег если он существует
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
            metaTag.content = newToken;
        }
    }
    
    /**
     * Добавляет CSRF токен в заголовки запроса
     * @param {Object} options - Опции для fetch
     * @returns {Object} Обновленные опции
     */
    addToHeaders(options = {}) {
        if (!this.token) {
            // Токен не найден - это не критично для чтения, но важно для записи
            console.warn('CSRF токен не найден. Убедитесь что мета-тег <meta name="csrf-token"> присутствует в HTML');
            return options;
        }
        
        // Инициализируем headers если их нет
        if (!options.headers) {
            options.headers = {};
        }
        
        // Добавляем CSRF токен и заголовок для идентификации AJAX запросов
        options.headers['X-CSRF-Token'] = this.token;
        options.headers['X-Requested-With'] = 'XMLHttpRequest';
        
        return options;
    }
    
    /**
     * Проверяет требуется ли CSRF защита для данного метода
     * @param {string} method - HTTP метод
     * @returns {boolean}
     */
    isModifyingMethod(method) {
        const modifyingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
        return modifyingMethods.includes(method.toUpperCase());
    }
    
    /**
     * Добавляет CSRF защиту только для изменяющих запросов
     * @param {string} method - HTTP метод
     * @param {Object} options - Опции для fetch
     * @returns {Object} Обновленные опции
     */
    addToModifyingRequest(method, options = {}) {
        if (this.isModifyingMethod(method)) {
            return this.addToHeaders(options);
        }
        return options;
    }
}

// Глобальный экземпляр
window.csrfProtection = new CSRFProtection();

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSRFProtection;
}

console.log('✅ CSRF Protection утилита загружена успешно');

