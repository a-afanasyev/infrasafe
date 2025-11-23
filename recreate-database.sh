#!/bin/bash

# Скрипт полной пересоздания базы данных InfraSafe
# ВНИМАНИЕ: Это удалит все существующие данные!

set -e

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${RED}⚠️  ВНИМАНИЕ: Это удалит все данные в базе данных!${NC}"
echo "================================================="
read -p "Вы уверены, что хотите продолжить? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Операция отменена.${NC}"
    exit 0
fi

# Параметры
DB_SERVICE="postgres"
DB_NAME="infrasafe"
DB_USER="postgres"
DOCKER_COMPOSE_FILE="docker-compose.unified.yml"
INIT_FILE="database/init/01_init_database.sql"
SEED_FILE="database/init/02_seed_data.sql"

echo -e "${YELLOW}🗑️  Шаг 1: Остановка контейнера базы данных...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" stop "$DB_SERVICE" || true

echo -e "${YELLOW}🗑️  Шаг 2: Удаление volume с данными...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" down -v "$DB_SERVICE" || true
docker volume rm infrasafe_postgres_data 2>/dev/null || true

echo -e "${YELLOW}🚀 Шаг 3: Запуск контейнера базы данных...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" up -d "$DB_SERVICE"

echo -e "${YELLOW}⏳ Шаг 4: Ожидание готовности базы данных...${NC}"
sleep 5

# Ждем пока БД станет доступной
for i in {1..30}; do
    if docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" pg_isready -U "$DB_USER" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ База данных готова${NC}"
        break
    fi
    echo -n "."
    sleep 1
done
echo

echo -e "${YELLOW}📋 Шаг 5: Создание схемы базы данных...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" < "$INIT_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Схема базы данных создана успешно!${NC}"
else
    echo -e "${RED}Ошибка: Не удалось создать схему базы данных.${NC}"
    exit 1
fi

echo ""
read -p "Загрузить тестовые данные из $SEED_FILE? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}📋 Шаг 6: Загрузка тестовых данных...${NC}"
    # Загружаем данные с отключенной проверкой внешних ключей
    {
        echo "SET session_replication_role = 'replica';"
        cat "$SEED_FILE"
        echo "SET session_replication_role = 'origin';"
    } | docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" 2>&1 | grep -v "NOTICE:" | grep -v "CREATE" | grep -v "ALTER" | grep -v "setval" | grep -v "^SET$" || true
    
    echo -e "${GREEN}✓ Тестовые данные загружены!${NC}"
else
    echo -e "${YELLOW}⏭️  Пропущена загрузка тестовых данных.${NC}"
fi

echo ""
echo -e "${GREEN}✅ База данных успешно пересоздана!${NC}"
echo ""
echo -e "${YELLOW}📊 Проверка данных:${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT 
    'buildings' as table_name, COUNT(*)::text as count FROM buildings
UNION ALL
SELECT 'controllers', COUNT(*)::text FROM controllers
UNION ALL
SELECT 'transformers', COUNT(*)::text FROM transformers
UNION ALL
SELECT 'metrics_current_month', COUNT(*)::text FROM metrics_current_month;
"

echo ""
echo -e "${YELLOW}🔄 Перезапуск backend...${NC}"
docker compose -f "$DOCKER_COMPOSE_FILE" restart app

echo ""
echo -e "${GREEN}✅ Готово! База данных пересоздана и backend перезапущен.${NC}"

