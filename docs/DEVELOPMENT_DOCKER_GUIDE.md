# 🚀 Среда разработки InfraSafe с оптимизированными Docker контейнерами

## 📋 Обзор

Эта конфигурация создана для **быстрой разработки** с минимальными пересборками контейнеров. Основные принципы:

✅ **Минимальные образы** - только зависимости, код через volume mounting  
✅ **Мгновенные изменения** - правки в коде отражаются сразу без пересборки  
✅ **Быстрые перезапуски** - только перезапуск контейнеров, не пересборка  
✅ **Hot Reload** - автоматическая перезагрузка при изменении кода  
✅ **Полная изоляция** - каждый сервис в своем контейнере  

## 🏗️ Архитектура

```
📁 Хост машина                   🐳 Docker контейнеры
├── src/             ────────────➤ /app/src (volume mount)
├── public/          ────────────➤ /usr/share/nginx/html/public
├── css/             ────────────➤ /usr/share/nginx/html/css
├── *.html           ────────────➤ /usr/share/nginx/html/*.html
├── package.json     ────────────➤ /app/package.json
└── logs/            ────────────➤ /app/logs

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (Nginx)       │────│   (Node.js)     │────│   (PostgreSQL)  │
│   Port: 8080    │    │   Port: 3000    │    │   Port: 5432    │
│   Volume Mount  │    │   Volume Mount  │    │   Persistent    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Быстрый старт

### 1. Первый запуск

```bash
# Запуск всей среды разработки
./dev-start.sh start

# Или вручную
docker-compose -f docker-compose.dev.yml up -d
```

### 2. Доступные сервисы

| Сервис | URL | Описание |
|--------|-----|----------|
| 🌐 Веб-интерфейс | http://localhost:8080 | Главная страница с картой |
| 🚀 API | http://localhost:8080/api/ | REST API через nginx |
| 📚 Swagger | http://localhost:8080/api-docs/ | API документация |
| 🔗 Прямой API | http://localhost:3000/api/ | Прямой доступ к бэкенду |
| 🗄️ PostgreSQL | localhost:5432 | База данных |

### 3. Управление средой

```bash
# Показать все доступные команды
./dev-start.sh help

# Основные команды
./dev-start.sh start      # Запуск
./dev-start.sh stop       # Остановка
./dev-start.sh restart    # Перезапуск
./dev-start.sh status     # Статус сервисов
./dev-start.sh logs       # Логи всех сервисов
```

## 📂 Структура файлов

### Новые файлы для разработки

```
infrasafe/
├── 🐳 Docker файлы разработки
│   ├── Dockerfile.dev              # Бэкенд (только зависимости)
│   ├── Dockerfile.frontend.dev     # Фронтенд (только nginx)
│   ├── docker-compose.dev.yml      # Композиция для разработки
│   ├── nginx.dev.conf              # Nginx конфигурация для dev
│   └── dev-start.sh                # Скрипт управления (исполняемый)
│
├── 🚀 Существующие файлы (монтируются как volumes)
│   ├── src/                        # Исходный код бэкенда
│   ├── public/                     # Фронтенд ресурсы
│   ├── css/                        # Стили
│   ├── *.html                      # HTML страницы
│   ├── package.json                # Зависимости Node.js
│   └── logs/                       # Логи приложения
│
└── 📁 Другие конфигурации
    ├── docker-compose.yml          # Основная композиция
    ├── docker-compose.prod.yml     # Production композиция
    └── другие файлы...
```

## 🔧 Детали конфигурации

### Dockerfile.dev (Бэкенд)

```dockerfile
# Только зависимости в образе
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
# Код монтируется через volume!
```

**Преимущества:**
- Пересборка только при изменении зависимостей
- Код изменяется мгновенно через volume mounting
- Hot reload работает из коробки

### Dockerfile.frontend.dev (Фронтенд)

```dockerfile
# Только nginx с базовой конфигурацией
FROM nginx:alpine
COPY nginx.dev.conf /etc/nginx/nginx.conf
# Статика монтируется через volume!
```

**Преимущества:**
- Изменения в HTML/CSS/JS отражаются сразу
- Отключено кэширование для разработки
- Увеличены таймауты для отладки

### docker-compose.dev.yml

**Ключевые особенности:**

1. **Максимальный Volume Mounting:**
   ```yaml
   volumes:
     - ./src:/app/src:ro                    # Исходный код
     - ./public:/usr/share/nginx/html/public:ro  # Статика
     - ./css:/usr/share/nginx/html/css:ro   # Стили
     - ./index.html:/usr/share/nginx/html/index.html:ro  # HTML
   ```

2. **Исключение node_modules:**
   ```yaml
   volumes:
     - /app/node_modules  # Остается в контейнере
   ```

3. **Логи доступны с хоста:**
   ```yaml
   volumes:
     - ./logs:/app/logs  # Логи синхронизируются
   ```

## 💡 Рабочий процесс

### Обычная разработка

1. **Изменения в коде:** Редактируйте файлы на хосте
2. **Автоматическое обновление:** Изменения отражаются мгновенно
3. **Перезапуск при необходимости:** `./dev-start.sh restart`

### Изменение зависимостей

```bash
# Если добавили новые npm пакеты
./dev-start.sh install

# Если изменили package.json кардинально
./dev-start.sh rebuild
```

### Работа с базой данных

```bash
# Подключение к PostgreSQL
./dev-start.sh shell-db

# Или через psql
docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -d infrasafe
```

## 🛠️ Полезные команды

### Логирование

```bash
# Все логи
./dev-start.sh logs

# Только бэкенд
./dev-start.sh logs-app

# Только фронтенд
./dev-start.sh logs-web

# Только база данных
./dev-start.sh logs-db
```

### Отладка

```bash
# Войти в контейнер бэкенда
./dev-start.sh shell-app

# Войти в контейнер фронтенда
./dev-start.sh shell-web

# Статус всех сервисов
./dev-start.sh status
```

### Тестирование

```bash
# Запуск тестов API
./dev-start.sh test

# Проверка работоспособности
curl http://localhost:8080/health
curl http://localhost:8080/api/buildings
```

## 📊 Сравнение с другими конфигурациями

| Параметр | dev | обычный | prod |
|----------|-----|---------|------|
| Скорость запуска | 🚀 Быстро | 🐌 Медленно | 🐌 Медленно |
| Пересборка при изменении кода | ❌ Нет | ✅ Да | ✅ Да |
| Hot reload | ✅ Да | ✅ Да | ❌ Нет |
| Кэширование | ❌ Отключено | ✅ Включено | ✅ Включено |
| Логирование | 📝 Подробное | 📝 Стандартное | 📝 Минимальное |
| Безопасность | ⚠️ Развитие | ✅ Средняя | ✅ Высокая |

## 🐛 Troubleshooting

### Контейнер не запускается

```bash
# Проверить логи
./dev-start.sh logs

# Пересобрать образы
./dev-start.sh rebuild

# Очистить все и начать заново
./dev-start.sh clean
```

### API недоступен

```bash
# Проверить статус
./dev-start.sh status

# Проверить прямой доступ к бэкенду
curl http://localhost:3000/api/buildings

# Проверить через nginx
curl http://localhost:8080/api/buildings
```

### Изменения не отражаются

```bash
# Проверить монтирование volumes
docker-compose -f docker-compose.dev.yml config

# Перезапустить контейнеры
./dev-start.sh restart

# Проверить права доступа к файлам
ls -la src/
```

### База данных не отвечает

```bash
# Проверить статус PostgreSQL
./dev-start.sh logs-db

# Проверить подключение
docker-compose -f docker-compose.dev.yml exec postgres pg_isready -U postgres
```

## 🔄 Миграция с существующих конфигураций

### Из docker-compose.yml

```bash
# Остановить старую среду
docker-compose down

# Запустить новую среду разработки
./dev-start.sh start
```

### Из docker-compose.prod.yml

```bash
# Остановить production
docker-compose -f docker-compose.prod.yml down

# Запустить разработку
./dev-start.sh start
```

## 📝 Рекомендации

### Для ежедневной разработки

1. **Используйте dev среду** для всей разработки
2. **Тестируйте в prod** перед коммитом
3. **Перезапускайте сервисы** вместо пересборки
4. **Мониторьте логи** для отладки

### Для production

1. **Не используйте dev конфигурацию** в продакшене
2. **Переключайтесь на prod** для финального тестирования
3. **Оптимизируйте образы** для продакшена

## 🎯 Следующие шаги

1. **Redis** - добавить для кэширования сессий
2. **Hot reload для фронтенда** - webpack dev server
3. **Автоматические тесты** - при изменении кода
4. **Профилирование** - производительность в dev режиме
5. **VS Code интеграция** - remote containers

---

**Готово к использованию! 🚀**

*Создано для быстрой и эффективной разработки InfraSafe* 