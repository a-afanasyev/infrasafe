# 🛠️ ПЛАН ИСПРАВЛЕНИЯ КРИТИЧЕСКИХ УЯЗВИМОСТЕЙ

**Дата:** 2025-01-25  
**Проект:** InfraSafe Frontend Security Fixes

---

## 🚨 КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ

### 1. Убрать 'unsafe-inline' из CSP

**Файл:** `index.html`

**Действия:**
1. Генерировать nonce на сервере для каждого запроса
2. Добавить nonce к inline скриптам
3. Обновить CSP header
4. Вынести все inline стили в отдельные файлы

**Пример:**
```html
<!-- На сервере генерировать: -->
<meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'nonce-{NONCE}' https://cdn.jsdelivr.net;
    style-src 'self' https://fonts.googleapis.com;
    ...
">

<!-- Для inline скриптов: -->
<script nonce="{NONCE}">
    window.BACKEND_URL = "http://localhost:3000/api";
</script>
```

---

### 2. Добавить Rate Limiting на клиенте

**Файл:** `public/utils/rateLimiter.js` (новый файл)

**Создать новый файл:**
```javascript
/**
 * Rate Limiter для защиты от DoS атак
 * Ограничивает количество запросов в единицу времени
 */
class RateLimiter {
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
}

// Глобальный экземпляр для API запросов
window.apiRateLimiter = new RateLimiter(10, 60000); // 10 запросов в минуту

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RateLimiter;
}
```

**Обновить `public/script.js`:**
```javascript
// В классе APIClient добавить проверку rate limiter
async fetch(url, options = {}) {
    // Проверяем rate limiter
    if (window.apiRateLimiter && !window.apiRateLimiter.canMakeRequest()) {
        const remaining = window.apiRateLimiter.getRemainingRequests();
        throw new Error(`Превышен лимит запросов. Попробуйте через ${Math.ceil(remaining / 60)} секунд.`);
    }
    
    // ... остальной код
}
```

---

### 3. Защита от больших JSON payloads

**Файл:** `public/utils/safeJsonParser.js` (новый файл)

**Создать новый файл:**
```javascript
/**
 * Безопасный парсер JSON с защитой от больших payloads
 */
class SafeJsonParser {
    constructor(maxSize = 1024 * 1024) { // 1MB по умолчанию
        this.maxSize = maxSize;
    }
    
    /**
     * Безопасно парсит JSON из Response
     * @param {Response} response - Fetch Response объект
     * @returns {Promise<Object>} Парсированный JSON
     * @throws {Error} Если размер превышает лимит или JSON невалиден
     */
    async parseResponse(response) {
        // Проверяем заголовок Content-Length
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > this.maxSize) {
            throw new Error(`Ответ слишком большой: ${contentLength} байт. Максимум: ${this.maxSize} байт`);
        }
        
        // Получаем текст
        const text = await response.text();
        
        // Проверяем размер текста
        if (text.length > this.maxSize) {
            throw new Error(`Ответ слишком большой: ${text.length} байт. Максимум: ${this.maxSize} байт`);
        }
        
        // Парсим JSON с обработкой ошибок
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`Ошибка парсинга JSON: ${error.message}`);
        }
    }
    
    /**
     * Безопасно парсит JSON строку
     * @param {string} jsonString - JSON строка
     * @returns {Object} Парсированный объект
     * @throws {Error} Если размер превышает лимит или JSON невалиден
     */
    parseString(jsonString) {
        if (jsonString.length > this.maxSize) {
            throw new Error(`JSON слишком большой: ${jsonString.length} байт. Максимум: ${this.maxSize} байт`);
        }
        
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error(`Ошибка парсинга JSON: ${error.message}`);
        }
    }
}

// Глобальный экземпляр
window.safeJsonParser = new SafeJsonParser(1024 * 1024); // 1MB

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SafeJsonParser;
}
```

**Обновить использование:**
```javascript
// Вместо:
const data = await response.json();

// Использовать:
const data = await window.safeJsonParser.parseResponse(response);
```

---

### 4. Исправить перехват fetch

**Файл:** `public/admin-auth.js`

**Исправление:**
```javascript
setupAuthHeaders() {
    // Проверяем что fetch еще не перехвачен
    if (this.fetchIntercepted) {
        console.warn('Fetch уже перехвачен, пропускаем');
        return;
    }
    
    // Сохраняем оригинальный fetch
    if (!window._originalFetch) {
        window._originalFetch = window.fetch;
    }
    
    const originalFetch = window._originalFetch;
    const self = this;
    
    // Перехватываем fetch
    window.fetch = function(url, options = {}) {
        // Инициализируем headers если их нет
        if (!options.headers) {
            options.headers = {};
        }
        
        // Добавляем авторизацию только для API запросов
        const isApiRequest = url.startsWith('/api/') || 
                           url.includes('/api/') ||
                           url.startsWith('http://localhost:3000/api/') ||
                           url.startsWith('http://localhost:8080/api/');
        
        if (self.token && isApiRequest) {
            options.headers['Authorization'] = `Bearer ${self.token}`;
        }
        
        // Перенаправляем запросы с 8080 на 3000 для API
        if (url.startsWith('http://localhost:8080/api/')) {
            url = url.replace('http://localhost:8080/api/', 'http://localhost:3000/api/');
        } else if (url.startsWith('/api/')) {
            url = 'http://localhost:3000' + url;
        }
        
        // Выполняем запрос
        return originalFetch.call(this, url, options).then(response => {
            // Обрабатываем 401 ошибки
            if (response.status === 401) {
                self.logout();
            }
            return response;
        });
    };
    
    this.fetchIntercepted = true;
    console.log('✅ Fetch перехвачен для авторизации');
}
```

---

### 5. Убрать небезопасный fallback в infrastructure-line-editor.js

**Файл:** `public/infrastructure-line-editor.js`

**Исправление:**
```javascript
show() {
    // Проверяем наличие DOMPurify
    if (typeof DOMPurify === 'undefined') {
        console.error('❌ DOMPurify не загружен! Безопасность не гарантирована.');
        
        // Показываем ошибку пользователю
        if (typeof showToast === 'function') {
            showToast('Ошибка загрузки системы безопасности. Перезагрузите страницу.', 'error');
        } else {
            alert('Ошибка загрузки системы безопасности. Перезагрузите страницу.');
        }
        
        return; // НЕ продолжаем выполнение без DOMPurify
    }
    
    // Удаляем существующие модальные окна
    const existingModals = document.querySelectorAll('#infrastructure-line-editor-modal');
    existingModals.forEach(modal => modal.remove());
    
    // Создаем modal HTML
    const modalHTML = this.createModalHTML();
    const modalContainer = document.createElement('div');
    modalContainer.id = 'infrastructure-line-editor-modal';
    
    // Используем ТОЛЬКО DOMPurify, без fallback
    modalContainer.innerHTML = DOMPurify.sanitize(modalHTML, {
        ALLOWED_TAGS: ['div', 'span', 'h3', 'button', 'form', 'input', 'textarea', 'select', 'option', 'label', 'strong', 'p'],
        ALLOWED_ATTR: ['class', 'id', 'type', 'value', 'placeholder', 'required', 'rows', 'min', 'max', 'step', 'style'],
        ALLOW_DATA_ATTR: false
    });
    
    document.body.appendChild(modalContainer);
    
    // Инициализируем обработчики
    setTimeout(() => {
        this.attachEventHandlers();
        this.initializeMap();
        this.renderExistingLine();
    }, 100);
}
```

---

### 6. Добавить CSRF защиту

**Файл:** `index.html` (добавить мета-тег)

**На сервере добавить:**
```javascript
// Генерировать CSRF токен на каждую сессию
app.use((req, res, next) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    next();
});
```

**В HTML шаблоне:**
```html
<!-- Добавить в <head> -->
<meta name="csrf-token" content="{{csrfToken}}">
```

**Создать утилиту:** `public/utils/csrf.js`
```javascript
/**
 * Утилиты для работы с CSRF токенами
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
     * Добавляет CSRF токен в заголовки запроса
     * @param {Object} options - Опции для fetch
     * @returns {Object} Обновленные опции
     */
    addToHeaders(options = {}) {
        if (!this.token) {
            console.warn('CSRF токен не найден');
            return options;
        }
        
        if (!options.headers) {
            options.headers = {};
        }
        
        options.headers['X-CSRF-Token'] = this.token;
        options.headers['X-Requested-With'] = 'XMLHttpRequest';
        
        return options;
    }
}

// Глобальный экземпляр
window.csrfProtection = new CSRFProtection();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSRFProtection;
}
```

**Обновить APIClient:**
```javascript
async fetch(url, options = {}) {
    // ... существующий код ...
    
    // Добавляем CSRF защиту для изменяющих запросов
    const isModifyingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase());
    if (isModifyingRequest && window.csrfProtection) {
        options = window.csrfProtection.addToHeaders(options);
    }
    
    // ... остальной код ...
}
```

---

## 📋 ЧЕКЛИСТ ИСПРАВЛЕНИЙ

- [ ] 1. Убрать 'unsafe-inline' из CSP
- [ ] 2. Создать `public/utils/rateLimiter.js`
- [ ] 3. Интегрировать rate limiter в APIClient
- [ ] 4. Создать `public/utils/safeJsonParser.js`
- [ ] 5. Заменить все `response.json()` на `safeJsonParser.parseResponse()`
- [ ] 6. Исправить перехват fetch в `admin-auth.js`
- [ ] 7. Убрать fallback в `infrastructure-line-editor.js`
- [ ] 8. Добавить CSRF токен на сервере
- [ ] 9. Создать `public/utils/csrf.js`
- [ ] 10. Интегрировать CSRF в APIClient
- [ ] 11. Подключить новые утилиты в `index.html`
- [ ] 12. Протестировать все исправления

---

## 🧪 ТЕСТИРОВАНИЕ

После внесения исправлений проверить:

1. ✅ Страница загружается с новым CSP
2. ✅ Rate limiting работает (попробовать отправить >10 запросов)
3. ✅ Большие JSON отклоняются
4. ✅ Fetch перехватывается корректно
5. ✅ DOMPurify обязателен для редактора линий
6. ✅ CSRF токены добавляются в запросы

---

**Составлено:** AI Security Auditor  
**Дата:** 2025-01-25

