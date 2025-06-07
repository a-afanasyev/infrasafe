# 🧪 Тестирование API InfraSafe Habitat IQ

Этот документ описывает инструменты для тестирования API системы мониторинга зданий InfraSafe.

## 📋 Доступные тестовые скрипты

### 1. 🚀 `test_api_quick.sh` - Быстрое тестирование
Краткая проверка основных API функций для ежедневного использования.

```bash
./test_api_quick.sh
```

**Что тестируется:**
- ✅ Базовые маршруты
- ✅ CRUD операции для зданий
- ✅ CRUD операции для контроллеров  
- ✅ Операции с метриками
- ✅ Данные для карты
- ✅ Обработка ошибок
- ✅ Веб-интерфейс

**Время выполнения:** ~5-10 секунд

### 2. 🧪 `test_api.sh` - Полное тестирование
Детальное тестирование всех API endpoints с авторизацией и полными данными.

```bash
./test_api.sh
```

**Что тестируется:**
- 🔐 Авторизация (логин, регистрация, профиль)
- 🏢 Полный CRUD для зданий
- 🎛️ Полный CRUD для контроллеров
- 📊 Полный CRUD для метрик + телеметрия
- 🗺️ Данные для карты
- ⚠️ Тесты на различные ошибки
- 🗑️ DELETE операции (опционально)

**Время выполнения:** ~2-3 минуты

## 🌐 Базовый URL

По умолчанию все скрипты используют:
```
http://localhost:8080
```

Для изменения отредактируйте переменную `API_URL` в скриптах.

## 📊 Структура API

### Базовые маршруты
```
GET  /api/                    # Информация об API
```

### 🔐 Авторизация
```
POST /api/auth/login          # Вход в систему
POST /api/auth/register       # Регистрация
GET  /api/auth/profile        # Профиль пользователя (требует JWT)
```

### 🏢 Здания
```
GET    /api/buildings         # Список всех зданий
GET    /api/buildings/:id     # Здание по ID
POST   /api/buildings         # Создание здания (требует JWT)
PUT    /api/buildings/:id     # Обновление здания (требует JWT)
DELETE /api/buildings/:id     # Удаление здания (требует JWT)
```

**Параметры запроса:**
- `page` - номер страницы (по умолчанию 1)
- `limit` - количество записей на странице (по умолчанию 10)

### 🎛️ Контроллеры
```
GET    /api/controllers                    # Список всех контроллеров
GET    /api/controllers/:id               # Контроллер по ID
GET    /api/controllers/building/:id      # Контроллеры здания
GET    /api/controllers/:id/metrics       # Метрики контроллера
POST   /api/controllers                   # Создание контроллера (требует JWT)
PUT    /api/controllers/:id               # Обновление контроллера (требует JWT)
PATCH  /api/controllers/:id/status        # Обновление статуса (требует JWT)
DELETE /api/controllers/:id               # Удаление контроллера (требует JWT)
```

### 📊 Метрики
```
GET    /api/metrics                       # Список всех метрик
GET    /api/metrics/latest                # Последние метрики контроллеров
GET    /api/metrics/controller/:id        # Метрики контроллера
GET    /api/metrics/:id                   # Метрика по ID
POST   /api/metrics                       # Создание метрики (требует JWT)
POST   /api/metrics/telemetry             # Телеметрия от устройства (без JWT)
DELETE /api/metrics/:id                   # Удаление метрики (требует JWT)
```

### 🗺️ Данные для карты
```
GET    /api/buildings-metrics             # Здания с метриками для карты
```

## 🔑 Авторизация

Для операций изменения данных (POST, PUT, PATCH, DELETE) требуется JWT токен в заголовке:

```
Authorization: Bearer <JWT_TOKEN>
```

**Тестовые учетные данные:**
- Логин: `admin`
- Пароль: `admin123`

## 📋 Примеры использования

### Быстрая проверка здоровья API
```bash
curl http://localhost:8080/api/
```

### Получение списка зданий
```bash
curl http://localhost:8080/api/buildings
```

### Получение данных для карты
```bash
curl http://localhost:8080/api/buildings-metrics | jq '.'
```

### Авторизация и получение токена
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

### Создание нового здания (с токеном)
```bash
curl -X POST http://localhost:8080/api/buildings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "name": "Новое здание",
    "address": "ул. Тестовая, 1",
    "town": "Ташкент",
    "latitude": 41.347052,
    "longitude": 69.203200,
    "region": "Тестовый",
    "management_company": "Тест УК",
    "hot_water": true
  }'
```

## 📈 Интерпретация результатов

### HTTP коды ответов
- **200-299** ✅ Успех
- **400-499** ⚠️ Ошибка клиента (неверные данные, отсутствие авторизации)
- **500-599** ❌ Ошибка сервера

### Типичные ошибки
- **401** - Отсутствует или недействителен JWT токен
- **404** - Ресурс не найден
- **422** - Ошибка валидации данных

## 🔧 Зависимости

Для корректной работы скриптов требуется:
- `curl` - для HTTP запросов
- `jq` (опционально) - для форматирования JSON

**Установка jq на macOS:**
```bash
brew install jq
```

**Установка jq на Ubuntu/Debian:**
```bash
sudo apt-get install jq
```

## 🚀 Автоматизация

### Интеграция в CI/CD
```bash
# В pipeline добавьте:
./test_api_quick.sh || exit 1
```

### Мониторинг здоровья
```bash
# Крон задача для проверки каждые 5 минут:
*/5 * * * * /path/to/test_api_quick.sh > /var/log/api_health.log 2>&1
```

### Использование с Docker
```bash
# Проверка после деплоя:
docker-compose up -d
sleep 10  # Ждем инициализации
./test_api_quick.sh
```

## 📚 Дополнительные ресурсы

- **Swagger документация:** http://localhost:8080/api-docs
- **Главная страница:** http://localhost:8080
- **Админ панель:** http://localhost:8080/admin.html

## 🐛 Отладка

### Проверка статуса контейнеров
```bash
docker-compose ps
```

### Просмотр логов
```bash
docker-compose logs app
docker-compose logs frontend
docker-compose logs postgres
```

### Проверка подключения к базе данных
```bash
docker exec -it leaflet-postgres-1 psql -U postgres -d infrasafe -c "SELECT COUNT(*) FROM buildings;"
```

### Ручная проверка endpoint'а
```bash
curl -v http://localhost:8080/api/buildings
```

## 🔄 Обновление тестов

При добавлении новых endpoint'ов обновите:
1. `test_api.sh` - для полного тестирования
2. `test_api_quick.sh` - для быстрой проверки (если endpoint критичен)
3. Этот документ - добавьте описание нового API

---

**📝 Примечание:** Все скрипты автоматически определяют наличие `jq` и форматируют JSON ответы соответственно. 