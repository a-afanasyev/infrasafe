#!/bin/bash

# Скрипт для создания бэкапа базы данных InfraSafe
# Автоматически определяет имя контейнера и создает бэкап с временной меткой

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🗄️  Создание бэкапа базы данных InfraSafe${NC}"
echo "================================================="

# Параметры базы данных
DB_NAME="infrasafe"
DB_USER="postgres"
DB_PASSWORD="postgres"

# Определяем имя контейнера PostgreSQL
# Пробуем найти контейнер из unified compose
CONTAINER_NAME=$(docker ps --filter "ancestor=postgis/postgis:15-3.3" --format "{{.Names}}" | head -n 1)

# Если не нашли, пробуем найти по имени сервиса
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -n 1)
fi

# Если все еще не нашли, пробуем через compose
if [ -z "$CONTAINER_NAME" ]; then
    # Проверяем, запущен ли unified compose
    if docker compose -f docker-compose.unified.yml ps postgres 2>/dev/null | grep -q "running"; then
        CONTAINER_NAME=$(docker compose -f docker-compose.unified.yml ps postgres | tail -n 1 | awk '{print $1}')
    fi
fi

# Если контейнер не найден
if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ Ошибка: Контейнер PostgreSQL не найден!${NC}"
    echo "Убедитесь, что база данных запущена:"
    echo "  docker compose -f docker-compose.unified.yml up -d postgres"
    exit 1
fi

echo -e "${GREEN}✓ Найден контейнер: ${CONTAINER_NAME}${NC}"

# Создаем директорию для бэкапов, если её нет
BACKUP_DIR="./database/backups"
mkdir -p "$BACKUP_DIR"

# Генерируем имя файла с временной меткой
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/infrasafe_backup_${TIMESTAMP}.sql"
BACKUP_FILE_COMPRESSED="${BACKUP_FILE}.gz"

echo -e "${YELLOW}📦 Создание бэкапа...${NC}"

# Создаем бэкап через pg_dump
if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null; then
    # Проверяем размер файла
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Бэкап создан успешно!${NC}"
    echo -e "  Файл: ${BACKUP_FILE}"
    echo -e "  Размер: ${FILE_SIZE}"
    
    # Сжимаем бэкап
    echo -e "${YELLOW}🗜️  Сжатие бэкапа...${NC}"
    if gzip "$BACKUP_FILE"; then
        COMPRESSED_SIZE=$(du -h "$BACKUP_FILE_COMPRESSED" | cut -f1)
        echo -e "${GREEN}✓ Бэкап сжат успешно!${NC}"
        echo -e "  Файл: ${BACKUP_FILE_COMPRESSED}"
        echo -e "  Размер: ${COMPRESSED_SIZE}"
    else
        echo -e "${YELLOW}⚠️  Не удалось сжать бэкап (gzip не установлен)${NC}"
        echo -e "  Бэкап сохранен без сжатия: ${BACKUP_FILE}"
    fi
    
    # Показываем информацию о бэкапе
    echo ""
    echo -e "${GREEN}📊 Информация о бэкапе:${NC}"
    echo "  База данных: $DB_NAME"
    echo "  Контейнер: $CONTAINER_NAME"
    echo "  Время создания: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo -e "${GREEN}✅ Бэкап завершен успешно!${NC}"
    
    # Показываем последние 5 бэкапов
    echo ""
    echo -e "${YELLOW}📋 Последние бэкапы:${NC}"
    ls -lh "$BACKUP_DIR" | tail -n 6 | awk '{print "  " $9 " (" $5 ")"}'
    
else
    echo -e "${RED}❌ Ошибка при создании бэкапа!${NC}"
    echo "Проверьте:"
    echo "  1. Контейнер запущен и доступен"
    echo "  2. Параметры подключения к БД правильные"
    echo "  3. У вас есть права на запись в директорию $BACKUP_DIR"
    exit 1
fi

