# InfraSafe - Система мониторинга инфраструктуры

> **ЛИЦЕНЗИЯ:** Apache License 2.0 (см. файл [LICENSE](LICENSE))
> **БЕЗОПАСНОСТЬ:** Требуется настройка `.env` файла перед production-деплоем.

**InfraSafe** — цифровая платформа мониторинга и управления многоквартирными домами, предназначенная для непрерывного мониторинга состояния инженерных систем жилых зданий с возможностью масштабируемого расширения за счёт дополнительных цифровых сервисов.

В основе каждого узла системы — интеллектуальный контроллер на базе промышленного ПК, способный работать с различными типами датчиков и интерфейсов. Контроллер собирает данные с объектов, обрабатывает их локально и передаёт в централизованное облако по защищённым каналам связи (Ethernet, мобильная сеть, VPN).

## Технологический стек

### Бэкенд
- **Платформа:** Node.js 20+ / Express.js
- **База данных:** PostgreSQL 15+ с PostGIS
- **Авторизация:** JWT (access + refresh tokens, blacklist, account locking)
- **API документация:** Swagger/OpenAPI 3.0
- **Логирование:** Winston + daily-rotate-file
- **Контейнеризация:** Docker & Docker Compose

### Фронтенд
- **Основа:** HTML5, CSS3, JavaScript (ES6+) — без фреймворков
- **Карты:** Leaflet.js с кластеризацией маркеров и множеством слоёв
- **Визуализация:** Chart.js для графиков и аналитики
- **Безопасность:** DOMPurify для защиты от XSS

### DevOps & Инфраструктура
- **Оркестрация:** Docker Compose (dev, prod, unified, generator)
- **Reverse Proxy:** Nginx
- **Тестирование:** Jest (1800+ unit/integration/security тестов, 57 E2E)
- **Линтинг:** ESLint

## Структура проекта

```
├── src/                              # Бэкенд (трёхслойная архитектура)
│   ├── config/
│   │   └── database.js               # Подключение к PostgreSQL
│   ├── controllers/                   # HTTP-обработка, валидация, ответы
│   │   ├── admin/                     # Админ-контроллеры (9 модулей + index)
│   │   │   ├── index.js               # Barrel-экспорт
│   │   │   ├── adminBuildingController.js
│   │   │   ├── adminControllerController.js
│   │   │   ├── adminMetricController.js
│   │   │   ├── adminTransformerController.js
│   │   │   ├── adminLineController.js
│   │   │   ├── adminWaterLineController.js
│   │   │   ├── adminColdWaterSourceController.js
│   │   │   ├── adminHeatSourceController.js
│   │   │   └── adminGeneralController.js
│   │   ├── authController.js          # Авторизация
│   │   ├── buildingController.js      # Здания
│   │   ├── controllerController.js    # Контроллеры IoT
│   │   ├── metricController.js        # Метрики
│   │   ├── alertController.js         # Алерты
│   │   ├── analyticsController.js     # Аналитика
│   │   ├── buildingMetricsController.js # Данные для карты
│   │   ├── powerAnalyticsController.js  # Анализ электросетей
│   │   ├── transformerController.js   # Трансформаторы
│   │   ├── lineController.js          # Линии электропередач
│   │   ├── coldWaterSourceController.js # Источники холодной воды
│   │   └── heatSourceController.js    # Источники тепла
│   ├── services/                      # Бизнес-логика
│   │   ├── adminService.js            # Общие batch-операции
│   │   ├── alertService.js            # Алерты с cooldown
│   │   ├── analyticsService.js        # Аналитика с Circuit Breaker
│   │   ├── authService.js             # JWT, refresh, blacklist
│   │   ├── buildingService.js         # Бизнес-логика зданий
│   │   ├── buildingMetricsService.js  # Агрегация для карты
│   │   ├── cacheService.js            # Кэширование (in-memory, Redis-ready)
│   │   ├── controllerService.js       # IoT-контроллеры
│   │   ├── metricService.js           # Метрики
│   │   └── powerAnalyticsService.js   # Анализ электросетей
│   ├── models/                        # SQL-запросы через pg Pool (без ORM)
│   │   ├── Building.js, Controller.js, Metric.js
│   │   ├── Alert.js, AlertType.js
│   │   ├── PowerTransformer.js, Transformer.js, Line.js
│   │   ├── ColdWaterSource.js, HeatSource.js
│   │   ├── WaterLine.js, WaterSupplier.js
│   ├── middleware/
│   │   ├── auth.js                    # JWT: authenticateJWT, isAdmin, optionalAuth
│   │   ├── correlationId.js           # x-correlation-id для трейсинга
│   │   ├── errorHandler.js            # Централизованная обработка ошибок
│   │   ├── rateLimiter.js             # Rate limiting
│   │   └── validators.js              # Валидация входных данных
│   ├── routes/                        # API-маршруты (16 файлов)
│   │   ├── index.js                   # Главный роутер с default-deny JWT
│   │   ├── authRoutes.js              # /api/auth/*
│   │   ├── buildingRoutes.js          # /api/buildings/*
│   │   ├── controllerRoutes.js        # /api/controllers/*
│   │   ├── metricRoutes.js            # /api/metrics/*
│   │   ├── alertRoutes.js             # /api/alerts/*
│   │   ├── analyticsRoutes.js         # /api/analytics/*
│   │   ├── adminRoutes.js             # /api/admin/*
│   │   ├── buildingMetricsRoutes.js   # /api/buildings-metrics
│   │   ├── powerAnalyticsRoutes.js    # /api/power-analytics/*
│   │   ├── transformerRoutes.js       # /api/transformers/*
│   │   ├── lineRoutes.js              # /api/lines/*
│   │   ├── waterLineRoutes.js         # /api/water-lines/*
│   │   ├── waterSourceRoutes.js       # /api/cold-water-sources/*
│   │   ├── heatSourceRoutes.js        # /api/heat-sources/*
│   │   └── waterSupplierRoutes.js     # /api/water-suppliers/*
│   ├── utils/
│   │   ├── apiResponse.js             # Стандартизированные ответы API
│   │   ├── circuitBreaker.js          # Circuit Breaker паттерн
│   │   ├── queryValidation.js         # Whitelist для sort/order (SQL injection)
│   │   ├── helpers.js                 # Вспомогательные функции
│   │   └── logger.js                  # Winston логирование
│   └── server.js                      # Точка входа, graceful shutdown, health check
├── public/                            # Статические ресурсы фронтенда
│   ├── admin.js                       # Админ-панель
│   ├── script.js                      # Интерфейс карты
│   ├── admin-auth.js                  # Авторизация в админке
│   ├── admin-coordinate-editor.js     # Редактор координат
│   ├── map-layers-control.js          # Управление слоями карты
│   ├── infrastructure-line-editor.js  # Редактор инфраструктурных линий
│   └── utils/                         # Клиентские утилиты
│       ├── domSecurity.js             # DOMPurify обёртка (XSS-защита)
│       ├── rateLimiter.js             # Rate limiter для API-вызовов
│       ├── safeJsonParser.js          # Безопасный JSON-парсер
│       ├── csrf.js                    # CSRF-защита
│       └── powerUtils.js             # Утилиты электросетей
├── database/
│   ├── init/
│   │   ├── 01_init_database.sql       # Схема БД (PostGIS, все таблицы)
│   │   └── 02_seed_data.sql           # Тестовые данные (17 зданий, Ташкент)
│   └── migrations/                    # Миграции 003-010
├── generator/                         # Сервис генерации метрик (отдельный package.json)
├── tests/
│   ├── jest/
│   │   ├── unit/                      # Unit-тесты (10 файлов)
│   │   ├── integration/               # Интеграционные тесты
│   │   └── security/                  # Тесты безопасности (SQL injection, XSS)
│   └── orchestrator/                  # Unified test runner (bash)
├── docker-compose.dev.yml             # Docker для разработки
├── docker-compose.prod.yml            # Docker для production
├── docker-compose.unified.yml         # Единое развертывание
├── docker-compose.generator.yml       # Генератор метрик
├── index.html                         # Главная страница (карта)
├── admin.html                         # Административная панель
├── about.html, contacts.html          # Информационные страницы
├── documentation.html                 # Страница документации
├── nginx.conf                         # Конфигурация Nginx
├── CLAUDE.md                          # Контекст для Claude Code
└── package.json                       # v1.0.1, Apache-2.0
```

## Установка и запуск

### Предварительные требования

- **Docker** >= 20.10
- **Docker Compose** >= 2.0
- **Git**

### Быстрый старт

```bash
# Клонировать
git clone https://github.com/a-afanasyev/infrasafe.git
cd infrasafe

# Для разработки
docker compose -f docker-compose.dev.yml up --build -d

# Или единое развертывание
docker compose -f docker-compose.unified.yml up --build -d
```

### Доступ к приложению

| Сервис | URL |
|--------|-----|
| Карта (карта мониторинга) | http://localhost:8080 |
| Админ-панель | http://localhost:8080/admin.html |
| Swagger UI | http://localhost:8080/api-docs |
| API | http://localhost:8080/api/ |
| Health Check | http://localhost:3000/health |

### Фронтенд-бандлинг

Фронтенд (index.html, admin.html, login.html) загружает минифицированные
бандлы из `public/dist/`. Эти файлы собираются esbuild'ом автоматически:

```bash
npm ci                         # postinstall собирает public/dist/
npm run build:frontend         # пересобрать один раз
npm run build:frontend:watch   # watch-режим: пересборка при каждом save
```

`public/dist/` в `.gitignore` — не коммитить. После `git clone` просто
выполните `npm ci` перед запуском Docker, чтобы бандлы были на месте.

### Тестирование

```bash
npm test                  # Все тесты (1800+, 89 suites)
npm run test:unit         # Unit-тесты (tests/jest/unit/)
npm run test:integration  # Интеграционные тесты
npm run test:security     # Тесты безопасности
npm run test:coverage     # С отчётом покрытия
npm run test:e2e          # E2E через Docker (запустить контейнеры заранее)
```

### Тестовые учётные данные (только для разработки)

- **Администратор:** admin / admin123
- **Тестовый пользователь:** testuser / TestPass123

**Для production:** скопируйте шаблон и сгенерируйте секреты:

```bash
cp .env.example .env
openssl rand -base64 32    # DB_PASSWORD
openssl rand -base64 64    # JWT_SECRET, JWT_REFRESH_SECRET
openssl rand -base64 32    # TOTP_ENCRYPTION_KEY (2FA)
```

Обязательные переменные в `.env`:
`DB_*`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `TOTP_ENCRYPTION_KEY`,
в production также `CORS_ORIGINS` и UK Integration (`UK_WEBHOOK_SECRET`,
`UK_SERVICE_USER`, `UK_SERVICE_PASSWORD`, `UK_API_ALLOWED_HOSTS`).

## Ключевые функции

### Контроль электроснабжения
- Мониторинг напряжения и токов на вводе
- Анализ загрузки трансформаторов (материализованные представления)
- Выявление перекосов фаз и перегрузок (пороги 85% / 95%)

### Мониторинг водоснабжения
- Холодная вода: давление, температура
- Горячая вода и отопление: подача/обратка, температурный баланс

### Система алертов
- Автоматические проверки с настраиваемыми порогами
- Cooldown-система (15 мин между одинаковыми алертами)
- Жизненный цикл: создание -> подтверждение -> закрытие

### Интеллектуальная аналитика
- 25+ аналитических эндпоинтов с Circuit Breaker
- Многоуровневое кэширование (in-memory, Redis-ready)
- Анализ энергоэффективности и прогнозирование нагрузок

## Архитектура

### Трёхслойная архитектура бэкенда

```
Nginx (8080) -> /api/* -> Express (3000) -> Routes -> Controllers -> Services -> Models -> PostgreSQL
```

### Безопасность
- **Default-deny JWT** — все маршруты защищены по умолчанию, публичные маршруты заданы явным allowlist
- **Rate limiting** — защита от brute-force и DDoS
- **SQL injection prevention** — whitelist-валидация для sort/order + параметризованные запросы
- **XSS protection** — DOMPurify на фронтенде, Helmet CSP на бэкенде
- **Correlation ID** — трейсинг запросов через `x-correlation-id`

### API Endpoints

Все эндпоинты монтируются под `/api`:

| Маршрут | Описание |
|---------|----------|
| `/auth/*` | Авторизация (login, register, refresh, logout) |
| `/buildings/*` | CRUD зданий |
| `/controllers/*` | IoT-контроллеры |
| `/metrics/*` | Метрики и телеметрия |
| `/alerts/*` | Алерты и уведомления |
| `/analytics/*` | Аналитика (25+ эндпоинтов) |
| `/admin/*` | Массовые админ-операции |
| `/buildings-metrics` | Данные для интерактивной карты |
| `/power-analytics/*` | Анализ электросетей |
| `/transformers/*` | Силовые трансформаторы |
| `/lines/*` | Линии электропередач |
| `/cold-water-sources/*` | Источники холодной воды |
| `/heat-sources/*` | Источники тепла |
| `/water-lines/*` | Водопроводные линии |
| `/water-suppliers/*` | Поставщики воды |

## Docker-сервисы

| Сервис | Описание | Порт |
|--------|----------|------|
| frontend | Nginx (статика + API proxy) | 8080 (dev: 8088) |
| app | Node.js Express | 3000 |
| postgres | PostgreSQL 15 + PostGIS | 5435 (host) -> 5432 (container) |

## Документация

- **API:** Swagger UI на `/api-docs`
- **Авторизация:** [docs/API_AUTH_MATRIX.md](docs/API_AUTH_MATRIX.md)
- **Аналитика электросетей:** [docs/POWER-ANALYTICS-API.md](docs/POWER-ANALYTICS-API.md)
- **Docker (разработка):** [docs/DEVELOPMENT_DOCKER_GUIDE.md](docs/DEVELOPMENT_DOCKER_GUIDE.md)
- **Генератор метрик:** [docs/GENERATOR.md](docs/GENERATOR.md)
- **Индекс документации:** [docs/INDEX.md](docs/INDEX.md)

## Лицензия

**Apache License 2.0** — см. файл [LICENSE](LICENSE)

Подробнее о правах и ограничениях: [LICENSE-GUIDE.md](LICENSE-GUIDE.md)

| Библиотека | Лицензия | Совместимость |
|------------|----------|---------------|
| Leaflet.js | BSD 2-Clause | Совместима |
| Express.js | MIT | Совместима |
| PostgreSQL | PostgreSQL License | Совместима |
| Node.js | MIT | Совместима |

## Вклад в проект

1. Форкните репозиторий
2. Создайте feature-ветку (`git checkout -b feature/amazing-feature`)
3. Закоммитьте изменения (`git commit -m 'Add amazing feature'`)
4. Запушьте в ветку (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

Все вклады должны соответствовать Apache License 2.0.
