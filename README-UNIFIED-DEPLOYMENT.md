# Единое Docker развертывание InfraSafe Habitat IQ

## Описание

Это развертывание использует **единые файлы** без разбивки на несколько отдельных Dockerfile и конфигураций:

- **Один multi-stage Dockerfile** (`Dockerfile.unified`) для всех сервисов
- **Один docker-compose файл** (`docker-compose.unified.yml`) для всей инфраструктуры
- **Общие зависимости** (database.sql, nginx.conf)

## Архитектура

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │     Backend     │    │   PostgreSQL    │
│   (Nginx)       │───▶│   (Node.js)     │───▶│   Database      │
│   Port: 8080    │    │   Port: 3000    │    │   Port: 5432    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Multi-stage Dockerfile

`Dockerfile.unified` содержит два stage:

1. **backend** - Node.js приложение с API
2. **frontend** - Nginx со статическими файлами и проксированием

## Запуск

```bash
# Запуск всей системы одной командой
docker compose -f docker-compose.unified.yml up --build -d

# Проверка статуса
docker compose -f docker-compose.unified.yml ps

# Остановка
docker compose -f docker-compose.unified.yml down
```

## Доступные сервисы

| Сервис | URL | Описание |
|--------|-----|----------|
| Веб-интерфейс | http://localhost:8080 | Главная страница с Leaflet картами |
| API | http://localhost:8080/api/ | REST API (проксируется через Nginx) |
| Swagger | http://localhost:8080/api-docs/ | API документация |
| Прямой API | http://localhost:3000/api/ | Прямой доступ к API |
| PostgreSQL | localhost:5432 | База данных |

## Файловая структура

```
leaflet/
├── docker-compose.unified.yml    # Единый compose файл
├── Dockerfile.unified            # Multi-stage Dockerfile
├── nginx.conf                   # Конфигурация Nginx
├── database.sql                 # Инициализация БД
├── package.json                 # Node.js зависимости
├── src/                         # Исходный код backend
├── css/                         # Стили фронтенда
├── public/                      # Статические ресурсы
├── data/                        # Данные и изображения
└── *.html                       # HTML страницы
```

## Преимущества единого развертывания

✅ **Простота развертывания** - один команда запускает всё
✅ **Единый конфигурационный файл** - вся настройка в одном месте
✅ **Multi-stage build** - оптимизированные контейнеры
✅ **Общие зависимости** - нет дублирования файлов
✅ **Легкая миграция** - проще переносить между средами

## Тестовые данные

Система автоматически создаёт тестовые данные:

- **3 здания в Киеве** с координатами
- **3 контроллера** (CTRL001, CTRL002, CTRL003)
- **Метрики и логи** с разными статусами

## Troubleshooting

### Проблемы сборки

```bash
# Пересборка без кэша
docker compose -f docker-compose.unified.yml build --no-cache

# Просмотр логов
docker compose -f docker-compose.unified.yml logs -f [service_name]
```

### Очистка

```bash
# Полная очистка
docker compose -f docker-compose.unified.yml down -v --rmi all

# Удаление неиспользуемых образов
docker system prune -f
```

## Миграция на другой сервер

1. Скопируйте файлы:
   - `docker-compose.unified.yml`
   - `Dockerfile.unified`
   - `nginx.conf`
   - `database.sql`
   - Исходный код проекта

2. Запустите:
   ```bash
   docker compose -f docker-compose.unified.yml up --build -d
   ```

## Мониторинг

```bash
# Статус контейнеров
docker compose -f docker-compose.unified.yml ps

# Использование ресурсов
docker stats

# Логи в реальном времени
docker compose -f docker-compose.unified.yml logs -f
```

---
*Документация создана для единого Docker развертывания InfraSafe Habitat IQ*