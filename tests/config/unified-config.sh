#!/bin/bash

# =============================================================================
# Unified Test Configuration - InfraSafe Testing Framework
# =============================================================================

# Цвета для вывода
export GREEN='\033[0;32m'
export RED='\033[0;31m'
export BLUE='\033[0;34m'
export YELLOW='\033[1;33m'
export CYAN='\033[0;36m'
export PURPLE='\033[0;35m'
export NC='\033[0m'

# =============================================================================
# API Configuration
# =============================================================================

# Автоматическое определение API порта и URL
detect_api_configuration() {
    echo -e "${CYAN}🔍 Определение конфигурации API...${NC}"
    
    # Проверяем порт 3000 (основной API)
    if curl -s --connect-timeout 2 "http://localhost:3000/api" >/dev/null 2>&1; then
        export TEST_CONFIG_API_PORT="3000"
        export TEST_CONFIG_API_URL="http://localhost:3000"
        echo -e "${GREEN}✅ API найден на порту 3000${NC}"
        return 0
    fi
    
    # Проверяем порт 8080 (frontend + proxy)
    if curl -s --connect-timeout 2 "http://localhost:8080/api" >/dev/null 2>&1; then
        export TEST_CONFIG_API_PORT="8080"
        export TEST_CONFIG_API_URL="http://localhost:8080"
        echo -e "${GREEN}✅ API найден на порту 8080 (через прокси)${NC}"
        return 0
    fi
    
    # Проверяем другие возможные порты
    for port in 3001 3002 8081 8082; do
        if curl -s --connect-timeout 1 "http://localhost:$port/api" >/dev/null 2>&1; then
            export TEST_CONFIG_API_PORT="$port"
            export TEST_CONFIG_API_URL="http://localhost:$port"
            echo -e "${GREEN}✅ API найден на порту $port${NC}"
            return 0
        fi
    done
    
    # API не найден
    echo -e "${RED}❌ API не найден на стандартных портах${NC}"
    echo -e "${YELLOW}ℹ️  Убедитесь, что сервер запущен командой: npm start или docker-compose up${NC}"
    return 1
}

# =============================================================================
# Database Configuration
# =============================================================================

export TEST_CONFIG_DB_HOST="${DB_HOST:-localhost}"
export TEST_CONFIG_DB_PORT="${DB_PORT:-5432}"
export TEST_CONFIG_DB_USER="${DB_USER:-postgres}"
export TEST_CONFIG_DB_NAME="${DB_NAME:-infrasafe}"
export TEST_CONFIG_DB_URL="postgresql://${TEST_CONFIG_DB_USER}@${TEST_CONFIG_DB_HOST}:${TEST_CONFIG_DB_PORT}/${TEST_CONFIG_DB_NAME}"

# =============================================================================
# Test Configuration
# =============================================================================

export TEST_CONFIG_TIMEOUT="30"
export TEST_CONFIG_MAX_RETRIES="3"
export TEST_CONFIG_CONNECT_TIMEOUT="10"
export TEST_CONFIG_API_HEALTH_CHECK_TIMEOUT="60"

# Load Testing Configuration
export TEST_CONFIG_LOAD_REQUESTS="100"
export TEST_CONFIG_LOAD_CONCURRENCY="10"
export TEST_CONFIG_LOAD_SUCCESS_THRESHOLD="95"
export TEST_CONFIG_LOAD_RESPONSE_TIME_THRESHOLD="200"

# Smoke Testing Configuration
export TEST_CONFIG_SMOKE_TIMEOUT="10"
export TEST_CONFIG_SMOKE_MAX_DURATION="60"

# =============================================================================
# Directories Configuration
# =============================================================================

export TEST_CONFIG_REPORTS_DIR="tests/reports"
export TEST_CONFIG_LOGS_DIR="tests/logs"
export TEST_CONFIG_TEMP_DIR="/tmp/infrasafe-tests"

# =============================================================================
# Authentication Configuration
# =============================================================================

export TEST_CONFIG_TEST_USERNAME="${TEST_USERNAME:-testuser}"
export TEST_CONFIG_TEST_PASSWORD="${TEST_PASSWORD:-TestPass123}"
export TEST_CONFIG_ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
export TEST_CONFIG_ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123}"

# =============================================================================
# JWT Configuration
# =============================================================================

export TEST_CONFIG_JWT_SECRET="${JWT_SECRET:-your-secret-key}"

# =============================================================================
# Utility Functions
# =============================================================================

# Создание необходимых директорий
create_test_directories() {
    echo -e "${CYAN}📁 Создание директорий для тестов...${NC}"
    
    mkdir -p "$TEST_CONFIG_REPORTS_DIR"
    mkdir -p "$TEST_CONFIG_LOGS_DIR"
    mkdir -p "$TEST_CONFIG_TEMP_DIR"
    
    echo -e "${GREEN}✅ Директории созданы${NC}"
}

# Очистка временных файлов
cleanup_temp_files() {
    echo -e "${CYAN}🧹 Очистка временных файлов...${NC}"
    
    # Очищаем временные файлы старше 1 дня
    find "$TEST_CONFIG_TEMP_DIR" -type f -mtime +1 -delete 2>/dev/null || true
    
    # Очищаем старые логи (старше 7 дней)
    find "$TEST_CONFIG_LOGS_DIR" -name "*.log" -mtime +7 -delete 2>/dev/null || true
    
    echo -e "${GREEN}✅ Очистка завершена${NC}"
}

# Проверка зависимостей
check_dependencies() {
    echo -e "${CYAN}🔍 Проверка зависимостей...${NC}"
    
    local missing_deps=()
    
    # Проверяем обязательные утилиты
    for cmd in curl jq bc; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "${RED}❌ Отсутствуют зависимости: ${missing_deps[*]}${NC}"
        echo -e "${YELLOW}Установите их командой:${NC}"
        echo -e "${YELLOW}  macOS: brew install ${missing_deps[*]}${NC}"
        echo -e "${YELLOW}  Ubuntu: sudo apt-get install ${missing_deps[*]}${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Все зависимости установлены${NC}"
    return 0
}

# Генерация уникального ID для тестов
generate_test_id() {
    echo "test-$(date +%Y%m%d-%H%M%S)-$$"
}

# Форматирование времени выполнения
format_duration() {
    local duration=$1
    local hours=$((duration / 3600))
    local minutes=$(((duration % 3600) / 60))
    local seconds=$((duration % 60))
    
    if [ $hours -gt 0 ]; then
        echo "${hours}ч ${minutes}м ${seconds}с"
    elif [ $minutes -gt 0 ]; then
        echo "${minutes}м ${seconds}с"
    else
        echo "${seconds}с"
    fi
}

# =============================================================================
# Initialization
# =============================================================================

# Инициализация конфигурации
init_test_config() {
    echo -e "${CYAN}🚀 Инициализация Unified Test Framework...${NC}"
    
    # Создаем директории
    create_test_directories
    
    # Проверяем зависимости
    if ! check_dependencies; then
        return 1
    fi
    
    # Определяем конфигурацию API
    if ! detect_api_configuration; then
        return 1
    fi
    
    # Очищаем старые файлы
    cleanup_temp_files
    
    echo -e "${GREEN}✅ Unified Test Framework инициализирован${NC}"
    echo -e "${BLUE}📋 Конфигурация:${NC}"
    echo -e "${BLUE}   API URL: $TEST_CONFIG_API_URL${NC}"
    echo -e "${BLUE}   DB URL: $TEST_CONFIG_DB_URL${NC}"
    echo -e "${BLUE}   Reports: $TEST_CONFIG_REPORTS_DIR${NC}"
    
    return 0
}

# Автоматическая инициализация при source
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    # Файл был source'ен, инициализируем автоматически
    init_test_config
fi
