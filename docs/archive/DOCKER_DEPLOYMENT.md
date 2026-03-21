# Развертывание InfraSafe Habitat IQ в Docker

## Обзор

Проект InfraSafe Habitat IQ развернут в Docker с микросервисной архитектурой:

- **🌐 Фронтенд Nginx** (порт 8080) - веб-интерфейс с Leaflet картами
- **🚀 Node.js API** (порт 3000) - бэкенд сервер с рефакторенной архитектурой
- **🗄️ PostgreSQL** (порт 5432) - база данных с партиционированными таблицами
- **📚 Swagger документация** - доступна по `/api-docs/`

## Быстрый запуск

```bash
# Клонировать репозиторий
git clone <repository-url>
cd leaflet

# Запустить все сервисы
docker compose up -d

# Проверить статус
docker compose ps

# Просмотреть логи
docker compose logs -f
```

## Доступные сервисы

### 🌐 Веб-интерфейс
- **URL:** http://localhost:8080
- **Описание:** Главная страница с интерактивной картой
- **Технологии:** Nginx, Leaflet Maps, vanilla JavaScript

### 🚀 API Endpoints
- **Базовый URL:** http://localhost:8080/api/ (проксируется к бэкенду)
- **Прямой доступ к API:** http://localhost:3000/api/
- **Документация:** http://localhost:8080/api-docs/

### 🗄️ База данных
- **Host:** localhost
- **Port:** 5432
- **Database:** infrasafe
- **User:** postgres
- **Password:** postgres

## Архитектура контейнеров

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (Nginx)       │────│   (Node.js)     │────│   (PostgreSQL)  │
│   Port: 8080    │    │   Port: 3000    │    │   Port: 5432    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Nginx Фронтенд
- **Статические файлы:** HTML, CSS, JS, изображения
- **Прокси API:** перенаправляет `/api/*` к бэкенду
- **Кэширование:** статические файлы кэшируются на 1 год
- **Gzip сжатие:** для всех текстовых файлов
- **Безопасность:** security headers, CSP

### Node.js API
- **Архитектура:** MVC с middleware
- **Аутентификация:** JWT токены
- **Логирование:** Winston с файловым выводом
- **Валидация:** схемы данных
- **Swagger:** автоматическая документация

### PostgreSQL
- **Партиционирование:** по времени для metrics/logs
- **Индексы:** оптимизированы для запросов
- **Расширения:** PostGIS готов к подключению

## Структура проекта

```
leaflet/
├── src/                       # 🚀 Backend (Node.js)
│   ├── controllers/           # Контроллеры API
│   ├── models/               # Модели данных
│   ├── routes/               # Маршруты API
│   ├── middleware/           # Middleware (auth, validation)
│   ├── utils/                # Утилиты и хелперы
│   └── index.js              # Точка входа
├── public/                   # 🌐 Frontend static files
│   ├── script.js             # Основная логика карт
│   ├── admin.js              # Админ панель
│   ├── images/               # Логотипы и иконки
│   └── libs/                 # Leaflet библиотеки
├── css/                      # Стили
├── *.html                    # HTML страницы
├── docker-compose.yml        # Конфигурация сервисов
├── Dockerfile               # Backend образ
├── Dockerfile.frontend      # Frontend образ
├── nginx.conf               # Конфигурация Nginx
├── database.sql             # Схема БД
└── package.json             # Зависимости Node.js
```

## Тестовые данные

В системе созданы тестовые данные:

### Здания
1. **Тестовое здание №1** - ул. Тестовая, 1, Киев
2. **Жилой комплекс Березняки** - ул. Березняковская, 15, Киев
3. **Офисный центр Центральный** - ул. Крещатик, 25, Киев

### Контроллеры
- CTRL001 (IS-100) - активный
- CTRL002 (IS-200) - активный
- CTRL003 (IS-100) - на обслуживании

## Команды управления

```bash
# Остановить все сервисы
docker compose down

# Остановить с удалением volumes (полная очистка)
docker compose down --volumes

# Пересобрать все образы
docker compose up --build

# Пересобрать только фронтенд
docker compose up --build frontend

# Просмотреть логи конкретного сервиса
docker compose logs frontend
docker compose logs app
docker compose logs postgres

# Подключиться к базе данных
docker exec -it leaflet-postgres-1 psql -U postgres -d infrasafe

# Перезапустить сервис
docker compose restart frontend
docker compose restart app
```

## Мониторинг

```bash
# Статус контейнеров
docker compose ps

# Использование ресурсов
docker stats

# Логи в реальном времени
docker compose logs -f frontend
docker compose logs -f app

# Проверка работоспособности
curl http://localhost:8080/
curl http://localhost:8080/api/buildings
```

## Nginx конфигурация

### Проксирование API
- `/api/*` → `http://app:3000/api/*`
- `/api-docs/*` → `http://app:3000/api-docs/*`

### Кэширование
- **Статические файлы:** 1 год
- **HTML файлы:** без кэширования
- **Gzip:** для всех текстовых файлов

### Безопасность
- Security Headers (XSS, CSRF protection)
- Content Security Policy
- CORS заголовки для API

## Архитектура базы данных

### Основные таблицы
- `buildings` - информация о зданиях
- `controllers` - контроллеры в зданиях
- `metrics` - метрики с контроллеров (партиционированная)
- `alerts` - система оповещений
- `logs` - логи системы (партиционированная)
- `users` - пользователи системы

### Особенности
- **Партиционирование** по времени для metrics и logs
- **Составные PRIMARY KEY** для партиционированных таблиц
- **Индексы** для быстрого поиска
- **Триггеры** для автоматического обновления heartbeat
- **Представления** для удобных запросов

## Безопасность

- **Контейнеры:** непривилегированные пользователи
- **API:** JWT аутентификация
- **HTTP:** Helmet.js security headers
- **CORS:** настроен для кросс-доменных запросов
- **Nginx:** скрытие версии сервера

## Производительность

- **Alpine Linux:** минимальные образы
- **Docker кэширование:** многослойная оптимизация
- **Nginx:** статическое кэширование и gzip
- **PostgreSQL:** партиционированные таблицы
- **Индексы:** оптимизация запросов

## Следующие шаги

1. **Redis кэширование** - добавить для сессий и метрик
2. **Prometheus/Grafana** - мониторинг метрик
3. **Let's Encrypt** - SSL сертификаты
4. **CI/CD pipeline** - автоматическое развертывание
5. **Load balancer** - для высокой доступности
6. **Backup стратегия** - регулярные бэкапы БД

## Troubleshooting

### Фронтенд не загружается
```bash
# Проверить логи Nginx
docker compose logs frontend

# Проверить файлы в контейнере
docker exec -it leaflet-frontend-1 ls -la /usr/share/nginx/html/
```

### API недоступен
```bash
# Проверить проксирование
curl -v http://localhost:8080/api/buildings

# Прямой доступ к бэкенду
curl http://localhost:3000/api/buildings
```

### База данных не отвечает
```bash
# Проверить статус PostgreSQL
docker compose logs postgres | grep "ready to accept"

# Тест подключения
docker exec leaflet-postgres-1 pg_isready -U postgres
```

## Ports Summary

| Сервис | Внешний порт | Внутренний порт | Описание |
|--------|--------------|-----------------|----------|
| Frontend | 8080 | 8080 | Веб-интерфейс Nginx |
| Backend API | 3000 | 3000 | Node.js API сервер |
| PostgreSQL | 5432 | 5432 | База данных |

## Контакты

Для вопросов по развертыванию и настройке системы обращайтесь к команде разработки.