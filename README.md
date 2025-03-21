# InfraSafe Habitat IQ

## Описание проекта

InfraSafe Habitat IQ - это веб-приложение для мониторинга и управления инфраструктурой зданий. Система отображает на карте состояние различных показателей (температура, влажность, давление, уровень CO2, напряжение) в реальном времени и позволяет операторам быстро реагировать на возникающие проблемы.

## Особенности проекта

- Интерактивная карта с маркерами инфраструктурных объектов
- Визуализация статусов систем в реальном времени
- Панель администрирования для управления зданиями и контроллерами
- Интеграция с базой данных PostgreSQL
- RESTful API для обмена данными между клиентом и сервером
- Документация API с использованием Swagger

## Как запустить проект

### Требования
- Node.js (v14+)
- PostgreSQL (v12+)

### Установка

1. Клонируйте репозиторий:
```
git clone https://github.com/yourusername/leaflet.git
cd leaflet
```

2. Установите зависимости:
```
npm install
```

3. Создайте файл `.env` с настройками окружения (или используйте существующий):
```
# Настройки сервера
PORT=3000
NODE_ENV=development

# Настройки базы данных
DB_HOST=localhost
DB_PORT=5432
DB_NAME=infrasafe
DB_USER=postgres
DB_PASSWORD=postgres

# Настройки логирования
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

4. Создайте базу данных PostgreSQL и импортируйте схему (SQL-скрипты не включены в этот репозиторий).

5. Запустите сервер в режиме разработки:
```
npm run dev
```

6. Или запустите сервер в обычном режиме:
```
npm start
```

7. Откройте приложение в браузере:
```
http://localhost:3000
```

8. Документация API доступна по адресу:
```
http://localhost:3000/api-docs
```

## Структура проекта

```
leaflet/
├── public/                  # Статические файлы
│   ├── css/                 # Стили приложения
│   │   └── style.css
│   ├── js/                  # Клиентские скрипты JavaScript
│   │   ├── script.js        # Основной JavaScript для карты
│   │   └── admin.js         # JavaScript для панели администрирования
│   ├── images/              # Иконки и изображения
│   └── index.html           # Основная страница приложения
├── src/                     # Исходный код сервера
│   ├── config/              # Конфигурационные файлы
│   │   └── database.js      # Конфигурация базы данных
│   ├── controllers/         # Контроллеры для обработки запросов
│   │   ├── buildingController.js
│   │   ├── controllerController.js
│   │   └── metricController.js
│   ├── models/              # Модели для работы с данными
│   │   ├── Building.js
│   │   ├── Controller.js
│   │   └── Metric.js
│   ├── routes/              # Маршруты API
│   │   ├── buildingRoutes.js
│   │   ├── controllerRoutes.js
│   │   ├── metricRoutes.js
│   │   └── index.js
│   ├── services/            # Сервисный слой для бизнес-логики
│   │   ├── buildingService.js
│   │   ├── controllerService.js
│   │   └── metricService.js
│   ├── middleware/          # Промежуточное ПО
│   │   └── errorHandler.js
│   ├── utils/               # Утилиты и вспомогательные функции
│   │   ├── helpers.js
│   │   └── logger.js
│   ├── server.js            # Настройка сервера Express
│   └── index.js             # Входная точка приложения
├── .env                     # Переменные окружения
├── .gitignore               # Игнорируемые файлы Git
├── package.json             # Зависимости и скрипты
└── README.md                # Документация проекта
```

## План рефакторинга

✅ Перенос конфигурации базы данных из `src/db.js` в `src/config/database.js`
✅ Добавление сервисного слоя для разделения бизнес-логики и контроллеров
✅ Перенос серверной логики в `src/server.js`
⬜ Улучшение обработки ошибок и логирования
⬜ Добавление модульного тестирования для ключевых компонентов
⬜ Реализация кэширования для часто запрашиваемых данных
⬜ Оптимизация запросов к базе данных
⬜ Улучшение документации API

## API Endpoints

### Здания
- `GET /api/buildings` - Получить список всех зданий
- `GET /api/buildings/:id` - Получить здание по ID
- `POST /api/buildings` - Создать новое здание
- `PUT /api/buildings/:id` - Обновить здание
- `DELETE /api/buildings/:id` - Удалить здание

### Контроллеры
- `GET /api/controllers` - Получить список всех контроллеров
- `GET /api/controllers/:id` - Получить контроллер по ID
- `GET /api/controllers/building/:buildingId` - Получить контроллеры по ID здания
- `GET /api/controllers/:id/metrics` - Получить метрики контроллера
- `POST /api/controllers` - Создать новый контроллер
- `PUT /api/controllers/:id` - Обновить контроллер
- `PATCH /api/controllers/:id/status` - Обновить статус контроллера
- `DELETE /api/controllers/:id` - Удалить контроллер

### Метрики
- `GET /api/metrics` - Получить список всех метрик
- `GET /api/metrics/:id` - Получить метрику по ID
- `GET /api/metrics/latest/all` - Получить последние метрики для всех контроллеров
- `GET /api/metrics/controller/:controllerId` - Получить метрики по ID контроллера
- `POST /api/metrics` - Создать новую метрику
- `POST /api/metrics/telemetry` - Получить телеметрию от устройства
- `DELETE /api/metrics/:id` - Удалить метрику