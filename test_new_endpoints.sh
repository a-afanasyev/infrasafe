#!/bin/bash

# Быстрый тест ТОЛЬКО новых endpoints после рефакторинга
# Фокус на проверке 9 новых API методов

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
        RESPONSE=$(eval "curl -s -w '\nСтатус: %{http_code}' -X $METHOD $HEADERS '${API_URL}${ENDPOINT}'")
    else
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
echo -e "${PURPLE}║           🚀 ТЕСТИРОВАНИЕ НОВЫХ ENDPOINTS                     ║${NC}"
echo -e "${PURPLE}║              (После рефакторинга бэкенда)                     ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo -e "${YELLOW}🌐 URL: ${API_URL}${NC}"
echo -e "${YELLOW}📅 Время: $(date)${NC}"
echo -e "${GREEN}📋 Тестируем 9 новых endpoints${NC}\n"

# Получаем JWT токен для авторизации
get_jwt_token

# 🏢 НОВЫЕ ENDPOINTS ДЛЯ ЗДАНИЙ (2 endpoints)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                🏢 НОВЫЕ ENDPOINTS ЗДАНИЙ                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}📍 1. Геопространственный поиск зданий${NC}"
test_endpoint "GET" "/api/buildings/search?latitude=41.347052&longitude=69.203200&radius=5&limit=10" "" "false" "Поиск зданий в радиусе 5км от Ташкента"

test_endpoint "GET" "/api/buildings/search?latitude=55.755825&longitude=37.617298&radius=2" "" "false" "Поиск зданий в радиусе 2км от Москвы"

echo -e "${CYAN}📊 2. Статистика зданий${NC}"
test_endpoint "GET" "/api/buildings/statistics" "" "false" "Получение аналитики зданий по городам и УК"

# 🎛️ НОВЫЕ ENDPOINTS ДЛЯ КОНТРОЛЛЕРОВ (2 endpoints)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              🎛️ НОВЫЕ ENDPOINTS КОНТРОЛЛЕРОВ                 ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}🔄 3. Автообновление статусов контроллеров${NC}"
test_endpoint "POST" "/api/controllers/update-status-by-activity" "" "true" "Автообновление статусов по активности (timeout 10 мин)"

echo -e "${CYAN}📊 4. Статистика контроллеров${NC}"
test_endpoint "GET" "/api/controllers/statistics" "" "false" "Получение аналитики контроллеров по статусам"

# 📊 НОВЫЕ ENDPOINTS ДЛЯ МЕТРИК (2 endpoints)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                📊 НОВЫЕ ENDPOINTS МЕТРИК                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}📈 5. Агрегированные метрики${NC}"
test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=hour" "" "false" "Агрегация метрик контроллера 1 по часам"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=day" "" "false" "Агрегация метрик контроллера 1 по дням"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=week" "" "false" "Агрегация метрик контроллера 1 по неделям"

echo -e "${CYAN}🧹 6. Очистка старых метрик${NC}"
test_endpoint "DELETE" "/api/metrics/cleanup?days=90" "" "true" "Очистка метрик старше 90 дней (data retention)"

# 🔐 НОВЫЕ ENDPOINTS ДЛЯ АУТЕНТИФИКАЦИИ (3 endpoints)
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║            🔐 НОВЫЕ ENDPOINTS АУТЕНТИФИКАЦИИ                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}🔄 7. Обновление токенов (refresh)${NC}"
# Получаем refresh token
REFRESH_LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "admin", "password": "admin123"}')

REFRESH_TOKEN=$(echo "$REFRESH_LOGIN_RESPONSE" | jq -r '.refreshToken' 2>/dev/null)

if [ "$REFRESH_TOKEN" != "null" ] && [ ! -z "$REFRESH_TOKEN" ]; then
    echo -e "${GREEN}✅ Refresh токен получен для тестирования${NC}"
    REFRESH_DATA='{"refreshToken": "'$REFRESH_TOKEN'"}'
    test_endpoint "POST" "/api/auth/refresh" "$REFRESH_DATA" "false" "Обновление access/refresh токенов"
else
    echo -e "${YELLOW}⚠️  AuthService возможно еще не полностью интегрирован${NC}"
    test_endpoint "POST" "/api/auth/refresh" '{"refreshToken": "fake.token"}' "false" "Тест refresh с фейк токеном"
fi

echo -e "${CYAN}🔑 8. Смена пароля${NC}"
CHANGE_PASSWORD_DATA='{
    "currentPassword": "admin123",
    "newPassword": "newTestPass123"
}'
test_endpoint "POST" "/api/auth/change-password" "$CHANGE_PASSWORD_DATA" "true" "Смена пароля пользователя"

# Возвращаем пароль обратно
RESTORE_PASSWORD_DATA='{
    "currentPassword": "newTestPass123",
    "newPassword": "admin123"
}'
test_endpoint "POST" "/api/auth/change-password" "$RESTORE_PASSWORD_DATA" "true" "Возврат к исходному паролю"

echo -e "${CYAN}🔓 9. Выход из системы (logout)${NC}"
test_endpoint "POST" "/api/auth/logout" "" "true" "Выход с добавлением токена в blacklist"

# ТЕСТЫ НА ОШИБКИ ДЛЯ НОВЫХ ENDPOINTS
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               ⚠️ ТЕСТЫ НА ОШИБКИ (НОВЫЕ ENDPOINTS)           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}🧪 Проверка валидации данных${NC}"
test_endpoint "GET" "/api/buildings/search?latitude=200&longitude=300&radius=5" "" "false" "Поиск с неверными координатами"

test_endpoint "GET" "/api/metrics/controller/1/aggregated?timeFrame=invalid" "" "false" "Агрегация с неверным timeFrame"

test_endpoint "DELETE" "/api/metrics/cleanup?days=0" "" "true" "Очистка с неверным параметром days"

WEAK_PASSWORD_DATA='{"currentPassword": "admin123", "newPassword": "123"}'
test_endpoint "POST" "/api/auth/change-password" "$WEAK_PASSWORD_DATA" "true" "Смена на слабый пароль"

# ИТОГИ ТЕСТИРОВАНИЯ
echo -e "${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║                📈 ИТОГИ ТЕСТИРОВАНИЯ НОВЫХ ENDPOINTS         ║${NC}"
echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "${GREEN}✅ Тестирование 9 новых endpoints завершено${NC}"
echo -e "${BLUE}📊 Протестированы категории:${NC}"
echo -e "${CYAN}   🏢 Здания (2 endpoints):${NC}"
echo -e "${CYAN}      • Геопространственный поиск по координатам и радиусу${NC}"
echo -e "${CYAN}      • Статистика зданий по городам и управляющим компаниям${NC}"
echo -e "${CYAN}   🎛️  Контроллеры (2 endpoints):${NC}"
echo -e "${CYAN}      • Автообновление статусов по активности${NC}"
echo -e "${CYAN}      • Статистика контроллеров по статусам и зданиям${NC}"
echo -e "${CYAN}   📊 Метрики (2 endpoints):${NC}"
echo -e "${CYAN}      • Агрегированные метрики по временным интервалам${NC}"
echo -e "${CYAN}      • Очистка старых метрик (data retention)${NC}"
echo -e "${CYAN}   🔐 Аутентификация (3 endpoints):${NC}"
echo -e "${CYAN}      • Обновление токенов через refresh token${NC}"
echo -e "${CYAN}      • Смена пароля с валидацией${NC}"
echo -e "${CYAN}      • Выход с добавлением токена в blacklist${NC}"

echo -e "\n${GREEN}🎯 Все новые функции после рефакторинга протестированы!${NC}"
echo -e "${YELLOW}📋 Для полного тестирования используйте: ./test_api.sh${NC}"
echo -e "${YELLOW}📖 Swagger документация: ${API_URL}/api-docs${NC}"

echo -e "\n${PURPLE}═══════════════════════════════════════════════════════════════${NC}" 