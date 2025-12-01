# 🚀 Инструкция по обновлению контейнеров на Production сервере

## ⚠️ ВАЖНО: Безопасное обновление

**НЕ УДАЛЯЙТЕ контейнер базы данных** - в нем содержатся рабочие данные!

## 📋 Шаги для обновления

### 1. Подключение к серверу

```bash
# Подключитесь к серверу по SSH
ssh user@your-server-ip

# Перейдите в директорию проекта
cd /path/to/infrasafe
```

### 2. Обновление кода

#### Вариант A: Если используется Git

```bash
# Сохраните текущие изменения (если есть)
git stash

# Получите последние изменения
git pull origin main

# Или из конкретной ветки
git pull origin production
```

#### Вариант B: Если код копируется вручную

```bash
# Скопируйте обновленные файлы на сервер
# Используйте scp, rsync или другой метод
```

### 3. Проверка конфигурации

```bash
# Убедитесь, что файл .env.prod существует и настроен
ls -la .env.prod

# Проверьте docker-compose файл
cat docker-compose.prod.yml
```

### 4. Остановка контейнеров (БЕЗ удаления)

```bash
# Остановите только frontend и app контейнеры
# НЕ останавливайте postgres, если не нужно обновлять БД
docker-compose -f docker-compose.prod.yml stop frontend app

# Или если используете unified:
docker-compose -f docker-compose.unified.yml stop frontend app nginx
```

### 5. Пересборка образов

```bash
# Пересоберите образы с новым кодом (без кеша для гарантии обновления)
docker-compose -f docker-compose.prod.yml build --no-cache frontend app

# Или для unified:
docker-compose -f docker-compose.unified.yml build --no-cache frontend app
```

### 6. Запуск обновленных контейнеров

```bash
# Запустите контейнеры
docker-compose -f docker-compose.prod.yml up -d frontend app

# Или для unified:
docker-compose -f docker-compose.unified.yml up -d frontend app nginx
```

### 7. Проверка статуса

```bash
# Проверьте статус всех контейнеров
docker-compose -f docker-compose.prod.yml ps

# Проверьте логи на ошибки
docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
docker-compose -f docker-compose.prod.yml logs --tail=50 app

# Проверьте healthcheck
docker-compose -f docker-compose.prod.yml ps
```

### 8. Проверка работоспособности

```bash
# Проверьте доступность API
curl http://localhost:3000/api/

# Проверьте фронтенд
curl http://localhost:8080/

# Проверьте версию в ответе API
curl http://localhost:3000/api/ | grep version
```

## 🔄 Полная пересборка (если нужно)

Если нужно полностью пересобрать все контейнеры:

```bash
# Остановите все контейнеры (кроме postgres)
docker-compose -f docker-compose.prod.yml stop frontend app

# Удалите старые образы (опционально)
docker-compose -f docker-compose.prod.yml rm -f frontend app

# Пересоберите и запустите
docker-compose -f docker-compose.prod.yml up -d --build --force-recreate frontend app
```

## 🛡️ Безопасное обновление базы данных

Если нужно обновить только схему БД (миграции):

```bash
# НЕ пересобирайте контейнер postgres
# Вместо этого выполните миграции внутри контейнера

# Подключитесь к контейнеру БД
docker exec -it infrasafe-postgres-1 psql -U postgres -d infrasafe

# Или выполните миграции через app контейнер
docker exec -it infrasafe-app-1 node scripts/run-migrations.js
```

## 📝 Быстрая команда для обновления

Создайте скрипт `update-production.sh`:

```bash
#!/bin/bash
set -e

echo "🔄 Обновление InfraSafe на production..."

# Переходим в директорию проекта
cd /path/to/infrasafe

# Обновляем код (если используется Git)
if [ -d .git ]; then
    echo "📥 Получение обновлений из Git..."
    git pull origin main
fi

# Останавливаем контейнеры (кроме postgres)
echo "⏸️  Остановка контейнеров..."
docker-compose -f docker-compose.prod.yml stop frontend app

# Пересобираем образы
echo "🔨 Пересборка образов..."
docker-compose -f docker-compose.prod.yml build --no-cache frontend app

# Запускаем контейнеры
echo "🚀 Запуск обновленных контейнеров..."
docker-compose -f docker-compose.prod.yml up -d frontend app

# Проверяем статус
echo "✅ Проверка статуса..."
sleep 5
docker-compose -f docker-compose.prod.yml ps

echo "✨ Обновление завершено!"
```

Сделайте скрипт исполняемым:

```bash
chmod +x update-production.sh
```

Запуск:

```bash
./update-production.sh
```

## 🔍 Откат изменений (если что-то пошло не так)

```bash
# Остановите новые контейнеры
docker-compose -f docker-compose.prod.yml stop frontend app

# Вернитесь к предыдущей версии кода
git checkout HEAD~1  # или конкретный коммит

# Пересоберите и запустите
docker-compose -f docker-compose.prod.yml up -d --build frontend app
```

## 📊 Мониторинг после обновления

```bash
# Следите за логами в реальном времени
docker-compose -f docker-compose.prod.yml logs -f frontend app

# Проверьте использование ресурсов
docker stats

# Проверьте healthcheck статус
docker-compose -f docker-compose.prod.yml ps
```

## ⚠️ Чек-лист перед обновлением

- [ ] Создана резервная копия базы данных
- [ ] Проверены изменения в коде
- [ ] Обновлен файл .env.prod (если нужно)
- [ ] Проверена доступность сервера
- [ ] Уведомлены пользователи о возможном кратковременном простое
- [ ] Выбрано время для обновления (минимум нагрузки)

## 🆘 Решение проблем

### Контейнер не запускается

```bash
# Проверьте логи
docker-compose -f docker-compose.prod.yml logs frontend
docker-compose -f docker-compose.prod.yml logs app

# Проверьте конфигурацию
docker-compose -f docker-compose.prod.yml config
```

### Проблемы с базой данных

```bash
# НЕ пересобирайте postgres контейнер
# Проверьте подключение
docker exec -it infrasafe-postgres-1 psql -U postgres -d infrasafe -c "SELECT 1;"
```

### Проблемы с сетью

```bash
# Проверьте сеть Docker
docker network ls
docker network inspect infrasafe-network
```

## 📞 Контакты для поддержки

При возникновении проблем проверьте:
1. Логи контейнеров
2. Статус healthcheck
3. Доступность портов
4. Конфигурацию .env.prod






