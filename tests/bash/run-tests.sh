#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Загрузка утилиты определения порта
source "$(dirname "$0")/../utils/port-detector.sh"

# Функция для запуска тестов системы алертов
run_alerts_tests() {
    echo -e "${CYAN}📋 Запуск тестов системы алертов...${NC}"
    if ./test_alerts_system.sh; then
        echo -e "${GREEN}✅ Тесты системы алертов прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ Тесты системы алертов провалились${NC}"
        return 1
    fi
}

# Функция для запуска API тестов
run_api_tests() {
    echo -e "${CYAN}📡 Запуск API тестов...${NC}"
    if ./test_api.sh; then
        echo -e "${GREEN}✅ API тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ API тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска JWT тестов
run_jwt_tests() {
    echo -e "${CYAN}🔐 Запуск JWT тестов...${NC}"
    if ./test_jwt_only.sh; then
        echo -e "${GREEN}✅ JWT тесты прошли успешно${NC}"
        return 0
    else
        echo -e "${RED}❌ JWT тесты провалились${NC}"
        return 1
    fi
}

# Функция для запуска всех bash тестов
run_all_bash_tests() {
    echo -e "${BLUE}🧪 Запуск всех bash тестов...${NC}"
    
    local total_exit_code=0
    local passed_tests=0
    local failed_tests=0
    
    # Тесты системы алертов
    if run_alerts_tests; then
        ((passed_tests++))
    else
        ((failed_tests++))
        total_exit_code=1
    fi
    
    # API тесты
    if run_api_tests; then
        ((passed_tests++))
    else
        ((failed_tests++))
        total_exit_code=1
    fi
    
    # JWT тесты
    if run_jwt_tests; then
        ((passed_tests++))
    else
        ((failed_tests++))
        total_exit_code=1
    fi
    
    echo ""
    echo -e "${BLUE}📊 Результаты bash тестов:${NC}"
    echo -e "${GREEN}✅ Успешных тестов: $passed_tests${NC}"
    echo -e "${RED}❌ Неуспешных тестов: $failed_tests${NC}"
    echo -e "${BLUE}📊 Всего тестов: $((passed_tests + failed_tests))${NC}"
    
    return $total_exit_code
}

# Главная функция
main() {
    echo -e "${BLUE}🚀 Bash тесты InfraSafe${NC}"
    echo -e "${BLUE}📋 Используется порт: $API_PORT${NC}"
    echo ""
    
    # Определение типа тестов из аргументов
    local test_type=${1:-"all"}
    
    case $test_type in
        "alerts")
            run_alerts_tests
            ;;
        "api")
            run_api_tests
            ;;
        "jwt")
            run_jwt_tests
            ;;
        "all")
            run_all_bash_tests
            ;;
        *)
            echo -e "${RED}❌ Неизвестный тип тестов: $test_type${NC}"
            echo -e "${YELLOW}Доступные типы: alerts, api, jwt, all${NC}"
            exit 1
            ;;
    esac
    
    local exit_code=$?
    
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}🎉 Bash тесты завершены успешно!${NC}"
    else
        echo -e "${RED}❌ Некоторые bash тесты провалились${NC}"
    fi
    
    exit $exit_code
}

# Запуск главной функции
main "$@" 