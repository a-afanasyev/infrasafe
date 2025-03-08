#!/bin/bash

# Скрипт для тестирования API через curl
# По одному эндпоинту за раз

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Базовый URL
API_URL="http://localhost:3000"

# Функция для выполнения запроса и вывода результата
test_endpoint() {
    METHOD=$1
    ENDPOINT=$2
    DATA=$3
    
    echo -e "${YELLOW}=== Тестирование ${METHOD} ${ENDPOINT} ===${NC}"
    
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
    
    if [[ $STATUS -ge 200 && $STATUS -lt 300 ]]; then
        echo -e "${GREEN}Успех! Статус: $STATUS${NC}"
    else
        echo -e "${RED}Ошибка! Статус: $STATUS${NC}"
    fi
    
    # Показываем тело ответа
    echo -e "${BLUE}Ответ:${NC}"
    echo "$RESPONSE" | sed '/Статус:/d'
    
    echo -e "\n"
    # Пауза между запросами
    sleep 1
}

echo -e "${YELLOW}=== Начинаем тестирование API ===${NC}"
echo -e "${YELLOW}URL: ${API_URL}${NC}\n"

# GET-запросы
echo -e "${BLUE}=== GET-запросы ===${NC}"

# Получить все здания
test_endpoint "GET" "/api/buildings"

# Получить здание по ID (подставьте существующий ID)
test_endpoint "GET" "/api/buildings/1"

# Получить все контроллеры
test_endpoint "GET" "/api/controllers"

# Получить контроллер по ID (подставьте существующий ID)
test_endpoint "GET" "/api/controllers/1"

# Получить контроллеры для здания
test_endpoint "GET" "/api/controllers/building/1"

# Получить метрики для контроллера
test_endpoint "GET" "/api/controllers/1/metrics"

# Получить все метрики
test_endpoint "GET" "/api/metrics"

# Получить последние метрики
test_endpoint "GET" "/api/metrics/latest"

# Получить метрики для контроллера
test_endpoint "GET" "/api/metrics/controller/1"

# Получить метрику по ID
test_endpoint "GET" "/api/metrics/1"

# POST-запросы
echo -e "${BLUE}=== POST-запросы ===${NC}"

# Создать здание
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

# Создать контроллер
CONTROLLER_DATA='{
  "serial_number": "SN-CURL-12345",
  "vendor": "Siemens",
  "model": "IOT-2000",
  "building_id": 1,
  "status": "online"
}'
test_endpoint "POST" "/api/controllers" "$CONTROLLER_DATA"

# Создать метрику
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

# Отправить телеметрию
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

# PUT и PATCH запросы
echo -e "${BLUE}=== PUT и PATCH запросы ===${NC}"

# Обновить здание
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

# Обновить контроллер
UPDATE_CONTROLLER_DATA='{
  "serial_number": "SN-CURL-UPDATED",
  "vendor": "Siemens",
  "model": "IOT-3000",
  "building_id": 1,
  "status": "online"
}'
test_endpoint "PUT" "/api/controllers/1" "$UPDATE_CONTROLLER_DATA"

# Обновить статус контроллера
UPDATE_STATUS_DATA='{
  "status": "maintenance"
}'
test_endpoint "PATCH" "/api/controllers/1/status" "$UPDATE_STATUS_DATA"

# DELETE-запросы (закомментированы, чтобы не удалять данные по умолчанию)
echo -e "${BLUE}=== DELETE-запросы (закомментированы) ===${NC}"

# Раскомментируйте следующие строки, если хотите выполнить DELETE-запросы
 test_endpoint "DELETE" "/api/metrics/1"
 test_endpoint "DELETE" "/api/controllers/1"
 test_endpoint "DELETE" "/api/buildings/1"

echo -e "${YELLOW}=== Тестирование API завершено ===${NC}" 