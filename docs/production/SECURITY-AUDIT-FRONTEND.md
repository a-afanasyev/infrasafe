# 🔒 АУДИТ БЕЗОПАСНОСТИ ФРОНТЕНДА

**Дата:** 2025-01-25  
**Проект:** InfraSafe  
**Фокус:** Дефейс и обрушение сайта (XSS, DoS)

---

## 📋 РЕЗЮМЕ

Проведен комплексный анализ фронтенда на уязвимости, связанные с дефейсом (XSS атаки) и обрушением сайта (DoS атаки). Обнаружено **6 критических**, **8 высоких** и **5 средних** уязвимостей.

---

## 🚨 КРИТИЧЕСКИЕ УЯЗВИМОСТИ

### 1. CSP разрешает 'unsafe-inline' - снижает защиту от XSS

**Файл:** `index.html:12-22`

**Проблема:**
```html
<meta http-equiv="Content-Security-Policy" content="
    script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
">
```

**Риск:** `unsafe-inline` позволяет выполнение inline скриптов, что снижает эффективность CSP против XSS атак.

**Рекомендация:**
- Использовать nonce-based CSP для скриптов
- Вынести все inline стили в отдельные файлы
- Использовать строгий CSP без `unsafe-inline`

**Пример исправления:**
```html
<meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'nonce-{SERVER_GENERATED_NONCE}' https://cdn.jsdelivr.net;
    style-src 'self' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: https:;
    connect-src 'self' http://localhost:3000 https://*;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
">
```

---

### 2. Отсутствие rate limiting на клиенте - DoS уязвимость

**Файлы:** `public/script.js`, `public/map-layers-control.js`, `public/admin.js`

**Проблема:**
- Множественные `setInterval` без ограничений частоты запросов
- Нет защиты от спама запросов при быстрых действиях пользователя
- Отсутствие debounce/throttle для API запросов

**Примеры проблемных мест:**

```javascript
// script.js:1807 - Обновление каждые N секунд без rate limiting
updateTimer = setInterval(loadData, updateInterval * 1000);

// map-layers-control.js:958 - Метрики каждые 30 секунд
this.metricsInterval = setInterval(() => {
    this.updateRealTimeMetrics();
}, 30000);
```

**Риск:** Злоумышленник может создать скрипт, который отправляет множество запросов, перегружая сервер и клиент.

**Рекомендация:**
- Добавить rate limiting на клиенте
- Использовать debounce/throttle для пользовательских действий
- Ограничить количество одновременных запросов

**Пример исправления:**
```javascript
class RateLimiter {
    constructor(maxRequests = 10, windowMs = 60000) {
        this.requests = [];
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }
    
    canMakeRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        
        this.requests.push(now);
        return true;
    }
}

const apiRateLimiter = new RateLimiter(10, 60000); // 10 запросов в минуту

async function safeFetch(url, options) {
    if (!apiRateLimiter.canMakeRequest()) {
        throw new Error('Превышен лимит запросов. Попробуйте позже.');
    }
    return fetch(url, options);
}
```

---

### 3. Отсутствие защиты от больших JSON payloads - DoS уязвимость

**Файлы:** Все файлы, использующие `JSON.parse()` и `response.json()`

**Проблема:**
```javascript
// script.js:136 - Нет проверки размера перед парсингом
const errorJson = JSON.parse(errorText);

// admin.js:1451 - Нет проверки размера ответа
const responseData = await response.json();
```

**Риск:** Злоумышленник может отправить очень большой JSON ответ, который вызовет:
- Исчерпание памяти браузера
- Зависание страницы
- Краш браузера

**Рекомендация:**
- Проверять размер ответа перед парсингом
- Ограничить максимальный размер JSON (например, 1MB)
- Использовать streaming для больших данных

**Пример исправления:**
```javascript
async function safeJsonParse(response, maxSize = 1024 * 1024) {
    const contentLength = response.headers.get('content-length');
    
    if (contentLength && parseInt(contentLength) > maxSize) {
        throw new Error(`Ответ слишком большой: ${contentLength} байт`);
    }
    
    const text = await response.text();
    
    if (text.length > maxSize) {
        throw new Error(`Ответ слишком большой: ${text.length} байт`);
    }
    
    return JSON.parse(text);
}
```

---

### 4. Перехват fetch глобально - потенциальная уязвимость

**Файл:** `public/admin-auth.js:78-104`

**Проблема:**
```javascript
setupAuthHeaders() {
    const originalFetch = window.fetch;
    const self = this;
    window.fetch = (url, options = {}) => {
        // Перехватывает ВСЕ fetch запросы
        // ...
    };
}
```

**Риск:**
- Злоумышленник может переопределить `window.fetch` снова
- Нет защиты от повторного перехвата
- Может конфликтовать с другими библиотеками

**Рекомендация:**
- Использовать Proxy для безопасного перехвата
- Добавить проверку на повторную переустановку
- Использовать более безопасный подход

**Пример исправления:**
```javascript
setupAuthHeaders() {
    if (this.fetchIntercepted) {
        console.warn('Fetch уже перехвачен');
        return;
    }
    
    const originalFetch = window.fetch;
    const self = this;
    
    window.fetch = function(url, options = {}) {
        // Добавляем авторизацию только для API запросов
        if (self.token && (url.startsWith('/api/') || url.includes('/api/'))) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${self.token}`
            };
        }
        
        return originalFetch.call(this, url, options).then(response => {
            if (response.status === 401) {
                self.logout();
            }
            return response;
        });
    };
    
    this.fetchIntercepted = true;
}
```

---

### 5. Небезопасное использование innerHTML с пользовательскими данными

**Файл:** `public/infrastructure-line-editor.js:96-103`

**Проблема:**
```javascript
// Использует DOMPurify, но есть fallback без защиты
if (window.DOMPurify) {
    modalContainer.innerHTML = DOMPurify.sanitize(modalHTML);
} else {
    // Fallback: используем innerHTML с предупреждением
    const temp = document.createElement('div');
    temp.innerHTML = modalHTML; // Потенциально небезопасно без DOMPurify
    modalContainer.appendChild(temp.firstElementChild);
}
```

**Риск:** Если DOMPurify не загрузится, код использует небезопасный fallback.

**Рекомендация:**
- Убрать небезопасный fallback
- Использовать только DOM API для создания элементов
- Если DOMPurify не загружен - блокировать функциональность

**Пример исправления:**
```javascript
show() {
    if (typeof DOMPurify === 'undefined') {
        console.error('DOMPurify не загружен! Безопасность не гарантирована.');
        showToast('Ошибка загрузки системы безопасности. Перезагрузите страницу.', 'error');
        return;
    }
    
    const modalHTML = this.createModalHTML();
    const modalContainer = document.createElement('div');
    modalContainer.id = 'infrastructure-line-editor-modal';
    
    // Используем только DOMPurify, без fallback
    modalContainer.innerHTML = DOMPurify.sanitize(modalHTML);
    
    document.body.appendChild(modalContainer);
    // ...
}
```

---

### 6. Отсутствие CSRF защиты

**Файлы:** Все файлы, отправляющие POST/PUT/DELETE запросы

**Проблема:**
- Все запросы используют только Bearer токены
- Нет CSRF токенов в заголовках или формах
- Уязвимость для CSRF атак если токен хранится в localStorage

**Риск:** Злоумышленник может создать сайт, который от имени пользователя выполняет действия на InfraSafe.

**Рекомендация:**
- Добавить CSRF токены для всех изменяющих запросов
- Использовать SameSite cookies для токенов
- Добавить заголовок `X-Requested-With` для дополнительной защиты

**Пример исправления:**
```javascript
// Генерация CSRF токена на сервере и передача в страницу
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

async function safeFetch(url, options = {}) {
    options.headers = {
        ...options.headers,
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrfToken
    };
    
    return fetch(url, options);
}
```

---

## ⚠️ ВЫСОКИЕ УЯЗВИМОСТИ

### 7. JSON.parse без try-catch в некоторых местах

**Файлы:** `public/utils/domSecurity.js:216`, `public/infrastructure-line-editor.js:39,51`

**Проблема:**
```javascript
// domSecurity.js:216 - Есть try-catch, но может быть улучшено
const payload = JSON.parse(atob(parts[1]));

// infrastructure-line-editor.js:39 - Нет обработки ошибок
mainPath = JSON.parse(mainPath);
```

**Риск:** Некорректный JSON может вызвать краш приложения.

**Рекомендация:** Обернуть все `JSON.parse` в try-catch с понятными сообщениями об ошибках.

---

### 8. Неограниченное количество маркеров на карте - DoS

**Файл:** `public/map-layers-control.js`

**Проблема:**
- Нет ограничения на количество маркеров, загружаемых на карту
- Большое количество маркеров может замедлить или заморозить браузер

**Рекомендация:**
- Добавить кластеризацию маркеров (уже используется MarkerCluster)
- Ограничить количество маркеров на экране
- Использовать виртуализацию для больших списков

---

### 9. Отсутствие проверки валидности координат перед отправкой

**Файл:** `public/admin-coordinate-editor.js:288-304`

**Проблема:**
- Валидация есть, но нет проверки на NaN/Infinity
- Нет проверки на экстремальные значения

**Рекомендация:**
```javascript
validateCoordinates(lat, lng) {
    // Проверка на NaN и Infinity
    if (!isFinite(lat) || !isFinite(lng)) {
        return { valid: false, error: 'Координаты должны быть конечными числами' };
    }
    
    // Проверка диапазона
    if (lat < -90 || lat > 90) {
        return { valid: false, error: 'Широта должна быть в диапазоне [-90, 90]' };
    }
    
    if (lng < -180 || lng > 180) {
        return { valid: false, error: 'Долгота должна быть в диапазоне [-180, 180]' };
    }
    
    return { valid: true };
}
```

---

### 10. Отсутствие защиты от перебора паролей (brute force)

**Файл:** `public/admin-auth.js:40-68`

**Проблема:**
- Нет ограничения на количество попыток входа
- Нет задержки между неудачными попытками
- Нет капчи после нескольких попыток

**Рекомендация:**
- Добавить счетчик неудачных попыток
- Блокировать на время после N неудачных попыток
- Добавить капчу после 3-5 неудачных попыток

---

### 11. Отсутствие валидации размера загружаемых файлов

**Файлы:** Все файлы, работающие с файлами (если есть)

**Проблема:**
- Если есть загрузка файлов, нет проверки размера на клиенте
- Большие файлы могут вызвать зависание

**Рекомендация:**
- Проверять размер файла перед отправкой
- Ограничить максимальный размер (например, 10MB)

---

### 12. Утечка информации через error messages

**Файлы:** `public/script.js:132-144`, `public/admin-auth.js:60-61`

**Проблема:**
```javascript
// script.js:134 - Может выдать внутреннюю информацию
errorMessage = errorText.substring(0, 200);
```

**Риск:** Сообщения об ошибках могут раскрыть внутреннюю структуру приложения.

**Рекомендация:**
- Использовать общие сообщения для пользователей
- Логировать детали только в консоль разработчика
- Не показывать stack traces пользователям

---

### 13. Использование localStorage для токенов - XSS риск

**Файлы:** Все файлы, использующие `localStorage.getItem('admin_token')`

**Проблема:**
- Токены хранятся в localStorage
- При XSS атаке токены могут быть украдены

**Рекомендация:**
- Использовать httpOnly cookies для токенов (требует изменений на бэкенде)
- Или использовать sessionStorage вместо localStorage
- Реализовать автоматическую очистку токенов при закрытии вкладки

---

### 14. Отсутствие защиты от clickjacking

**Файл:** `index.html`

**Проблема:**
- CSP содержит `frame-ancestors 'none'` - это хорошо
- Но нет дополнительных заголовков X-Frame-Options

**Рекомендация:**
- Добавить заголовок `X-Frame-Options: DENY` на сервере
- CSP уже защищает, но дублирование не помешает

---

## 📊 СРЕДНИЕ УЯЗВИМОСТИ

### 15. Множественные setTimeout без очистки

**Файлы:** `public/script.js`, `public/map-layers-control.js`

**Проблема:**
- Множественные setTimeout без сохранения идентификаторов
- Нет очистки при размонтировании компонентов

**Рекомендация:**
- Сохранять все идентификаторы таймеров
- Очищать при размонтировании компонентов

---

### 16. Отсутствие проверки на null/undefined перед использованием DOM

**Файлы:** Множественные места

**Проблема:**
- Хотя есть проверки, не везде они последовательны

**Рекомендация:**
- Использовать единый подход к проверкам
- Использовать optional chaining где возможно

---

### 17. Отсутствие защиты от SSRF через URL параметры

**Файлы:** `public/script.js:114`

**Проблема:**
```javascript
const fullURL = url.startsWith('http') ? url : `${this.baseURL}${url}`;
```

**Риск:** Если URL приходит из пользовательского ввода, возможен SSRF.

**Рекомендация:**
- Валидировать все URL перед использованием
- Разрешать только определенные домены

---

### 18. Отсутствие защиты от timing attacks

**Файлы:** `public/admin-auth.js`

**Проблема:**
- Нет защиты от timing attacks при проверке паролей

**Рекомендация:**
- Использовать постоянное время для проверки
- Добавить задержку при неудачных попытках

---

### 19. Логирование чувствительных данных

**Файлы:** Множественные места

**Проблема:**
- В консоль могут логироваться токены, пароли и другие чувствительные данные

**Рекомендация:**
- Не логировать чувствительные данные
- Использовать режим разработки для детального логирования

---

## ✅ ПОЛОЖИТЕЛЬНЫЕ МОМЕНТЫ

1. ✅ Использование DOMPurify для санитизации HTML
2. ✅ Наличие утилит безопасности (`domSecurity.js`)
3. ✅ Использование `textContent` вместо `innerHTML` где возможно
4. ✅ Валидация JWT токенов перед использованием
5. ✅ CSP заголовки (хотя и с `unsafe-inline`)
6. ✅ Экранирование пользовательских данных в popup

---

## 🔧 ПРИОРИТЕТНЫЕ ИСПРАВЛЕНИЯ

### Критично (исправить немедленно):
1. Убрать `unsafe-inline` из CSP
2. Добавить rate limiting на клиенте
3. Добавить защиту от больших JSON payloads
4. Исправить перехват fetch
5. Убрать небезопасный fallback в `infrastructure-line-editor.js`
6. Добавить CSRF защиту

### Высокий приоритет (исправить в ближайшее время):
7. Добавить обработку ошибок JSON.parse
8. Ограничить количество маркеров
9. Улучшить валидацию координат
10. Добавить защиту от brute force
11. Улучшить обработку ошибок
12. Использовать более безопасное хранение токенов

### Средний приоритет (исправить при возможности):
13. Очистка таймеров
14. Улучшение проверок на null
15. Защита от SSRF
16. Защита от timing attacks
17. Улучшение логирования

---

## 📝 РЕКОМЕНДАЦИИ ПО УЛУЧШЕНИЮ БЕЗОПАСНОСТИ

1. **Регулярный аудит безопасности** - проводить аудит каждые 3 месяца
2. **Автоматизированное тестирование** - добавить автоматические тесты безопасности
3. **Мониторинг** - отслеживать подозрительную активность
4. **Документация** - документировать все меры безопасности
5. **Обучение** - обучать команду безопасности

---

## 🔗 Полезные ресурсы

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [DOMPurify Documentation](https://github.com/cure53/DOMPurify)

---

**Составлено:** AI Security Auditor  
**Дата:** 2025-01-25
