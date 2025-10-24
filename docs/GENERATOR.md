## Генератор тестовых данных (отдельный сервис)

Сервис предназначен для генерации тестовых метрик по зданиям и отправки их в основной API по HTTP. Прямого доступа к базе данных нет.

### Возможности
- Хранение диапазонов значений по каждому `building_id` в локальном JSON
- Ручной запуск одноразовой генерации
- Плановая автоматика по cron (по умолчанию каждые 2 минуты)
- Простой UI для ввода диапазонов

### Структура
- `generator/src/server.js` — Express-приложение, REST эндпоинты и статика UI
- `generator/src/store.js` — локальное хранение диапазонов (JSON-файл `generator-data.json`)
- `generator/src/apiClient.js` — HTTP-клиент к основному API (логин/отправка метрик)
- `generator/src/scheduler.js` — планировщик генерации

### Конфигурация окружения
Скопируйте `.env.example` в `.env` и укажите настройки:

```
PORT=8081
API_BASE_URL=http://localhost:8080/api
# либо готовый токен:
# API_STATIC_TOKEN=...
# либо логин/пароль для получения токена:
# API_USERNAME=admin
# API_PASSWORD=admin123
# cron для запуска
# GENERATOR_CRON=*/2 * * * *
```

### Запуск локально
```
cd generator
npm install
npm run start
```
Откройте UI: `http://localhost:8081/`

### Docker
```
cd generator
docker build -t infrasafe-generator:latest .
docker run --rm -p 8081:8081 --env-file .env infrasafe-generator:latest
```

### Интеграция с docker-compose
Добавьте новый сервис (не трогая БД):

```yaml
  generator:
    image: infrasafe-generator:latest
    build:
      context: ./generator
    env_file:
      - ./generator/.env
    ports:
      - "8081:8081"
    # Персистентность конфигурации диапазонов (опционально)
    volumes:
      - generator_data:/app/generator-data.json
    depends_on:
      - backend # имя сервиса API, скорректируйте при необходимости

volumes:
  generator_data: {}
```

Важно: контейнеры БД не удаляются и не модифицируются, сервис работает только через HTTP API.

---

## UI: настройка всех показателей
Откройте `http://localhost:8081/`.
- Введите `Building ID` (числовой `building_id` из основной системы).
- Заполните диапазоны:
  - Электричество (напряжение, В): `PH1`, `PH2`, `PH3` — `min`, `max`
  - Сила тока (А): `PH1`, `PH2`, `PH3` — `min`, `max`
  - Давление воды (бар): `ХВС`, `ГВС вход`, `ГВС выход` — `min`, `max`
  - Температура воды (°C): `ХВС`, `ГВС вход`, `ГВС выход` — `min`, `max`
  - Окружение: `Воздух (°C)`, `Влажность (%)` — `min`, `max`
  - Протечки: `Вероятность протечки (0..1)` — вероятность установки `leak_sensor=true`
- Нажмите «Сохранить диапазоны» — настройки сохраняются для конкретного здания.
- Кнопка «Выполнить генерацию один раз» сразу сгенерирует и отправит метрики согласно диапазонам.

Под капотом UI вызывает эндпоинты сервиса (см. ниже).

## Эндпоинты сервиса-генератора
- `GET /health` — проверка работоспособности сервиса
- `GET /api/ranges` — получить все сохранённые диапазоны (по всем зданиям)
- `GET /api/ranges/:buildingId` — получить диапазоны конкретного здания
- `POST /api/ranges/:buildingId` — сохранить диапазоны здания
  - Тело запроса:
    ```json
    {
      "electricity": { "ph1": [min, max], "ph2": [min, max], "ph3": [min, max] },
      "amperage": { "ph1": [min, max], "ph2": [min, max], "ph3": [min, max] },
      "waterPressure": { "cold": [min, max], "hotIn": [min, max], "hotOut": [min, max] },
      "waterTemp": { "cold": [min, max], "hotIn": [min, max], "hotOut": [min, max] },
      "environment": { "airTemp": [min, max], "humidity": [min, max] },
      "leakProbability": 0.1
    }
    ```
- `POST /api/generate/run-once` — разовая генерация и отправка метрик для всех зданий, у которых есть сохранённые диапазоны

## Хранение и формат диапазонов
- Файл: `generator-data.json` в рабочем каталоге контейнера.
- Структура:
  ```json
  {
    "rangesByBuildingId": {
      "1": {
        "electricity": { "ph1": [210, 230], "ph2": [210, 230], "ph3": [210, 230] },
        "amperage": { "ph1": [5, 30], "ph2": [5, 30], "ph3": [5, 30] },
        "waterPressure": { "cold": [2.0, 3.0], "hotIn": [2.5, 3.5], "hotOut": [2.0, 3.0] },
        "waterTemp": { "cold": [5, 15], "hotIn": [50, 70], "hotOut": [40, 60] },
        "environment": { "airTemp": [18, 28], "humidity": [30, 70] },
        "leakProbability": 0.1
      }
    }
  }
  ```
- Для персистентности используйте volume (см. docker-compose выше).

## Интеграция с основным API
- Чтение зданий/контроллеров: `GET /api/buildings-metrics` (используется `building_id` и `controller_id`).
- Отправка метрик: `POST /api/metrics` с телом вида:
  ```json
  {
    "controller_id": 1,
    "timestamp": "2025-01-01T10:00:00Z",
    "electricity_ph1": 220.5,
    "electricity_ph2": 221.0,
    "electricity_ph3": 219.8,
    "amperage_ph1": 15.2,
    "amperage_ph2": 14.8,
    "amperage_ph3": 15.5,
    "cold_water_pressure": 2.5,
    "cold_water_temp": 8.5,
    "hot_water_in_pressure": 3.2,
    "hot_water_out_pressure": 2.8,
    "hot_water_in_temp": 65.0,
    "hot_water_out_temp": 45.0,
    "air_temp": 22.0,
    "humidity": 45.0,
    "leak_sensor": false
  }
  ```
- Аутентификация: через `API_STATIC_TOKEN` или `API_USERNAME`/`API_PASSWORD` (логин на `/api/auth/login`).

## Планировщик
- Переменная `GENERATOR_CRON` определяет периодичность выполнения (по умолчанию — каждые 2 минуты).
- Каждое срабатывание отправляет по одной записи метрик на каждый контроллер зданий, для которых заданы диапазоны.

## Безопасность
- Генератор не имеет соединения с БД; взаимодействие только через HTTP API.
- Токены храните в `.env`, не коммитьте секреты в репозиторий.
- Рекомендуется ограничить доступ к UI и эндпоинтам генератора в production-среде сетью/ACL.

## Отладка и частые ошибки
- 401 при отправке метрик: проверьте `API_STATIC_TOKEN` или пары `API_USERNAME`/`API_PASSWORD`.
- Пустой список зданий: проверьте доступность `API_BASE_URL` и эндпоинта `/api/buildings-metrics`.
- Метрики не появляются: убедитесь, что для нужного `building_id` сохранены диапазоны и есть связанный `controller_id`.
- Контейнер перезапускается: проверьте переменные окружения и сетевую доступность бэкенда.
