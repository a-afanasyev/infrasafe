#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для отображения помощи
show_help() {
    echo -e "${YELLOW}🚀 Скрипт управления средой разработки InfraSafe${NC}"
    echo "=============================================="
    echo
    echo "Использование: ./dev-start.sh [команда]"
    echo
    echo "Команды:"
    echo "  start     - Запустить среду разработки"
    echo "  stop      - Остановить все сервисы"
    echo "  restart   - Перезапустить все сервисы"
    echo "  rebuild   - Пересобрать и запустить контейнеры"
    echo "  logs      - Показать логи всех сервисов"
    echo "  logs-app  - Показать логи только бэкенда"
    echo "  logs-web  - Показать логи только фронтенда"
    echo "  logs-db   - Показать логи только базы данных"
    echo "  status    - Показать статус всех сервисов"
    echo "  clean     - Очистить все контейнеры и данные"
    echo "  shell-app - Войти в контейнер бэкенда"
    echo "  shell-web - Войти в контейнер фронтенда"
    echo "  shell-db  - Войти в контейнер базы данных"
    echo "  install   - Установить зависимости в контейнере"
    echo "  test      - Запустить тесты API"
    echo "  help      - Показать эту справку"
    echo
    echo "Примеры:"
    echo "  ./dev-start.sh start"
    echo "  ./dev-start.sh logs-app"
    echo "  ./dev-start.sh rebuild"
    echo
}

# Проверка наличия Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker не найден. Пожалуйста, установите Docker.${NC}"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker не запущен. Пожалуйста, запустите Docker.${NC}"
        exit 1
    fi
}

# Запуск среды разработки
start_dev() {
    echo -e "${GREEN}🚀 Запуск среды разработки InfraSafe...${NC}"
    
    # Проверяем файл .env
    if [ ! -f .env ]; then
        echo -e "${YELLOW}📄 Файл .env не найден. Создаем из env.example...${NC}"
        if [ -f env.example ]; then
            cp env.example .env
            echo -e "${YELLOW}⚠️  Отредактируйте файл .env при необходимости${NC}"
        else
            echo -e "${RED}❌ Файл env.example не найден${NC}"
        fi
    fi
    
    # Запуск контейнеров
    docker-compose -f docker-compose.dev.yml up -d
    
    echo -e "${GREEN}✅ Среда разработки запущена!${NC}"
    echo
    echo -e "${BLUE}🌐 Доступные сервисы:${NC}"
    echo "  - Веб-интерфейс: http://localhost:8080"
    echo "  - API: http://localhost:8080/api/"
    echo "  - Swagger: http://localhost:8080/api-docs/"
    echo "  - Прямой API: http://localhost:3000/api/"
    echo "  - PostgreSQL: localhost:5432"
    echo
    echo -e "${YELLOW}📝 Полезные команды:${NC}"
    echo "  - Логи: ./dev-start.sh logs"
    echo "  - Статус: ./dev-start.sh status"
    echo "  - Остановка: ./dev-start.sh stop"
}

# Остановка сервисов
stop_dev() {
    echo -e "${YELLOW}🛑 Остановка сервисов...${NC}"
    docker-compose -f docker-compose.dev.yml down
    echo -e "${GREEN}✅ Сервисы остановлены${NC}"
}

# Перезапуск сервисов
restart_dev() {
    echo -e "${YELLOW}🔄 Перезапуск сервисов...${NC}"
    docker-compose -f docker-compose.dev.yml restart
    echo -e "${GREEN}✅ Сервисы перезапущены${NC}"
}

# Пересборка и запуск
rebuild_dev() {
    echo -e "${YELLOW}🏗️  Пересборка контейнеров...${NC}"
    docker-compose -f docker-compose.dev.yml down
    docker-compose -f docker-compose.dev.yml build --no-cache
    docker-compose -f docker-compose.dev.yml up -d
    echo -e "${GREEN}✅ Контейнеры пересобраны и запущены${NC}"
}

# Показать логи
show_logs() {
    echo -e "${BLUE}📋 Логи всех сервисов:${NC}"
    docker-compose -f docker-compose.dev.yml logs -f
}

# Показать логи конкретного сервиса
show_service_logs() {
    service=$1
    echo -e "${BLUE}📋 Логи сервиса ${service}:${NC}"
    docker-compose -f docker-compose.dev.yml logs -f $service
}

# Показать статус
show_status() {
    echo -e "${BLUE}📊 Статус сервисов:${NC}"
    docker-compose -f docker-compose.dev.yml ps
    echo
    echo -e "${BLUE}💾 Использование ресурсов:${NC}"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
}

# Очистка
clean_dev() {
    echo -e "${RED}🧹 Очистка всех контейнеров и данных...${NC}"
    read -p "Вы уверены? Все данные будут удалены! (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose -f docker-compose.dev.yml down -v --rmi local
        docker system prune -f
        echo -e "${GREEN}✅ Очистка завершена${NC}"
    else
        echo -e "${YELLOW}❌ Очистка отменена${NC}"
    fi
}

# Вход в контейнер
shell_access() {
    service=$1
    echo -e "${BLUE}🐚 Вход в контейнер ${service}...${NC}"
    docker-compose -f docker-compose.dev.yml exec $service sh
}

# Вход в базу данных
db_shell() {
    echo -e "${BLUE}🗄️  Вход в базу данных...${NC}"
    docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe
}

# Установка зависимостей
install_deps() {
    echo -e "${YELLOW}📦 Установка зависимостей...${NC}"
    docker-compose -f docker-compose.dev.yml exec app npm install
    echo -e "${GREEN}✅ Зависимости установлены${NC}"
}

# Запуск тестов
run_tests() {
    echo -e "${YELLOW}🧪 Запуск тестов API...${NC}"
    if [ -f "./test_api.sh" ]; then
        ./test_api.sh
    else
        echo -e "${RED}❌ Файл тестов не найден${NC}"
    fi
}

# Проверка Docker
check_docker

# Обработка команд
case "${1:-start}" in
    start)
        start_dev
        ;;
    stop)
        stop_dev
        ;;
    restart)
        restart_dev
        ;;
    rebuild)
        rebuild_dev
        ;;
    logs)
        show_logs
        ;;
    logs-app)
        show_service_logs app
        ;;
    logs-web)
        show_service_logs frontend
        ;;
    logs-db)
        show_service_logs postgres
        ;;
    status)
        show_status
        ;;
    clean)
        clean_dev
        ;;
    shell-app)
        shell_access app
        ;;
    shell-web)
        shell_access frontend
        ;;
    shell-db)
        db_shell
        ;;
    install)
        install_deps
        ;;
    test)
        run_tests
        ;;
    help)
        show_help
        ;;
    *)
        echo -e "${RED}❌ Неизвестная команда: $1${NC}"
        echo
        show_help
        exit 1
        ;;
esac 