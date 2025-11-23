#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Инициализация среды разработки проекта InfraSafe${NC}"
echo "================================================="

# Проверка наличия .env файла
if [ ! -f .env ]; then
    echo -e "${YELLOW}Файл .env не найден. Копируем из env.example...${NC}"
    cp env.example .env
    echo -e "${RED}ВНИМАНИЕ: Отредактируйте файл .env с вашими настройками!${NC}"
fi

# Проверка наличия Docker
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}Docker и Docker Compose установлены. Используем Docker для развертывания.${NC}"

    # Выбор режима запуска
    read -p "Выберите режим запуска (unified/dev/prod): " mode

    if [ "$mode" = "prod" ]; then
        echo "Запуск приложения в production режиме..."
        docker compose -f docker-compose.prod.yml up -d --build
        COMPOSE_FILE="docker-compose.prod.yml"
    elif [ "$mode" = "dev" ]; then
        echo "Запуск приложения в development режиме..."
        docker compose -f docker-compose.dev.yml up -d --build
        COMPOSE_FILE="docker-compose.dev.yml"
    else
        echo "Запуск приложения в unified режиме (рекомендуется)..."
        docker compose -f docker-compose.unified.yml up -d --build
        COMPOSE_FILE="docker-compose.unified.yml"
    fi

    echo -e "${GREEN}Приложение запущено на http://localhost:8080${NC}"
    echo -e "${GREEN}API документация доступна на http://localhost:8080/api-docs${NC}"
    echo -e "${YELLOW}Для просмотра логов выполните:${NC} docker compose -f $COMPOSE_FILE logs -f app"
    echo -e "${YELLOW}Для остановки:${NC} docker compose -f $COMPOSE_FILE down"

elif command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo -e "${GREEN}Node.js и npm установлены. Запускаем локально.${NC}"

    # Установка зависимостей
    echo "Установка зависимостей..."
    npm install

    # Проверка наличия PostgreSQL
    if command -v psql &> /dev/null; then
        echo -e "${GREEN}PostgreSQL установлен.${NC}"
        echo "Обратите внимание: Вам необходимо создать базу данных 'leaflet'"
        echo "Выполните: createdb leaflet"
    else
        echo -e "${RED}PostgreSQL не установлен. Установите PostgreSQL для работы с базой данных.${NC}"
        echo "Для macOS: brew install postgresql"
    fi

    # Запуск приложения
    echo "Запуск приложения..."
    npm run dev

else
    echo -e "${RED}Не найдены Node.js/npm или Docker.${NC}"
    echo "Установите Docker Desktop или Node.js:"
    echo "  - Docker Desktop: https://www.docker.com/products/docker-desktop"
    echo "  - Node.js: https://nodejs.org/"
    echo "  - Или используйте облачную среду разработки GitPod: https://gitpod.io/#https://github.com/ваш-аккаунт/leaflet"
fi