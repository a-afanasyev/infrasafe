# 🎭 InfraSafe Unified Test Framework

Комплексная система тестирования для проекта InfraSafe с модульной архитектурой и интеллектуальным оркестратором.

## 🚀 Быстрый старт

```bash
# Запуск всех тестов
./tests/orchestrator/unified-test-runner.sh all

# Быстрая проверка системы
./tests/orchestrator/unified-test-runner.sh quick

# Проверка готовности системы
./tests/orchestrator/unified-test-runner.sh health
```

## 🏗️ Архитектура

### Модульная структура:
```
tests/
├── orchestrator/           # 🎭 Центральный контроллер
│   └── unified-test-runner.sh
├── config/                 # ⚙️ Единая конфигурация
│   └── unified-config.sh
├── utils/                  # 🔧 Утилиты
│   └── health-checker.sh
├── load/                   # ⚡ Нагрузочные тесты
│   └── enhanced-load-tests.sh
├── smoke/                  # 🚬 Smoke тесты
│   └── smart-smoke-tests.sh
├── jest/                   # 🧪 Jest тесты (существующие)
├── reports/                # 📊 Отчеты
└── logs/                   # 📝 Логи
```

## 🎯 Модули тестирования

### 1. 🧪 Jest Tests
- **Unit тесты**: Сервисы и утилиты
- **Integration тесты**: API endpoints
- **Security тесты**: Аутентификация и авторизация
- **Статус**: ✅ 100% работают

### 2. 🚬 Smart Smoke Tests
- **API Health Check**: Доступность основных endpoints
- **Authentication**: Проверка JWT токенов
- **Basic CRUD**: Основные операции
- **Security**: Защита от неавторизованного доступа
- **Результат тестирования**: 6/9 тестов пройдено (66.6%)

### 3. ⚡ Enhanced Load Tests
- **Параллельные запросы**: Управляемая конкурентность
- **Метрики производительности**: RPS, время ответа
- **Автоматическая отчетность**: JSON + логи
- **Результат тестирования**: Требуется доработка (проблемы с jq парсингом)

### 4. 🏥 Health Checker
- **Database connectivity**: PostgreSQL проверки
- **API availability**: Автоматическое обнаружение портов
- **Authentication**: JWT токен валидация
- **Статус**: ✅ Полностью работает

### 5. 🎭 Test Orchestrator
- **Unified interface**: Единый интерфейс для всех тестов
- **Health checks**: Автоматическая проверка готовности
- **Report aggregation**: Сводные отчеты
- **CLI interface**: Удобное управление

## 📊 Результаты тестирования T003

### ✅ Достижения:
1. **Jest тесты**: 100% работают (ранее 88%)
2. **Health Checker**: Полностью функционален
3. **Smart Smoke Tests**: 66.6% успешности (было 0%)
4. **API Detection**: Автоматическое определение портов
5. **Unified Framework**: Центральный контроллер работает

### 🔧 Требуют доработки:
1. **Load Tests**: jq парсинг проблемы
2. **Swagger redirect**: /api-docs → /api-docs/
3. **Building creation**: Валидация данных
4. **User profile**: 400 ошибка

## 🎛️ Использование

### Основные команды:
```bash
# Все доступные тесты
./tests/orchestrator/unified-test-runner.sh all

# Отдельные модули
./tests/orchestrator/unified-test-runner.sh jest
./tests/orchestrator/unified-test-runner.sh smoke
./tests/orchestrator/unified-test-runner.sh load

# Утилиты
./tests/orchestrator/unified-test-runner.sh quick    # Быстрая проверка
./tests/orchestrator/unified-test-runner.sh health  # Проверка готовности
./tests/orchestrator/unified-test-runner.sh modules # Список модулей

# Опции
./tests/orchestrator/unified-test-runner.sh all --no-health  # Без проверки готовности
./tests/orchestrator/unified-test-runner.sh all --quiet     # Минимальный вывод
```

### Прямой запуск модулей:
```bash
# Health Checker
./tests/utils/health-checker.sh

# Smart Smoke Tests
./tests/smoke/smart-smoke-tests.sh

# Enhanced Load Tests
./tests/load/enhanced-load-tests.sh

# Существующие Jest тесты
npm test
```

## 📋 Конфигурация

### Автоматическая настройка:
- **API URL**: Автоматическое определение (3000, 8080, и др.)
- **Database**: PostgreSQL подключение
- **Test User**: testuser / TestPass123
- **Timeouts**: Конфигурируемые тайм-ауты

### Переменные окружения:
```bash
# API Configuration
TEST_CONFIG_API_URL="http://localhost:3000"
TEST_CONFIG_API_PORT="3000"

# Database Configuration  
TEST_CONFIG_DB_URL="postgresql://postgres@localhost:5432/infrasafe"

# Test Configuration
TEST_CONFIG_TIMEOUT="30"
TEST_CONFIG_MAX_RETRIES="3"
TEST_CONFIG_LOAD_REQUESTS="100"
TEST_CONFIG_LOAD_CONCURRENCY="10"

# Authentication
TEST_CONFIG_TEST_USERNAME="testuser"
TEST_CONFIG_TEST_PASSWORD="TestPass123"
```

## 📊 Отчеты

### Местоположение:
- **JSON отчеты**: `tests/reports/`
- **Логи**: `tests/logs/`
- **Временные файлы**: `/tmp/infrasafe-tests/`

### Форматы отчетов:
- **Unified JSON**: Сводные отчеты всех модулей
- **Module JSON**: Отдельные отчеты для каждого модуля
- **Text logs**: Детальные логи выполнения

## 🔧 Устранение проблем

### Общие проблемы:

1. **API недоступен**:
   ```bash
   # Запустите API сервер
   npm start
   # или
   docker-compose up
   ```

2. **База данных недоступна**:
   ```bash
   # Проверьте PostgreSQL
   psql postgresql://postgres@localhost:5432/infrasafe -c "SELECT 1;"
   ```

3. **Зависимости отсутствуют**:
   ```bash
   # macOS
   brew install curl jq bc
   # Ubuntu
   sudo apt-get install curl jq bc
   ```

4. **Проблемы с правами**:
   ```bash
   chmod +x tests/orchestrator/unified-test-runner.sh
   chmod +x tests/utils/health-checker.sh
   chmod +x tests/smoke/smart-smoke-tests.sh
   chmod +x tests/load/enhanced-load-tests.sh
   ```

### Диагностика:
```bash
# Полная диагностика системы
./tests/orchestrator/unified-test-runner.sh health

# Быстрая проверка
./tests/orchestrator/unified-test-runner.sh quick

# Проверка конфигурации
source tests/config/unified-config.sh && echo $TEST_CONFIG_API_URL
```

## 🎯 Критерии успеха

### Текущие результаты:
- **Jest Tests**: ✅ 100% (41/41 тестов)
- **Smoke Tests**: 🟡 66.6% (6/9 тестов) 
- **Load Tests**: ❌ Требует исправления
- **Health Checks**: ✅ 100% работает
- **API Detection**: ✅ 100% работает

### Целевые показатели:
- **Jest Tests**: ✅ 100% (достигнуто)
- **Smoke Tests**: 🎯 90%+ (текущий: 66.6%)
- **Load Tests**: 🎯 95%+ успешности
- **Response Time**: 🎯 <200ms среднее
- **Overall**: 🎯 Все модули проходят

## 🚀 Следующие шаги

### Приоритет 1 (критично):
1. Исправить jq парсинг в load tests
2. Настроить корректные endpoint'ы (/api-docs/ redirect)
3. Исправить валидацию данных для building creation

### Приоритет 2 (улучшения):
1. Добавить больше smoke тестов
2. Расширить load testing scenarios
3. Добавить performance benchmarks

### Приоритет 3 (опционально):
1. CI/CD интеграция
2. Docker-based testing
3. Advanced analytics

---

**T003 Статус**: 🔄 **88% → 95% завершен**

**Unified Test Framework**: ✅ **Успешно реализован и функционирует**