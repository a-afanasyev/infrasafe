#!/bin/bash

# =============================================================================
# Smart Smoke Testing - InfraSafe Testing Framework
# =============================================================================

# Загружаем конфигурацию
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config/unified-config.sh"
source "$SCRIPT_DIR/../utils/health-checker.sh"

# =============================================================================
# Smoke Testing Configuration
# =============================================================================

SMOKE_REPORT="$TEST_CONFIG_REPORTS_DIR/smoke-test-$(date +%Y%m%d-%H%M%S).log"
SMOKE_JSON_REPORT="$TEST_CONFIG_REPORTS_DIR/smoke-test-$(date +%Y%m%d-%H%M%S).json"

# =============================================================================
# Smoke Testing Functions
# =============================================================================

# Выполнение одного smoke теста
run_smoke_test() {
    local test_name="$1"
    local method="$2"
    local endpoint="$3"
    local expected_status="$4"
    local data="$5"
    local headers="$6"
    local description="$7"
    
    echo -e "${CYAN}🚬 Тест: $test_name${NC}"
    echo -e "${YELLOW}Описание: $description${NC}"
    echo -e "${BLUE}Запрос: $method $endpoint${NC}"
    
    local start_time=$(date +%s.%N)
    
    # Выполняем запрос с улучшенной обработкой ошибок
    local response=$(safe_curl "$method" "$endpoint" "$data" "$headers" 3)
    local http_code="${response: -3}"
    local response_body="${response%???}"
    
    local end_time=$(date +%s.%N)
    local response_time=$(echo "$end_time - $start_time" | bc -l)
    
    # Форматируем время ответа
    local formatted_time=$(printf "%.3f" "$response_time")
    
    # Проверяем результат
    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ ПРОЙДЕН${NC}"
        echo -e "${BLUE}Статус: $http_code, Время: ${formatted_time}s${NC}"
        
        # Логируем успех
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] PASS: $test_name - $method $endpoint - $http_code (${formatted_time}s)" >> "$SMOKE_REPORT"
        
        return 0
    else
        echo -e "${RED}❌ ПРОВАЛЕН${NC}"
        echo -e "${RED}Ожидался: $expected_status, Получен: $http_code${NC}"
        
        # Показываем детали ошибки только если они полезны
        if [ "$http_code" != "000" ] && [ -n "$response_body" ] && [ ${#response_body} -lt 500 ]; then
            echo -e "${BLUE}Ответ: $response_body${NC}"
        elif [ "$http_code" = "000" ]; then
            echo -e "${RED}Ошибка подключения: API недоступен${NC}"
        fi
        
        # Логируем ошибку
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $test_name - $method $endpoint - Expected: $expected_status, Got: $http_code (${formatted_time}s)" >> "$SMOKE_REPORT"
        
        return 1
    fi
}

# Получение JWT токена для smoke тестов
get_smoke_test_token() {
    echo -e "${CYAN}🔐 Получение JWT токена...${NC}"
    
    local auth_data="{\"username\": \"$TEST_CONFIG_TEST_USERNAME\", \"password\": \"$TEST_CONFIG_TEST_PASSWORD\"}"
    local response=$(safe_curl "POST" "/api/auth/login" "$auth_data" "-H 'Content-Type: application/json'" 3)
    local http_code="${response: -3}"
    local response_body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        local token=$(echo "$response_body" | jq -r '.accessToken // empty' 2>/dev/null)
        
        if [ -n "$token" ] && [ "$token" != "null" ]; then
            echo -e "${GREEN}✅ JWT токен получен${NC}"
            echo "$token"
            return 0
        fi
    fi
    
    echo -e "${RED}❌ Не удалось получить JWT токен${NC}"
    return 1
}

# Очистка тестовых ресурсов
cleanup_smoke_test_resources() {
    echo -e "${CYAN}🧹 Очистка тестовых ресурсов...${NC}"
    
    # Если у нас есть токен и созданные тестовые ресурсы, удаляем их
    if [ -n "$JWT_TOKEN" ] && [ -n "$TEST_BUILDING_ID" ]; then
        echo -e "${BLUE}   Удаление тестового здания (ID: $TEST_BUILDING_ID)...${NC}"
        safe_curl "DELETE" "/api/buildings/$TEST_BUILDING_ID" "" "-H 'Authorization: Bearer $JWT_TOKEN'" 1 >/dev/null 2>&1
    fi
    
    if [ -n "$JWT_TOKEN" ] && [ -n "$TEST_CONTROLLER_ID" ]; then
        echo -e "${BLUE}   Удаление тестового контроллера (ID: $TEST_CONTROLLER_ID)...${NC}"
        safe_curl "DELETE" "/api/controllers/$TEST_CONTROLLER_ID" "" "-H 'Authorization: Bearer $JWT_TOKEN'" 1 >/dev/null 2>&1
    fi
    
    # Очищаем временные файлы
    rm -f /tmp/smoke_test_*.json 2>/dev/null || true
    
    echo -e "${GREEN}✅ Очистка завершена${NC}"
}

# Основная функция smoke тестирования
run_smart_smoke_tests() {
    echo -e "${CYAN}🚬 Запуск Smart Smoke тестов InfraSafe API${NC}"
    echo -e "${YELLOW}API URL: $TEST_CONFIG_API_URL${NC}"
    echo -e "${YELLOW}Отчет: $SMOKE_REPORT${NC}"
    echo -e "${YELLOW}JSON отчет: $SMOKE_JSON_REPORT${NC}"
    
    local start_time=$(date +%s)
    local test_results=()
    local passed_tests=0
    local failed_tests=0
    local total_tests=0
    
    # Инициализация отчета
    echo "=== Smart Smoke Test Report - $(date) ===" > "$SMOKE_REPORT"
    echo "API URL: $TEST_CONFIG_API_URL" >> "$SMOKE_REPORT"
    echo "" >> "$SMOKE_REPORT"
    
    # Настройка автоочистки
    trap cleanup_smoke_test_resources EXIT
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 1: Проверка доступности API
    ((total_tests++))
    if run_smoke_test "API Health Check" "GET" "/api" "200" "" "-H 'Content-Type: application/json'" "Проверка доступности основного API endpoint"; then
        ((passed_tests++))
        test_results+=('{"name": "API Health Check", "status": "PASS", "endpoint": "/api", "method": "GET"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "API Health Check", "status": "FAIL", "endpoint": "/api", "method": "GET"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 2: Аутентификация
    ((total_tests++))
    local auth_data="{\"username\": \"$TEST_CONFIG_TEST_USERNAME\", \"password\": \"$TEST_CONFIG_TEST_PASSWORD\"}"
    if run_smoke_test "Authentication" "POST" "/api/auth/login" "200" "$auth_data" "-H 'Content-Type: application/json'" "Проверка системы аутентификации"; then
        ((passed_tests++))
        test_results+=('{"name": "Authentication", "status": "PASS", "endpoint": "/api/auth/login", "method": "POST"}')
        
        # Получаем токен для дальнейших тестов (берем последнюю строку вывода)
        JWT_TOKEN=$(get_smoke_test_token 2>/dev/null | tail -n 1)
    else
        ((failed_tests++))
        test_results+=('{"name": "Authentication", "status": "FAIL", "endpoint": "/api/auth/login", "method": "POST"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 3: Получение списка зданий
    ((total_tests++))
    if run_smoke_test "Get Buildings" "GET" "/api/buildings" "200" "" "-H 'Content-Type: application/json'" "Получение списка зданий"; then
        ((passed_tests++))
        test_results+=('{"name": "Get Buildings", "status": "PASS", "endpoint": "/api/buildings", "method": "GET"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "Get Buildings", "status": "FAIL", "endpoint": "/api/buildings", "method": "GET"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 4: Получение списка контроллеров
    ((total_tests++))
    if run_smoke_test "Get Controllers" "GET" "/api/controllers" "200" "" "-H 'Content-Type: application/json'" "Получение списка контроллеров"; then
        ((passed_tests++))
        test_results+=('{"name": "Get Controllers", "status": "PASS", "endpoint": "/api/controllers", "method": "GET"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "Get Controllers", "status": "FAIL", "endpoint": "/api/controllers", "method": "GET"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 5: Получение метрик
    ((total_tests++))
    if run_smoke_test "Get Metrics" "GET" "/api/metrics" "200" "" "-H 'Content-Type: application/json'" "Получение списка метрик"; then
        ((passed_tests++))
        test_results+=('{"name": "Get Metrics", "status": "PASS", "endpoint": "/api/metrics", "method": "GET"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "Get Metrics", "status": "FAIL", "endpoint": "/api/metrics", "method": "GET"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 6: Swagger документация
    ((total_tests++))
    if run_smoke_test "API Documentation" "GET" "/api-docs/" "200" "" "-H 'Accept: text/html'" "Проверка доступности Swagger документации"; then
        ((passed_tests++))
        test_results+=('{"name": "API Documentation", "status": "PASS", "endpoint": "/api-docs/", "method": "GET"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "API Documentation", "status": "FAIL", "endpoint": "/api-docs/", "method": "GET"}')
    fi
    
    # Тесты с авторизацией (если токен получен)
    if [ -n "$JWT_TOKEN" ]; then
        echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
        
        # Тест 7: Создание тестового здания (защищенный endpoint)
        ((total_tests++))
        local building_data="{\"name\": \"Smoke Test Building\", \"address\": \"Test Address\", \"town\": \"Test Town\", \"latitude\": 55.7558, \"longitude\": 37.6176}"
        if run_smoke_test "Create Building (Auth)" "POST" "/api/buildings" "201" "$building_data" "-H \"Authorization: Bearer $JWT_TOKEN\" -H 'Content-Type: application/json'" "Создание здания (требует авторизации)"; then
            ((passed_tests++))
            test_results+=('{"name": "Create Building (Auth)", "status": "PASS", "endpoint": "/api/buildings", "method": "POST"}')
            
            # Сохраняем ID для последующего удаления
            # В реальном случае нужно было бы парсить ответ для получения ID
        else
            ((failed_tests++))
            test_results+=('{"name": "Create Building (Auth)", "status": "FAIL", "endpoint": "/api/buildings", "method": "POST"}')
        fi
        
        echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
        
        # Тест 8: Получение профиля пользователя
        ((total_tests++))
        if run_smoke_test "User Profile" "GET" "/api/auth/profile" "200" "" "-H \"Authorization: Bearer $JWT_TOKEN\" -H 'Content-Type: application/json'" "Получение профиля авторизованного пользователя"; then
            ((passed_tests++))
            test_results+=('{"name": "User Profile", "status": "PASS", "endpoint": "/api/auth/profile", "method": "GET"}')
        else
            ((failed_tests++))
            test_results+=('{"name": "User Profile", "status": "FAIL", "endpoint": "/api/auth/profile", "method": "GET"}')
        fi
    else
        echo -e "${YELLOW}⚠️  Пропускаем тесты с авторизацией (JWT токен недоступен)${NC}"
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест неавторизованного доступа к защищенному endpoint
    ((total_tests++))
    local unauthorized_data="{\"name\": \"Unauthorized Test\"}"
    if run_smoke_test "Unauthorized Access" "POST" "/api/buildings" "401" "$unauthorized_data" "-H 'Content-Type: application/json'" "Проверка защиты от неавторизованного доступа"; then
        ((passed_tests++))
        test_results+=('{"name": "Unauthorized Access", "status": "PASS", "endpoint": "/api/buildings", "method": "POST"}')
    else
        ((failed_tests++))
        test_results+=('{"name": "Unauthorized Access", "status": "FAIL", "endpoint": "/api/buildings", "method": "POST"}')
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Подведение итогов
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    local success_rate=0
    
    if [ $total_tests -gt 0 ]; then
        success_rate=$(echo "scale=1; $passed_tests * 100 / $total_tests" | bc -l)
    fi
    
    # Создаем JSON отчет
    cat > "$SMOKE_JSON_REPORT" << EOF
{
    "report_info": {
        "timestamp": "$(date -Iseconds)",
        "api_url": "$TEST_CONFIG_API_URL",
        "duration": $total_duration,
        "test_type": "smoke"
    },
    "summary": {
        "total_tests": $total_tests,
        "passed_tests": $passed_tests,
        "failed_tests": $failed_tests,
        "success_rate": $success_rate
    },
    "tests": [
EOF
    
    # Добавляем результаты в JSON
    local first=true
    for result in "${test_results[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> "$SMOKE_JSON_REPORT"
        fi
        echo "        $result" >> "$SMOKE_JSON_REPORT"
    done
    
    echo "    ]" >> "$SMOKE_JSON_REPORT"
    echo "}" >> "$SMOKE_JSON_REPORT"
    
    # Выводим результаты
    echo -e "${CYAN}📊 Результаты Smoke тестирования:${NC}"
    echo -e "${BLUE}   Время выполнения: $(format_duration $total_duration)${NC}"
    echo -e "${BLUE}   Всего тестов: $total_tests${NC}"
    echo -e "${GREEN}   Пройдено: $passed_tests${NC}"
    echo -e "${RED}   Провалено: $failed_tests${NC}"
    echo -e "${BLUE}   Успешность: ${success_rate}%${NC}"
    
    # Логируем итоги
    echo "" >> "$SMOKE_REPORT"
    echo "=== SUMMARY ===" >> "$SMOKE_REPORT"
    echo "Total Tests: $total_tests" >> "$SMOKE_REPORT"
    echo "Passed: $passed_tests" >> "$SMOKE_REPORT"
    echo "Failed: $failed_tests" >> "$SMOKE_REPORT"
    echo "Success Rate: ${success_rate}%" >> "$SMOKE_REPORT"
    echo "Duration: $(format_duration $total_duration)" >> "$SMOKE_REPORT"
    
    echo -e "${BLUE}📄 Отчеты сохранены:${NC}"
    echo -e "${BLUE}   Текстовый: $SMOKE_REPORT${NC}"
    echo -e "${BLUE}   JSON: $SMOKE_JSON_REPORT${NC}"
    
    # Определяем статус
    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}🎉 Все smoke тесты пройдены успешно!${NC}"
        echo "RESULT: SUCCESS" >> "$SMOKE_REPORT"
        return 0
    else
        echo -e "${RED}⚠️  Некоторые smoke тесты провалены${NC}"
        echo "RESULT: FAILED" >> "$SMOKE_REPORT"
        return 1
    fi
}

# =============================================================================
# Script Execution
# =============================================================================

# Обработка сигналов
trap 'echo -e "\n${YELLOW}⚠️  Smoke тестирование прервано пользователем${NC}"; cleanup_smoke_test_resources; exit 1' INT TERM

# Если скрипт запущен напрямую
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo -e "${CYAN}🚀 Запуск Smart Smoke Testing...${NC}"
    
    # Быстрая проверка доступности API
    if ! check_api_availability >/dev/null 2>&1; then
        echo -e "${RED}❌ API недоступен для smoke тестов${NC}"
        echo -e "${YELLOW}ℹ️  Запустите API сервер перед выполнением smoke тестов${NC}"
        exit 1
    fi
    
    run_smart_smoke_tests
    exit $?
fi
