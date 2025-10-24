#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Загрузка утилиты определения порта
source "$(dirname "$0")/utils/port-detector.sh"

# Функция для запуска bash тестов
run_bash_tests() {
    echo -e "${BLUE}🧪 Запуск bash тестов...${NC}"
    cd "$(dirname "$0")/bash"
    
    if ./run-tests.sh all; then
        echo -e "${GREEN}✅ Bash тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Bash тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска Jest тестов
run_jest_tests() {
    echo -e "${BLUE}🧪 Запуск Jest тестов...${NC}"
    
    # Возвращаемся в корневую директорию проекта
    cd "$(dirname "$0")/.."
    
    if npm test; then
        echo -e "${GREEN}✅ Jest тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Jest тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска нагрузочных тестов
run_load_tests() {
    echo -e "${BLUE}🧪 Запуск нагрузочных тестов...${NC}"
    cd "$(dirname "$0")/load"
    
    if ./run-load-tests.sh; then
        echo -e "${GREEN}✅ Нагрузочные тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Нагрузочные тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска smoke тестов
run_smoke_tests() {
    echo -e "${BLUE}🧪 Запуск smoke тестов...${NC}"
    cd "$(dirname "$0")/smoke"
    
    if ./run-smoke-tests.sh; then
        echo -e "${GREEN}✅ Smoke тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Smoke тесты провалились${NC}"
        return 1
    fi
}

# Функция для отображения справки
show_help() {
    echo -e "${BLUE}🚀 Универсальный тестовый runner для InfraSafe${NC}"
    echo ""
    echo -e "${YELLOW}Использование:${NC}"
    echo "  $0 [тип_тестов]"
    echo ""
    echo -e "${YELLOW}Доступные типы тестов:${NC}"
    echo "  bash     - Bash тесты (alerts, api, jwt)"
    echo "  jest     - Jest тесты (unit, integration, security)"
    echo "  load     - Нагрузочные тесты"
    echo "  smoke    - Smoke тесты"
    echo "  all      - Все типы тестов (по умолчанию)"
    echo "  help     - Показать эту справку"
    echo ""
    echo -e "${YELLOW}Примеры:${NC}"
    echo "  $0          # Запустить все тесты"
    echo "  $0 bash     # Запустить только bash тесты"
    echo "  $0 jest     # Запустить только Jest тесты"
    echo "  $0 load     # Запустить только нагрузочные тесты"
    echo "  $0 smoke    # Запустить только smoke тесты"
    echo ""
    echo -e "${BLUE}📋 Используется порт: $API_PORT${NC}"
}

# Функция для генерации отчета
generate_report() {
    local total_tests=$1
    local passed_tests=$2
    local failed_tests=$3
    local test_type=$4
    
    echo ""
    echo -e "${PURPLE}📊 ОТЧЕТ ПО ТЕСТАМ: $test_type${NC}"
    echo -e "${GREEN}✅ Успешных тестов: $passed_tests${NC}"
    echo -e "${RED}❌ Неуспешных тестов: $failed_tests${NC}"
    echo -e "${BLUE}📊 Всего тестов: $total_tests${NC}"
    
    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}🎉 Все тесты прошли успешно!${NC}"
    else
        echo -e "${YELLOW}⚠️  Обнаружены проблемы в $failed_tests тестах${NC}"
    fi
}

# Главная функция
main() {
    echo -e "${BLUE}🚀 Универсальный тестовый runner для InfraSafe${NC}"
    echo -e "${BLUE}📋 Используется порт: $API_PORT${NC}"
    echo -e "${BLUE}📋 URL: $API_URL${NC}"
    echo ""
    
    # Определение типа тестов из аргументов
    local test_type=${1:-"all"}
    
    case $test_type in
        "bash")
            run_bash_tests
            ;;
        "jest")
            run_jest_tests
            ;;
        "load")
            run_load_tests
            ;;
        "smoke")
            run_smoke_tests
            ;;
        "all")
            local total_exit_code=0
            local total_tests=0
            local passed_tests=0
            local failed_tests=0
            
            echo -e "${CYAN}🔄 Запуск всех типов тестов...${NC}"
            echo ""
            
            # Bash тесты
            if run_bash_tests; then
                ((passed_tests++))
            else
                ((failed_tests++))
                total_exit_code=1
            fi
            ((total_tests++))
            
            # Jest тесты
            if run_jest_tests; then
                ((passed_tests++))
            else
                ((failed_tests++))
                total_exit_code=1
            fi
            ((total_tests++))
            
            # Нагрузочные тесты
            if run_load_tests; then
                ((passed_tests++))
            else
                ((failed_tests++))
                total_exit_code=1
            fi
            ((total_tests++))
            
            # Smoke тесты
            if run_smoke_tests; then
                ((passed_tests++))
            else
                ((failed_tests++))
                total_exit_code=1
            fi
            ((total_tests++))
            
            generate_report $total_tests $passed_tests $failed_tests "ВСЕ ТЕСТЫ"
            
            exit $total_exit_code
            ;;
        "help"|"-h"|"--help")
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Неизвестный тип тестов: $test_type${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
    
    local exit_code=$?
    
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}🎉 Тесты завершены успешно!${NC}"
    else
        echo -e "${RED}❌ Тесты провалились${NC}"
    fi
    
    exit $exit_code
}

# Запуск главной функции
main "$@" 