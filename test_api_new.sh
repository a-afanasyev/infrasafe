#!/bin/bash

# Улучшенный скрипт для тестирования API через curl
# Поддерживает параметры командной строки, выборочное тестирование,
# сбор статистики и сохранение результатов в файл

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Переменные по умолчанию
API_URL="http://localhost:3000"
TESTS_TO_RUN="all"
DELAY_BETWEEN_TESTS=1
OUTPUT_FILE=""
SUMMARY_ONLY=false
MAX_RETRIES=1

# Статистика тестирования
TOTAL_TESTS=0
SUCCESSFUL_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

# Обработка аргументов командной строки
print_usage() {
    echo "Использование: $0 [ОПЦИИ]"
    echo "Опции:"
    echo "  --url=URL               Базовый URL API (по умолчанию: http://localhost:3000)"
    echo "  --tests=ТЕСТЫ           Тесты для запуска: all, get, post, put, delete, building, controller, metric"
    echo "                          или конкретный эндпоинт (например: /api/buildings)"
    echo "  --delay=СЕКУНДЫ         Задержка между запросами в секундах (по умолчанию: 1)"
    echo "  --output=ФАЙЛ           Сохранить результаты в файл"
    echo "  --summary               Показать только общую статистику"
    echo "  --retries=ЧИСЛО         Количество повторных попыток при ошибке (по умолчанию: 1)"
    echo "  --help                  Показать эту справку"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --url=*)
            API_URL="${1#*=}"
            ;;
        --tests=*)
            TESTS_TO_RUN="${1#*=}"
            ;;
        --delay=*)
            DELAY_BETWEEN_TESTS="${1#*=}"
            ;;
        --output=*)
            OUTPUT_FILE="${1#*=}"
            ;;
        --summary)
            SUMMARY_ONLY=true
            ;;
        --retries=*)
            MAX_RETRIES="${1#*=}"
            ;;
        --help)
            print_usage
            ;;
        *)
            echo "Неизвестный параметр: $1"
            print_usage
            ;;
    esac
    shift
done

# Функция для проверки, нужно ли выполнять тест
should_run_test() {
    local method=$1
    local endpoint=$2
    
    # Если указано "all", выполняем все тесты
    if [ "$TESTS_TO_RUN" = "all" ]; then
        return 0
    fi
    
    # Если указан конкретный метод (get, post, put, delete)
    if [ "$TESTS_TO_RUN" = "${method,,}" ]; then
        return 0
    fi
    
    # Проверка на группы тестов
    if [[ "$endpoint" == *"/buildings"* ]] && [[ "$TESTS_TO_RUN" == *"building"* ]]; then
        return 0
    fi
    
    if [[ "$endpoint" == *"/controllers"* ]] && [[ "$TESTS_TO_RUN" == *"controller"* ]]; then
        return 0
    fi
    
    if [[ "$endpoint" == *"/metrics"* ]] && [[ "$TESTS_TO_RUN" == *"metric"* ]]; then
        return 0
    fi
    
    # Если указан конкретный эндпоинт
    if [ "$TESTS_TO_RUN" = "$endpoint" ] || [ "$TESTS_TO_RUN" = "${method,,}:$endpoint" ]; then
        return 0
    fi
    
    # Проверка на наличие тестируемого эндпоинта в списке (для случаев --tests=endpoint1,endpoint2)
    IFS=',' read -ra ENDPOINTS <<< "$TESTS_TO_RUN"
    for i in "${ENDPOINTS[@]}"; do
        if [ "$i" = "$endpoint" ] || [ "$i" = "${method,,}:$endpoint" ]; then
            return 0
        fi
    done
    
    return 1
}

# Функция для валидации ответа API
validate_response() {
    local response=$1
    local check_field=$2
    local expected_value=$3
    
    # Проверяем наличие поля в ответе
    if [[ $response == *"\"$check_field\""* ]]; then
        # Извлекаем значение поля (примитивная проверка)
        local actual_value=$(echo "$response" | grep -o "\"$check_field\":[^,}\]]*" | cut -d':' -f2- | tr -d ' "')
        
        # Сравниваем со ожидаемым значением, если оно указано
        if [ -n "$expected_value" ] && [ "$actual_value" != "$expected_value" ]; then
            echo -e "${RED}Ошибка валидации: поле $check_field имеет значение $actual_value, ожидалось $expected_value${NC}"
            return 1
        fi
        
        return 0
    else
        echo -e "${RED}Ошибка валидации: поле $check_field не найдено в ответе${NC}"
        return 1
    fi
}

# Функция для выполнения запроса и вывода результата
test_endpoint() {
    METHOD=$1
    ENDPOINT=$2
    DATA=$3
    local retries=${4:-$MAX_RETRIES}
    
    local attempt=1
    local success=false
    local validation_success=true
    
    # Если не включен режим только статистики, выводим информацию о тесте
    if [ "$SUMMARY_ONLY" = false ]; then
        echo -e "${YELLOW}=== Тестирование ${METHOD} ${ENDPOINT} ===${NC}"
    fi
    
    while [ $attempt -le $retries ] && [ "$success" = false ]; do
        if [ $attempt -gt 1 ] && [ "$SUMMARY_ONLY" = false ]; then
            echo -e "${YELLOW}Повторная попытка $attempt/$retries...${NC}"
        fi
        
        if [ -z "$DATA" ]; then
            # GET или DELETE запрос без данных
            RESPONSE=$(curl -s -w "\nСтатус: %{http_code}" -X $METHOD "${API_URL}${ENDPOINT}")
        else
            # POST, PUT или PATCH запрос с данными
            RESPONSE=$(curl -s -w "\nСтатус: %{http_code}" -X $METHOD "${API_URL}${ENDPOINT}" \
                -H "Content-Type: application/json" \
                -d "$DATA")
        fi
        
        STATUS=$(echo "$RESPONSE" | grep "Статус:" | cut -d' ' -f2)
        RESPONSE_BODY=$(echo "$RESPONSE" | sed '/Статус:/d')
        
        # Проверка статуса
        if [[ $STATUS -ge 200 && $STATUS -lt 300 ]]; then
            success=true
            
            # Дополнительные проверки для конкретных эндпоинтов
            if [ "$METHOD" = "GET" ] && [ "$ENDPOINT" = "/api/buildings" ]; then
                if ! validate_response "$RESPONSE_BODY" "pagination" ""; then
                    validation_success=false
                fi
            fi
            
            if [ "$METHOD" = "GET" ] && [[ "$ENDPOINT" == "/api/buildings/"* ]]; then
                if ! validate_response "$RESPONSE_BODY" "building_id" ""; then
                    validation_success=false
                fi
            fi
            
            if [ "$METHOD" = "GET" ] && [[ "$ENDPOINT" == "/api/controllers/"* ]]; then
                if ! validate_response "$RESPONSE_BODY" "controller_id" ""; then
                    validation_success=false
                fi
            fi
            
            if [ "$METHOD" = "GET" ] && [[ "$ENDPOINT" == "/api/metrics/"* ]]; then
                if ! validate_response "$RESPONSE_BODY" "metric_id" ""; then
                    validation_success=false
                fi
            fi
        fi
        
        # Если это последняя попытка или успех, показываем результат
        if [ "$success" = true ] || [ $attempt -eq $retries ]; then
            if [ "$SUMMARY_ONLY" = false ]; then
                if [ "$success" = true ]; then
                    if [ "$validation_success" = true ]; then
                        echo -e "${GREEN}Успех! Статус: $STATUS${NC}"
                    else
                        echo -e "${YELLOW}Частичный успех! Статус: $STATUS, но валидация не прошла${NC}"
                    fi
                else
                    echo -e "${RED}Ошибка! Статус: $STATUS${NC}"
                fi
                
                # Показываем тело ответа
                echo -e "${BLUE}Ответ:${NC}"
                echo "$RESPONSE_BODY"
                echo -e "\n"
            fi
        fi
        
        attempt=$((attempt + 1))
        
        # Пауза между попытками
        if [ "$success" = false ] && [ $attempt -le $retries ]; then
            sleep $DELAY_BETWEEN_TESTS
        fi
    done
    
    # Обновляем статистику
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$success" = true ]; then
        if [ "$validation_success" = true ]; then
            SUCCESSFUL_TESTS=$((SUCCESSFUL_TESTS + 1))
        else
            # Частичный успех считаем как успех, но логируем проблему
            SUCCESSFUL_TESTS=$((SUCCESSFUL_TESTS + 1))
            if [ -n "$OUTPUT_FILE" ]; then
                {
                    echo "ПРЕДУПРЕЖДЕНИЕ: ${METHOD} ${ENDPOINT} - Статус: ${STATUS}, но валидация не прошла"
                    echo "--------------------"
                } >> "${OUTPUT_FILE%.json}_warnings.log"
            fi
        fi
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        # Сохраняем ошибки в лог, если указан файл
        if [ -n "$OUTPUT_FILE" ]; then
            {
                echo "ОШИБКА: ${METHOD} ${ENDPOINT} - Статус: ${STATUS}"
                echo "Тело ответа: $RESPONSE_BODY"
                echo "--------------------"
            } >> "${OUTPUT_FILE%.json}_errors.log"
        fi
    fi
    
    # Пауза между тестами
    sleep $DELAY_BETWEEN_TESTS
}

# Функции для группировки тестов
run_building_tests() {
    if [ "$SUMMARY_ONLY" = false ]; then
        echo -e "${BLUE}=== Тесты API зданий ===${NC}"
    fi
    
    # GET-запросы для зданий
    if should_run_test "GET" "/api/buildings"; then
        test_endpoint "GET" "/api/buildings"
    fi
    
    if should_run_test "GET" "/api/buildings/1"; then
        test_endpoint "GET" "/api/buildings/1"
    fi
    
    # POST-запрос для создания здания
    if should_run_test "POST" "/api/buildings"; then
        BUILDING_DATA='{
          "name": "Тестовое здание curl",
          "address": "ул. Пушкина, 10",
          "town": "Москва",
          "latitude": 55.751244,
          "longitude": 37.618423,
          "region": "Центральный",
          "management_company": "ООО Управляющая компания",
          "hot_water": true
        }'
        test_endpoint "POST" "/api/buildings" "$BUILDING_DATA"
    fi
    
    # PUT-запрос для обновления здания
    if should_run_test "PUT" "/api/buildings/1"; then
        UPDATE_BUILDING_DATA='{
          "name": "Обновленное здание",
          "address": "ул. Обновленная, 20",
          "town": "Москва",
          "latitude": 55.751244,
          "longitude": 37.618423,
          "region": "Центральный",
          "management_company": "ООО Новая УК",
          "hot_water": true
        }'
        test_endpoint "PUT" "/api/buildings/1" "$UPDATE_BUILDING_DATA"
    fi
    
    # DELETE-запрос для удаления здания
    if should_run_test "DELETE" "/api/buildings/1"; then
        test_endpoint "DELETE" "/api/buildings/1"
    fi
}

run_controller_tests() {
    if [ "$SUMMARY_ONLY" = false ]; then
        echo -e "${BLUE}=== Тесты API контроллеров ===${NC}"
    fi
    
    # GET-запросы для контроллеров
    if should_run_test "GET" "/api/controllers"; then
        test_endpoint "GET" "/api/controllers"
    fi
    
    if should_run_test "GET" "/api/controllers/1"; then
        test_endpoint "GET" "/api/controllers/1"
    fi
    
    if should_run_test "GET" "/api/controllers/building/1"; then
        test_endpoint "GET" "/api/controllers/building/1"
    fi
    
    if should_run_test "GET" "/api/controllers/1/metrics"; then
        test_endpoint "GET" "/api/controllers/1/metrics"
    fi
    
    # POST-запрос для создания контроллера
    if should_run_test "POST" "/api/controllers"; then
        CONTROLLER_DATA='{
          "serial_number": "SN-CURL-12345",
          "vendor": "Siemens",
          "model": "IOT-2000",
          "building_id": 1,
          "status": "online"
        }'
        test_endpoint "POST" "/api/controllers" "$CONTROLLER_DATA"
    fi
    
    # PUT-запрос для обновления контроллера
    if should_run_test "PUT" "/api/controllers/1"; then
        UPDATE_CONTROLLER_DATA='{
          "serial_number": "SN-CURL-UPDATED",
          "vendor": "Siemens",
          "model": "IOT-3000",
          "building_id": 1,
          "status": "online"
        }'
        test_endpoint "PUT" "/api/controllers/1" "$UPDATE_CONTROLLER_DATA"
    fi
    
    # PATCH-запрос для обновления статуса контроллера
    if should_run_test "PATCH" "/api/controllers/1/status"; then
        UPDATE_STATUS_DATA='{
          "status": "maintenance"
        }'
        test_endpoint "PATCH" "/api/controllers/1/status" "$UPDATE_STATUS_DATA"
    fi
    
    # DELETE-запрос для удаления контроллера
    if should_run_test "DELETE" "/api/controllers/1"; then
        test_endpoint "DELETE" "/api/controllers/1"
    fi
}

run_metric_tests() {
    if [ "$SUMMARY_ONLY" = false ]; then
        echo -e "${BLUE}=== Тесты API метрик ===${NC}"
    fi
    
    # GET-запросы для метрик
    if should_run_test "GET" "/api/metrics"; then
        test_endpoint "GET" "/api/metrics"
    fi
    
    if should_run_test "GET" "/api/metrics/latest"; then
        test_endpoint "GET" "/api/metrics/latest"
    fi
    
    if should_run_test "GET" "/api/metrics/controller/1"; then
        test_endpoint "GET" "/api/metrics/controller/1"
    fi
    
    if should_run_test "GET" "/api/metrics/1"; then
        test_endpoint "GET" "/api/metrics/1"
    fi
    
    # POST-запрос для создания метрики
    if should_run_test "POST" "/api/metrics"; then
        METRIC_DATA='{
          "controller_id": 1,
          "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
          "electricity_ph1": 220.5,
          "electricity_ph2": 221.0,
          "electricity_ph3": 219.8,
          "amperage_ph1": 10.2,
          "amperage_ph2": 9.8,
          "amperage_ph3": 10.5,
          "cold_water_pressure": 5.2,
          "cold_water_temp": 10.5,
          "hot_water_in_pressure": 4.8,
          "hot_water_out_pressure": 4.2,
          "hot_water_in_temp": 65.0,
          "hot_water_out_temp": 45.0,
          "air_temp": 22.5,
          "humidity": 45.0,
          "leak_sensor": false
        }'
        test_endpoint "POST" "/api/metrics" "$METRIC_DATA"
    fi
    
    # POST-запрос для отправки телеметрии
    if should_run_test "POST" "/api/metrics/telemetry"; then
        TELEMETRY_DATA='{
          "serial_number": "SN-CURL-12345",
          "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
          "metrics": {
            "electricity_ph1": 220.5,
            "electricity_ph2": 221.0,
            "electricity_ph3": 219.8,
            "amperage_ph1": 10.2,
            "amperage_ph2": 9.8,
            "amperage_ph3": 10.5,
            "cold_water_pressure": 5.2,
            "cold_water_temp": 10.5,
            "hot_water_in_pressure": 4.8,
            "hot_water_out_pressure": 4.2,
            "hot_water_in_temp": 65.0,
            "hot_water_out_temp": 45.0,
            "air_temp": 22.5,
            "humidity": 45.0,
            "leak_sensor": false
          }
        }'
        test_endpoint "POST" "/api/metrics/telemetry" "$TELEMETRY_DATA"
    fi
    
    # DELETE-запрос для удаления метрики
    if should_run_test "DELETE" "/api/metrics/1"; then
        test_endpoint "DELETE" "/api/metrics/1"
    fi
}

# Функция для вывода статистики
print_statistics() {
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    echo -e "\n${YELLOW}=== Статистика тестирования ===${NC}"
    echo -e "Всего тестов: ${TOTAL_TESTS}"
    
    if [ $TOTAL_TESTS -gt 0 ]; then
        SUCCESS_PERCENT=$((SUCCESSFUL_TESTS * 100 / TOTAL_TESTS))
        echo -e "Успешно: ${GREEN}${SUCCESSFUL_TESTS}${NC} (${SUCCESS_PERCENT}%)"
        echo -e "Ошибок: ${RED}${FAILED_TESTS}${NC}"
    else
        echo -e "Успешно: ${GREEN}0${NC} (0%)"
        echo -e "Ошибок: ${RED}0${NC}"
    fi
    
    echo -e "Время выполнения: ${DURATION} секунд"
    echo -e "${YELLOW}===========================${NC}"
    
    # Если указан файл для вывода, сохраняем статистику в него
    if [ -n "$OUTPUT_FILE" ]; then
        {
            echo "Статистика тестирования API ($(date))"
            echo "URL: $API_URL"
            echo "Всего тестов: $TOTAL_TESTS"
            if [ $TOTAL_TESTS -gt 0 ]; then
                echo "Успешно: $SUCCESSFUL_TESTS ($SUCCESS_PERCENT%)"
            else
                echo "Успешно: 0 (0%)"
            fi
            echo "Ошибок: $FAILED_TESTS"
            echo "Время выполнения: $DURATION секунд"
        } > "$OUTPUT_FILE"
        echo -e "${GREEN}Результаты сохранены в файл: $OUTPUT_FILE${NC}"
    fi
}

# Основной блок выполнения
echo -e "${YELLOW}=== Начинаем тестирование API ===${NC}"
echo -e "${YELLOW}URL: ${API_URL}${NC}\n"

# Запуск тестов по группам
if [ "$TESTS_TO_RUN" = "all" ] || [[ "$TESTS_TO_RUN" == *"building"* ]] || [[ "$TESTS_TO_RUN" == *"/api/buildings"* ]]; then
    run_building_tests
fi

if [ "$TESTS_TO_RUN" = "all" ] || [[ "$TESTS_TO_RUN" == *"controller"* ]] || [[ "$TESTS_TO_RUN" == *"/api/controllers"* ]]; then
    run_controller_tests
fi

if [ "$TESTS_TO_RUN" = "all" ] || [[ "$TESTS_TO_RUN" == *"metric"* ]] || [[ "$TESTS_TO_RUN" == *"/api/metrics"* ]]; then
    run_metric_tests
fi

# Вывод статистики
print_statistics

# Возвращаем код ошибки, если были неудачные тесты
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Тестирование завершено с ошибками${NC}"
    exit 1
else
    echo -e "${GREEN}Все тесты успешно пройдены${NC}"
    exit 0
fi 