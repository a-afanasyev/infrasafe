# Руководство по системе линий инфраструктуры

**Дата создания:** 2025-10-21  
**Версия:** 1.0.0  
**Статус:** ✅ Полностью реализовано

---

## 📋 Обзор

Система визуализации линий инфраструктуры позволяет отображать на карте:
- ❄️ **Линии холодного водоснабжения (ХВС)** - синий цвет (#0066FF)
- 🔥 **Линии горячего водоснабжения (ГВС)** - красный цвет (#FF0000)
- ⚡ **Линии электропередач** - желто-оранжевый цвет (#FFA500)

### Ключевые возможности

✅ Отрисовка линий по геокоординатам (Leaflet Polyline)  
✅ Хранение точек маршрута в JSON (БД)  
✅ Поддержка ответвлений (пунктирные линии)  
✅ Интерактивные popup с детальной информацией  
✅ Отображение алертов/аварий на линиях  
✅ Автоматический расчет длины линии  
✅ PostGIS геометрия для пространственных запросов  

---

## 🗂️ Архитектура

### База данных

#### Таблица `infrastructure_lines`
```sql
-- Основная таблица для хранения линий инфраструктуры
CREATE TABLE infrastructure_lines (
    line_id SERIAL PRIMARY KEY,
    line_type VARCHAR(20), -- 'cold_water', 'hot_water', 'electricity'
    name VARCHAR(255),
    main_path JSONB, -- Массив точек [{lat, lng, order}, ...]
    branches JSONB, -- Ответвления
    display_color VARCHAR(7), -- HEX цвет
    length_km DECIMAL(10,3), -- Автоматически вычисляется
    geom GEOMETRY(LINESTRING, 4326), -- PostGIS
    ...
);
```

#### Таблица `line_alert_zones`
```sql
-- Связь алертов с сегментами линий
CREATE TABLE line_alert_zones (
    alert_zone_id SERIAL PRIMARY KEY,
    line_id INTEGER REFERENCES infrastructure_lines(line_id),
    alert_id BIGINT REFERENCES infrastructure_alerts(alert_id),
    segment_start_index INTEGER, -- Индекс начала сегмента
    segment_end_index INTEGER, -- Индекс конца сегмента
    alert_point JSONB, -- Координаты аварии {lat, lng}
    ...
);
```

### Backend (Node.js/Express)

#### Модель: `src/models/InfrastructureLine.js`
- `getAll(filters)` - получить все линии с фильтрацией
- `getById(id)` - получить линию по ID
- `getByType(type)` - получить линии по типу
- `create(data)` - создать новую линию
- `update(id, data)` - обновить линию
- `delete(id)` - удалить линию
- `getAlertsOnLine(lineId)` - получить алерты на линии
- `getStatistics()` - статистика по линиям

#### API Endpoints: `/api/infrastructure-lines`

**Публичные (GET):**
- `GET /api/infrastructure-lines` - все линии
- `GET /api/infrastructure-lines/type/:type` - линии по типу
- `GET /api/infrastructure-lines/:id` - линия по ID
- `GET /api/infrastructure-lines/:id/alerts` - алерты на линии
- `GET /api/infrastructure-lines/statistics` - статистика

**Защищенные (POST/PUT/DELETE, требуют JWT):**
- `POST /api/infrastructure-lines` - создать линию
- `PUT /api/infrastructure-lines/:id` - обновить линию
- `DELETE /api/infrastructure-lines/:id` - удалить линию
- `POST /api/infrastructure-lines/alerts` - добавить алерт

### Frontend (Leaflet.js)

#### Файл: `public/map-layers-control.js`

**Методы загрузки:**
- `loadColdWaterLines()` - загрузка линий ХВС
- `loadHotWaterLines()` - загрузка линий ГВС
- `loadPowerLines()` - загрузка линий электропередач

**Методы отрисовки:**
- `drawInfrastructureLine(lineData, layer)` - отрисовка основной линии
- `drawBranch(branch, lineData, layer)` - отрисовка ответвления
- `createLinePopup(lineData)` - создание popup
- `loadLineAlerts(lineId, lineData, layer)` - загрузка алертов
- `displayLineAlert(alert, lineData, layer)` - отображение алерта
- `highlightLineSegment(lineData, start, end, layer)` - подсветка сегмента

---

## 📊 Формат данных

### Структура main_path

```json
[
    {
        "lat": 55.751244,
        "lng": 37.618423,
        "order": 0,
        "description": "Начальная точка"
    },
    {
        "lat": 55.752244,
        "lng": 37.619423,
        "order": 1,
        "description": "Промежуточная точка"
    },
    {
        "lat": 55.753244,
        "lng": 37.620423,
        "order": 2,
        "description": "Конечная точка"
    }
]
```

### Структура branches

```json
[
    {
        "branch_id": "branch_1",
        "name": "Ответвление на дом 5",
        "parent_point_index": 1,
        "points": [
            {"lat": 55.752244, "lng": 37.619423, "order": 0},
            {"lat": 55.752500, "lng": 37.619800, "order": 1}
        ]
    }
]
```

### Структура alert_point

```json
{
    "lat": 55.7525,
    "lng": 37.6197
}
```

---

## 🚀 Использование

### Создание линии через API

```bash
curl -X POST http://localhost:3000/api/infrastructure-lines \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "line_type": "cold_water",
    "name": "Линия ХВС - улица Пушкина",
    "description": "Основная магистраль",
    "main_path": [
      {"lat": 55.751, "lng": 37.618, "order": 0},
      {"lat": 55.752, "lng": 37.619, "order": 1}
    ],
    "branches": [],
    "diameter_mm": 300,
    "material": "steel",
    "display_color": "#0066FF",
    "line_width": 4,
    "status": "active"
  }'
```

### Получение линий по типу

```bash
# ХВС
curl http://localhost:3000/api/infrastructure-lines/type/cold_water

# ГВС
curl http://localhost:3000/api/infrastructure-lines/type/hot_water

# Электричество
curl http://localhost:3000/api/infrastructure-lines/type/electricity
```

### Получение статистики

```bash
curl http://localhost:3000/api/infrastructure-lines/statistics
```

Ответ:
```json
{
  "success": true,
  "data": {
    "total": 3,
    "by_type": {
      "cold_water": {
        "total": 1,
        "active": 1,
        "total_length_km": 0.68
      },
      "hot_water": {...},
      "electricity": {...}
    },
    "total_length_km": 1.58
  }
}
```

---

## 🎨 Визуализация на карте

### Стили линий

**Основная линия:**
- Толщина: 4px (по умолчанию)
- Непрозрачность: 0.8 (active) / 0.5 (другие статусы)
- Закругленные концы и соединения

**Ответвление:**
- Толщина: 2px
- Непрозрачность: 0.6
- Пунктирная линия (dashArray: '10, 10')

**Проблемный сегмент (с алертом):**
- Толщина: 6px
- Цвет: красный (#F44336)
- Непрозрачность: 1.0

### Маркеры алертов

Круглые маркеры с цветовой кодировкой:
- 🔵 INFO - синий (#2196F3)
- 🟠 WARNING - оранжевый (#FF9800)
- 🔴 CRITICAL - красный (#F44336)

---

## 🔧 Тестовые данные

В БД уже созданы 3 тестовые линии:

### 1. Линия ХВС (ID: 1)
- **Название:** "Линия ХВС - улица Ленина"
- **Тип:** cold_water
- **Цвет:** #0066FF (синий)
- **Длина:** 0.681 км
- **Ответвления:** 1 (на дом 5)

### 2. Линия ГВС (ID: 2)
- **Название:** "Линия ГВС - микрорайон Центральный"
- **Тип:** hot_water
- **Цвет:** #FF0000 (красный)
- **Длина:** 0.454 км
- **Ответвления:** нет

### 3. Линия электропередач (ID: 3)
- **Название:** "ЛЭП-10кВ - промзона"
- **Тип:** electricity
- **Цвет:** #FFA500 (желто-оранжевый)
- **Длина:** 0.454 км
- **Ответвления:** 1 (на склад)

---

## 🧪 Тестирование

### Тест API endpoints (в контейнере)

```bash
# 1. Получить линии ХВС
curl http://localhost:3000/api/infrastructure-lines/type/cold_water

# 2. Получить линии ГВС
curl http://localhost:3000/api/infrastructure-lines/type/hot_water

# 3. Получить линии электропередач
curl http://localhost:3000/api/infrastructure-lines/type/electricity

# 4. Получить статистику
curl http://localhost:3000/api/infrastructure-lines/statistics

# 5. Получить конкретную линию
curl http://localhost:3000/api/infrastructure-lines/1
```

### Проверка на карте

1. Откройте http://localhost:8080
2. Откройте панель управления слоями (правый верхний угол)
3. Включите слои:
   - 🚰 Линии водоснабжения
   - 🔌 Линии электропередач
4. На карте должны появиться цветные линии
5. Кликните на линию - откроется popup с информацией
6. Наведите курсор - появится tooltip с названием

---

## 📝 Примеры использования

### Добавление нового ответвления

```javascript
// Обновление линии с новым ответвлением
const updateData = {
  branches: [
    ...existingBranches,
    {
      branch_id: "new_branch",
      name: "Новое ответвление",
      parent_point_index: 2,
      points: [
        {lat: 55.753, lng: 37.620, order: 0},
        {lat: 55.753500, lng: 37.620500, order: 1}
      ]
    }
  ]
};

// PUT /api/infrastructure-lines/:id
```

### Добавление алерта на линию

```javascript
const alertData = {
  line_id: 1,
  alert_id: 123, // опционально
  segment_start_index: 1,
  segment_end_index: 2,
  alert_point: {
    lat: 55.7525,
    lng: 37.6195
  },
  description: "Утечка воды на линии ХВС",
  severity: "CRITICAL"
};

// POST /api/infrastructure-lines/alerts
```

---

## 🔍 Технические детали

### PostGIS функции

**Автоматическое создание геометрии:**
Триггер `trig_infrastructure_lines_geom` автоматически создает LINESTRING из JSON точек при INSERT/UPDATE.

**Валидация координат:**
Триггер `trig_validate_main_path` проверяет:
- Наличие обязательных полей (lat, lng, order)
- Диапазон широты: [-90, 90]
- Диапазон долготы: [-180, 180]

**Вычисление длины:**
Длина линии автоматически вычисляется в километрах с учетом кривизны Земли (EPSG:3857).

### Оптимизация

- GIN индексы на JSONB полях для быстрого поиска
- GIST индекс на геометрии для пространственных запросов
- Кэширование слоев на frontend (не перезагружать при переключении)

---

## 📚 Дополнительные ресурсы

- **Файл миграции:** `database/migrations/003_infrastructure_lines.sql`
- **Модель:** `src/models/InfrastructureLine.js`
- **Контроллер:** `src/controllers/infrastructureLinesController.js`
- **Роуты:** `src/routes/infrastructureLinesRoutes.js`
- **Frontend:** `public/map-layers-control.js` (строки 1043-1437)

---

## ✅ Чеклист готовности

- [x] База данных: таблицы созданы
- [x] Backend: модель реализована
- [x] Backend: контроллер реализован
- [x] Backend: роуты подключены
- [x] Backend: API endpoints работают
- [x] Frontend: методы загрузки добавлены
- [x] Frontend: методы отрисовки реализованы
- [x] Frontend: popup и tooltip работают
- [x] Интеграция с алертами реализована
- [x] Тестовые данные добавлены
- [x] API протестирован
- [x] Документация создана

---

**Система полностью готова к использованию!** 🎉


