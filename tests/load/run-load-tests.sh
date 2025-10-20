#!/bin/bash

# Нагрузочные тесты для API InfraSafe
# Требует установки: curl, jq, bc

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Загрузка утилиты определения порта
source "$(dirname "$0")/../utils/port-detector.sh"

# Проверка, что переменные установлены
if [ -z "$API_PORT" ] || [ -z "$API_URL" ]; then
    echo "❌ Ошибка: переменные API не установлены"
    exit 1
fi

# Конфигурация
REPORTS_DIR="tests/reports"
LOAD_REPORT="$REPORTS_DIR/load-test-report-$(date +%Y%m%d-%H%M%S).json"

# Создаем директорию для отчетов
mkdir -p "$REPORTS_DIR"

echo -e "${CYAN} Запуск нагрузочных тестов InfraSafe API${NC}"
echo -e "${YELLOW}API URL: $API_URL (порт: $API_PORT)${NC}"
echo -e "${YELLOW}Отчет: $LOAD_REPORT${NC}"

# Получение JWT токена
get_jwt_token() {
    echo -e "${CYAN}🔐 Получение JWT токена...${NC}"
    
    local response=$(curl -s -X POST "$API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username": "testuser", "password": "TestPass123"}')
    
    local token=$(echo "$response" | jq -r '.accessToken // empty')
    
    if [ -z "$token" ] || [ "$token" = "null" ]; then
        echo -e "${RED}❌ Не удалось получить JWT токен${NC}"
        return 1
    fi
    
    echo "$token"
}

# Функция для выполнения нагрузочного теста
run_load_test() {
    local test_name="$1"
    local endpoint="$2"
    local method="$3"
    local data="$4"
    local requests="$5"
    local concurrency="$6"
    
    echo -e "${CYAN} Тест: $test_name${NC}"
    echo -e "${YELLOW}Endpoint: $method $endpoint${NC}"
    echo -e "${YELLOW}Запросов: $requests, Конкурентность: $concurrency${NC}"
    
    local start_time=$(date +%s.%N)
    local success_count=0
    local error_count=0
    local total_time=0
    
    # Подготовка заголовков
    local headers="-H 'Content-Type: application/json'"
    if [ ! -z "$JWT_TOKEN" ]; then
        headers="$headers -H 'Authorization: Bearer $JWT_TOKEN'"
    fi
    
    # Выполнение запросов
    for ((i=1; i<=requests; i++)); do
        local request_start=$(date +%s.%N)
        
        if [ -z "$data" ]; then
            local response=$(curl -s -w "%{http_code}|%{time_total}" \
                -X "$method" $headers "$API_URL$endpoint")
        else
            local response=$(curl -s -w "%{http_code}|%{time_total}" \
                -X "$method" $headers "$API_URL$endpoint" -d "$data")
        fi
        
        local http_code=$(echo "$response" | tail -1 | cut -d'|' -f1)
        local response_time=$(echo "$response" | tail -1 | cut -d'|' -f2)
        
        if [[ $http_code -ge 200 && $http_code -lt 300 ]]; then
            ((success_count++))
        else
            ((error_count++))
        fi
        
        total_time=$(echo "$total_time + $response_time" | bc -l)
        
        # Небольшая задержка для имитации реальной нагрузки
        sleep 0.01
    done
    
    local end_time=$(date +%s.%N)
    local total_duration=$(echo "$end_time - $start_time" | bc -l)
    local avg_response_time=$(echo "scale=3; $total_time / $requests" | bc -l)
    local success_rate=$(echo "scale=2; $success_count * 100 / $requests" | bc -l)
    local requests_per_second=$(echo "scale=2; $requests / $total_duration" | bc -l)
    
    # Сохранение результатов
    local result=$(cat <<EOF
{
    "test_name": "$test_name",
    "endpoint": "$method $endpoint",
    "requests": $requests,
    "concurrency": $concurrency,
    "success_count": $success_count,
    "error_count": $error_count,
    "success_rate": $success_rate,
    "total_duration": $total_duration,
    "avg_response_time": $avg_response_time,
    "requests_per_second": $requests_per_second,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)
    
    echo "$result" >> "$LOAD_REPORT"
    
    echo -e "${GREEN}✅ Успешно: $success_count${NC}"
    echo -e "${RED}❌ Ошибки: $error_count${NC}"
    echo -e "${BLUE}📈 Успешность: ${success_rate}%${NC}"
    echo -e "${BLUE}⏱️  Среднее время ответа: ${avg_response_time}s${NC}"
    echo -e "${BLUE} Запросов в секунду: ${requests_per_second}${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
}

# Основная функция
main() {
    echo -e "${CYAN}🔐 Получение JWT токена...${NC}"
    JWT_TOKEN=$(get_jwt_token)
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Не удалось получить токен. Завершение тестов.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ JWT токен получен${NC}"
    
    # Инициализация отчета
    echo "[]" > "$LOAD_REPORT"
    
    echo -e "${CYAN} Запуск нагрузочных тестов...${NC}"
    
    # Тест 1: Получение списка зданий (GET)
    run_load_test "Get Buildings List" "/api/buildings" "GET" "" 100 10
    
    # Тест 2: Получение списка контроллеров (GET)
    run_load_test "Get Controllers List" "/api/controllers" "GET" "" 100 10
    
    # Тест 3: Получение метрик (GET)
    run_load_test "Get Metrics" "/api/metrics" "GET" "" 100 10
    
    # Тест 4: Создание здания (POST)
    local building_data='{"name": "Load Test Building", "address": "Test Address", "latitude": 55.7558, "longitude": 37.6176, "building_type": "residential", "floors": 10, "year_built": 2020}'
    run_load_test "Create Building" "/api/buildings" "POST" "$building_data" 50 5
    
    # Тест 5: Создание контроллера (POST)
    local controller_data='{"name": "Load Test Controller", "type": "temperature", "location": "Test Location", "building_id": 1, "status": "active"}'
    run_load_test "Create Controller" "/api/controllers" "POST" "$controller_data" 50 5
    
    # Тест 6: Отправка телеметрии (POST)
    local telemetry_data='{"controller_id": 1, "metric_type": "temperature", "value": 22.5, "unit": "celsius", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
    run_load_test "Send Telemetry" "/api/metrics/telemetry" "POST" "$telemetry_data" 200 20
    
    # Тест 7: Аналитика (GET)
    run_load_test "Get Analytics" "/api/analytics/buildings" "GET" "" 50 5
    
    # Тест 8: Алерты (GET)
    run_load_test "Get Alerts" "/api/alerts" "GET" "" 50 5
    
    echo -e "${GREEN}✅ Все нагрузочные тесты завершены${NC}"
    echo -e "${BLUE}📊 Отчет сохранен: $LOAD_REPORT${NC}"
    
    # Генерация сводки
    generate_summary
}

# Генерация сводки результатов
generate_summary() {
    echo -e "${CYAN} Сводка результатов нагрузочного тестирования:${NC}"
    
    if [ -f "$LOAD_REPORT" ]; then
        local total_tests=$(jq length "$LOAD_REPORT")
        local avg_success_rate=$(jq -r '[.[].success_rate] | add / length | . * 100 | floor / 100' "$LOAD_REPORT")
        local avg_response_time=$(jq -r '[.[].avg_response_time] | add / length' "$LOAD_REPORT")
        local avg_rps=$(jq -r '[.[].requests_per_second] | add / length' "$LOAD_REPORT")
        
        echo -e "${BLUE}Всего тестов: $total_tests${NC}"
        echo -e "${BLUE}Средняя успешность: ${avg_success_rate}%${NC}"
        echo -e "${BLUE}Среднее время ответа: ${avg_response_time}s${NC}"
        echo -e "${BLUE}Средняя пропускная способность: ${avg_rps} RPS${NC}"
        
        # Проверка производительности
        if (( $(echo "$avg_success_rate >= 95" | bc -l) )); then
            echo -e "${GREEN}✅ Успешность в норме (>= 95%)${NC}"
        else
            echo -e "${RED}❌ Низкая успешность (< 95%)${NC}"
        fi
        
        if (( $(echo "$avg_response_time <= 1.0" | bc -l) )); then
            echo -e "${GREEN}✅ Время ответа в норме (<= 1.0s)${NC}"
        else
            echo -e "${RED}❌ Медленное время ответа (> 1.0s)${NC}"
        fi
    fi
}

# Обработка сигналов
trap 'echo -e "\n${YELLOW}⚠️  Тестирование прервано пользователем${NC}"; exit 1' INT TERM

# Запуск основной функции
main "$@" 