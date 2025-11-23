# T003: Техническая спецификация - Автоматическое определение порта

## 📋 Обзор

Данный документ содержит техническую спецификацию для реализации автоматического определения порта в системе тестирования InfraSafe.

## 🎯 Цели

1. **Унификация:** Единая система определения порта для всех типов тестов
2. **Надежность:** Автоматическое определение рабочего порта с fallback
3. **Простота:** Минимальные изменения в существующих тестах
4. **Совместимость:** Работа на всех поддерживаемых платформах

## 🏗️ Архитектура

### Компоненты системы

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Bash Tests    │    │   Jest Tests    │    │  Load Tests     │
│                 │    │                 │    │                 │
│  test_api.sh    │    │  integration/   │    │ run-load-tests  │
│  test_alerts    │    │  unit/          │    │                 │
│  test_jwt       │    │  security/      │    └─────────────────┘
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────────────────┼───────────────────────┐
                                 │                       │
                    ┌─────────────────┐    ┌─────────────────┐
                    │  Port Detector  │    │  Smoke Tests    │
                    │                 │    │                 │
                    │  Bash Utils     │    │ run-smoke-tests │
                    │  JS Utils       │    │                 │
                    └─────────────────┘    └─────────────────┘
```

### Поток данных

1. **Инициализация:** Тест загружает утилиту определения порта
2. **Определение:** Утилита проверяет доступность портов 3000 и 8080
3. **Выбор:** Выбирается первый доступный порт
4. **Fallback:** Если ни один порт не доступен, используется 3000
5. **Экспорт:** Переменные окружения устанавливаются для теста
6. **Выполнение:** Тест выполняется с определенным портом

## 🔧 Техническая реализация

### 1. Bash утилита (`tests/utils/port-detector.sh`)

```bash
#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Конфигурация
DEFAULT_PORT=3000
ALTERNATIVE_PORT=8080
TIMEOUT=3
HEALTH_ENDPOINT="/api/health"

# Функция для проверки доступности порта
check_port() {
    local port=$1
    local url="http://localhost:${port}${HEALTH_ENDPOINT}"
    
    # Проверка с timeout
    if curl -s --connect-timeout $TIMEOUT --max-time $TIMEOUT "$url" > /dev/null 2>&1; then
        return 0  # Порт доступен
    else
        return 1  # Порт недоступен
    fi
}

# Функция для определения рабочего порта
detect_api_port() {
    echo -e "${BLUE}🔍 Определение рабочего порта...${NC}"
    
    # Проверка порта 3000
    echo -e "${YELLOW}📡 Проверка порта $DEFAULT_PORT...${NC}"
    if check_port $DEFAULT_PORT; then
        echo -e "${GREEN}✅ Порт $DEFAULT_PORT доступен${NC}"
        echo $DEFAULT_PORT
        return 0
    fi
    
    # Проверка порта 8080
    echo -e "${YELLOW}📡 Проверка порта $ALTERNATIVE_PORT...${NC}"
    if check_port $ALTERNATIVE_PORT; then
        echo -e "${GREEN}✅ Порт $ALTERNATIVE_PORT доступен${NC}"
        echo $ALTERNATIVE_PORT
        return 0
    fi
    
    # Fallback на порт по умолчанию
    echo -e "${YELLOW}⚠️  Ни один порт не доступен, используем $DEFAULT_PORT${NC}"
    echo $DEFAULT_PORT
    return 1
}

# Функция для установки переменных окружения
setup_api_environment() {
    local detected_port=$(detect_api_port)
    
    export API_PORT=$detected_port
    export API_URL="http://localhost:$detected_port"
    
    echo -e "${GREEN}🚀 API настроен на порт: $API_PORT${NC}"
    echo -e "${BLUE}📋 URL: $API_URL${NC}"
    
    return 0
}

# Автоматическая настройка при загрузке скрипта
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Если скрипт запущен напрямую
    setup_api_environment
else
    # Если скрипт загружен через source
    setup_api_environment
fi
```

### 2. JavaScript утилита (`tests/utils/port-detector.js`)

```javascript
const axios = require('axios');

// Конфигурация
const CONFIG = {
    DEFAULT_PORT: 3000,
    ALTERNATIVE_PORT: 8080,
    TIMEOUT: 3000,
    HEALTH_ENDPOINT: '/api/health'
};

// Функция для проверки доступности порта
async function checkPort(port) {
    const url = `http://localhost:${port}${CONFIG.HEALTH_ENDPOINT}`;
    
    try {
        const response = await axios.get(url, {
            timeout: CONFIG.TIMEOUT
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

// Функция для определения рабочего порта
async function detectApiPort() {
    console.log('🔍 Определение рабочего порта...');
    
    // Проверка порта по умолчанию
    console.log(`📡 Проверка порта ${CONFIG.DEFAULT_PORT}...`);
    if (await checkPort(CONFIG.DEFAULT_PORT)) {
        console.log(`✅ Порт ${CONFIG.DEFAULT_PORT} доступен`);
        return CONFIG.DEFAULT_PORT;
    }
    
    // Проверка альтернативного порта
    console.log(`📡 Проверка порта ${CONFIG.ALTERNATIVE_PORT}...`);
    if (await checkPort(CONFIG.ALTERNATIVE_PORT)) {
        console.log(`✅ Порт ${CONFIG.ALTERNATIVE_PORT} доступен`);
        return CONFIG.ALTERNATIVE_PORT;
    }
    
    // Fallback на порт по умолчанию
    console.log(`⚠️  Ни один порт не доступен, используем ${CONFIG.DEFAULT_PORT}`);
    return CONFIG.DEFAULT_PORT;
}

// Функция для настройки переменных окружения
async function setupApiEnvironment() {
    const detectedPort = await detectApiPort();
    
    process.env.API_PORT = detectedPort.toString();
    process.env.API_URL = `http://localhost:${detectedPort}`;
    
    console.log(`🚀 API настроен на порт: ${detectedPort}`);
    console.log(`📋 URL: ${process.env.API_URL}`);
    
    return {
        port: detectedPort,
        url: process.env.API_URL
    };
}

module.exports = {
    detectApiPort,
    setupApiEnvironment,
    checkPort
};
```

### 3. Интеграция с Jest (`tests/jest/setup.js`)

```javascript
const { setupApiEnvironment } = require('../utils/port-detector');

// Настройка перед всеми тестами
beforeAll(async () => {
    console.log('🧪 Настройка Jest тестов...');
    
    try {
        await setupApiEnvironment();
        console.log('✅ Jest тесты настроены');
    } catch (error) {
        console.error('❌ Ошибка настройки Jest тестов:', error);
        throw error;
    }
}, 10000); // Увеличиваем timeout для определения порта

// Очистка после всех тестов
afterAll(async () => {
    console.log('🧹 Очистка Jest тестов...');
}, 5000);
```

### 4. Обновление bash тестов

#### Пример для `tests/bash/test_alerts_system.sh`:

```bash
#!/bin/bash

# Загрузка утилиты определения порта
source "$(dirname "$0")/../utils/port-detector.sh"

# Проверка, что переменные установлены
if [ -z "$API_PORT" ] || [ -z "$API_URL" ]; then
    echo "❌ Ошибка: переменные API не установлены"
    exit 1
fi

echo "🚀 Запуск тестов системы алертов на порту $API_PORT"

# Остальной код теста остается без изменений
# Все обращения к $BASE_URL заменяются на $API_URL
```

### 5. Универсальный runner (`tests/run-all-tests.sh`)

```bash
#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Загрузка утилиты определения порта
source "$(dirname "$0")/utils/port-detector.sh"

# Функция для запуска bash тестов
run_bash_tests() {
    echo -e "${BLUE}🧪 Запуск bash тестов...${NC}"
    cd "$(dirname "$0")/bash"
    
    local exit_code=0
    
    # Запуск тестов системы алертов
    echo -e "${YELLOW}📋 Тестирование системы алертов...${NC}"
    if ./test_alerts_system.sh; then
        echo -e "${GREEN}✅ Тесты алертов прошли успешно${NC}"
    else
        echo -e "${RED}❌ Тесты алертов провалились${NC}"
        exit_code=1
    fi
    
    # Запуск API тестов
    echo -e "${YELLOW}📡 Тестирование API...${NC}"
    if ./test_api.sh; then
        echo -e "${GREEN}✅ API тесты прошли успешно${NC}"
    else
        echo -e "${RED}❌ API тесты провалились${NC}"
        exit_code=1
    fi
    
    # Запуск JWT тестов
    echo -e "${YELLOW}🔐 Тестирование JWT...${NC}"
    if ./test_jwt_only.sh; then
        echo -e "${GREEN}✅ JWT тесты прошли успешно${NC}"
    else
        echo -e "${RED}❌ JWT тесты провалились${NC}"
        exit_code=1
    fi
    
    return $exit_code
}

# Функция для запуска Jest тестов
run_jest_tests() {
    echo -e "${BLUE}🧪 Запуск Jest тестов...${NC}"
    
    if npm test; then
        echo -e "${GREEN}✅ Jest тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Jest тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска нагрузочных тестов
run_load_tests() {
    echo -e "${BLUE}🧪 Запуск нагрузочных тестов...${NC}"
    cd "$(dirname "$0")/load"
    
    if ./run-load-tests.sh; then
        echo -e "${GREEN}✅ Нагрузочные тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Нагрузочные тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска smoke тестов
run_smoke_tests() {
    echo -e "${BLUE}🧪 Запуск smoke тестов...${NC}"
    cd "$(dirname "$0")/smoke"
    
    if ./run-smoke-tests.sh; then
        echo -e "${GREEN}✅ Smoke тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Smoke тесты провалились${NC}"
        return 1
    fi
}

# Главная функция
main() {
    echo -e "${BLUE}🚀 Запуск всех тестов InfraSafe${NC}"
    echo -e "${BLUE}📋 Используется порт: $API_PORT${NC}"
    echo ""
    
    local total_exit_code=0
    
    # Определение типа тестов из аргументов
    local test_type=${1:-"all"}
    
    case $test_type in
        "bash")
            run_bash_tests
            total_exit_code=$?
            ;;
        "jest")
            run_jest_tests
            total_exit_code=$?
            ;;
        "load")
            run_load_tests
            total_exit_code=$?
            ;;
        "smoke")
            run_smoke_tests
            total_exit_code=$?
            ;;
        "all")
            run_bash_tests
            bash_exit=$?
            
            run_jest_tests
            jest_exit=$?
            
            run_load_tests
            load_exit=$?
            
            run_smoke_tests
            smoke_exit=$?
            
            total_exit_code=$((bash_exit + jest_exit + load_exit + smoke_exit))
            ;;
        *)
            echo -e "${RED}❌ Неизвестный тип тестов: $test_type${NC}"
            echo -e "${YELLOW}Доступные типы: bash, jest, load, smoke, all${NC}"
            exit 1
            ;;
    esac
    
    echo ""
    if [ $total_exit_code -eq 0 ]; then
        echo -e "${GREEN}🎉 Все тесты прошли успешно!${NC}"
    else
        echo -e "${RED}❌ Некоторые тесты провалились${NC}"
    fi
    
    exit $total_exit_code
}

# Запуск главной функции
main "$@"
```

## 📊 Критерии приемки

### Функциональные критерии
- [ ] Автоматическое определение порта работает в 99% случаев
- [ ] Все типы тестов используют единую систему определения порта
- [ ] Fallback механизмы работают корректно
- [ ] Timeout и обработка ошибок работают

### Технические критерии
- [ ] Время определения порта < 5 секунд
- [ ] Совместимость с macOS, Linux, Windows
- [ ] Минимальные изменения в существующих тестах
- [ ] Подробное логирование процесса

### Тестовые критерии
- [ ] Все bash тесты проходят (100% успешность)
- [ ] Все Jest тесты проходят (100% успешность)
- [ ] Нагрузочные тесты работают (>95% успешность)
- [ ] Smoke тесты работают (100% успешность)

## 🚀 План внедрения

1. **Этап 1:** Создание утилит определения порта
2. **Этап 2:** Обновление bash тестов
3. **Этап 3:** Обновление Jest тестов
4. **Этап 4:** Обновление нагрузочных и smoke тестов
5. **Этап 5:** Создание универсального runner
6. **Этап 6:** Тестирование и валидация
7. **Этап 7:** Документация и обучение

## 📈 Ожидаемые результаты

После внедрения:
- **Надежность:** 99% успешного определения порта
- **Универсальность:** Единая система для всех типов тестов
- **Простота:** Одна команда для запуска всех тестов
- **CI/CD готовность:** Автоматическое тестирование в pipeline
- **Готовность к production:** 100% покрытие тестированием 