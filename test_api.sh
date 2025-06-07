#!/bin/bash

# Скрипт для тестирования API InfraSafe Habitat IQ
# Полное покрытие всех endpoints с авторизацией

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Базовый URL
API_URL="http://localhost:8080"

# JWT токен (будет получен после логина)
JWT_TOKEN=""

# Функция для выполнения запроса и вывода результата
test_endpoint() {
    METHOD=$1
    ENDPOINT=$2
    DATA=$3
    REQUIRES_AUTH=$4
    DESCRIPTION=$5
    
    echo -e "${CYAN}📡 ${DESCRIPTION}${NC}"
    echo -e "${YELLOW}${METHOD} ${ENDPOINT}${NC}"
    
    # Подготовка заголовков
    HEADERS="-H 'Content-Type: application/json'"
    if [ "$REQUIRES_AUTH" = "true" ] && [ ! -z "$JWT_TOKEN" ]; then
        HEADERS="$HEADERS -H 'Authorization: Bearer $JWT_TOKEN'"
    fi
    
    # Выполнение запроса
    if [ -z "$DATA" ]; then
        # GET или DELETE запрос без данных
        RESPONSE=$(eval "curl -s -w '\nСтатус: %{http_code}' -X $METHOD $HEADERS '${API_URL}${ENDPOINT}'")
    else
        # POST, PUT или PATCH запрос с данными
        RESPONSE=$(eval "curl -s -w '\nСтатус: %{http_code}' -X $METHOD $HEADERS '${API_URL}${ENDPOINT}' -d '$DATA'")
    fi
    
    STATUS=$(echo "$RESPONSE" | grep "Статус:" | cut -d' ' -f2)
    
    if [[ $STATUS -ge 200 && $STATUS -lt 300 ]]; then
        echo -e "${GREEN}✅ Успех! Статус: $STATUS${NC}"
    elif [[ $STATUS -ge 400 && $STATUS -lt 500 ]]; then
        echo -e "${YELLOW}⚠️  Клиентская ошибка! Статус: $STATUS${NC}"
    else
        echo -e "${RED}❌ Ошибка сервера! Статус: $STATUS${NC}"
    fi
    
    # Показываем тело ответа (форматированное)
    BODY=$(echo "$RESPONSE" | sed '/Статус:/d')
    if command -v jq &> /dev/null; then
        echo -e "${BLUE}📋 Ответ:${NC}"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    else
        echo -e "${BLUE}📋 Ответ:${NC}"
        echo "$BODY"
    fi
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}\n"
    sleep 0.5
}

# Функция для получения JWT токена
get_jwt_token() {
    echo -e "${CYAN}🔐 Получение JWT токена для тестирования...${NC}"
    
    LOGIN_DATA='{
        "username": "admin",
        "password": "admin123"
    }'
    
    RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "$LOGIN_DATA")
    
    JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.token' 2>/dev/null)
    
    if [ "$JWT_TOKEN" != "null" ] && [ ! -z "$JWT_TOKEN" ]; then
        echo -e "${GREEN}✅ JWT токен получен успешно${NC}"
        echo -e "${BLUE}🎫 Токен: ${JWT_TOKEN:0:20}...${NC}\n"
    else
        echo -e "${YELLOW}⚠️  Не удалось получить JWT токен, некоторые тесты могут не пройти${NC}\n"
        JWT_TOKEN=""
    fi
}

echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║               🚀 ТЕСТИРОВАНИЕ API INFRASAFE                   ║${NC}"
echo -e "${PURPLE}║                   Версия: 1.0.0                              ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo -e "${YELLOW}🌐 URL: ${API_URL}${NC}"
echo -e "${YELLOW}📅 Время: $(date)${NC}\n"

# Получаем JWT токен для авторизации
get_jwt_token

# 1. БАЗОВЫЕ МАРШРУТЫ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    📊 БАЗОВЫЕ МАРШРУТЫ                        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/" "" "false" "Информация об API"

# 2. АВТОРИЗАЦИЯ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    🔐 АВТОРИЗАЦИЯ                             ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

LOGIN_DATA='{
    "username": "admin", 
    "password": "admin123"
}'
test_endpoint "POST" "/api/auth/login" "$LOGIN_DATA" "false" "Авторизация администратора"

REGISTER_DATA='{
    "username": "testuser_api",
    "password": "testpass123",
    "role": "user"
}'
test_endpoint "POST" "/api/auth/register" "$REGISTER_DATA" "true" "Регистрация нового пользователя"

test_endpoint "GET" "/api/auth/profile" "" "true" "Получение профиля пользователя"

# 3. ЗДАНИЯ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    🏢 ЗДАНИЯ                                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/buildings" "" "false" "Получение всех зданий"
test_endpoint "GET" "/api/buildings?page=1&limit=5" "" "false" "Получение зданий с пагинацией"
test_endpoint "GET" "/api/buildings/1" "" "false" "Получение здания по ID"

BUILDING_DATA='{
    "name": "API Test Building",
    "address": "ул. Тестовая API, 123",
    "town": "Тестград",
    "latitude": 41.347052,
    "longitude": 69.203200,
    "region": "Тестовый район",
    "management_company": "ООО Тестовая УК",
    "hot_water": true
}'
test_endpoint "POST" "/api/buildings" "$BUILDING_DATA" "true" "Создание нового здания"

UPDATE_BUILDING_DATA='{
    "name": "Обновленное API здание",
    "address": "ул. Обновленная API, 456", 
    "town": "Новый Тестград",
    "latitude": 41.347052,
    "longitude": 69.203200,
    "region": "Обновленный район",
    "management_company": "ООО Новая Тестовая УК",
    "hot_water": false
}'
test_endpoint "PUT" "/api/buildings/1" "$UPDATE_BUILDING_DATA" "true" "Обновление здания"

# 4. КОНТРОЛЛЕРЫ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    🎛️  КОНТРОЛЛЕРЫ                           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/controllers" "" "false" "Получение всех контроллеров"
test_endpoint "GET" "/api/controllers?page=1&limit=3" "" "false" "Получение контроллеров с пагинацией"
test_endpoint "GET" "/api/controllers/1" "" "false" "Получение контроллера по ID"
test_endpoint "GET" "/api/controllers/building/1" "" "false" "Получение контроллеров здания"
test_endpoint "GET" "/api/controllers/1/metrics" "" "false" "Получение метрик контроллера"

CONTROLLER_DATA='{
    "serial_number": "API-TEST-001",
    "vendor": "TestVendor",
    "model": "API-Model-X1",
    "building_id": 1,
    "status": "online"
}'
test_endpoint "POST" "/api/controllers" "$CONTROLLER_DATA" "true" "Создание нового контроллера"

UPDATE_CONTROLLER_DATA='{
    "serial_number": "API-TEST-001-UPD",
    "vendor": "UpdatedVendor", 
    "model": "API-Model-X2",
    "building_id": 1,
    "status": "online"
}'
test_endpoint "PUT" "/api/controllers/1" "$UPDATE_CONTROLLER_DATA" "true" "Обновление контроллера"

STATUS_UPDATE_DATA='{
    "status": "maintenance"
}'
test_endpoint "PATCH" "/api/controllers/1/status" "$STATUS_UPDATE_DATA" "true" "Обновление статуса контроллера"

# 5. МЕТРИКИ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    📊 МЕТРИКИ                                 ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/metrics" "" "false" "Получение всех метрик"
test_endpoint "GET" "/api/metrics?page=1&limit=5" "" "false" "Получение метрик с пагинацией"
test_endpoint "GET" "/api/metrics/latest" "" "false" "Получение последних метрик всех контроллеров"
test_endpoint "GET" "/api/metrics/controller/1" "" "false" "Получение метрик контроллера"
test_endpoint "GET" "/api/metrics/1" "" "false" "Получение метрики по ID"

METRIC_DATA='{
    "controller_id": 1,
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "electricity_ph1": 220.5,
    "electricity_ph2": 221.0,
    "electricity_ph3": 219.8,
    "amperage_ph1": 15.2,
    "amperage_ph2": 14.8,
    "amperage_ph3": 15.5,
    "cold_water_pressure": 2.5,
    "cold_water_temp": 8.5,
    "hot_water_in_pressure": 3.2,
    "hot_water_out_pressure": 2.8,
    "hot_water_in_temp": 65.0,
    "hot_water_out_temp": 45.0,
    "air_temp": 22.0,
    "humidity": 45.0,
    "leak_sensor": false
}'
test_endpoint "POST" "/api/metrics" "$METRIC_DATA" "true" "Создание новой метрики"

# Телеметрия (без авторизации)
TELEMETRY_DATA='{
    "controller_id": 1,
    "temperature": 23.5,
    "humidity": 47.2,
    "pressure": 2.8,
    "voltage": 220.1,
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'
test_endpoint "POST" "/api/metrics/telemetry" "$TELEMETRY_DATA" "false" "Отправка телеметрии от устройства"

# 6. ЗДАНИЯ С МЕТРИКАМИ (ДЛЯ КАРТЫ)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    🗺️  ДАННЫЕ ДЛЯ КАРТЫ                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/buildings-metrics" "" "false" "Получение зданий с метриками для карты"

# 7. ТЕСТЫ НА ОШИБКИ
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    ⚠️  ТЕСТЫ НА ОШИБКИ                       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

test_endpoint "GET" "/api/buildings/99999" "" "false" "Несуществующее здание"
test_endpoint "GET" "/api/controllers/99999" "" "false" "Несуществующий контроллер"
test_endpoint "GET" "/api/metrics/99999" "" "false" "Несуществующая метрика"
test_endpoint "GET" "/api/nonexistent" "" "false" "Несуществующий endpoint"

INVALID_BUILDING_DATA='{
    "name": "",
    "invalid_field": "test"
}'
test_endpoint "POST" "/api/buildings" "$INVALID_BUILDING_DATA" "true" "Создание здания с невалидными данными"

# 8. DELETE ОПЕРАЦИИ (ОПЦИОНАЛЬНО)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    🗑️  DELETE ОПЕРАЦИИ                       ║${NC}"
echo -e "${BLUE}║      (раскомментируйте для выполнения)                        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${YELLOW}💡 DELETE операции закомментированы для безопасности${NC}"
echo -e "${YELLOW}💡 Раскомментируйте строки ниже для тестирования удаления${NC}\n"

# test_endpoint "DELETE" "/api/metrics/1" "" "true" "Удаление метрики"
# test_endpoint "DELETE" "/api/controllers/1" "" "true" "Удаление контроллера"  
# test_endpoint "DELETE" "/api/buildings/1" "" "true" "Удаление здания"

# ИТОГИ
echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                    📈 ИТОГИ ТЕСТИРОВАНИЯ                     ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${GREEN}✅ Тестирование API завершено${NC}"
echo -e "${BLUE}📊 Протестированы следующие группы endpoints:${NC}"
echo -e "${CYAN}   • Базовые маршруты${NC}"
echo -e "${CYAN}   • Авторизация (login, register, profile)${NC}"
echo -e "${CYAN}   • Здания (CRUD операции)${NC}"
echo -e "${CYAN}   • Контроллеры (CRUD + статус)${NC}"
echo -e "${CYAN}   • Метрики (CRUD + телеметрия)${NC}"
echo -e "${CYAN}   • Данные для карты${NC}"
echo -e "${CYAN}   • Обработка ошибок${NC}"

echo -e "\n${YELLOW}📋 Для просмотра документации API: ${API_URL}/api-docs${NC}"
echo -e "${YELLOW}🏠 Главная страница приложения: ${API_URL}${NC}"
echo -e "${YELLOW}👨‍💼 Админ панель: ${API_URL}/admin.html${NC}\n"

if command -v jq &> /dev/null; then
    echo -e "${GREEN}💡 jq установлен - JSON ответы форматируются${NC}"
else
    echo -e "${YELLOW}💡 Установите jq для лучшего форматирования JSON: brew install jq${NC}"
fi

echo -e "\n${PURPLE}═══════════════════════════════════════════════════════════════${NC}" 