#!/bin/bash

# Скрипт для обновления InfraSafe на production сервере
# Использование: ./update-production.sh

set -e  # Остановка при ошибке

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Определяем, какой docker-compose файл использовать
COMPOSE_FILE="docker-compose.prod.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    COMPOSE_FILE="docker-compose.unified.yml"
fi

echo -e "${BLUE}🔄 Обновление InfraSafe на production...${NC}"
echo -e "${BLUE}Используется файл: $COMPOSE_FILE${NC}"
echo ""

# Проверяем, что мы в правильной директории
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}❌ Ошибка: файл $COMPOSE_FILE не найден!${NC}"
    echo "Убедитесь, что вы находитесь в корневой директории проекта InfraSafe"
    exit 1
fi

# Шаг 1: Обновление кода из Git (если используется)
if [ -d .git ]; then
    echo -e "${YELLOW}📥 Шаг 1: Получение обновлений из Git...${NC}"
    CURRENT_BRANCH=$(git branch --show-current)
    echo "Текущая ветка: $CURRENT_BRANCH"
    
    # Сохраняем текущие изменения
    if ! git diff-index --quiet HEAD --; then
        echo -e "${YELLOW}⚠️  Обнаружены незакоммиченные изменения. Сохраняем в stash...${NC}"
        git stash
    fi
    
    # Получаем обновления
    git pull origin "$CURRENT_BRANCH" || {
        echo -e "${RED}❌ Ошибка при получении обновлений из Git${NC}"
        exit 1
    }
    echo -e "${GREEN}✅ Код обновлен${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠️  Git репозиторий не найден. Пропускаем обновление кода.${NC}"
    echo "Убедитесь, что файлы обновлены вручную."
    echo ""
fi

# Шаг 2: Остановка контейнеров (кроме postgres)
echo -e "${YELLOW}⏸️  Шаг 2: Остановка контейнеров frontend и app...${NC}"
docker-compose -f "$COMPOSE_FILE" stop frontend app 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Контейнеры уже остановлены или не существуют${NC}"
}
echo -e "${GREEN}✅ Контейнеры остановлены${NC}"
echo ""

# Шаг 3: Пересборка образов
echo -e "${YELLOW}🔨 Шаг 3: Пересборка образов...${NC}"
echo "Это может занять несколько минут..."
docker-compose -f "$COMPOSE_FILE" build --no-cache frontend app || {
    echo -e "${RED}❌ Ошибка при пересборке образов${NC}"
    exit 1
}
echo -e "${GREEN}✅ Образы пересобраны${NC}"
echo ""

# Шаг 4: Запуск обновленных контейнеров
echo -e "${YELLOW}🚀 Шаг 4: Запуск обновленных контейнеров...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d frontend app || {
    echo -e "${RED}❌ Ошибка при запуске контейнеров${NC}"
    exit 1
}
echo -e "${GREEN}✅ Контейнеры запущены${NC}"
echo ""

# Шаг 5: Ожидание инициализации
echo -e "${YELLOW}⏳ Шаг 5: Ожидание инициализации контейнеров (10 секунд)...${NC}"
sleep 10
echo ""

# Шаг 6: Проверка статуса
echo -e "${YELLOW}✅ Шаг 6: Проверка статуса контейнеров...${NC}"
docker-compose -f "$COMPOSE_FILE" ps
echo ""

# Шаг 7: Проверка healthcheck
echo -e "${YELLOW}🏥 Шаг 7: Проверка healthcheck...${NC}"
FRONTEND_STATUS=$(docker-compose -f "$COMPOSE_FILE" ps frontend | grep -c "healthy\|Up" || echo "0")
APP_STATUS=$(docker-compose -f "$COMPOSE_FILE" ps app | grep -c "healthy\|Up" || echo "0")

if [ "$FRONTEND_STATUS" -gt 0 ] && [ "$APP_STATUS" -gt 0 ]; then
    echo -e "${GREEN}✅ Все контейнеры работают${NC}"
else
    echo -e "${RED}⚠️  Внимание: некоторые контейнеры могут быть не готовы${NC}"
    echo "Проверьте логи: docker-compose -f $COMPOSE_FILE logs"
fi
echo ""

# Шаг 8: Проверка доступности
echo -e "${YELLOW}🌐 Шаг 8: Проверка доступности сервисов...${NC}"

# Проверка API
if curl -f -s http://localhost:3000/api/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API доступен на порту 3000${NC}"
    # Проверяем версию
    API_VERSION=$(curl -s http://localhost:3000/api/ | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "неизвестно")
    echo "   Версия API: $API_VERSION"
else
    echo -e "${RED}❌ API недоступен на порту 3000${NC}"
fi

# Проверка Frontend
if curl -f -s http://localhost:8080/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend доступен на порту 8080${NC}"
else
    echo -e "${RED}❌ Frontend недоступен на порту 8080${NC}"
fi
echo ""

# Итоговый статус
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Обновление завершено!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Полезные команды:"
echo "  • Просмотр логов: docker-compose -f $COMPOSE_FILE logs -f"
echo "  • Статус контейнеров: docker-compose -f $COMPOSE_FILE ps"
echo "  • Перезапуск: docker-compose -f $COMPOSE_FILE restart frontend app"
echo ""













