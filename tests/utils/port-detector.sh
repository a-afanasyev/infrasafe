#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Конфигурация
DEFAULT_PORT=3000
ALTERNATIVE_PORT=8080
TIMEOUT=3
HEALTH_ENDPOINT="/api/health"

# Функция для проверки доступности TCP порта
check_tcp_port() {
    local port=$1
    
    # Проверка с помощью netcat (nc)
    if command -v nc >/dev/null 2>&1; then
        if nc -z localhost $port 2>/dev/null; then
            return 0  # Порт доступен
        fi
    fi
    
    # Альтернативная проверка с помощью /dev/tcp
    if timeout $TIMEOUT bash -c "</dev/tcp/localhost/$port" 2>/dev/null; then
        return 0  # Порт доступен
    fi
    
    return 1  # Порт недоступен
}

# Функция для проверки HTTP endpoint
check_http_endpoint() {
    local port=$1
    local url="http://localhost:${port}${HEALTH_ENDPOINT}"
    
    # Проверка с timeout
    if curl -s --connect-timeout $TIMEOUT --max-time $TIMEOUT "$url" > /dev/null 2>&1; then
        return 0  # Endpoint доступен
    else
        return 1  # Endpoint недоступен
    fi
}

# Функция для определения рабочего порта
detect_api_port() {
    # Проверка порта 3000
    if check_tcp_port $DEFAULT_PORT; then
        if check_http_endpoint $DEFAULT_PORT; then
            echo $DEFAULT_PORT
            return 0
        fi
    fi
    
    # Проверка порта 8080
    if check_tcp_port $ALTERNATIVE_PORT; then
        if check_http_endpoint $ALTERNATIVE_PORT; then
            echo $ALTERNATIVE_PORT
            return 0
        fi
    fi
    
    # Fallback на порт по умолчанию
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

# Функция для проверки доступности API
verify_api_availability() {
    local port=$1
    local url="http://localhost:${port}${HEALTH_ENDPOINT}"
    
    echo -e "${CYAN}🔍 Проверка доступности API на порту $port...${NC}"
    
    if check_http_endpoint $port; then
        echo -e "${GREEN}✅ API доступен на порту $port${NC}"
        return 0
    else
        echo -e "${RED}❌ API недоступен на порту $port${NC}"
        return 1
    fi
}

# Автоматическая настройка при загрузке скрипта
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Если скрипт запущен напрямую
    setup_api_environment
    echo -e "${BLUE}📊 Переменные окружения:${NC}"
    echo "API_PORT=$API_PORT"
    echo "API_URL=$API_URL"
else
    # Если скрипт загружен через source
    setup_api_environment
fi 