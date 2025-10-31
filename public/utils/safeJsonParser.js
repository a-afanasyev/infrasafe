/**
 * Безопасный парсер JSON с защитой от больших payloads
 * 
 * Защищает от:
 * - Очень больших JSON ответов (DoS через исчерпание памяти)
 * - Невалидного JSON (краш приложения)
 * 
 * Использование:
 *   const parser = new SafeJsonParser(1024 * 1024); // 1MB лимит
 *   const data = await parser.parseResponse(response);
 */

class SafeJsonParser {
    /**
     * Конструктор безопасного парсера JSON
     * @param {number} maxSize - Максимальный размер в байтах (по умолчанию 1MB)
     */
    constructor(maxSize = 1024 * 1024) {
        this.maxSize = maxSize;
    }
    
    /**
     * Безопасно парсит JSON из Response
     * @param {Response} response - Fetch Response объект
     * @returns {Promise<Object>} Парсированный JSON
     * @throws {Error} Если размер превышает лимит или JSON невалиден
     */
    async parseResponse(response) {
        // Проверяем заголовок Content-Length если доступен
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            const length = parseInt(contentLength, 10);
            if (!isNaN(length) && length > this.maxSize) {
                throw new Error(
                    `Ответ слишком большой: ${this.formatBytes(length)}. ` +
                    `Максимум разрешено: ${this.formatBytes(this.maxSize)}`
                );
            }
        }
        
        // Получаем текст ответа
        const text = await response.text();
        
        // Проверяем размер текста
        if (text.length > this.maxSize) {
            throw new Error(
                `Ответ слишком большой: ${this.formatBytes(text.length)}. ` +
                `Максимум разрешено: ${this.formatBytes(this.maxSize)}`
            );
        }
        
        // Парсим JSON с обработкой ошибок
        try {
            return JSON.parse(text);
        } catch (error) {
            // Не раскрываем детали ошибки для безопасности
            throw new Error('Ошибка парсинга JSON ответа от сервера');
        }
    }
    
    /**
     * Безопасно парсит JSON строку
     * @param {string} jsonString - JSON строка
     * @returns {Object} Парсированный объект
     * @throws {Error} Если размер превышает лимит или JSON невалиден
     */
    parseString(jsonString) {
        if (!jsonString || typeof jsonString !== 'string') {
            throw new Error('Ожидается строка для парсинга');
        }
        
        if (jsonString.length > this.maxSize) {
            throw new Error(
                `JSON слишком большой: ${this.formatBytes(jsonString.length)}. ` +
                `Максимум разрешено: ${this.formatBytes(this.maxSize)}`
            );
        }
        
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error('Ошибка парсинга JSON строки');
        }
    }
    
    /**
     * Форматирует байты в читаемый формат
     * @param {number} bytes - Количество байт
     * @returns {string} Отформатированная строка
     * @private
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

// Глобальный экземпляр с лимитом 1MB
window.safeJsonParser = new SafeJsonParser(1024 * 1024);

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SafeJsonParser;
}

console.log('✅ SafeJsonParser утилита загружена успешно');

