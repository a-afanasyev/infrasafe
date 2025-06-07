#!/bin/bash

# Быстрое тестирование основных API функций InfraSafe
# Краткая версия test_api.sh

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Базовый URL
API_URL="http://localhost:8080"

# Функция для быстрого тестирования
quick_test() {
    METHOD=$1
    ENDPOINT=$2
    DESCRIPTION=$3
    
    echo -n -e "${CYAN}${DESCRIPTION}... ${NC}"
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X $METHOD "${API_URL}${ENDPOINT}")
    
    if [[ $STATUS -ge 200 && $STATUS -lt 300 ]]; then
        echo -e "${GREEN}✅ OK ($STATUS)${NC}"
        return 0
    elif [[ $STATUS -ge 400 && $STATUS -lt 500 ]]; then
        echo -e "${YELLOW}⚠️ $STATUS${NC}"
        return 1
    else
        echo -e "${RED}❌ $STATUS${NC}"
        return 1
    fi
}

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🚀 БЫСТРОЕ ТЕСТИРОВАНИЕ API INFRASAFE                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo -e "${YELLOW}🌐 URL: ${API_URL}${NC}\n"

# Счетчики
TOTAL=0
PASSED=0
FAILED=0

# Функция для подсчета результатов
count_result() {
    TOTAL=$((TOTAL + 1))
    if [ $1 -eq 0 ]; then
        PASSED=$((PASSED + 1))
    else
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${BLUE}📊 Базовые маршруты:${NC}"
quick_test "GET" "/api/" "API информация"
count_result $?

echo -e "\n${BLUE}🏢 Здания:${NC}"
quick_test "GET" "/api/buildings" "Список зданий"
count_result $?
quick_test "GET" "/api/buildings/1" "Здание по ID"
count_result $?

echo -e "\n${BLUE}🎛️ Контроллеры:${NC}"
quick_test "GET" "/api/controllers" "Список контроллеров"
count_result $?
quick_test "GET" "/api/controllers/1" "Контроллер по ID"
count_result $?
quick_test "GET" "/api/controllers/building/1" "Контроллеры здания"
count_result $?

echo -e "\n${BLUE}📊 Метрики:${NC}"
quick_test "GET" "/api/metrics" "Список метрик"
count_result $?
quick_test "GET" "/api/metrics/latest" "Последние метрики"
count_result $?
quick_test "GET" "/api/metrics/controller/1" "Метрики контроллера"
count_result $?

echo -e "\n${BLUE}🗺️ Данные для карты:${NC}"
quick_test "GET" "/api/buildings-metrics" "Здания с метриками"
count_result $?

echo -e "\n${BLUE}⚠️ Тесты на ошибки (должны возвращать 404):${NC}"
# Функция для тестирования ошибок - 404 это ожидаемый результат
error_test() {
    METHOD=$1
    ENDPOINT=$2
    DESCRIPTION=$3
    
    echo -n -e "${CYAN}${DESCRIPTION}... ${NC}"
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X $METHOD "${API_URL}${ENDPOINT}")
    
    if [[ $STATUS -eq 404 ]]; then
        echo -e "${GREEN}✅ OK (404)${NC}"
        return 0
    else
        echo -e "${RED}❌ $STATUS${NC}"
        return 1
    fi
}

error_test "GET" "/api/buildings/99999" "Несуществующее здание"
count_result $?
error_test "GET" "/api/nonexistent" "Несуществующий endpoint"
count_result $?

# Итоги
echo -e "\n${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                        📈 ИТОГИ                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 Все тесты прошли успешно!${NC}"
else
    echo -e "${YELLOW}⚠️ Некоторые тесты не прошли${NC}"
fi

echo -e "${CYAN}📊 Результаты: ${GREEN}$PASSED прошло${NC}, ${RED}$FAILED не прошло${NC}, ${BLUE}$TOTAL всего${NC}"

# Проверка доступности основных страниц
echo -e "\n${BLUE}🌐 Проверка веб-интерфейса:${NC}"
quick_test "GET" "/" "Главная страница"
quick_test "GET" "/admin.html" "Админ панель"
quick_test "GET" "/api-docs" "Документация API"

echo -e "\n${YELLOW}💡 Для полного тестирования запустите: ./test_api.sh${NC}"
echo -e "${YELLOW}📋 Документация API: ${API_URL}/api-docs${NC}"

if [ $FAILED -gt 0 ]; then
    exit 1
else
    exit 0
fi 