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
        
        # Если ошибка 401 и требуется авторизация, пытаемся обновить токен
        if [ "$STATUS" = "401" ] && [ "$REQUIRES_AUTH" = "true" ]; then
            echo -e "${CYAN}🔄 Попытка обновления токена...${NC}"
            get_jwt_token
            if [ ! -z "$JWT_TOKEN" ]; then
                echo -e "${GREEN}🔄 Токен обновлен, повторяем запрос...${NC}"
                # Повторяем запрос с новым токеном
                HEADERS="-H 'Content-Type: application/json' -H 'Authorization: Bearer $JWT_TOKEN'"
                if [ -z "$DATA" ]; then
                    RESPONSE=$(eval "curl -s -w '\nСтатус: %{http_code}' -X $METHOD $HEADERS '${API_URL}${ENDPOINT}'")
                else
                    RESPONSE=$(eval "curl -s -w '\nСтатус: %{http_code}' -X $METHOD $HEADERS '${API_URL}${ENDPOINT}' -d '$DATA'")
                fi
                STATUS=$(echo "$RESPONSE" | grep "Статус:" | cut -d' ' -f2)
                echo -e "${BLUE}🔄 Повторный статус: $STATUS${NC}"
            fi
        fi
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
    
    # Попробуем разные комбинации логин/пароль
    LOGIN_ATTEMPTS=(
        '{"username": "testapi", "password": "Password123"}'
        '{"username": "admin", "password": "Admin123"}'
        '{"username": "admin", "password": "admin123"}'
        '{"username": "user", "password": "User123"}'
        '{"username": "test", "password": "Test123"}'
    )
    
    for LOGIN_DATA in "${LOGIN_ATTEMPTS[@]}"; do
        echo -e "${YELLOW}🔍 Попытка авторизации с: $(echo "$LOGIN_DATA" | jq -r '.username')${NC}"
        
        RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
            -H "Content-Type: application/json" \
            -d "$LOGIN_DATA")
        
        # Проверяем разные форматы ответа
        TOKEN1=$(echo "$RESPONSE" | jq -r '.accessToken' 2>/dev/null)
        TOKEN2=$(echo "$RESPONSE" | jq -r '.token' 2>/dev/null)
        TOKEN3=$(echo "$RESPONSE" | jq -r '.access_token' 2>/dev/null)
        TOKEN4=$(echo "$RESPONSE" | jq -r '.data.token' 2>/dev/null)
        
        # Выбираем первый валидный токен
        if [ "$TOKEN1" != "null" ] && [ ! -z "$TOKEN1" ] && [ "$TOKEN1" != "" ]; then
            JWT_TOKEN="$TOKEN1"
            break
        elif [ "$TOKEN2" != "null" ] && [ ! -z "$TOKEN2" ] && [ "$TOKEN2" != "" ]; then
            JWT_TOKEN="$TOKEN2"
            break
        elif [ "$TOKEN3" != "null" ] && [ ! -z "$TOKEN3" ] && [ "$TOKEN3" != "" ]; then
            JWT_TOKEN="$TOKEN3"
            break
        elif [ "$TOKEN4" != "null" ] && [ ! -z "$TOKEN4" ] && [ "$TOKEN4" != "" ]; then
            JWT_TOKEN="$TOKEN4"
            break
        fi
    done
    
    if [ ! -z "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ] && [ "$JWT_TOKEN" != "" ]; then
        echo -e "${GREEN}✅ JWT токен получен успешно${NC}"
        echo -e "${BLUE}🎫 Токен: ${JWT_TOKEN:0:30}...${NC}"
        echo -e "${CYAN}📊 Длина токена: ${#JWT_TOKEN} символов${NC}\n"
        return 0
    else
        echo -e "${YELLOW}⚠️  Не удалось получить JWT токен${NC}"
        echo -e "${YELLOW}📝 Последний ответ сервера:${NC}"
        echo "$RESPONSE" | head -3
        echo -e "${YELLOW}⚠️  Защищенные endpoints не будут протестированы${NC}\n"
        JWT_TOKEN=""
        return 1
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

# Если токен не получен, пытаемся создать тестового пользователя
if [ -z "$JWT_TOKEN" ]; then
    echo -e "${CYAN}🔧 Попытка создания тестового пользователя...${NC}"
    
    REGISTER_DATA='{
        "username": "testadmin",
        "password": "TestPass123",
        "email": "testadmin@example.com",
        "role": "admin"
    }'
    
    RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/register" \
        -H "Content-Type: application/json" \
        -d "$REGISTER_DATA")
    
    echo -e "${BLUE}📝 Результат регистрации:${NC}"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    
    # Пытаемся войти с новым пользователем
    LOGIN_DATA='{
        "username": "testadmin",
        "password": "TestPass123"
    }'
    
    RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "$LOGIN_DATA")
    
    JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken' 2>/dev/null)
    
    if [ ! -z "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
        echo -e "${GREEN}✅ Успешно создан и авторизован тестовый пользователь${NC}"
        echo -e "${BLUE}🎫 Токен: ${JWT_TOKEN:0:30}...${NC}\n"
    else
        echo -e "${RED}❌ Не удалось создать тестового пользователя${NC}\n"
    fi
fi

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
    "password": "Admin123"
}'
test_endpoint "POST" "/api/auth/login" "$LOGIN_DATA" "false" "Авторизация администратора"

REGISTER_DATA='{
    "username": "testuser_api",
    "password": "TestPass123",
    "email": "testuser@example.com",
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
    "serial_number": "SN-1",
    "temperature": 23.5,
    "humidity": 47.2,
    "co2_level": 400,
    "voltage": 220.1,
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'
test_endpoint "POST" "/api/metrics/telemetry" "$TELEMETRY_DATA" "false" "Отправка телеметрии от устройства"

# 🆕 НОВЫЕ ENDPOINTS ПОСЛЕ РЕФАКТОРИНГА
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               🚀 НОВЫЕ ENDPOINTS (РЕФАКТОРИНГ)                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

# НОВЫЕ ENDPOINTS ДЛЯ ЗДАНИЙ
echo -e "${CYAN}📍 Геопространственный поиск зданий${NC}"
test_endpoint "GET" "/api/buildings/search?latitude=41.347052&longitude=69.203200&radius=5&limit=10" "" "false" "Поиск зданий в радиусе 5км"

test_endpoint "GET" "/api/buildings/search?latitude=41.347052&longitude=69.203200&radius=1" "" "false" "Поиск зданий в радиусе 1км"

# Тест с неверными координатами
test_endpoint "GET" "/api/buildings/search?latitude=200&longitude=300&radius=5" "" "false" "Поиск с неверными координатами (должна быть ошибка)"

echo -e "${CYAN}📊 Статистика зданий${NC}"
test_endpoint "GET" "/api/buildings/statistics" "" "false" "Получение статистики зданий"

# НОВЫЕ ENDPOINTS ДЛЯ КОНТРОЛЛЕРОВ
echo -e "${CYAN}🔄 Автообновление статусов контроллеров${NC}"
test_endpoint "POST" "/api/controllers/update-status-by-activity" "" "true" "Автообновление статусов контроллеров по активности"

echo -e "${CYAN}📊 Статистика контроллеров${NC}"
test_endpoint "GET" "/api/controllers/statistics" "" "false" "Получение статистики контроллеров"

# НОВЫЕ ENDPOINTS ДЛЯ МЕТРИК
echo -e "${CYAN}📈 Агрегированные метрики${NC}"
test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=hour" "" "false" "Агрегация метрик контроллера по часам"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=day&startDate=2024-01-01T00:00:00Z&endDate=2024-12-31T23:59:59Z" "" "false" "Агрегация метрик по дням за период"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=week" "" "false" "Агрегация метрик по неделям"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=month" "" "false" "Агрегация метрик по месяцам"

# Тест с неверным timeFrame
test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=invalid" "" "false" "Агрегация с неверным timeFrame (должна быть ошибка)"

echo -e "${CYAN}🧹 Очистка старых метрик${NC}"
test_endpoint "DELETE" "/api/metrics/cleanup?days=90" "" "true" "Очистка метрик старше 90 дней"

test_endpoint "DELETE" "/api/metrics/cleanup?days=365" "" "true" "Очистка метрик старше 1 года"

# Тест с неверным параметром
test_endpoint "DELETE" "/api/metrics/cleanup?days=0" "" "true" "Очистка с неверным параметром days (должна быть ошибка)"

# НОВЫЕ ENDPOINTS ДЛЯ АУТЕНТИФИКАЦИИ
echo -e "${CYAN}🔐 Расширенная аутентификация${NC}"

# Получаем refresh token для тестирования
REFRESH_TOKEN=""
echo -e "${YELLOW}🔄 Получение refresh токена...${NC}"
REFRESH_LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "admin", "password": "admin123"}')

REFRESH_TOKEN=$(echo "$REFRESH_LOGIN_RESPONSE" | jq -r '.refreshToken' 2>/dev/null)

if [ "$REFRESH_TOKEN" != "null" ] && [ ! -z "$REFRESH_TOKEN" ]; then
    echo -e "${GREEN}✅ Refresh токен получен${NC}"
    
    REFRESH_DATA='{"refreshToken": "'$REFRESH_TOKEN'"}'
    test_endpoint "POST" "/api/auth/refresh" "$REFRESH_DATA" "false" "Обновление токенов через refresh token"
else
    echo -e "${YELLOW}⚠️  Refresh токен не получен, возможно authService еще не полностью интегрирован${NC}"
    
    # Тест без refresh токена
    test_endpoint "POST" "/api/auth/refresh" '{}' "false" "Обновление токенов без refresh token (должна быть ошибка)"
fi

# Тест с недействительным refresh токеном
INVALID_REFRESH_DATA='{"refreshToken": "invalid.refresh.token"}'
test_endpoint "POST" "/api/auth/refresh" "$INVALID_REFRESH_DATA" "false" "Обновление с недействительным refresh токеном (должна быть ошибка)"

echo -e "${CYAN}🔓 Выход из системы${NC}"
test_endpoint "POST" "/api/auth/logout" "" "true" "Выход из системы (добавление токена в blacklist)"

echo -e "${CYAN}🔑 Смена пароля${NC}"
CHANGE_PASSWORD_DATA='{
    "currentPassword": "admin123",
    "newPassword": "newAdminPass123"
}'
test_endpoint "POST" "/api/auth/change-password" "$CHANGE_PASSWORD_DATA" "true" "Смена пароля"

# Возвращаем обратно старый пароль
RESTORE_PASSWORD_DATA='{
    "currentPassword": "newAdminPass123",
    "newPassword": "admin123"
}'
test_endpoint "POST" "/api/auth/change-password" "$RESTORE_PASSWORD_DATA" "true" "Возврат к старому паролю"

# Тест с неверным текущим паролем
WRONG_PASSWORD_DATA='{
    "currentPassword": "wrongpassword",
    "newPassword": "newpass123"
}'
test_endpoint "POST" "/api/auth/change-password" "$WRONG_PASSWORD_DATA" "true" "Смена пароля с неверным текущим паролем (должна быть ошибка)"

# Тест с простым новым паролем
WEAK_PASSWORD_DATA='{
    "currentPassword": "admin123",
    "newPassword": "123"
}'
test_endpoint "POST" "/api/auth/change-password" "$WEAK_PASSWORD_DATA" "true" "Смена на слабый пароль (должна быть ошибка)"

# 6. АДМИНСКИЕ API (ОПТИМИЗИРОВАННЫЕ)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               👨‍💼 АДМИНСКИЕ API (ОПТИМИЗИРОВАННЫЕ)           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

# Оптимизированные здания
echo -e "${CYAN}🏢 Оптимизированное получение зданий${NC}"
test_endpoint "GET" "/api/admin/buildings?page=1&limit=10" "" "true" "Пагинированный список зданий"
test_endpoint "GET" "/api/admin/buildings?search=Дом" "" "true" "Поиск зданий по названию"
test_endpoint "GET" "/api/admin/buildings?region=Ташкент&sort=name&order=asc" "" "true" "Фильтрация и сортировка зданий"

# Batch операции с зданиями
echo -e "${CYAN}📦 Массовые операции с зданиями${NC}"
BUILDINGS_BATCH_DATA='{
    "action": "update_status",
    "ids": [1, 2, 3],
    "data": {
        "status": "active"
    }
}'
test_endpoint "POST" "/api/admin/buildings/batch" "$BUILDINGS_BATCH_DATA" "true" "Массовое обновление статуса зданий"

BUILDINGS_DELETE_BATCH='{
    "action": "delete",
    "ids": [99, 100, 101]
}'
test_endpoint "POST" "/api/admin/buildings/batch" "$BUILDINGS_DELETE_BATCH" "true" "Массовое удаление зданий (несуществующих ID)"

# Оптимизированные контроллеры
echo -e "${CYAN}🎛️  Оптимизированное получение контроллеров${NC}"
test_endpoint "GET" "/api/admin/controllers?page=1&limit=10" "" "true" "Пагинированный список контроллеров"
test_endpoint "GET" "/api/admin/controllers?search=SN-" "" "true" "Поиск контроллеров по серийному номеру"
test_endpoint "GET" "/api/admin/controllers?status=active&manufacturer=Siemens" "" "true" "Фильтрация контроллеров по статусу и производителю"

# Batch операции с контроллерами
echo -e "${CYAN}📦 Массовые операции с контроллерами${NC}"
CONTROLLERS_BATCH_DATA='{
    "action": "update_status",
    "ids": [1, 2, 3],
    "data": {
        "status": "inactive"
    }
}'
test_endpoint "POST" "/api/admin/controllers/batch" "$CONTROLLERS_BATCH_DATA" "true" "Массовое обновление статуса контроллеров"

CONTROLLERS_CALIBRATE_BATCH='{
    "action": "calibrate",
    "ids": [1, 2],
    "data": {
        "calibration_date": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
    }
}'
test_endpoint "POST" "/api/admin/controllers/batch" "$CONTROLLERS_CALIBRATE_BATCH" "true" "Массовая калибровка контроллеров"

# Оптимизированные метрики
echo -e "${CYAN}📊 Оптимизированное получение метрик${NC}"
test_endpoint "GET" "/api/admin/metrics?page=1&limit=20" "" "true" "Пагинированный список метрик"
test_endpoint "GET" "/api/admin/metrics?controller_id=1&start_date=2024-01-01&end_date=2024-12-31" "" "true" "Метрики по контроллеру за период"
test_endpoint "GET" "/api/admin/metrics?sort=timestamp&order=desc&limit=50" "" "true" "Последние 50 метрик"

# Трансформаторы (новые эндпоинты)
echo -e "${CYAN}⚡ Управление трансформаторами${NC}"
test_endpoint "GET" "/api/admin/transformers?page=1&limit=10" "" "true" "Пагинированный список трансформаторов"
test_endpoint "GET" "/api/admin/transformers?search=TR-" "" "true" "Поиск трансформаторов по названию"
test_endpoint "GET" "/api/admin/transformers?power_min=100&power_max=1000&sort=power_kva&order=desc" "" "true" "Фильтрация трансформаторов по мощности"

# CRUD операции с трансформаторами
TRANSFORMER_CREATE_DATA='{
    "name": "TR-TEST-001",
    "power_kva": 630,
    "voltage_kv": 10,
    "building_id": 34
}'
test_endpoint "POST" "/api/admin/transformers" "$TRANSFORMER_CREATE_DATA" "true" "Создание нового трансформатора"

TRANSFORMER_UPDATE_DATA='{
    "name": "TR-TEST-001-UPDATED",
    "power_kva": 800,
    "voltage_kv": 10
}'
test_endpoint "PUT" "/api/admin/transformers/1" "$TRANSFORMER_UPDATE_DATA" "true" "Обновление трансформатора"

test_endpoint "GET" "/api/admin/transformers/1" "" "true" "Получение трансформатора по ID"

# Линии электропередач (новые эндпоинты)
echo -e "${CYAN}🔌 Управление линиями электропередач${NC}"
test_endpoint "GET" "/api/admin/lines?page=1&limit=10" "" "true" "Пагинированный список линий"
test_endpoint "GET" "/api/admin/lines?search=LINE-" "" "true" "Поиск линий по названию"
test_endpoint "GET" "/api/admin/lines?voltage_min=6&voltage_max=35&sort=length_km&order=asc" "" "true" "Фильтрация линий по напряжению и длине"

# CRUD операции с линиями
LINE_CREATE_DATA='{
    "name": "LINE-TEST-001",
    "voltage_kv": 10,
    "length_km": 2.5,
    "transformer_id": 1
}'
test_endpoint "POST" "/api/admin/lines" "$LINE_CREATE_DATA" "true" "Создание новой линии"

LINE_UPDATE_DATA='{
    "name": "LINE-TEST-001-UPDATED",
    "voltage_kv": 10,
    "length_km": 3.2
}'
test_endpoint "PUT" "/api/admin/lines/1" "$LINE_UPDATE_DATA" "true" "Обновление линии"

test_endpoint "GET" "/api/admin/lines/1" "" "true" "Получение линии по ID"

# Batch операции с метриками
echo -e "${CYAN}📦 Массовые операции с метриками${NC}"
METRICS_CLEANUP_BATCH='{
    "action": "cleanup_old",
    "data": {
        "older_than_days": 30
    }
}'
test_endpoint "POST" "/api/admin/metrics/batch" "$METRICS_CLEANUP_BATCH" "true" "Массовая очистка старых метрик"

METRICS_AGGREGATE_BATCH='{
    "action": "aggregate",
    "data": {
        "time_frame": "hour",
        "controller_ids": [1, 2, 3]
    }
}'
test_endpoint "POST" "/api/admin/metrics/batch" "$METRICS_AGGREGATE_BATCH" "true" "Массовая агрегация метрик"

# Batch операции с трансформаторами
echo -e "${CYAN}📦 Массовые операции с трансформаторами${NC}"
TRANSFORMERS_BATCH_DATA='{
    "action": "update_voltage",
    "ids": [1, 2, 3],
    "data": {
        "voltage_kv": 10
    }
}'
test_endpoint "POST" "/api/admin/transformers/batch" "$TRANSFORMERS_BATCH_DATA" "true" "Массовое обновление напряжения трансформаторов"

TRANSFORMERS_DELETE_BATCH='{
    "action": "delete",
    "ids": [99, 100]
}'
test_endpoint "POST" "/api/admin/transformers/batch" "$TRANSFORMERS_DELETE_BATCH" "true" "Массовое удаление трансформаторов (несуществующих ID)"

# Batch операции с линиями
echo -e "${CYAN}📦 Массовые операции с линиями${NC}"
LINES_BATCH_DATA='{
    "action": "update_voltage",
    "ids": [1, 2, 3],
    "data": {
        "voltage_kv": 6
    }
}'
test_endpoint "POST" "/api/admin/lines/batch" "$LINES_BATCH_DATA" "true" "Массовое обновление напряжения линий"

LINES_MAINTENANCE_BATCH='{
    "action": "set_maintenance",
    "ids": [1, 2],
    "data": {
        "maintenance_date": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
    }
}'
test_endpoint "POST" "/api/admin/lines/batch" "$LINES_MAINTENANCE_BATCH" "true" "Массовая установка даты обслуживания линий"

# Глобальный поиск
echo -e "${CYAN}🔍 Глобальный поиск${NC}"
test_endpoint "GET" "/api/admin/search?query=Дом&type=buildings&limit=10" "" "true" "Поиск по зданиям"
test_endpoint "GET" "/api/admin/search?query=SN-1&type=controllers" "" "true" "Поиск по контроллерам"
test_endpoint "GET" "/api/admin/search?query=temperature&type=metrics" "" "true" "Поиск по метрикам"
test_endpoint "GET" "/api/admin/search?query=TR-&type=transformers" "" "true" "Поиск по трансформаторам"
test_endpoint "GET" "/api/admin/search?query=LINE-&type=lines" "" "true" "Поиск по линиям"
test_endpoint "GET" "/api/admin/search?query=test" "" "true" "Глобальный поиск по всем типам"

# Статистика для админ дашборда
echo -e "${CYAN}📈 Статистика для дашборда${NC}"
test_endpoint "GET" "/api/admin/stats" "" "true" "Общая статистика системы"
test_endpoint "GET" "/api/admin/stats?period=week" "" "true" "Статистика за неделю"
test_endpoint "GET" "/api/admin/stats?period=month&detailed=true" "" "true" "Детальная статистика за месяц"

# Экспорт данных
echo -e "${CYAN}📤 Экспорт данных${NC}"
EXPORT_DATA='{
    "type": "buildings",
    "format": "csv",
    "filters": {
        "region": "Ташкент"
    }
}'
test_endpoint "POST" "/api/admin/export" "$EXPORT_DATA" "true" "Экспорт зданий в CSV"

EXPORT_CONTROLLERS_DATA='{
    "type": "controllers",
    "format": "json",
    "filters": {
        "status": "active"
    }
}'
test_endpoint "POST" "/api/admin/export" "$EXPORT_CONTROLLERS_DATA" "true" "Экспорт активных контроллеров в JSON"

EXPORT_METRICS_DATA='{
    "type": "metrics",
    "format": "xlsx",
    "filters": {
        "controller_id": 1,
        "start_date": "2024-01-01",
        "end_date": "2024-12-31"
    }
}'
test_endpoint "POST" "/api/admin/export" "$EXPORT_METRICS_DATA" "true" "Экспорт метрик в Excel"

EXPORT_TRANSFORMERS_DATA='{
    "type": "transformers",
    "format": "csv",
    "filters": {
        "power_min": 100,
        "power_max": 1000
    }
}'
test_endpoint "POST" "/api/admin/export" "$EXPORT_TRANSFORMERS_DATA" "true" "Экспорт трансформаторов в CSV"

EXPORT_LINES_DATA='{
    "type": "lines",
    "format": "json",
    "filters": {
        "voltage_min": 6,
        "voltage_max": 35
    }
}'
test_endpoint "POST" "/api/admin/export" "$EXPORT_LINES_DATA" "true" "Экспорт линий в JSON"

# Тесты на ошибки для админских API
echo -e "${CYAN}⚠️  Тесты ошибок админских API${NC}"
test_endpoint "GET" "/api/admin/buildings?page=0&limit=0" "" "true" "Неверные параметры пагинации (должна быть ошибка)"
test_endpoint "GET" "/api/admin/search?query=" "" "true" "Поиск с пустым запросом (должна быть ошибка)"

INVALID_BATCH_DATA='{
    "action": "invalid_action",
    "ids": []
}'
test_endpoint "POST" "/api/admin/buildings/batch" "$INVALID_BATCH_DATA" "true" "Неверная batch операция (должна быть ошибка)"

INVALID_EXPORT_DATA='{
    "type": "invalid_type",
    "format": "invalid_format"
}'
test_endpoint "POST" "/api/admin/export" "$INVALID_EXPORT_DATA" "true" "Неверные параметры экспорта (должна быть ошибка)"

# Тесты ошибок для новых эндпоинтов
test_endpoint "GET" "/api/admin/transformers/99999" "" "true" "Несуществующий трансформатор (должна быть ошибка)"
test_endpoint "GET" "/api/admin/lines/99999" "" "true" "Несуществующая линия (должна быть ошибка)"

INVALID_TRANSFORMER_DATA='{
    "name": "",
    "power_kva": -100,
    "voltage_kv": 0
}'
test_endpoint "POST" "/api/admin/transformers" "$INVALID_TRANSFORMER_DATA" "true" "Создание трансформатора с невалидными данными (должна быть ошибка)"

INVALID_LINE_DATA='{
    "name": "",
    "voltage_kv": -10,
    "length_km": -5
}'
test_endpoint "POST" "/api/admin/lines" "$INVALID_LINE_DATA" "true" "Создание линии с невалидными данными (должна быть ошибка)"

# 7. ЗДАНИЯ С МЕТРИКАМИ (ДЛЯ КАРТЫ)
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
# test_endpoint "DELETE" "/api/admin/transformers/1" "" "true" "Удаление трансформатора"
# test_endpoint "DELETE" "/api/admin/lines/1" "" "true" "Удаление линии"

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
echo -e "${GREEN}   🆕 НОВЫЕ ENDPOINTS ПОСЛЕ РЕФАКТОРИНГА:${NC}"
echo -e "${CYAN}   • Геопространственный поиск зданий${NC}"
echo -e "${CYAN}   • Статистика зданий и контроллеров${NC}"
echo -e "${CYAN}   • Агрегированные метрики по временным интервалам${NC}"
echo -e "${CYAN}   • Очистка старых метрик (data retention)${NC}"
echo -e "${CYAN}   • Расширенная аутентификация (logout, refresh, смена пароля)${NC}"
echo -e "${GREEN}   👨‍💼 ОПТИМИЗИРОВАННЫЕ АДМИНСКИЕ API:${NC}"
echo -e "${CYAN}   • Быстрая пагинация и поиск зданий/контроллеров/метрик${NC}"
echo -e "${CYAN}   • Массовые операции (batch) для всех сущностей${NC}"
echo -e "${CYAN}   • Глобальный поиск по всем типам данных${NC}"
echo -e "${CYAN}   • Статистика для админского дашборда${NC}"
echo -e "${CYAN}   • Экспорт данных в различных форматах (CSV, JSON, Excel)${NC}"
echo -e "${CYAN}   • Данные для карты${NC}"
echo -e "${CYAN}   • Обработка ошибок${NC}"
echo -e "${GREEN}   ⚡ НОВЫЕ СУЩНОСТИ АДМИНКИ:${NC}"
echo -e "${CYAN}   • Трансформаторы (CRUD + фильтрация + batch операции)${NC}"
echo -e "${CYAN}   • Линии электропередач (CRUD + фильтрация + batch операции)${NC}"
echo -e "${CYAN}   • Расширенный поиск по всем 5 типам сущностей${NC}"
echo -e "${CYAN}   • Экспорт трансформаторов и линий${NC}"

echo -e "\n${YELLOW}📋 Для просмотра документации API: ${API_URL}/api-docs${NC}"
echo -e "${YELLOW}🏠 Главная страница приложения: ${API_URL}${NC}"
echo -e "${YELLOW}👨‍💼 Админ панель: ${API_URL}/admin.html${NC}\n"

if command -v jq &> /dev/null; then
    echo -e "${GREEN}💡 jq установлен - JSON ответы форматируются${NC}"
else
    echo -e "${YELLOW}💡 Установите jq для лучшего форматирования JSON: brew install jq${NC}"
fi

echo -e "\n${PURPLE}═══════════════════════════════════════════════════════════════${NC}" 