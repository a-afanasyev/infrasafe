#!/bin/bash

# =============================================================================
# Unified Test Orchestrator - InfraSafe Testing Framework
# =============================================================================

# Загружаем конфигурацию
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config/unified-config.sh"
source "$SCRIPT_DIR/../utils/health-checker.sh"

# =============================================================================
# Test Orchestrator Configuration
# =============================================================================

ORCHESTRATOR_REPORT="$TEST_CONFIG_REPORTS_DIR/unified-test-report-$(date +%Y%m%d-%H%M%S).json"
ORCHESTRATOR_LOG="$TEST_CONFIG_LOGS_DIR/unified-test-$(date +%Y%m%d-%H%M%S).log"

# =============================================================================
# Test Suite Management
# =============================================================================

# Определение доступных тестовых модулей
get_available_test_modules() {
    local modules=()
    
    # Jest тесты (встроенные)
    if [ -f "package.json" ] && [ -d "tests/jest" ]; then
        modules+=("jest")
    fi
    
    # Enhanced Load Tests
    if [ -f "tests/load/enhanced-load-tests.sh" ]; then
        modules+=("load")
    fi
    
    # Smart Smoke Tests
    if [ -f "tests/smoke/smart-smoke-tests.sh" ]; then
        modules+=("smoke")
    fi
    
    echo "${modules[@]}"
}

# Выполнение Jest тестов
run_jest_tests() {
    echo -e "${CYAN}📋 Выполнение Jest тестов...${NC}"
    
    local start_time=$(date +%s)
    local jest_log="$TEST_CONFIG_TEMP_DIR/jest-output.json"
    
    # Запускаем Jest с JSON отчетом
    if command -v npm >/dev/null 2>&1; then
        npm test -- --json --outputFile="$jest_log" --silent 2>/dev/null
        local jest_exit_code=$?
    else
        echo -e "${RED}❌ npm не найден, пропускаем Jest тесты${NC}"
        return 1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Парсим результаты Jest
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    local success_rate=0
    
    if [ -f "$jest_log" ] && [ -s "$jest_log" ]; then
        total_tests=$(jq -r '.numTotalTests // 0' "$jest_log" 2>/dev/null)
        passed_tests=$(jq -r '.numPassedTests // 0' "$jest_log" 2>/dev/null)
        failed_tests=$(jq -r '.numFailedTests // 0' "$jest_log" 2>/dev/null)
        
        if [ $total_tests -gt 0 ]; then
            success_rate=$(echo "scale=1; $passed_tests * 100 / $total_tests" | bc -l)
        fi
    fi
    
    echo -e "${BLUE}   Всего тестов: $total_tests${NC}"
    echo -e "${GREEN}   Пройдено: $passed_tests${NC}"
    echo -e "${RED}   Провалено: $failed_tests${NC}"
    echo -e "${BLUE}   Успешность: ${success_rate}%${NC}"
    echo -e "${BLUE}   Время: $(format_duration $duration)${NC}"
    
    # Возвращаем результат в JSON формате
    cat << EOF
{
    "module": "jest",
    "total_tests": $total_tests,
    "passed_tests": $passed_tests,
    "failed_tests": $failed_tests,
    "success_rate": $success_rate,
    "duration": $duration,
    "exit_code": $jest_exit_code,
    "status": "$([ $jest_exit_code -eq 0 ] && echo "PASS" || echo "FAIL")"
}
EOF
    
    return $jest_exit_code
}

# Выполнение Load тестов
run_load_tests() {
    echo -e "${CYAN}⚡ Выполнение Enhanced Load тестов...${NC}"
    
    local start_time=$(date +%s)
    local load_script="$SCRIPT_DIR/../load/enhanced-load-tests.sh"
    
    if [ ! -f "$load_script" ]; then
        echo -e "${RED}❌ Enhanced Load Tests не найдены${NC}"
        return 1
    fi
    
    # Запускаем load тесты
    "$load_script" >/dev/null 2>&1
    local load_exit_code=$?
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Ищем последний load test отчет
    local latest_load_report=$(ls -t "$TEST_CONFIG_REPORTS_DIR"/load-test-report-*.json 2>/dev/null | head -1)
    
    local total_requests=0
    local total_success=0
    local total_errors=0
    local overall_success_rate=0
    
    if [ -f "$latest_load_report" ]; then
        total_requests=$(jq -r '.summary.total_requests // 0' "$latest_load_report" 2>/dev/null)
        total_success=$(jq -r '.summary.total_success // 0' "$latest_load_report" 2>/dev/null)
        total_errors=$(jq -r '.summary.total_errors // 0' "$latest_load_report" 2>/dev/null)
        overall_success_rate=$(jq -r '.summary.overall_success_rate // 0' "$latest_load_report" 2>/dev/null)
    fi
    
    echo -e "${BLUE}   Всего запросов: $total_requests${NC}"
    echo -e "${GREEN}   Успешно: $total_success${NC}"
    echo -e "${RED}   Ошибки: $total_errors${NC}"
    echo -e "${BLUE}   Успешность: ${overall_success_rate}%${NC}"
    echo -e "${BLUE}   Время: $(format_duration $duration)${NC}"
    
    # Возвращаем результат в JSON формате
    cat << EOF
{
    "module": "load",
    "total_requests": $total_requests,
    "successful_requests": $total_success,
    "failed_requests": $total_errors,
    "success_rate": $overall_success_rate,
    "duration": $duration,
    "exit_code": $load_exit_code,
    "status": "$([ $load_exit_code -eq 0 ] && echo "PASS" || echo "FAIL")",
    "report_file": "$latest_load_report"
}
EOF
    
    return $load_exit_code
}

# Выполнение Smoke тестов
run_smoke_tests() {
    echo -e "${CYAN}🚬 Выполнение Smart Smoke тестов...${NC}"
    
    local start_time=$(date +%s)
    local smoke_script="$SCRIPT_DIR/../smoke/smart-smoke-tests.sh"
    
    if [ ! -f "$smoke_script" ]; then
        echo -e "${RED}❌ Smart Smoke Tests не найдены${NC}"
        return 1
    fi
    
    # Запускаем smoke тесты
    "$smoke_script" >/dev/null 2>&1
    local smoke_exit_code=$?
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Ищем последний smoke test отчет
    local latest_smoke_report=$(ls -t "$TEST_CONFIG_REPORTS_DIR"/smoke-test-*.json 2>/dev/null | head -1)
    
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    local success_rate=0
    
    if [ -f "$latest_smoke_report" ]; then
        total_tests=$(jq -r '.summary.total_tests // 0' "$latest_smoke_report" 2>/dev/null)
        passed_tests=$(jq -r '.summary.passed_tests // 0' "$latest_smoke_report" 2>/dev/null)
        failed_tests=$(jq -r '.summary.failed_tests // 0' "$latest_smoke_report" 2>/dev/null)
        success_rate=$(jq -r '.summary.success_rate // 0' "$latest_smoke_report" 2>/dev/null)
    fi
    
    echo -e "${BLUE}   Всего тестов: $total_tests${NC}"
    echo -e "${GREEN}   Пройдено: $passed_tests${NC}"
    echo -e "${RED}   Провалено: $failed_tests${NC}"
    echo -e "${BLUE}   Успешность: ${success_rate}%${NC}"
    echo -e "${BLUE}   Время: $(format_duration $duration)${NC}"
    
    # Возвращаем результат в JSON формате
    cat << EOF
{
    "module": "smoke",
    "total_tests": $total_tests,
    "passed_tests": $passed_tests,
    "failed_tests": $failed_tests,
    "success_rate": $success_rate,
    "duration": $duration,
    "exit_code": $smoke_exit_code,
    "status": "$([ $smoke_exit_code -eq 0 ] && echo "PASS" || echo "FAIL")",
    "report_file": "$latest_smoke_report"
}
EOF
    
    return $smoke_exit_code
}

# =============================================================================
# Test Orchestration Functions
# =============================================================================

# Выполнение всех тестов
run_all_tests() {
    local test_modules=("$@")
    
    if [ ${#test_modules[@]} -eq 0 ]; then
        test_modules=($(get_available_test_modules))
    fi
    
    echo -e "${CYAN}🎭 Запуск Unified Test Framework...${NC}"
    echo -e "${YELLOW}Модули для тестирования: ${test_modules[*]}${NC}"
    echo -e "${YELLOW}Отчет: $ORCHESTRATOR_REPORT${NC}"
    echo -e "${YELLOW}Лог: $ORCHESTRATOR_LOG${NC}"
    
    local overall_start_time=$(date +%s)
    local test_results=()
    local modules_passed=0
    local modules_failed=0
    local total_modules=0
    
    # Инициализация лога
    echo "=== Unified Test Framework Execution Log - $(date) ===" > "$ORCHESTRATOR_LOG"
    echo "Modules: ${test_modules[*]}" >> "$ORCHESTRATOR_LOG"
    echo "" >> "$ORCHESTRATOR_LOG"
    
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Выполняем каждый тестовый модуль
    for module in "${test_modules[@]}"; do
        ((total_modules++))
        echo -e "${CYAN}🔄 Выполнение модуля: $module${NC}"
        
        local module_result=""
        local module_exit_code=1
        
        case "$module" in
            "jest")
                module_result=$(run_jest_tests)
                module_exit_code=$?
                ;;
            "load")
                module_result=$(run_load_tests)
                module_exit_code=$?
                ;;
            "smoke")
                module_result=$(run_smoke_tests)
                module_exit_code=$?
                ;;
            *)
                echo -e "${RED}❌ Неизвестный модуль: $module${NC}"
                module_result='{"module": "'$module'", "status": "UNKNOWN", "error": "Unknown module"}'
                ;;
        esac
        
        # Сохраняем результат
        test_results+=("$module_result")
        
        # Обновляем счетчики
        if [ $module_exit_code -eq 0 ]; then
            ((modules_passed++))
            echo -e "${GREEN}✅ Модуль $module завершен успешно${NC}"
        else
            ((modules_failed++))
            echo -e "${RED}❌ Модуль $module завершен с ошибками${NC}"
        fi
        
        # Логируем результат
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Module $module: $([ $module_exit_code -eq 0 ] && echo "PASS" || echo "FAIL")" >> "$ORCHESTRATOR_LOG"
        
        echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    done
    
    local overall_end_time=$(date +%s)
    local overall_duration=$((overall_end_time - overall_start_time))
    
    # Создаем сводный JSON отчет
    cat > "$ORCHESTRATOR_REPORT" << EOF
{
    "framework_info": {
        "name": "InfraSafe Unified Test Framework",
        "version": "1.0.0",
        "timestamp": "$(date -Iseconds)",
        "api_url": "$TEST_CONFIG_API_URL",
        "total_duration": $overall_duration
    },
    "execution_summary": {
        "total_modules": $total_modules,
        "modules_passed": $modules_passed,
        "modules_failed": $modules_failed,
        "overall_status": "$([ $modules_failed -eq 0 ] && echo "PASS" || echo "FAIL")"
    },
    "module_results": [
EOF
    
    # Добавляем результаты модулей
    local first=true
    for result in "${test_results[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> "$ORCHESTRATOR_REPORT"
        fi
        echo "        $result" >> "$ORCHESTRATOR_REPORT"
    done
    
    # Завершаем JSON отчет
    cat >> "$ORCHESTRATOR_REPORT" << EOF
    ],
    "environment": {
        "api_port": "$TEST_CONFIG_API_PORT",
        "db_url": "$TEST_CONFIG_DB_URL",
        "test_user": "$TEST_CONFIG_TEST_USERNAME"
    }
}
EOF
    
    # Выводим итоговую статистику
    echo -e "${CYAN}📊 Итоги выполнения Unified Test Framework:${NC}"
    echo -e "${BLUE}   Общее время: $(format_duration $overall_duration)${NC}"
    echo -e "${BLUE}   Всего модулей: $total_modules${NC}"
    echo -e "${GREEN}   Успешно: $modules_passed${NC}"
    echo -e "${RED}   С ошибками: $modules_failed${NC}"
    
    local overall_success_rate=0
    if [ $total_modules -gt 0 ]; then
        overall_success_rate=$(echo "scale=1; $modules_passed * 100 / $total_modules" | bc -l)
    fi
    echo -e "${BLUE}   Общая успешность: ${overall_success_rate}%${NC}"
    
    echo -e "${BLUE}📄 Отчеты:${NC}"
    echo -e "${BLUE}   Сводный JSON: $ORCHESTRATOR_REPORT${NC}"
    echo -e "${BLUE}   Лог выполнения: $ORCHESTRATOR_LOG${NC}"
    
    # Логируем итоги
    echo "" >> "$ORCHESTRATOR_LOG"
    echo "=== EXECUTION SUMMARY ===" >> "$ORCHESTRATOR_LOG"
    echo "Total Modules: $total_modules" >> "$ORCHESTRATOR_LOG"
    echo "Modules Passed: $modules_passed" >> "$ORCHESTRATOR_LOG"
    echo "Modules Failed: $modules_failed" >> "$ORCHESTRATOR_LOG"
    echo "Overall Success Rate: ${overall_success_rate}%" >> "$ORCHESTRATOR_LOG"
    echo "Total Duration: $(format_duration $overall_duration)" >> "$ORCHESTRATOR_LOG"
    
    # Определяем финальный статус
    if [ $modules_failed -eq 0 ]; then
        echo -e "${GREEN}🎉 Все тестовые модули выполнены успешно!${NC}"
        echo "OVERALL RESULT: SUCCESS" >> "$ORCHESTRATOR_LOG"
        return 0
    else
        echo -e "${RED}⚠️  Некоторые тестовые модули завершились с ошибками${NC}"
        echo "OVERALL RESULT: FAILED" >> "$ORCHESTRATOR_LOG"
        return 1
    fi
}

# Быстрый smoke test (только основные проверки)
run_quick_test() {
    echo -e "${CYAN}⚡ Быстрая проверка системы...${NC}"
    
    # Проверяем только доступность API и базовую функциональность
    if ! check_api_availability || ! check_api_endpoints; then
        echo -e "${RED}❌ Быстрая проверка провалена${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Быстрая проверка прошла успешно${NC}"
    return 0
}

# =============================================================================
# CLI Interface
# =============================================================================

show_help() {
    cat << EOF
🎭 InfraSafe Unified Test Framework

ИСПОЛЬЗОВАНИЕ:
    $(basename "$0") [КОМАНДА] [ОПЦИИ]

КОМАНДЫ:
    all             Запустить все доступные тесты
    jest            Запустить только Jest тесты
    load            Запустить только нагрузочные тесты
    smoke           Запустить только smoke тесты
    quick           Быстрая проверка системы
    health          Проверка готовности системы
    modules         Показать доступные модули
    help            Показать эту справку

ОПЦИИ:
    --no-health     Пропустить проверку готовности системы
    --quiet         Минимальный вывод
    --config FILE   Использовать альтернативный конфигурационный файл

ПРИМЕРЫ:
    $(basename "$0") all                    # Все тесты
    $(basename "$0") jest smoke             # Только Jest и Smoke тесты
    $(basename "$0") quick                  # Быстрая проверка
    $(basename "$0") health                 # Проверка готовности системы

ОТЧЕТЫ:
    Все отчеты сохраняются в директории: $TEST_CONFIG_REPORTS_DIR
    Логи сохраняются в директории: $TEST_CONFIG_LOGS_DIR

EOF
}

# =============================================================================
# Main Script Logic
# =============================================================================

main() {
    local skip_health_check=false
    local quiet_mode=false
    local commands=()
    
    # Парсинг аргументов
    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-health)
                skip_health_check=true
                shift
                ;;
            --quiet)
                quiet_mode=true
                shift
                ;;
            --config)
                # Загружаем альтернативный конфиг (если указан)
                if [ -f "$2" ]; then
                    source "$2"
                fi
                shift 2
                ;;
            help|-h|--help)
                show_help
                exit 0
                ;;
            modules)
                echo -e "${CYAN}Доступные тестовые модули:${NC}"
                for module in $(get_available_test_modules); do
                    echo -e "${GREEN}  ✅ $module${NC}"
                done
                exit 0
                ;;
            health)
                perform_full_health_check
                exit $?
                ;;
            quick)
                run_quick_test
                exit $?
                ;;
            all|jest|load|smoke)
                commands+=("$1")
                shift
                ;;
            *)
                echo -e "${RED}❌ Неизвестная команда: $1${NC}"
                echo -e "${YELLOW}Используйте 'help' для получения справки${NC}"
                exit 1
                ;;
        esac
    done
    
    # Если команды не указаны, используем 'all'
    if [ ${#commands[@]} -eq 0 ]; then
        commands=("all")
    fi
    
    # Проверка готовности системы (если не отключена)
    if [ "$skip_health_check" = false ]; then
        echo -e "${CYAN}🏥 Проверка готовности системы...${NC}"
        if ! perform_full_health_check; then
            echo -e "${RED}❌ Система не готова к тестированию${NC}"
            echo -e "${YELLOW}ℹ️  Используйте --no-health для пропуска этой проверки${NC}"
            exit 1
        fi
        echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    fi
    
    # Выполнение команд
    local overall_exit_code=0
    
    for command in "${commands[@]}"; do
        case $command in
            "all")
                run_all_tests
                ;;
            "jest"|"load"|"smoke")
                run_all_tests "$command"
                ;;
        esac
        
        # Сохраняем код ошибки
        if [ $? -ne 0 ]; then
            overall_exit_code=1
        fi
    done
    
    exit $overall_exit_code
}

# =============================================================================
# Script Execution
# =============================================================================

# Если скрипт запущен напрямую
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
