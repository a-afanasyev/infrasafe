#!/bin/bash

# =============================================================================
# Service Health Checker - InfraSafe Testing Framework
# =============================================================================

# Загружаем конфигурацию
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config/unified-config.sh"

# =============================================================================
# Database Health Checks
# =============================================================================

check_database_connection() {
    echo -e "${CYAN}🗄️  Проверка подключения к базе данных...${NC}"
    
    # Проверяем, что PostgreSQL доступен
    if ! command -v psql >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  psql не найден, пропускаем проверку PostgreSQL${NC}"
        return 0
    fi
    
    # Проверяем подключение к базе данных
    local test_query="SELECT 1 as test;"
    
    if psql "$TEST_CONFIG_DB_URL" -c "$test_query" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ База данных доступна${NC}"
        return 0
    else
        echo -e "${RED}❌ База данных недоступна${NC}"
        echo -e "${YELLOW}ℹ️  Убедитесь, что PostgreSQL запущен и доступен по адресу: $TEST_CONFIG_DB_URL${NC}"
        return 1
    fi
}

check_database_schema() {
    echo -e "${CYAN}🏗️  Проверка схемы базы данных...${NC}"
    
    if ! command -v psql >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Пропускаем проверку схемы (psql недоступен)${NC}"
        return 0
    fi
    
    # Проверяем наличие ключевых таблиц
    local tables=("users" "buildings" "controllers" "metrics" "infrastructure_alerts")
    local missing_tables=()
    
    for table in "${tables[@]}"; do
        local count=$(psql "$TEST_CONFIG_DB_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='$table';" 2>/dev/null | tr -d ' \n')
        
        if [ "$count" != "1" ]; then
            missing_tables+=("$table")
        fi
    done
    
    if [ ${#missing_tables[@]} -gt 0 ]; then
        echo -e "${RED}❌ Отсутствуют таблицы: ${missing_tables[*]}${NC}"
        echo -e "${YELLOW}ℹ️  Выполните инициализацию БД: npm run db:init${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Схема базы данных корректна${NC}"
    return 0
}

check_test_data() {
    echo -e "${CYAN}📊 Проверка тестовых данных...${NC}"
    
    if ! command -v psql >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Пропускаем проверку тестовых данных${NC}"
        return 0
    fi
    
    # Проверяем наличие тестового пользователя
    local user_count=$(psql "$TEST_CONFIG_DB_URL" -t -c "SELECT COUNT(*) FROM users WHERE username='$TEST_CONFIG_TEST_USERNAME';" 2>/dev/null | tr -d ' \n')
    
    if [ "$user_count" != "1" ]; then
        echo -e "${YELLOW}⚠️  Тестовый пользователь не найден, создаем...${NC}"
        
        # Создаем тестового пользователя (если возможно)
        local password_hash='$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LrLm6sHTBs6E3n6Xi' # TestPass123
        psql "$TEST_CONFIG_DB_URL" -c "INSERT INTO users (username, email, password_hash, role, is_active) VALUES ('$TEST_CONFIG_TEST_USERNAME', '${TEST_CONFIG_TEST_USERNAME}@test.com', '$password_hash', 'admin', true) ON CONFLICT (username) DO NOTHING;" >/dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Тестовый пользователь создан${NC}"
        else
            echo -e "${YELLOW}⚠️  Не удалось создать тестового пользователя автоматически${NC}"
        fi
    else
        echo -e "${GREEN}✅ Тестовый пользователь найден${NC}"
    fi
    
    return 0
}

# =============================================================================
# API Health Checks
# =============================================================================

safe_curl() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local headers="$4"
    local max_retries="${5:-$TEST_CONFIG_MAX_RETRIES}"
    
    for retry in $(seq 1 $max_retries); do
        local curl_cmd="curl -s -w %{http_code} -X $method"
        curl_cmd="$curl_cmd --connect-timeout $TEST_CONFIG_CONNECT_TIMEOUT"
        curl_cmd="$curl_cmd --max-time $TEST_CONFIG_TIMEOUT"
        
        # Добавляем заголовки
        if [ -n "$headers" ]; then
            curl_cmd="$curl_cmd $headers"
        fi
        
        # Добавляем данные
        if [ -n "$data" ]; then
            curl_cmd="$curl_cmd -d '$data'"
        fi
        
        curl_cmd="$curl_cmd '$TEST_CONFIG_API_URL$endpoint'"
        
        local response
        response=$(eval "$curl_cmd" 2>/dev/null)
        local http_code="${response: -3}"
        local response_body="${response%???}"
        
        if [ "$http_code" != "000" ]; then
            echo "$response"
            return 0
        fi
        
        if [ $retry -lt $max_retries ]; then
            echo -e "${YELLOW}⚠️  Попытка $retry/$max_retries неудачна, повторяем через 1 секунду...${NC}" >&2
            sleep 1
        fi
    done
    
    echo "000Connection failed after $max_retries retries"
    return 1
}

check_api_availability() {
    echo -e "${CYAN}🌐 Проверка доступности API...${NC}"
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        echo -e "${BLUE}ℹ️  Попытка $attempt/$max_attempts...${NC}"
        
        local response=$(safe_curl "GET" "/api" "" "" 1)
        local http_code="${response: -3}"
        
        if [ "$http_code" = "200" ]; then
            echo -e "${GREEN}✅ API доступен и отвечает${NC}"
            return 0
        fi
        
        if [ "$http_code" != "000" ]; then
            echo -e "${YELLOW}⚠️  API доступен, но возвращает код $http_code${NC}"
            # API отвечает, но с ошибкой - считаем это доступным
            return 0
        fi
        
        echo -e "${YELLOW}⏳ API недоступен, ожидание 2 секунды...${NC}"
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ API недоступен после $max_attempts попыток${NC}"
    echo -e "${YELLOW}ℹ️  Убедитесь, что сервер запущен:${NC}"
    echo -e "${YELLOW}     • npm start${NC}"
    echo -e "${YELLOW}     • docker-compose up${NC}"
    echo -e "${YELLOW}     • docker-compose -f docker-compose.dev.yml up${NC}"
    return 1
}

check_api_endpoints() {
    echo -e "${CYAN}🔗 Проверка ключевых API endpoints...${NC}"
    
    local endpoints=(
        "/api"
        "/api/buildings"
        "/api/controllers"
        "/api/metrics"
    )
    
    local failed_endpoints=()
    
    for endpoint in "${endpoints[@]}"; do
        echo -e "${BLUE}   Проверяем $endpoint...${NC}"
        
        local response=$(safe_curl "GET" "$endpoint" "" "" 2)
        local http_code="${response: -3}"
        
        if [ "$http_code" = "200" ] || [ "$http_code" = "401" ]; then
            echo -e "${GREEN}   ✅ $endpoint доступен${NC}"
        else
            echo -e "${RED}   ❌ $endpoint недоступен (код: $http_code)${NC}"
            failed_endpoints+=("$endpoint")
        fi
    done
    
    if [ ${#failed_endpoints[@]} -gt 0 ]; then
        echo -e "${RED}❌ Недоступные endpoints: ${failed_endpoints[*]}${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Все ключевые endpoints доступны${NC}"
    return 0
}

check_api_authentication() {
    echo -e "${CYAN}🔐 Проверка системы аутентификации...${NC}"
    
    # Попытка авторизации
    local auth_data="{\"username\": \"$TEST_CONFIG_TEST_USERNAME\", \"password\": \"$TEST_CONFIG_TEST_PASSWORD\"}"
    local response=$(safe_curl "POST" "/api/auth/login" "$auth_data" "-H 'Content-Type: application/json'" 3)
    local http_code="${response: -3}"
    local response_body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        # Проверяем наличие токена в ответе
        local token=$(echo "$response_body" | jq -r '.accessToken // empty' 2>/dev/null)
        
        if [ -n "$token" ] && [ "$token" != "null" ]; then
            echo -e "${GREEN}✅ Аутентификация работает, токен получен${NC}"
            export TEST_JWT_TOKEN="$token"
            return 0
        else
            echo -e "${YELLOW}⚠️  Аутентификация работает, но токен не найден в ответе${NC}"
            echo -e "${BLUE}Ответ: $response_body${NC}"
            return 1
        fi
    elif [ "$http_code" = "401" ]; then
        echo -e "${RED}❌ Неверные учетные данные для тестового пользователя${NC}"
        echo -e "${YELLOW}ℹ️  Проверьте наличие пользователя: $TEST_CONFIG_TEST_USERNAME${NC}"
        return 1
    else
        echo -e "${RED}❌ Ошибка аутентификации (код: $http_code)${NC}"
        echo -e "${BLUE}Ответ: $response_body${NC}"
        return 1
    fi
}

# =============================================================================
# Service Startup Helpers
# =============================================================================

start_api_server() {
    echo -e "${CYAN}🚀 Попытка запуска API сервера...${NC}"
    
    # Проверяем, есть ли package.json (Node.js проект)
    if [ -f "package.json" ]; then
        echo -e "${BLUE}📦 Найден package.json, запускаем npm start...${NC}"
        
        # Запускаем в фоне
        npm start > "$TEST_CONFIG_LOGS_DIR/api-startup.log" 2>&1 &
        local api_pid=$!
        
        echo -e "${BLUE}🔄 API запускается (PID: $api_pid), ожидаем готовности...${NC}"
        
        # Ждем готовности API
        local ready=false
        for i in {1..30}; do
            sleep 2
            if check_api_availability >/dev/null 2>&1; then
                ready=true
                break
            fi
        done
        
        if $ready; then
            echo -e "${GREEN}✅ API сервер успешно запущен${NC}"
            echo "$api_pid" > "$TEST_CONFIG_TEMP_DIR/api.pid"
            return 0
        else
            echo -e "${RED}❌ API сервер не запустился в течение 60 секунд${NC}"
            kill $api_pid 2>/dev/null || true
            return 1
        fi
    fi
    
    # Проверяем Docker Compose
    if [ -f "docker-compose.yml" ] || [ -f "docker-compose.dev.yml" ]; then
        echo -e "${BLUE}🐳 Найден docker-compose, запускаем контейнеры...${NC}"
        
        local compose_file="docker-compose.dev.yml"
        [ -f "$compose_file" ] || compose_file="docker-compose.yml"
        
        docker-compose -f "$compose_file" up -d > "$TEST_CONFIG_LOGS_DIR/docker-startup.log" 2>&1
        
        if [ $? -eq 0 ]; then
            echo -e "${BLUE}🔄 Контейнеры запущены, ожидаем готовности API...${NC}"
            
            # Ждем готовности API
            sleep 10
            for i in {1..30}; do
                if check_api_availability >/dev/null 2>&1; then
                    echo -e "${GREEN}✅ API в контейнере готов${NC}"
                    return 0
                fi
                sleep 2
            done
            
            echo -e "${RED}❌ API в контейнере не готов в течение 60 секунд${NC}"
            return 1
        else
            echo -e "${RED}❌ Ошибка запуска Docker контейнеров${NC}"
            return 1
        fi
    fi
    
    echo -e "${YELLOW}⚠️  Не найдены способы автоматического запуска API${NC}"
    echo -e "${YELLOW}ℹ️  Запустите API вручную:${NC}"
    echo -e "${YELLOW}     • npm start${NC}"
    echo -e "${YELLOW}     • docker-compose up${NC}"
    return 1
}

# =============================================================================
# Main Health Check Function
# =============================================================================

perform_full_health_check() {
    echo -e "${CYAN}🏥 Выполнение полной проверки готовности системы...${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    local start_time=$(date +%s)
    local checks_passed=0
    local checks_total=0
    
    # 1. Проверка базы данных
    ((checks_total++))
    if check_database_connection; then
        ((checks_passed++))
        
        # Дополнительные проверки БД, если основная прошла
        if check_database_schema && check_test_data; then
            echo -e "${GREEN}✅ База данных полностью готова${NC}"
        fi
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # 2. Проверка API
    ((checks_total++))
    if check_api_availability; then
        ((checks_passed++))
        
        # Дополнительные проверки API, если основная прошла
        if check_api_endpoints && check_api_authentication; then
            echo -e "${GREEN}✅ API полностью готов${NC}"
        fi
    else
        # Пытаемся запустить API автоматически
        echo -e "${YELLOW}🔧 Попытка автоматического запуска API...${NC}"
        if start_api_server; then
            ((checks_passed++))
            
            # Повторная проверка после запуска
            if check_api_endpoints && check_api_authentication; then
                echo -e "${GREEN}✅ API успешно запущен и готов${NC}"
            fi
        fi
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Итоги
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    echo -e "${CYAN}📊 Результаты проверки готовности:${NC}"
    echo -e "${BLUE}   Проверок пройдено: $checks_passed/$checks_total${NC}"
    echo -e "${BLUE}   Время выполнения: $(format_duration $duration)${NC}"
    
    if [ $checks_passed -eq $checks_total ]; then
        echo -e "${GREEN}🎉 Система полностью готова к тестированию!${NC}"
        return 0
    else
        echo -e "${RED}⚠️  Система не готова к тестированию${NC}"
        echo -e "${YELLOW}ℹ️  Устраните проблемы перед запуском тестов${NC}"
        return 1
    fi
}

# =============================================================================
# Script Execution
# =============================================================================

# Если скрипт запущен напрямую
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    perform_full_health_check
    exit $?
fi
