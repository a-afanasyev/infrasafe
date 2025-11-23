# ПЛАН T019: Редактирование координат в админке

**Дата создания:** 2025-10-21  
**Сложность:** Level 3 (Feature Development)  
**Оценка:** 8-10 часов  
**Статус:** В планировании

---

## 🎯 ЦЕЛЬ ЗАДАЧИ

Добавить в админку функционал редактирования координат и характеристик для всех объектов инфраструктуры:
- ⚡ Трансформаторы
- 🔌 Линии электропередач (старая таблица `lines`)
- 🚰 Линии водоснабжения ХВС/ГВС (таблица `water_lines`)
- 💧 Источники воды (`cold_water_sources`)
- 🔥 Источники тепла (`heat_sources`)
- 📍 Линии инфраструктуры (новая таблица `infrastructure_lines`)

---

## 📋 ТРЕБОВАНИЯ

### Функциональные требования

1. **Редактирование координат:**
   - Ручной ввод latitude/longitude
   - Выбор точки на карте кликом
   - Валидация координат (диапазоны)
   - Предпросмотр на карте перед сохранением

2. **Дополнительные поля для линий электропередач:**
   - Тип кабеля (cable_type): varchar(100)
   - Год ввода в эксплуатацию (commissioning_year): integer

3. **UI требования:**
   - Компактные формы редактирования
   - Встроенная мини-карта для выбора координат
   - Валидация на стороне клиента и сервера
   - Toast уведомления об успехе/ошибках

4. **Интеграция:**
   - Обновление существующих моделей
   - API endpoints для UPDATE операций
   - Автообновление карты после изменений

---

## 🗂️ АРХИТЕКТУРА РЕШЕНИЯ

### 1. Обновления базы данных

#### Миграция 004: Дополнительные поля для линий электропередач

```sql
-- Добавление новых полей в таблицу lines (старые линии электропередач)
ALTER TABLE lines 
ADD COLUMN cable_type VARCHAR(100),
ADD COLUMN commissioning_year INTEGER CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100);

-- Добавление новых полей в таблицу infrastructure_lines
ALTER TABLE infrastructure_lines
ADD COLUMN cable_type VARCHAR(100),
ADD COLUMN commissioning_year INTEGER CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100);

-- Комментарии
COMMENT ON COLUMN lines.cable_type IS 'Тип кабеля (медь, алюминий, и т.д.)';
COMMENT ON COLUMN lines.commissioning_year IS 'Год ввода в эксплуатацию';
COMMENT ON COLUMN infrastructure_lines.cable_type IS 'Тип кабеля для линий электропередач';
COMMENT ON COLUMN infrastructure_lines.commissioning_year IS 'Год ввода в эксплуатацию';
```

### 2. Backend обновления

#### Обновление моделей

**Файлы для обновления:**
- `src/models/Transformer.js` - поддержка latitude/longitude
- `src/models/Line.js` - добавить cable_type, commissioning_year
- `src/models/WaterLine.js` - поддержка координат (если нет)
- `src/models/WaterSource.js` - поддержка координат
- `src/models/HeatSource.js` - поддержка координат
- `src/models/InfrastructureLine.js` - добавить cable_type, commissioning_year

**Новые/обновленные методы:**
```javascript
// Для всех моделей добавить/обновить
static async updateCoordinates(id, latitude, longitude) {
    // Обновление координат с валидацией
    // Автоматическое обновление geom (PostGIS)
}

// Для Line и InfrastructureLine
static async updateExtendedFields(id, {cable_type, commissioning_year}) {
    // Обновление дополнительных полей
}
```

#### Обновление контроллеров

Добавить методы обновления координат в существующие контроллеры:
- `src/controllers/transformerController.js`
- `src/controllers/lineController.js`
- `src/controllers/waterLineController.js`
- `src/controllers/waterSourceController.js`
- `src/controllers/heatSourceController.js`
- `src/controllers/infrastructureLinesController.js`

---

### 3. Frontend (Админка)

#### Структура UI для каждого объекта

**Общий шаблон формы редактирования координат:**

```html
<div class="edit-coordinates-form">
    <h3>Редактирование координат</h3>
    
    <!-- Ручной ввод -->
    <div class="coordinate-input">
        <label>Широта (Latitude):</label>
        <input type="number" step="0.000001" min="-90" max="90" 
               id="edit-latitude" required>
        
        <label>Долгота (Longitude):</label>
        <input type="number" step="0.000001" min="-180" max="180" 
               id="edit-longitude" required>
    </div>
    
    <!-- Выбор на карте -->
    <div class="map-picker">
        <button type="button" id="pick-on-map">📍 Выбрать на карте</button>
        <div id="mini-map" style="height: 300px; display: none;"></div>
    </div>
    
    <!-- Дополнительные поля (для линий электропередач) -->
    <div class="additional-fields" style="display: none;">
        <label>Тип кабеля:</label>
        <select id="edit-cable-type">
            <option value="">Не указан</option>
            <option value="copper">Медный</option>
            <option value="aluminum">Алюминиевый</option>
            <option value="fiber">Оптоволоконный</option>
            <option value="mixed">Смешанный</option>
        </select>
        
        <label>Год ввода в эксплуатацию:</label>
        <input type="number" min="1900" max="2100" 
               id="edit-commissioning-year" placeholder="YYYY">
    </div>
    
    <!-- Кнопки -->
    <div class="form-actions">
        <button type="submit" class="btn-save">💾 Сохранить</button>
        <button type="button" class="btn-cancel">✕ Отмена</button>
    </div>
</div>
```

#### Компоненты для каждой вкладки

**1. Трансформаторы (`transformers`)**
- Кнопка "Изменить координаты" в каждой строке таблицы
- Modal окно с формой
- Мини-карта для выбора точки
- Обновление через `PUT /api/transformers/:id`

**2. Линии электропередач (`lines`)**
- Редактирование координат начала/конца
- **НОВОЕ:** Поля cable_type и commissioning_year
- Предпросмотр линии на карте
- Обновление через `PUT /api/lines/:id`

**3. Линии водоснабжения (`water-lines`)**
- Редактирование координат
- Обновление через `PUT /api/water-lines/:id`

**4. Источники воды (`water-sources` / `cold-water-sources`)**
- Редактирование координат точки
- Обновление через `PUT /api/cold-water-sources/:id`

**5. Источники тепла (`heat-sources`)**
- Редактирование координат точки
- Обновление через `PUT /api/heat-sources/:id`

**6. Линии инфраструктуры (`infrastructure-lines`)**
- Редактирование массива точек main_path (JSON)
- Редактирование ответвлений branches
- **НОВОЕ:** Поля cable_type и commissioning_year (для electricity)
- Визуальный редактор с картой
- Обновление через `PUT /api/infrastructure-lines/:id`

---

## 🎨 ДИЗАЙН UI

### Modal окно редактирования

```css
.edit-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
}

.coordinate-input {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 10px;
    margin-bottom: 15px;
}

.mini-map {
    height: 300px;
    border: 1px solid #ddd;
    border-radius: 4px;
    margin: 15px 0;
}
```

### Кнопки в таблице

```html
<td>
    <button onclick="editCoordinates(transformerId)" class="btn-edit">
        📍 Координаты
    </button>
    <button onclick="editItem(transformerId)" class="btn-edit">
        ✏️ Изменить
    </button>
    <button onclick="deleteItem(transformerId)" class="btn-delete">
        🗑️ Удалить
    </button>
</td>
```

---

## 🔄 ПЛАН РЕАЛИЗАЦИИ

### Фаза 1: База данных (1 час)
- [x] Анализ текущих таблиц
- [ ] Создание миграции 004
- [ ] Добавление полей cable_type и commissioning_year
- [ ] Обновление комментариев в БД
- [ ] Применение миграции

### Фаза 2: Backend (2-3 часа)
- [ ] Обновление модели Transformer (latitude/longitude)
- [ ] Обновление модели Line (cable_type, commissioning_year)
- [ ] Обновление модели InfrastructureLine (cable_type, commissioning_year)
- [ ] Обновление моделей WaterSource, HeatSource
- [ ] Добавление методов updateCoordinates() во все модели
- [ ] Обновление контроллеров
- [ ] Тестирование API endpoints

### Фаза 3: Frontend админка (4-5 часов)
- [ ] Создание универсального компонента EditCoordinatesModal
- [ ] Интеграция Leaflet мини-карты в modal
- [ ] Формы для Трансформаторов
- [ ] Формы для Линий электропередач (+ cable_type, commissioning_year)
- [ ] Формы для Линий ХВС/ГВС
- [ ] Формы для Источников воды
- [ ] Формы для Источников тепла
- [ ] Формы для Линий инфраструктуры (визуальный редактор точек)
- [ ] Валидация на клиенте
- [ ] Toast уведомления

### Фаза 4: Интеграция с картой (1 час)
- [ ] Выбор координат кликом на карте
- [ ] Перетаскивание маркера на карте
- [ ] Автоматическое центрирование на выбранном объекте
- [ ] Подсветка объекта на карте при редактировании

### Фаза 5: Тестирование (1 час)
- [ ] Тесты API (Jest)
- [ ] Тестирование UI (Chrome MCP)
- [ ] Проверка валидации
- [ ] Проверка обновления карты

---

## 📊 ОБЪЕКТЫ ДЛЯ РЕДАКТИРОВАНИЯ

### 1. Трансформаторы (`transformers`)
**Текущие поля:**
- transformer_id
- name
- power_kva
- voltage_kv
- location (текстовое)
- ❌ latitude - **НЕТ (нужно добавить)**
- ❌ longitude - **НЕТ (нужно добавить)**

**Что добавить:**
```sql
ALTER TABLE transformers 
ADD COLUMN latitude NUMERIC(9,6),
ADD COLUMN longitude NUMERIC(9,6),
ADD COLUMN geom GEOMETRY(POINT, 4326);

-- Триггер для автоматического обновления geom
CREATE TRIGGER trig_transformers_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON transformers
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();
```

### 2. Линии электропередач (`lines`)
**Текущие поля:**
- line_id
- name
- voltage_kv
- length_km
- transformer_id
- ❌ latitude_start - **НЕТ**
- ❌ longitude_start - **НЕТ**
- ❌ latitude_end - **НЕТ**
- ❌ longitude_end - **НЕТ**
- ❌ cable_type - **НЕТ (ТРЕБОВАНИЕ)**
- ❌ commissioning_year - **НЕТ (ТРЕБОВАНИЕ)**

**Что добавить:**
```sql
ALTER TABLE lines 
ADD COLUMN latitude_start NUMERIC(9,6),
ADD COLUMN longitude_start NUMERIC(9,6),
ADD COLUMN latitude_end NUMERIC(9,6),
ADD COLUMN longitude_end NUMERIC(9,6),
ADD COLUMN cable_type VARCHAR(100),
ADD COLUMN commissioning_year INTEGER CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100),
ADD COLUMN geom GEOMETRY(LINESTRING, 4326);
```

### 3. Линии водоснабжения (`water_lines`)
**Текущие поля:**
- line_id
- name
- diameter_mm
- pressure_bar
- ❌ Координаты - **НЕТ**

**Что добавить:**
```sql
ALTER TABLE water_lines
ADD COLUMN latitude_start NUMERIC(9,6),
ADD COLUMN longitude_start NUMERIC(9,6),
ADD COLUMN latitude_end NUMERIC(9,6),
ADD COLUMN longitude_end NUMERIC(9,6),
ADD COLUMN geom GEOMETRY(LINESTRING, 4326);
```

### 4. Источники воды (`cold_water_sources`)
**Текущие поля:**
- ✅ latitude - **ЕСТЬ**
- ✅ longitude - **ЕСТЬ**
- ✅ geom - **ЕСТЬ**

**Действие:** Только добавить UI редактирования (БД уже готова)

### 5. Источники тепла (`heat_sources`)
**Текущие поля:**
- ✅ latitude - **ЕСТЬ**
- ✅ longitude - **ЕСТЬ**
- ✅ geom - **ЕСТЬ**

**Действие:** Только добавить UI редактирования (БД уже готова)

### 6. Линии инфраструктуры (`infrastructure_lines`)
**Текущие поля:**
- ✅ main_path (JSONB) - **ЕСТЬ**
- ✅ branches (JSONB) - **ЕСТЬ**
- ✅ geom (LINESTRING) - **ЕСТЬ**
- ❌ cable_type - **НЕТ (для electricity)**
- ❌ commissioning_year - **НЕТ**

**Что добавить:**
- cable_type и commissioning_year (уже указано выше)
- Визуальный редактор точек (drag & drop на карте)

---

## 🎯 КОМПОНЕНТЫ РЕШЕНИЯ

### Универсальный компонент: CoordinateEditor

```javascript
/**
 * Универсальный компонент редактирования координат
 * Работает для точечных объектов (transformers, sources)
 */
class CoordinateEditor {
    constructor(options) {
        this.objectType = options.objectType;
        this.objectId = options.objectId;
        this.currentLat = options.latitude;
        this.currentLng = options.longitude;
        this.onSave = options.onSave;
    }
    
    /**
     * Показать modal с формой редактирования
     */
    show() {
        // Создать modal
        // Инициализировать мини-карту
        // Установить текущие координаты
        // Добавить обработчики
    }
    
    /**
     * Инициализация Leaflet мини-карты
     */
    initMiniMap() {
        // Создать карту Leaflet
        // Добавить draggable маркер
        // Обработчик клика на карте
        // Обработчик перетаскивания маркера
    }
    
    /**
     * Валидация координат
     */
    validateCoordinates(lat, lng) {
        // Проверка диапазонов
        // Проверка формата
    }
    
    /**
     * Сохранение координат
     */
    async save() {
        // Валидация
        // API запрос
        // Toast уведомление
        // Обновление главной карты
    }
}
```

### Визуальный редактор линий: LinePathEditor

```javascript
/**
 * Визуальный редактор пути линии
 * Для редактирования main_path в infrastructure_lines
 */
class LinePathEditor {
    constructor(lineId, lineData) {
        this.lineId = lineId;
        this.mainPath = lineData.main_path;
        this.branches = lineData.branches;
    }
    
    /**
     * Показать редактор
     */
    show() {
        // Создать modal с большой картой
        // Отрисовать текущую линию
        // Добавить инструменты:
        //   - Добавить точку
        //   - Удалить точку
        //   - Переместить точку (drag)
        //   - Добавить ответвление
    }
    
    /**
     * Добавление точки в линию
     */
    addPoint(lat, lng, insertAfterIndex) {
        // Вставить точку в main_path
        // Пересчитать order
        // Перерисовать линию
    }
    
    /**
     * Удаление точки
     */
    removePoint(index) {
        // Проверка минимум 2 точки
        // Удалить из main_path
        // Пересчитать order
        // Перерисовать
    }
    
    /**
     * Сохранение изменений
     */
    async save() {
        // Валидация (минимум 2 точки)
        // API запрос PUT /api/infrastructure-lines/:id
        // Обновление главной карты
    }
}
```

---

## 📋 ДЕТАЛЬНЫЙ ПЛАН ФОРМ

### Форма: Трансформаторы

```html
<div id="edit-transformer-modal" class="modal">
    <div class="modal-content">
        <h3>📍 Редактирование трансформатора</h3>
        
        <form id="edit-transformer-form">
            <!-- Основные данные (read-only для контекста) -->
            <div class="info-row">
                <strong>Название:</strong> <span id="transformer-name"></span>
            </div>
            <div class="info-row">
                <strong>Мощность:</strong> <span id="transformer-power"></span> кВА
            </div>
            
            <!-- Редактируемые координаты -->
            <div class="form-group">
                <label>Широта (Latitude):</label>
                <input type="number" step="0.000001" min="-90" max="90" 
                       id="transformer-latitude" required>
            </div>
            
            <div class="form-group">
                <label>Долгота (Longitude):</label>
                <input type="number" step="0.000001" min="-180" max="180" 
                       id="transformer-longitude" required>
            </div>
            
            <!-- Кнопка выбора на карте -->
            <button type="button" id="pick-transformer-location" class="btn-map">
                📍 Выбрать на карте
            </button>
            
            <!-- Мини-карта (показывается при клике на кнопку) -->
            <div id="transformer-mini-map" style="height: 250px; display: none;"></div>
            
            <!-- Кнопки действий -->
            <div class="form-actions">
                <button type="submit" class="btn-save">💾 Сохранить</button>
                <button type="button" class="btn-cancel">✕ Отмена</button>
            </div>
        </form>
    </div>
</div>
```

### Форма: Линии электропередач

```html
<div id="edit-line-modal" class="modal">
    <div class="modal-content">
        <h3>⚡ Редактирование линии электропередач</h3>
        
        <form id="edit-line-form">
            <!-- Основные данные -->
            <div class="info-row">
                <strong>Название:</strong> <span id="line-name"></span>
            </div>
            
            <!-- Начальная точка -->
            <fieldset>
                <legend>Начальная точка</legend>
                <div class="form-group">
                    <label>Широта:</label>
                    <input type="number" step="0.000001" min="-90" max="90" 
                           id="line-latitude-start" required>
                </div>
                <div class="form-group">
                    <label>Долгота:</label>
                    <input type="number" step="0.000001" min="-180" max="180" 
                           id="line-longitude-start" required>
                </div>
            </fieldset>
            
            <!-- Конечная точка -->
            <fieldset>
                <legend>Конечная точка</legend>
                <div class="form-group">
                    <label>Широта:</label>
                    <input type="number" step="0.000001" min="-90" max="90" 
                           id="line-latitude-end" required>
                </div>
                <div class="form-group">
                    <label>Долгота:</label>
                    <input type="number" step="0.000001" min="-180" max="180" 
                           id="line-longitude-end" required>
                </div>
            </fieldset>
            
            <!-- НОВЫЕ ПОЛЯ -->
            <fieldset>
                <legend>Дополнительные характеристики</legend>
                <div class="form-group">
                    <label>Тип кабеля:</label>
                    <select id="line-cable-type">
                        <option value="">Не указан</option>
                        <option value="copper">Медный (Cu)</option>
                        <option value="aluminum">Алюминиевый (Al)</option>
                        <option value="steel_aluminum">Сталеалюминиевый (AC)</option>
                        <option value="fiber">Оптоволоконный</option>
                        <option value="other">Другой</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Год ввода в эксплуатацию:</label>
                    <input type="number" min="1900" max="2100" 
                           id="line-commissioning-year" placeholder="YYYY">
                </div>
            </fieldset>
            
            <!-- Мини-карта -->
            <button type="button" id="pick-line-location" class="btn-map">
                📍 Выбрать точки на карте
            </button>
            <div id="line-mini-map" style="height: 300px; display: none;"></div>
            
            <!-- Кнопки -->
            <div class="form-actions">
                <button type="submit" class="btn-save">💾 Сохранить</button>
                <button type="button" class="btn-cancel">✕ Отмена</button>
            </div>
        </form>
    </div>
</div>
```

---

## 📊 ТАБЛИЦА ОБЪЕКТОВ И ПОЛЕЙ

| Объект | Текущие координаты | Нужно добавить | Дополнительные поля |
|--------|-------------------|----------------|---------------------|
| **Трансформаторы** | ❌ Нет | latitude, longitude, geom | - |
| **Линии электропередач** | ❌ Нет | lat_start, lng_start, lat_end, lng_end, geom | cable_type, commissioning_year |
| **Линии ХВС/ГВС** | ❌ Нет | lat_start, lng_start, lat_end, lng_end, geom | - |
| **Источники воды** | ✅ Есть | - | - |
| **Источники тепла** | ✅ Есть | - | - |
| **Линии инфраструктуры** | ✅ Есть (JSON) | - | cable_type, commissioning_year |

---

## 🔧 ТЕХНИЧЕСКИЕ ДЕТАЛИ

### Валидация координат

**JavaScript (Frontend):**
```javascript
function validateCoordinate(lat, lng) {
    // Проверка типа
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return { valid: false, error: 'Координаты должны быть числами' };
    }
    
    // Проверка диапазона широты
    if (lat < -90 || lat > 90) {
        return { valid: false, error: 'Широта должна быть в диапазоне [-90, 90]' };
    }
    
    // Проверка диапазона долготы
    if (lng < -180 || lng > 180) {
        return { valid: false, error: 'Долгота должна быть в диапазоне [-180, 180]' };
    }
    
    return { valid: true };
}
```

**SQL (Backend триггеры уже созданы):**
- Триггеры автоматически создают geom из latitude/longitude
- Валидация координат в триггерах

### API Endpoints для обновления

**Существующие endpoints (нужно обновить модели):**
- `PUT /api/transformers/:id` - обновить трансформатор
- `PUT /api/lines/:id` - обновить линию электропередач
- `PUT /api/water-lines/:id` - обновить линию водоснабжения
- `PUT /api/cold-water-sources/:id` - обновить источник воды
- `PUT /api/heat-sources/:id` - обновить источник тепла
- `PUT /api/infrastructure-lines/:id` - обновить линию инфраструктуры

---

## 🎨 UX УЛУЧШЕНИЯ

### 1. Интерактивный выбор на карте

**Workflow:**
1. Пользователь кликает "📍 Выбрать на карте"
2. Показывается мини-карта с текущей позицией
3. Пользователь кликает на карте → координаты обновляются в форме
4. Или перетаскивает маркер → координаты обновляются в реальном времени
5. Кнопка "Применить" → координаты переносятся в форму
6. Форма сохраняется → объект обновляется в БД и на главной карте

### 2. Предпросмотр изменений

- При изменении координат показывать предпросмотр на мини-карте
- Подсветка изменений (старая позиция vs новая)
- Расчет расстояния перемещения

### 3. Упрощенная навигация

- Кнопка "📍 Координаты" в каждой строке таблицы
- Быстрый доступ к редактированию
- Минималистичный UI

---

## ✅ КРИТЕРИИ ЗАВЕРШЕНИЯ

- ✅ Все необходимые поля добавлены в БД
- ✅ Миграции применены успешно
- ✅ Backend модели обновлены
- ✅ API endpoints поддерживают новые поля
- ✅ UI формы созданы для всех объектов
- ✅ Мини-карта работает для выбора координат
- ✅ Валидация работает на клиенте и сервере
- ✅ Главная карта обновляется после изменений
- ✅ Все функции протестированы
- ✅ Документация обновлена

---

## 📝 ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ

### Пример 1: Обновление координат трансформатора

```javascript
// API запрос
PUT /api/transformers/5
{
  "latitude": 55.751244,
  "longitude": 37.618423
}

// Ответ
{
  "success": true,
  "message": "Трансформатор обновлен",
  "data": {
    "transformer_id": 5,
    "latitude": 55.751244,
    "longitude": 37.618423,
    "geom": "POINT(37.618423 55.751244)"
  }
}
```

### Пример 2: Обновление линии электропередач

```javascript
// API запрос
PUT /api/lines/3
{
  "latitude_start": 55.748000,
  "longitude_start": 37.615000,
  "latitude_end": 55.750000,
  "longitude_end": 37.617000,
  "cable_type": "copper",
  "commissioning_year": 2015
}
```

### Пример 3: Обновление точек линии инфраструктуры

```javascript
// API запрос
PUT /api/infrastructure-lines/1
{
  "main_path": [
    {"lat": 55.751, "lng": 37.618, "order": 0},
    {"lat": 55.752, "lng": 37.619, "order": 1},
    {"lat": 55.753, "lng": 37.620, "order": 2} // Новая точка добавлена
  ],
  "cable_type": "aluminum",
  "commissioning_year": 2018
}
```

---

## 📅 ПОРЯДОК РЕАЛИЗАЦИИ

### День 1 (4-5 часов):
1. ✅ Создание SQL миграции
2. ✅ Обновление backend моделей
3. ✅ Тестирование API endpoints

### День 2 (4-5 часов):
4. ✅ Создание UI компонентов (CoordinateEditor)
5. ✅ Интеграция форм в админку
6. ✅ Добавление мини-карт Leaflet
7. ✅ Тестирование через Chrome MCP

---

**Следующий шаг:** Создание SQL миграции и обновление моделей

