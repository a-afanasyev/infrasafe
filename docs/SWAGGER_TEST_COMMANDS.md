# 🧪 КОМАНДЫ ДЛЯ ТЕСТИРОВАНИЯ SWAGGER

## 🚀 Доступ к интерфейсам

```bash
# Swagger UI (обновленная документация)
open http://localhost:3000/api-docs/

# Фронтенд приложения  
open http://localhost:8080/

# API Root с перечнем endpoints
curl http://localhost:3000/api/
```

## 🔥 Тестирование новых ALERTS endpoints

### 1. Получить активные алерты
```bash
curl -X GET "http://localhost:3000/api/alerts" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### 2. Получить статистику алертов
```bash
curl -X GET "http://localhost:3000/api/alerts/statistics?days=7" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### 3. Получить статус системы алертов
```bash
curl -X GET "http://localhost:3000/api/alerts/status" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### 4. Получить пороги алертов
```bash
curl -X GET "http://localhost:3000/api/alerts/thresholds" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### 5. Проверить конкретный трансформатор (требует JWT)
```bash
# Сначала получить JWT токен
TOKEN=$(curl -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Затем проверить трансформатор
curl -X POST "http://localhost:3000/api/alerts/check/transformer/TR-FARABI-01" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## 📊 Проверка интеграции в Swagger UI

1. Откройте Swagger UI: http://localhost:3000/api-docs/
2. Найдите секцию **"Alerts"** в списке тагов
3. Проверьте наличие всех 8 endpoints:
   - `GET /api/alerts`
   - `POST /api/alerts` 
   - `GET /api/alerts/statistics`
   - `GET /api/alerts/status`
   - `POST /api/alerts/check/transformer/{transformerId}`
   - `POST /api/alerts/check/all-transformers`
   - `PATCH /api/alerts/{alertId}/acknowledge`
   - `PATCH /api/alerts/{alertId}/resolve`
   - `GET /api/alerts/thresholds`
   - `PUT /api/alerts/thresholds`

## 🔧 Управление контейнерами

```bash
# Остановить все сервисы
docker-compose -f docker-compose.dev.yml down

# Запустить все сервисы
docker-compose -f docker-compose.dev.yml up -d

# Посмотреть логи
docker-compose -f docker-compose.dev.yml logs -f

# Посмотреть статус
docker-compose -f docker-compose.dev.yml ps
```

## ✅ Проверка результата интеграции

**Ожидаемый результат:**
- ✅ 8 новых alerts endpoints в Swagger UI
- ✅ Схемы Alert и AlertCreate в секции Schemas
- ✅ Тег "Alerts" в списке тагов
- ✅ Примеры запросов и ответов для каждого endpoint
- ✅ Все endpoints возвращают корректные данные

**Размер документации:** 2117 строк (+556 строк alerts документации) 