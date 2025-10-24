#!/bin/bash

# Smoke тесты для проверки работоспособности API InfraSafe
# Быстрая проверка основных функций

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
SMOKE_REPORT="tests/reports/smoke-test-$(date +%Y%m%d-%H%M%S).log"

# Создаем директорию для отчетов
mkdir -p "tests/reports"

echo -e "${CYAN}🚬 Запуск Smoke тестов InfraSafe API${NC}"
echo -e "${YELLOW}API URL: $API_URL (порт: $API_PORT)${NC}"
echo -e "${YELLOW}Отчет: $SMOKE_REPORT${NC}"

# Счетчики
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Функция для выполнения теста
run_smoke_test() {
    local test_name="$1"
    local method="$2"
    local endpoint="$3"
    local expected_status="$4"
    local data="$5"
    local description="$6"
    
    ((TOTAL_TESTS++))
    
    echo -e "${CYAN} Тест $TOTAL_TESTS: $test_name${NC}"
    echo -e "${YELLOW}Описание: $description${NC}"
    
    # Подготовка заголовков
    local headers="-H 'Content-Type: application/json'"
    if [ ! -z "$JWT_TOKEN" ]; then
        headers="$headers -H 'Authorization: Bearer $JWT_TOKEN'"
    fi
    
    # Выполнение запроса
    local response
    if [ -z "$data" ]; then
        response=$(curl -s -w "%{http_code}" -X "$method" $headers "$API_URL$endpoint")
    else
        response=$(curl -s -w "%{http_code}" -X "$method" $headers "$API_URL$endpoint" -d "$data")
    fi
    
    local http_code="${response: -3}"
    local response_body="${response%???}"
    
    # Проверка результата
    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ ПРОЙДЕН${NC}"
        echo -e "${BLUE}Статус: $http_code${NC}"
        ((PASSED_TESTS++))
        
        # Логируем успех
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] PASS: $test_name - $method $endpoint - $http_code" >> "$SMOKE_REPORT"
    else
        echo -e "${RED}❌ ПРОВАЛЕН${NC}"
        echo -e "${RED}Ожидался: $expected_status, Получен: $http_code${NC}"
        echo -e "${BLUE}Ответ: $response_body${NC}"
        ((FAILED_TESTS++))
        
        # Логируем ошибку
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAIL: $test_name - $method $endpoint - Expected: $expected_status, Got: $http_code" >> "$SMOKE_REPORT"
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    sleep 0.5
}

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
    echo "=== Smoke Test Report - $(date) ===" > "$SMOKE_REPORT"
    echo "API URL: $API_URL" >> "$SMOKE_REPORT"
    echo "" >> "$SMOKE_REPORT"
    
    echo -e "${CYAN}🚬 Запуск Smoke тестов...${NC}"
    
    # 1. Проверка доступности API
    run_smoke_test "API Health Check" "GET" "/api" "200" "" "Проверка доступности API"
    
    # 2. Авторизация
    run_smoke_test "Authentication" "POST" "/api/auth/login" "200" '{"username": "testuser", "password": "TestPass123"}' "Проверка авторизации"
    
    # 3. Получение списка зданий
    run_smoke_test "Get Buildings" "GET" "/api/buildings" "200" "" "Получение списка зданий"
    
    # 4. Получение списка контроллеров
    run_smoke_test "Get Controllers" "GET" "/api/controllers" "200" "" "Получение списка контроллеров"
    
    # 5. Получение метрик
    run_smoke_test "Get Metrics" "GET" "/api/metrics" "200" "" "Получение метрик"
    
    # 6. Отправка телеметрии (без авторизации)
    local telemetry_data='{"controller_id": 1, "metric_type": "temperature", "value": 22.5, "unit": "celsius", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
    run_smoke_test "Send Telemetry" "POST" "/api/metrics/telemetry" "200" "$telemetry_data" "Отправка телеметрии"
    
    # 7. Получение аналитики
    run_smoke_test "Get Analytics" "GET" "/api/analytics/buildings" "200" "" "Получение аналитики по зданиям"
    
    # 8. Получение алертов
    run_smoke_test "Get Alerts" "GET" "/api/alerts" "200" "" "Получение алертов"
    
    # 9. Создание тестового здания
    local building_data='{"name": "Smoke Test Building", "address": "Test Address", "latitude": 55.7558, "longitude": 37.6176, "building_type": "residential", "floors": 5, "year_built": 2020}'
    run_smoke_test "Create Building" "POST" "/api/buildings" "201" "$building_data" "Создание здания"
    
    # 10. Проверка защищенных endpoints без токена
    run_smoke_test "Protected Endpoint Without Auth" "POST" "/api/buildings" "401" '{"name": "test"}' "Проверка защиты без авторизации"
    
    # 11. Проверка несуществующего endpoint
    run_smoke_test "Non-existent Endpoint" "GET" "/api/nonexistent" "404" "" "Проверка обработки 404 ошибок"
    
    # 12. Проверка валидации данных
    run_smoke_test "Data Validation" "POST" "/api/buildings" "400" '{"invalid": "data"}' "Проверка валидации данных"
    
    echo -e "${GREEN}✅ Все Smoke тесты завершены${NC}"
    
    # Вывод результатов
    echo -e "${CYAN}📊 Результаты Smoke тестирования:${NC}"
    echo -e "${BLUE}Всего тестов: $TOTAL_TESTS${NC}"
    echo -e "${GREEN}Пройдено: $PASSED_TESTS${NC}"
    echo -e "${RED}Провалено: $FAILED_TESTS${NC}"
    
    local success_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
    echo -e "${BLUE}Успешность: ${success_rate}%${NC}"
    
    # Логируем итоги
    echo "" >> "$SMOKE_REPORT"
    echo "=== SUMMARY ===" >> "$SMOKE_REPORT"
    echo "Total Tests: $TOTAL_TESTS" >> "$SMOKE_REPORT"
    echo "Passed: $PASSED_TESTS" >> "$SMOKE_REPORT"
    echo "Failed: $FAILED_TESTS" >> "$SMOKE_REPORT"
    echo "Success Rate: ${success_rate}%" >> "$SMOKE_REPORT"
    
    # Определяем статус
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN} Все тесты пройдены успешно!${NC}"
        echo "RESULT: SUCCESS" >> "$SMOKE_REPORT"
        exit 0
    else
        echo -e "${RED}⚠️  Некоторые тесты провалены${NC}"
        echo "RESULT: FAILED" >> "$SMOKE_REPORT"
        exit 1
    fi
}

# Обработка сигналов
trap 'echo -e "\n${YELLOW}⚠️  Тестирование прервано пользователем${NC}"; exit 1' INT TERM

# Запуск основной функции
main "$@" 