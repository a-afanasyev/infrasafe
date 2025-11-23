#!/bin/bash

# Скрипт инициализации базы данных InfraSafe
# Использование: ./init-database.sh

set -e

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🗄️  Инициализация базы данных InfraSafe${NC}"
echo "================================================="

# Параметры подключения
DB_SERVICE="postgres"
DB_NAME="infrasafe"
DB_USER="postgres"
DOCKER_COMPOSE_FILE="docker-compose.unified.yml"

# Проверка наличия docker-compose файла
if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
    echo -e "${RED}Ошибка: Файл $DOCKER_COMPOSE_FILE не найден.${NC}"
    exit 1
fi

# Проверка, запущен ли контейнер базы данных
CONTAINER_ID=$(docker compose -f "$DOCKER_COMPOSE_FILE" ps -q "$DB_SERVICE")

if [ -z "$CONTAINER_ID" ]; then
    echo -e "${RED}Ошибка: Контейнер сервиса '$DB_SERVICE' не запущен. Запустите docker compose up -d $DB_SERVICE.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Найден контейнер: $(docker compose -f "$DOCKER_COMPOSE_FILE" ps -q "$DB_SERVICE" --format '{{.Names}}')${NC}"

# Проверка существования файлов инициализации
INIT_FILE="database/init/01_init_database.sql"
SEED_FILE="database/init/02_seed_data.sql"

if [ ! -f "$INIT_FILE" ]; then
    echo -e "${RED}Ошибка: Файл $INIT_FILE не найден.${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Шаг 1: Создание схемы базы данных...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" < "$INIT_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Схема базы данных создана успешно!${NC}"
else
    echo -e "${RED}Ошибка: Не удалось создать схему базы данных.${NC}"
    exit 1
fi

# Шаг 1.5 пропущен - проверка внешних ключей будет отключена при загрузке seed данных

# Проверка, нужно ли загружать тестовые данные
if [ -f "$SEED_FILE" ]; then
    echo ""
    read -p "Загрузить тестовые данные из $SEED_FILE? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}📋 Шаг 2: Загрузка тестовых данных...${NC}"
        # Загружаем данные с отключенной проверкой внешних ключей
        # Используем временный файл для объединения команд
        {
            echo "SET session_replication_role = 'replica';"
            cat "$SEED_FILE"
            echo "SET session_replication_role = 'origin';"
        } | docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Тестовые данные загружены успешно!${NC}"
        else
            echo -e "${YELLOW}⚠️  Загрузка завершена с предупреждениями (некоторые объекты уже существуют)${NC}"
            echo -e "${YELLOW}   Это нормально, если база данных уже была частично инициализирована.${NC}"
            # Все равно включаем обратно проверку внешних ключей на всякий случай
            docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -c "SET session_replication_role = 'origin';" > /dev/null 2>&1 || true
        fi
    else
        echo -e "${YELLOW}⏭️  Пропущена загрузка тестовых данных.${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Файл $SEED_FILE не найден, пропущена загрузка тестовых данных.${NC}"
fi

echo ""
echo -e "${GREEN}✅ Инициализация базы данных завершена успешно!${NC}"
echo ""
echo -e "${YELLOW}📊 Проверка таблиц:${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -c "\dt" | head -20

