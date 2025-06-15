#!/bin/bash

# Расширенный тест JWT авторизации для всех защищенных endpoints
API_URL="http://localhost:8080"

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 Расширенное тестирование JWT авторизации...${NC}"

# Создаем пользователя через API регистрации
echo -e "${CYAN}📝 Создание тестового пользователя через API...${NC}"
curl -s -X POST "${API_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"username": "jwttest2", "email": "jwt2@test.com", "password": "Password123", "role": "admin"}' > /dev/null 2>&1

echo -e "${CYAN}🔑 Попытка авторизации...${NC}"
RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "jwttest2", "password": "Password123"}')

echo -e "${BLUE}📋 Ответ сервера:${NC}"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Пробуем разные поля для токена
JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken' 2>/dev/null)
if [ "$JWT_TOKEN" = "null" ] || [ -z "$JWT_TOKEN" ]; then
    JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.token' 2>/dev/null)
fi
if [ "$JWT_TOKEN" = "null" ] || [ -z "$JWT_TOKEN" ]; then
    JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token' 2>/dev/null)
fi

if [ ! -z "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
    echo -e "${GREEN}✅ JWT токен получен: ${JWT_TOKEN:0:30}...${NC}"

    # Функция для тестирования защищенного endpoint
    test_protected_endpoint() {
        METHOD=$1
        ENDPOINT=$2
        DATA=$3
        DESCRIPTION=$4

        echo -e "\n${CYAN}🧪 Тестирование: ${DESCRIPTION}${NC}"
        echo -e "${YELLOW}${METHOD} ${ENDPOINT}${NC}"

        if [ -z "$DATA" ]; then
            RESPONSE=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X "$METHOD" "${API_URL}${ENDPOINT}" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $JWT_TOKEN")
        else
            RESPONSE=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X "$METHOD" "${API_URL}${ENDPOINT}" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $JWT_TOKEN" \
                -d "$DATA")
        fi

        STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)
        BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

        if [[ $STATUS -ge 200 && $STATUS -lt 300 ]]; then
            echo -e "${GREEN}✅ Успех! Статус: $STATUS${NC}"
        elif [[ $STATUS -ge 400 && $STATUS -lt 500 ]]; then
            echo -e "${YELLOW}⚠️  Клиентская ошибка! Статус: $STATUS${NC}"
        else
            echo -e "${RED}❌ Ошибка сервера! Статус: $STATUS${NC}"
        fi

        echo -e "${BLUE}📋 Ответ:${NC}"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY" | head -3
    }

    echo -e "\n${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               🧪 ТЕСТИРОВАНИЕ ЗАЩИЩЕННЫХ API                  ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

    # 1. Базовые защищенные endpoints
    echo -e "\n${CYAN}📊 Базовые защищенные операции${NC}"
    test_protected_endpoint "POST" "/api/controllers/update-status-by-activity" "" "Обновление статусов контроллеров"
    test_protected_endpoint "GET" "/api/auth/profile" "" "Получение профиля пользователя"

    # 2. CRUD операции с зданиями
    echo -e "\n${CYAN}🏢 CRUD операции с зданиями${NC}"
    BUILDING_DATA='{
        "name": "JWT Test Building",
        "address": "ул. JWT Тестовая, 123",
        "town": "JWT Город",
        "latitude": 41.347052,
        "longitude": 69.203200,
        "region": "JWT Район",
        "management_company": "ООО JWT Тест",
        "hot_water": true
    }'
    test_protected_endpoint "POST" "/api/buildings" "$BUILDING_DATA" "Создание здания"

    UPDATE_BUILDING_DATA='{
        "name": "JWT Test Building Updated",
        "address": "ул. JWT Обновленная, 456"
    }'
    test_protected_endpoint "PUT" "/api/buildings/1" "$UPDATE_BUILDING_DATA" "Обновление здания"

    # 3. CRUD операции с контроллерами
    echo -e "\n${CYAN}🎛️  CRUD операции с контроллерами${NC}"
    CONTROLLER_DATA='{
        "serial_number": "JWT-TEST-001",
        "vendor": "JWT Vendor",
        "model": "JWT Model",
        "building_id": 1,
        "status": "online"
    }'
    test_protected_endpoint "POST" "/api/controllers" "$CONTROLLER_DATA" "Создание контроллера"

    STATUS_UPDATE_DATA='{"status": "maintenance"}'
    test_protected_endpoint "PATCH" "/api/controllers/1/status" "$STATUS_UPDATE_DATA" "Обновление статуса контроллера"

    # 4. Операции с метриками
    echo -e "\n${CYAN}📊 Операции с метриками${NC}"
    METRIC_DATA='{
        "controller_id": 1,
        "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
        "electricity_ph1": 220.5,
        "electricity_ph2": 221.0,
        "electricity_ph3": 219.8,
        "cold_water_pressure": 2.5,
        "hot_water_in_temp": 65.0,
        "air_temp": 22.0,
        "humidity": 45.0,
        "leak_sensor": false
    }'
    test_protected_endpoint "POST" "/api/metrics" "$METRIC_DATA" "Создание метрики"
    test_protected_endpoint "DELETE" "/api/metrics/cleanup?days=90" "" "Очистка старых метрик"

    # 5. 🆕 НОВЫЕ ЗАЩИЩЕННЫЕ ENDPOINTS - ВОДНАЯ ИНФРАСТРУКТУРА
    echo -e "\n${CYAN}💧 Водная инфраструктура (защищенные операции)${NC}"

    # Линии водоснабжения
    WATER_LINE_DATA='{
        "name": "JWT Линия ХВС",
        "description": "JWT тестовая линия",
        "diameter_mm": 200,
        "material": "steel",
        "pressure_rating": 6.0,
        "length_km": 1.5,
        "status": "active"
    }'
    test_protected_endpoint "POST" "/api/water-lines" "$WATER_LINE_DATA" "Создание линии водоснабжения"

    UPDATE_WATER_LINE_DATA='{
        "name": "JWT Линия ХВС Обновленная",
        "diameter_mm": 250
    }'
    test_protected_endpoint "PUT" "/api/water-lines/1" "$UPDATE_WATER_LINE_DATA" "Обновление линии водоснабжения"

    # Поставщики воды
    WATER_SUPPLIER_DATA='{
        "name": "JWT ХВС Поставщик",
        "type": "cold_water",
        "company_name": "ООО JWT Водоканал",
        "contact_person": "JWT Тестер",
        "phone": "+998901234567",
        "email": "jwt@watercompany.uz",
        "tariff_per_m3": 1200.00,
        "status": "active"
    }'
    test_protected_endpoint "POST" "/api/water-suppliers" "$WATER_SUPPLIER_DATA" "Создание поставщика воды"

    # Источники холодной воды
    COLD_WATER_SOURCE_DATA='{
        "name": "JWT Скважина №1",
        "type": "well",
        "capacity_m3_per_hour": 50.0,
        "depth_meters": 120,
        "water_quality": "excellent",
        "status": "active",
        "location": "JWT Район"
    }'
    test_protected_endpoint "POST" "/api/cold-water-sources" "$COLD_WATER_SOURCE_DATA" "Создание источника холодной воды"

    # Источники тепла
    HEAT_SOURCE_DATA='{
        "name": "JWT Котельная №1",
        "type": "boiler",
        "capacity_mw": 5.0,
        "fuel_type": "gas",
        "efficiency_percent": 85.0,
        "status": "active",
        "location": "JWT Район"
    }'
    test_protected_endpoint "POST" "/api/heat-sources" "$HEAT_SOURCE_DATA" "Создание источника тепла"

    # 6. Админские API (защищенные)
    echo -e "\n${CYAN}👨‍💼 Админские API (защищенные операции)${NC}"

    # Batch операции
    BUILDINGS_BATCH_DATA='{
        "action": "update_status",
        "ids": [1, 2, 3],
        "data": {"status": "active"}
    }'
    test_protected_endpoint "POST" "/api/admin/buildings/batch" "$BUILDINGS_BATCH_DATA" "Массовые операции с зданиями"

    CONTROLLERS_BATCH_DATA='{
        "action": "update_status",
        "ids": [1, 2],
        "data": {"status": "inactive"}
    }'
    test_protected_endpoint "POST" "/api/admin/controllers/batch" "$CONTROLLERS_BATCH_DATA" "Массовые операции с контроллерами"

    # Трансформаторы
    TRANSFORMER_DATA='{
        "name": "JWT-TR-001",
        "power_kva": 630,
        "voltage_kv": 10,
        "building_id": 1
    }'
    test_protected_endpoint "POST" "/api/admin/transformers" "$TRANSFORMER_DATA" "Создание трансформатора"

    # Линии электропередач
    LINE_DATA='{
        "name": "JWT-LINE-001",
        "voltage_kv": 10,
        "length_km": 2.5,
        "transformer_id": 1
    }'
    test_protected_endpoint "POST" "/api/admin/lines" "$LINE_DATA" "Создание линии электропередач"

    # Водные линии (админские)
    WATER_LINES_BATCH_DATA='{
        "action": "update_status",
        "ids": [1, 2],
        "data": {"status": "maintenance"}
    }'
    test_protected_endpoint "POST" "/api/admin/water-lines/batch" "$WATER_LINES_BATCH_DATA" "Массовые операции с водными линиями"

    # Экспорт данных
    EXPORT_DATA='{
        "type": "buildings",
        "format": "csv",
        "filters": {"region": "JWT Район"}
    }'
    test_protected_endpoint "POST" "/api/admin/export" "$EXPORT_DATA" "Экспорт данных"

    # 7. Аналитика (защищенные операции)
    echo -e "\n${CYAN}📊 Аналитика (защищенные операции)${NC}"
    test_protected_endpoint "POST" "/api/analytics/refresh" "" "Обновление аналитических данных"
    test_protected_endpoint "POST" "/api/analytics/cache/invalidate" "" "Очистка кеша аналитики"
    test_protected_endpoint "POST" "/api/analytics/circuit-breakers/reset" "" "Сброс автоматических выключателей"

    THRESHOLDS_DATA='{
        "overload_threshold": 0.85,
        "critical_threshold": 0.95,
        "warning_threshold": 0.75
    }'
    test_protected_endpoint "PUT" "/api/analytics/thresholds" "$THRESHOLDS_DATA" "Обновление пороговых значений"

    ANALYTICS_TRANSFORMER_DATA='{
        "name": "JWT-TR-ANALYTICS-001",
        "power_kva": 1000,
        "voltage_kv": 10,
        "latitude": 41.347052,
        "longitude": 69.203200
    }'
    test_protected_endpoint "POST" "/api/analytics/transformers" "$ANALYTICS_TRANSFORMER_DATA" "Создание трансформатора через аналитику"

    # 8. Расширенная аутентификация
    echo -e "\n${CYAN}🔐 Расширенная аутентификация${NC}"
    test_protected_endpoint "POST" "/api/auth/logout" "" "Выход из системы"

    CHANGE_PASSWORD_DATA='{
        "currentPassword": "Password123",
        "newPassword": "NewPassword123"
    }'
    test_protected_endpoint "POST" "/api/auth/change-password" "$CHANGE_PASSWORD_DATA" "Смена пароля"

    # Возвращаем пароль обратно
    RESTORE_PASSWORD_DATA='{
        "currentPassword": "NewPassword123",
        "newPassword": "Password123"
    }'
    test_protected_endpoint "POST" "/api/auth/change-password" "$RESTORE_PASSWORD_DATA" "Возврат к старому паролю"

    echo -e "\n${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    📈 ИТОГИ JWT ТЕСТИРОВАНИЯ                  ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

    echo -e "${GREEN}✅ JWT авторизация работает${NC}"
    echo -e "${CYAN}🧪 Протестированы защищенные endpoints:${NC}"
    echo -e "${CYAN}   • Базовые CRUD операции (здания, контроллеры, метрики)${NC}"
    echo -e "${CYAN}   • Водная инфраструктура (линии, поставщики, источники)${NC}"
    echo -e "${CYAN}   • Админские API (batch операции, экспорт)${NC}"
    echo -e "${CYAN}   • Аналитика (обновления, кеш, пороги)${NC}"
    echo -e "${CYAN}   • Расширенная аутентификация (logout, смена пароля)${NC}"
    echo -e "${CYAN}   • Трансформаторы и линии электропередач${NC}"

else
    echo -e "${RED}❌ Не удалось получить JWT токен${NC}"
    echo -e "${YELLOW}📝 Проверьте:${NC}"
    echo -e "${YELLOW}   • Запущен ли сервер API${NC}"
    echo -e "${YELLOW}   • Доступна ли база данных${NC}"
    echo -e "${YELLOW}   • Корректность учетных данных${NC}"
fi