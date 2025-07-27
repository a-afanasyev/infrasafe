#!/bin/bash

# Скрипт для тестирования фронтенда с обновленными слоями карты
# Использование: ./test-frontend-layers.sh

set -e

echo "🚀 Тестирование фронтенда InfraSafe с новыми слоями карты"
echo "============================================================"

# Проверяем, что Docker запущен
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker не запущен. Пожалуйста, запустите Docker Desktop."
    exit 1
fi

# Останавливаем существующие контейнеры
echo "🛑 Останавливаем существующие контейнеры..."
docker-compose -f docker-compose.frontend-test.yml down --remove-orphans

# Очищаем старые образы
echo "🧹 Очищаем старые образы..."
docker system prune -f

# Собираем новые образы
echo "🏗️  Собираем новые образы..."
docker-compose -f docker-compose.frontend-test.yml build --no-cache

# Запускаем контейнеры
echo "🚀 Запускаем контейнеры..."
docker-compose -f docker-compose.frontend-test.yml up -d

# Ждем запуска
echo "⏳ Ожидаем запуска сервисов..."
sleep 10

# Проверяем статус контейнеров
echo "📊 Статус контейнеров:"
docker-compose -f docker-compose.frontend-test.yml ps

# Проверяем доступность сервисов
echo "🌐 Проверяем доступность сервисов..."

# Проверяем фронтенд
if curl -s http://localhost:8080 > /dev/null; then
    echo "✅ Фронтенд доступен на http://localhost:8080"
else
    echo "❌ Фронтенд недоступен"
    exit 1
fi

# Проверяем API
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ API доступен на http://localhost:3000"
else
    echo "⚠️  API недоступен (это нормально, если база данных еще не готова)"
fi

# Показываем логи
echo "📋 Последние логи фронтенда:"
docker-compose -f docker-compose.frontend-test.yml logs --tail=10 frontend-test

echo ""
echo "🎉 Тестирование завершено!"
echo "============================================================"
echo "📍 Основная страница: http://localhost:8080"
echo "📍 Тестовая страница слоев: http://localhost:8080/test-layers.html"
echo "📍 Админка: http://localhost:8080/admin.html"
echo "📍 Документация: http://localhost:8080/docs/MAP_LAYERS_GUIDE.md"
echo "📍 API: http://localhost:3000/api"
echo ""
echo "🔍 Для просмотра логов используйте:"
echo "   docker-compose -f docker-compose.frontend-test.yml logs -f"
echo ""
echo "🛑 Для остановки используйте:"
echo "   docker-compose -f docker-compose.frontend-test.yml down" 