# Проверка ошибок консоли

## Статус проверки

✅ **Все файлы загружаются корректно:**
- index.html: HTTP 200
- script.js: HTTP 200  
- style.css: HTTP 200

✅ **API endpoint доступен:**
- `/api/buildings-metrics`: HTTP 200
- Данные возвращаются в правильном формате

## Возможные проблемы

### 1. CORS (Cross-Origin Resource Sharing)
Если фронтенд работает на `http://localhost:8000`, а API на `http://localhost:3000`, могут быть проблемы с CORS.

**Решение:** Убедитесь, что backend настроен для разрешения запросов с фронтенда:
```javascript
// В backend сервере должен быть настроен CORS
app.use(cors({
    origin: ['http://localhost:8000', 'http://localhost:8001'],
    credentials: true
}));
```

### 2. Базовый URL API
В `script.js` используется:
```javascript
const backendURL = window.BACKEND_URL || "/api";
```

Если фронтенд и backend на разных портах, нужно установить:
```html
<script>
    window.BACKEND_URL = "http://localhost:3000/api";
</script>
```

### 3. Проверка консоли браузера
Откройте DevTools (F12) и проверьте:
- Вкладка **Console** - ошибки JavaScript
- Вкладка **Network** - ошибки загрузки файлов и API запросы
- Вкладка **Sources** - ошибки загрузки скриптов

## Рекомендации для отладки

1. Откройте консоль браузера (F12)
2. Проверьте ошибки в Console
3. Проверьте Network tab для запросов к API
4. Убедитесь, что все запросы возвращают статус 200

## Тестирование API

```bash
# Проверка доступности API
curl http://localhost:3000/api/buildings-metrics

# Проверка CORS заголовков
curl -I http://localhost:3000/api/buildings-metrics
```

