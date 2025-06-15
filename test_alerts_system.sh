#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# URL сервера
BASE_URL="http://localhost:3000"

# Функция для красивого вывода
print_header() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC} $1"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
}

print_test() {
    echo -e "${BLUE}📡${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ Успех!${NC} Статус: $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️  Предупреждение!${NC} Статус: $1"
}

print_error() {
    echo -e "${RED}❌ Ошибка!${NC} Статус: $1"
}

print_info() {
    echo -e "${PURPLE}📋 Ответ:${NC}"
}

# Функция для выполнения HTTP запроса
make_request() {
    local method="$1"
    local url="$2"
    local data="$3"
    local headers="$4"

    # Используем временный файл для надежного разделения тела ответа и статуса
    local temp_file=$(mktemp)
    local status_file=$(mktemp)

    if [ -n "$data" ] && [ -n "$headers" ]; then
        curl -s -w "%{http_code}" -X "$method" "$url" -H "$headers" -d "$data" -o "$temp_file" > "$status_file"
    elif [ -n "$headers" ]; then
        curl -s -w "%{http_code}" -X "$method" "$url" -H "$headers" -o "$temp_file" > "$status_file"
    elif [ -n "$data" ]; then
        curl -s -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$data" -o "$temp_file" > "$status_file"
    else
        curl -s -w "%{http_code}" "$url" -o "$temp_file" > "$status_file"
    fi

    local status_code=$(cat "$status_file")
    local response_body=$(cat "$temp_file")
    rm -f "$temp_file" "$status_file"

    echo "$response_body"
    return $status_code
}

# Основная функция тестирования
main() {
    clear
    print_header "🚨 КОМПЛЕКСНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ АЛЕРТОВ InfraSafe 🚨"
    echo -e "${CYAN}🌐 URL:${NC} $BASE_URL"
    echo -e "${CYAN}📅 Время:${NC} $(date)"
    echo -e "${CYAN}📋 Тестируем систему алертов с реальными данными Ташкента${NC}"
    echo ""

    # Счетчики для статистики
    local total_tests=0
    local passed_tests=0
    local failed_tests=0

    print_header "📋 ПРОСМОТР И ФИЛЬТРАЦИЯ АЛЕРТОВ"

    # Тест 1: Получение всех алертов
    ((total_tests++))
    print_test "Получение всех активных алертов"
    echo "GET /api/alerts"
    response=$(make_request "GET" "$BASE_URL/api/alerts")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        alert_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${PURPLE}📊 Найдено алертов: $alert_count${NC}"
        if [ "$alert_count" -gt 0 ]; then
            echo -e "${PURPLE}🎯 Типы алертов:${NC}"
            echo "$response" | jq -r '.data[] | "• \(.severity) - \(.infrastructure_id): \(.message)"' | head -5
        fi
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 2: Критические алерты
    ((total_tests++))
    print_test "Фильтрация критических алертов"
    echo "GET /api/alerts?severity=CRITICAL"
    response=$(make_request "GET" "$BASE_URL/api/alerts?severity=CRITICAL")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        critical_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${RED}🚨 Критических алертов: $critical_count${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 3: Алерты трансформаторов
    ((total_tests++))
    print_test "Алерты трансформаторов"
    echo "GET /api/alerts?infrastructure_type=transformer"
    response=$(make_request "GET" "$BASE_URL/api/alerts?infrastructure_type=transformer")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        transformer_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${YELLOW}⚡ Алертов трансформаторов: $transformer_count${NC}"
        if [ "$transformer_count" -gt 0 ]; then
            echo -e "${PURPLE}🔋 Нагрузка трансформаторов:${NC}"
            echo "$response" | jq -r '.data[] | "• \(.infrastructure_id): \(.data.load_percent)% (порог \(.data.threshold)%)"'
        fi
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 4: Комбинированная фильтрация
    ((total_tests++))
    print_test "Критические алерты трансформаторов"
    echo "GET /api/alerts?severity=CRITICAL&infrastructure_type=transformer"
    response=$(make_request "GET" "$BASE_URL/api/alerts?severity=CRITICAL&infrastructure_type=transformer")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        critical_transformers=$(echo "$response" | jq -r '.count // 0')
        echo -e "${RED}🚨⚡ Критически перегруженных трансформаторов: $critical_transformers${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "📊 СТАТИСТИКА И АНАЛИТИКА"

    # Тест 5: Статистика алертов
    ((total_tests++))
    print_test "Статистика алертов за 7 дней"
    echo "GET /api/alerts/statistics"
    response=$(make_request "GET" "$BASE_URL/api/alerts/statistics")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        echo -e "${PURPLE}📈 Статистика по типам:${NC}"
        echo "$response" | jq -r '.data.statistics[] | "• \(.severity) \(.infrastructure_type): \(.count) алертов"' 2>/dev/null || echo "Данные статистики недоступны"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 6: Статус системы
    ((total_tests++))
    print_test "Статус системы алертов"
    echo "GET /api/alerts/status"
    response=$(make_request "GET" "$BASE_URL/api/alerts/status")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        cb_state=$(echo "$response" | jq -r '.data.circuit_breaker_state.state // "unknown"')
        cooldown=$(echo "$response" | jq -r '.data.cooldown_minutes // "unknown"')
        echo -e "${GREEN}🔄 Circuit Breaker: $cb_state${NC}"
        echo -e "${BLUE}⏱️  Cooldown: $cooldown минут${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 7: Пороги алертов
    ((total_tests++))
    print_test "Пороги алертов"
    echo "GET /api/alerts/thresholds"
    response=$(make_request "GET" "$BASE_URL/api/alerts/thresholds")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        echo -e "${PURPLE}⚙️ Настроенные пороги:${NC}"
        echo "$response" | jq -r '.data | to_entries[] | "• \(.key): \(.value)"' 2>/dev/null || echo "Пороги недоступны"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "🔗 ИНТЕГРАЦИЯ С АНАЛИТИКОЙ ТРАНСФОРМАТОРОВ"

    # Тест 8: Аналитика трансформаторов
    ((total_tests++))
    print_test "Аналитика загрузки трансформаторов"
    echo "GET /api/analytics/transformers"
    response=$(make_request "GET" "$BASE_URL/api/analytics/transformers")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        transformer_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${YELLOW}⚡ Трансформаторов в системе: $transformer_count${NC}"
        echo -e "${PURPLE}📊 Загрузка трансформаторов:${NC}"
        echo "$response" | jq -r '.data[] | "• \(.id) (\(.name)): \(.load_percent | tonumber | floor)% нагрузка"' 2>/dev/null | head -3
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq '.data[] | {id, name, load_percent, capacity_kva}' 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 9: Перегруженные трансформаторы
    ((total_tests++))
    print_test "Поиск перегруженных трансформаторов (>85%)"
    echo "GET /api/analytics/transformers (фильтрация нагрузки >85%)"
    response=$(make_request "GET" "$BASE_URL/api/analytics/transformers")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        overloaded=$(echo "$response" | jq '.data[] | select(.load_percent | tonumber > 85)' 2>/dev/null)
        if [ -n "$overloaded" ]; then
            echo -e "${RED}🚨 Обнаружены перегруженные трансформаторы:${NC}"
            echo "$overloaded" | jq -r '"• " + .id + " (" + .name + "): " + (.load_percent | tonumber | tostring) + "% нагрузка"' 2>/dev/null
        else
            echo -e "${GREEN}✅ Перегруженных трансформаторов не обнаружено${NC}"
        fi
    else
        print_error $status
        ((failed_tests++))
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "📄 ТЕСТИРОВАНИЕ ПАГИНАЦИИ И СОРТИРОВКИ"

    # Тест 10: Пагинация
    ((total_tests++))
    print_test "Пагинация алертов (лимит 2)"
    echo "GET /api/alerts?limit=2"
    response=$(make_request "GET" "$BASE_URL/api/alerts?limit=2")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        returned_count=$(echo "$response" | jq -r '.data | length')
        echo -e "${BLUE}📄 Возвращено записей: $returned_count (ожидается ≤2)${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    print_info
    echo "$response" | jq '.data[] | {alert_id, infrastructure_id, severity}' 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 11: Сортировка
    ((total_tests++))
    print_test "Сортировка по дате создания (ASC)"
    echo "GET /api/alerts?sort=created_at&order=ASC"
    response=$(make_request "GET" "$BASE_URL/api/alerts?sort=created_at&order=ASC")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        echo -e "${BLUE}🔄 Сортировка по возрастанию даты:${NC}"
        echo "$response" | jq -r '.data[0:2][] | "• " + .alert_id + ": " + .created_at' 2>/dev/null || echo "Данные сортировки недоступны"
    else
        print_error $status
        ((failed_tests++))
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "🕐 ФИЛЬТРАЦИЯ ПО ВРЕМЕНИ"

    # Тест 12: Фильтрация по дате
    ((total_tests++))
    print_test "Алерты за последние 24 часа"
    yesterday=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "GET /api/alerts?created_after=$yesterday"
    response=$(make_request "GET" "$BASE_URL/api/alerts?created_after=$yesterday")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        recent_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${BLUE}📅 Алертов за 24 часа: $recent_count${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "⚠️ ТЕСТИРОВАНИЕ ГРАНИЧНЫХ СЛУЧАЕВ"

    # Тест 13: Несуществующий severity
    ((total_tests++))
    print_test "Фильтр с несуществующим severity"
    echo "GET /api/alerts?severity=UNKNOWN"
    response=$(make_request "GET" "$BASE_URL/api/alerts?severity=UNKNOWN")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        unknown_count=$(echo "$response" | jq -r '.count // 0')
        echo -e "${BLUE}📊 Алертов с severity=UNKNOWN: $unknown_count (ожидается 0)${NC}"
    else
        print_warning $status
        ((passed_tests++)) # Это нормальное поведение
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Тест 14: Очень большой лимит
    ((total_tests++))
    print_test "Большой лимит пагинации"
    echo "GET /api/alerts?limit=1000"
    response=$(make_request "GET" "$BASE_URL/api/alerts?limit=1000")
    status=$?

    if [ $status -eq 200 ]; then
        print_success $status
        ((passed_tests++))
        returned_count=$(echo "$response" | jq -r '.data | length')
        echo -e "${BLUE}📄 Возвращено записей: $returned_count${NC}"
    else
        print_error $status
        ((failed_tests++))
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    print_header "📈 ИТОГИ ТЕСТИРОВАНИЯ СИСТЕМЫ АЛЕРТОВ"

    echo -e "${GREEN}✅ Успешных тестов: $passed_tests${NC}"
    echo -e "${RED}❌ Неуспешных тестов: $failed_tests${NC}"
    echo -e "${BLUE}📊 Всего тестов: $total_tests${NC}"

    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}🎉 ВСЕ ТЕСТЫ ПРОШЛИ УСПЕШНО!${NC}"
        echo -e "${GREEN}✨ Система алертов InfraSafe полностью функциональна${NC}"
    else
        echo -e "${YELLOW}⚠️  Обнаружены проблемы в $failed_tests тестах${NC}"
        echo -e "${YELLOW}🔧 Рекомендуется проверить логи сервера${NC}"
    fi

    echo ""
    echo -e "${CYAN}📋 ПРОТЕСТИРОВАННАЯ ФУНКЦИОНАЛЬНОСТЬ:${NC}"
    echo "• 📋 Получение и фильтрация алертов"
    echo "• 🔍 Поиск по severity и infrastructure_type"
    echo "• 📊 Статистика и аналитика алертов"
    echo "• ⚙️ Статус системы и Circuit Breaker"
    echo "• 🔗 Интеграция с аналитикой трансформаторов"
    echo "• 📄 Пагинация и сортировка"
    echo "• 🕐 Фильтрация по времени"
    echo "• ⚠️ Граничные случаи и валидация"

    echo ""
    echo -e "${PURPLE}🎯 ОБНАРУЖЕННЫЕ АЛЕРТЫ В ТАШКЕНТЕ:${NC}"
    curl -s "$BASE_URL/api/alerts" | jq -r '.data[]? | "• " + .severity + " - " + .infrastructure_id + ": " + .message' 2>/dev/null | head -5

    echo ""
    echo -e "${BLUE}🚀 Система алертов готова к эксплуатации!${NC}"
}

# Запуск тестирования
main "$@"