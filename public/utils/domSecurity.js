/**
 * Утилиты для безопасной работы с DOM и предотвращения XSS атак
 * Используется DOMPurify для санитизации HTML
 */

// Импорт DOMPurify (работает в браузере)
// DOMPurify будет доступен глобально через CDN или подключение script

/**
 * Безопасное отображение текста (замена innerHTML для простого текста)
 * @param {HTMLElement} element - DOM элемент
 * @param {string} text - Текст для отображения
 */
function setSecureText(element, text) {
    if (!element || text === null || text === undefined) {
        return;
    }
    element.textContent = String(text);
}

/**
 * Безопасное отображение HTML с санитизацией
 * @param {HTMLElement} element - DOM элемент  
 * @param {string} html - HTML для отображения
 * @param {Object} options - Опции для DOMPurify
 */
function setSecureHTML(element, html, options = {}) {
    if (!element || html === null || html === undefined) {
        return;
    }
    
    // Проверяем наличие DOMPurify
    if (typeof DOMPurify === 'undefined') {
        console.error('DOMPurify не загружен! Используется небезопасный fallback.');
        element.textContent = String(html); // Fallback - только текст
        return;
    }
    
    // Конфигурация по умолчанию для DOMPurify
    const defaultConfig = {
        ALLOWED_TAGS: ['div', 'span', 'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th'],
        ALLOWED_ATTR: ['class', 'id', 'style'],
        ALLOW_DATA_ATTR: false
    };
    
    const config = { ...defaultConfig, ...options };
    const cleanHTML = DOMPurify.sanitize(String(html), config);
    element.innerHTML = cleanHTML;
}

/**
 * Безопасное отображение сообщения об ошибке
 * @param {HTMLElement} container - Контейнер для ошибки
 * @param {string} message - Сообщение об ошибке
 * @param {string} className - CSS класс для стилизации (по умолчанию 'error-message')
 */
function showSecureErrorMessage(container, message, className = 'error-message') {
    if (!container) return;
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Создаем безопасный элемент для ошибки
    const errorDiv = document.createElement('div');
    errorDiv.className = className;
    setSecureText(errorDiv, message);
    
    container.appendChild(errorDiv);
}

/**
 * Безопасное отображение сообщения об успехе
 * @param {HTMLElement} container - Контейнер для сообщения
 * @param {string} message - Сообщение об успехе  
 * @param {string} className - CSS класс для стилизации (по умолчанию 'success-message')
 */
function showSecureSuccessMessage(container, message, className = 'success-message') {
    if (!container) return;
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Создаем безопасный элемент для успеха
    const successDiv = document.createElement('div');
    successDiv.className = className;
    setSecureText(successDiv, message);
    
    container.appendChild(successDiv);
}

/**
 * Безопасная очистка контейнера
 * @param {HTMLElement} container - Контейнер для очистки
 */
function clearContainer(container) {
    if (!container) return;
    container.innerHTML = '';
}

/**
 * Создание безопасной строки таблицы с данными
 * @param {Object} data - Данные для строки
 * @param {Array} fields - Поля для отображения в формате [{key: 'name', secure: true}, ...]
 * @param {string} additionalCells - Дополнительные ячейки (уже безопасный HTML)
 * @returns {HTMLTableRowElement} - Безопасная строка таблицы
 */
function createSecureTableRow(data, fields, additionalCells = '') {
    const row = document.createElement('tr');
    
    // Добавляем ячейки с данными
    fields.forEach(field => {
        const cell = document.createElement('td');
        const value = data[field.key];
        
        if (field.secure === false) {
            // Для заведомо безопасных данных (например, ID, числа)
            cell.innerHTML = value || '';
        } else {
            // Для всех остальных данных используем безопасное отображение
            setSecureText(cell, value || '');
        }
        
        row.appendChild(cell);
    });
    
    // Добавляем дополнительные ячейки (например, кнопки)
    if (additionalCells) {
        const tempDiv = document.createElement('div');
        setSecureHTML(tempDiv, additionalCells);
        while (tempDiv.firstChild) {
            row.appendChild(tempDiv.firstChild);
        }
    }
    
    return row;
}

/**
 * Экранирование HTML символов для безопасного отображения
 * @param {string} text - Текст для экранирования
 * @returns {string} - Экранированный текст
 */
function escapeHTML(text) {
    if (text === null || text === undefined) return '';
    
    const div = document.createElement('div');
    setSecureText(div, text);
    return div.innerHTML;
}

// Экспорт функций для использования в других модулях
window.DOMSecurity = {
    setSecureText,
    setSecureHTML,
    showSecureErrorMessage,
    showSecureSuccessMessage,
    clearContainer,
    createSecureTableRow,
    escapeHTML
};

console.log('✅ DOMSecurity утилиты загружены успешно');

