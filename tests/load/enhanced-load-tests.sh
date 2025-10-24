#!/bin/bash

# =============================================================================
# Enhanced Load Testing - InfraSafe Testing Framework
# =============================================================================

# Загружаем конфигурацию
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config/unified-config.sh"
source "$SCRIPT_DIR/../utils/health-checker.sh"

# =============================================================================
# Load Testing Configuration
# =============================================================================

LOAD_REPORT="$TEST_CONFIG_REPORTS_DIR/load-test-report-$(date +%Y%m%d-%H%M%S).json"
LOAD_LOG="$TEST_CONFIG_LOGS_DIR/load-test-$(date +%Y%m%d-%H%M%S).log"

# =============================================================================
# Load Testing Functions
# =============================================================================

# Получение JWT токена для нагрузочных тестов
get_load_test_token() {
    echo -e "${CYAN}🔐 Получение JWT токена для нагрузочных тестов...${NC}" >&2
    
    local auth_data="{\"username\": \"$TEST_CONFIG_TEST_USERNAME\", \"password\": \"$TEST_CONFIG_TEST_PASSWORD\"}"
    local response=$(safe_curl "POST" "/api/auth/login" "$auth_data" "-H 'Content-Type: application/json'" 3)
    local http_code="${response: -3}"
    local response_body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        local token=$(echo "$response_body" | jq -r '.accessToken // empty' 2>/dev/null)
        
        if [ -n "$token" ] && [ "$token" != "null" ]; then
            echo -e "${GREEN}✅ JWT токен получен для нагрузочных тестов${NC}" >&2
            echo "$token"
            return 0
        fi
    fi
    
    echo -e "${RED}❌ Не удалось получить JWT токен${NC}" >&2
    return 1
}

# Выполнение параллельных запросов
run_parallel_requests() {
    local endpoint="$1"
    local method="$2"
    local auth_header="$3"
    local data="$4"
    local num_requests="$5"
    local concurrency="$6"
    local test_name="$7"
    
    echo -e "${CYAN}⚡ Тест: $test_name${NC}" >&2
    echo -e "${BLUE}Endpoint: $method $endpoint${NC}" >&2
    echo -e "${BLUE}Запросов: $num_requests, Конкурентность: $concurrency${NC}" >&2
    
    local start_time=$(date +%s.%N)
    local success_count=0
    local error_count=0
    local total_response_time=0
    local temp_dir="$TEST_CONFIG_TEMP_DIR/load-test-$$"
    
    mkdir -p "$temp_dir"
    
    # Функция для выполнения одного запроса
    single_request() {
        local request_id="$1"
        local req_start=$(date +%s.%N)
        
        local response=$(safe_curl "$method" "$endpoint" "$data" "$auth_header" 1)
        local http_code="${response: -3}"
        local req_end=$(date +%s.%N)
        local req_time=$(echo "$req_end - $req_start" | bc -l)
        
        # Записываем результат
        echo "{\"id\": $request_id, \"status\": \"$http_code\", \"time\": $req_time}" > "$temp_dir/result_$request_id.json"
    }
    
    # Запускаем запросы пакетами для управления конкурентностью
    local batch_size=$concurrency
    local processed=0
    
    while [ $processed -lt $num_requests ]; do
        local batch_end=$((processed + batch_size))
        [ $batch_end -gt $num_requests ] && batch_end=$num_requests
        
        # Запускаем пакет запросов
        for i in $(seq $((processed + 1)) $batch_end); do
            single_request "$i" &
        done
        
        # Ждем завершения пакета
        wait
        
        processed=$batch_end
        
        # Показываем прогресс
        local progress=$((processed * 100 / num_requests))
        echo -e "${YELLOW}   Прогресс: $processed/$num_requests ($progress%)${NC}" >&2
    done
    
    local end_time=$(date +%s.%N)
    local total_time=$(echo "$end_time - $start_time" | bc -l)
    
    # Обрабатываем результаты
    for result_file in "$temp_dir"/result_*.json; do
        if [ -f "$result_file" ]; then
            local status=$(jq -r '.status' "$result_file" 2>/dev/null)
            local req_time=$(jq -r '.time' "$result_file" 2>/dev/null)
            
            if [ "$status" = "200" ] || [ "$status" = "201" ]; then
                ((success_count++))
                total_response_time=$(echo "$total_response_time + $req_time" | bc -l)
            else
                ((error_count++))
            fi
        fi
    done
    
    # Вычисляем метрики
    local success_rate=0
    local avg_response_time=0
    local rps=0
    
    if [ $num_requests -gt 0 ]; then
        success_rate=$(echo "scale=1; $success_count * 100 / $num_requests" | bc -l)
    fi
    
    if [ $success_count -gt 0 ]; then
        avg_response_time=$(echo "scale=3; $total_response_time / $success_count" | bc -l)
    fi
    
    if [ $(echo "$total_time > 0" | bc -l) -eq 1 ]; then
        rps=$(echo "scale=2; $num_requests / $total_time" | bc -l)
    fi
    
    # Выводим результаты
    echo -e "${GREEN}✅ Успешно: $success_count${NC}" >&2
    echo -e "${RED}❌ Ошибки: $error_count${NC}" >&2
    echo -e "${BLUE}📈 Успешность: ${success_rate}%${NC}" >&2
    echo -e "${BLUE}⏱️  Среднее время ответа: ${avg_response_time}s${NC}" >&2
    echo -e "${BLUE}🚀 Запросов в секунду: $rps${NC}" >&2
    
    # Очищаем временные файлы
    rm -rf "$temp_dir"
    
    # Возвращаем JSON результат
    echo "{\"test_name\": \"$test_name\", \"endpoint\": \"$endpoint\", \"method\": \"$method\", \"requests\": $num_requests, \"concurrency\": $concurrency, \"success_count\": $success_count, \"error_count\": $error_count, \"success_rate\": $success_rate, \"avg_response_time\": $avg_response_time, \"rps\": $rps, \"total_time\": $total_time}"
}

# Выполнение полного набора нагрузочных тестов
run_full_load_tests() {
    echo -e "${CYAN}🚀 Запуск полного набора нагрузочных тестов...${NC}"
    echo -e "${YELLOW}API URL: $TEST_CONFIG_API_URL${NC}"
    echo -e "${YELLOW}Отчет: $LOAD_REPORT${NC}"
    echo -e "${YELLOW}Лог: $LOAD_LOG${NC}"
    
    local start_time=$(date +%s)
    local test_results=()
    
    # Получаем JWT токен
    local jwt_token
    jwt_token=$(get_load_test_token)
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Не удалось получить JWT токен. Завершение тестов.${NC}"
        return 1
    fi
    
    local auth_header="-H 'Authorization: Bearer $jwt_token' -H 'Content-Type: application/json'"
    local no_auth_header="-H 'Content-Type: application/json'"
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 1: Получение списка зданий (без авторизации)
    echo -e "${CYAN}📋 Тест 1: Получение списка зданий${NC}"
    local result1=$(run_parallel_requests "/api/buildings" "GET" "$no_auth_header" "" "$TEST_CONFIG_LOAD_REQUESTS" "$TEST_CONFIG_LOAD_CONCURRENCY" "Get Buildings List")
    test_results+=("$result1")
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 2: Получение списка контроллеров (без авторизации)
    echo -e "${CYAN}🎛️  Тест 2: Получение списка контроллеров${NC}"
    local result2=$(run_parallel_requests "/api/controllers" "GET" "$no_auth_header" "" "$TEST_CONFIG_LOAD_REQUESTS" "$TEST_CONFIG_LOAD_CONCURRENCY" "Get Controllers List")
    test_results+=("$result2")
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 3: Получение метрик (без авторизации)
    echo -e "${CYAN}📊 Тест 3: Получение метрик${NC}"
    local result3=$(run_parallel_requests "/api/metrics" "GET" "$no_auth_header" "" "$((TEST_CONFIG_LOAD_REQUESTS / 2))" "$TEST_CONFIG_LOAD_CONCURRENCY" "Get Metrics")
    test_results+=("$result3")
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 4: Аутентификация (средняя нагрузка)
    echo -e "${CYAN}🔐 Тест 4: Аутентификация${NC}"
    local auth_data="{\"username\": \"$TEST_CONFIG_TEST_USERNAME\", \"password\": \"$TEST_CONFIG_TEST_PASSWORD\"}"
    local result4=$(run_parallel_requests "/api/auth/login" "POST" "$no_auth_header" "$auth_data" "50" "5" "Authentication Load")
    test_results+=("$result4")
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Тест 5: Защищенные endpoints (с авторизацией)
    echo -e "${CYAN}🔒 Тест 5: Создание зданий (защищенный endpoint)${NC}"
    local building_data="{\"name\": \"Load Test Building\", \"address\": \"Test Address\", \"town\": \"Test Town\", \"latitude\": 55.7558, \"longitude\": 37.6176}"
    local result5=$(run_parallel_requests "/api/buildings" "POST" "$auth_header" "$building_data" "20" "3" "Create Buildings (Auth Required)")
    test_results+=("$result5")
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Обработка результатов
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    local total_requests=0
    local total_success=0
    local total_errors=0
    local overall_success_rate=0
    
    # Создаем JSON отчет
    cat > "$LOAD_REPORT" << EOF
{
    "report_info": {
        "timestamp": "$(date -Iseconds)",
        "api_url": "$TEST_CONFIG_API_URL",
        "total_duration": $total_duration,
        "configuration": {
            "requests_per_test": $TEST_CONFIG_LOAD_REQUESTS,
            "concurrency": $TEST_CONFIG_LOAD_CONCURRENCY,
            "success_threshold": $TEST_CONFIG_LOAD_SUCCESS_THRESHOLD,
            "response_time_threshold": $TEST_CONFIG_LOAD_RESPONSE_TIME_THRESHOLD
        }
    },
    "tests": [
EOF
    
    # Добавляем результаты тестов в JSON
    local first=true
    for result in "${test_results[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> "$LOAD_REPORT"
        fi
        echo "        $result" >> "$LOAD_REPORT"
        
        # Обновляем общую статистику
        local requests=$(echo "$result" | jq -r '.requests')
        local success=$(echo "$result" | jq -r '.success_count')
        local errors=$(echo "$result" | jq -r '.error_count')
        
        total_requests=$((total_requests + requests))
        total_success=$((total_success + success))
        total_errors=$((total_errors + errors))
    done
    
    # Вычисляем общую успешность
    if [ $total_requests -gt 0 ]; then
        overall_success_rate=$(echo "scale=1; $total_success * 100 / $total_requests" | bc -l)
    fi
    
    # Завершаем JSON отчет
    cat >> "$LOAD_REPORT" << EOF
    ],
    "summary": {
        "total_requests": $total_requests,
        "total_success": $total_success,
        "total_errors": $total_errors,
        "overall_success_rate": $overall_success_rate
    }
}
EOF
    
    # Выводим итоги
    echo -e "${CYAN}📊 Результаты нагрузочного тестирования:${NC}"
    echo -e "${BLUE}   Общее время: $(format_duration $total_duration)${NC}"
    echo -e "${BLUE}   Всего запросов: $total_requests${NC}"
    echo -e "${GREEN}   Успешно: $total_success${NC}"
    echo -e "${RED}   Ошибки: $total_errors${NC}"
    echo -e "${BLUE}   Общая успешность: ${overall_success_rate}%${NC}"
    
    # Проверяем соответствие пороговым значениям
    local threshold_met=true
    
    if [ $(echo "$overall_success_rate < $TEST_CONFIG_LOAD_SUCCESS_THRESHOLD" | bc -l) -eq 1 ]; then
        echo -e "${RED}❌ Успешность ниже порогового значения ($TEST_CONFIG_LOAD_SUCCESS_THRESHOLD%)${NC}"
        threshold_met=false
    else
        echo -e "${GREEN}✅ Успешность соответствует пороговому значению${NC}"
    fi
    
    echo -e "${BLUE}📄 Детальный отчет сохранен: $LOAD_REPORT${NC}"
    
    if [ "$threshold_met" = true ]; then
        echo -e "${GREEN}🎉 Нагрузочные тесты пройдены успешно!${NC}"
        return 0
    else
        echo -e "${RED}⚠️  Нагрузочные тесты завершились с проблемами${NC}"
        return 1
    fi
}

# =============================================================================
# Script Execution
# =============================================================================

# Если скрипт запущен напрямую
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo -e "${CYAN}🚀 Запуск Enhanced Load Testing...${NC}"
    
    # Проверяем готовность системы
    if ! perform_full_health_check >/dev/null 2>&1; then
        echo -e "${RED}❌ Система не готова к нагрузочным тестам${NC}"
        echo -e "${YELLOW}ℹ️  Запустите health checker для диагностики: ./tests/utils/health-checker.sh${NC}"
        exit 1
    fi
    
    run_full_load_tests
    exit $?
fi
