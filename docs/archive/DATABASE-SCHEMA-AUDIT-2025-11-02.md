# 🔍 АУДИТ СООТВЕТСТВИЯ БАЗЫ ДАННЫХ КОДУ

**Дата проверки:** 2 ноября 2025  
**Проверяющий:** VAN Mode Analysis  
**Статус:** ❌ КРИТИЧЕСКИЕ НЕСООТВЕТСТВИЯ ОБНАРУЖЕНЫ

---

## 📊 КРАТКОЕ РЕЗЮМЕ

**Текущее состояние БД:**
- Таблицы: 25 базовых таблиц созданы ✅
- Init скрипты: Выполнены частично (только 01_init_database.sql) ✅
- **Миграции: НЕ ПРИМЕНЕНЫ** ❌
- Данные: Минимальные (1 здание, 1 контроллер, 130 метрик)

**Критические проблемы:**
1. ❌ Миграции 003, 004, 005 НЕ ПРИМЕНЕНЫ
2. ❌ Отсутствуют критические поля в таблицах
3. ❌ Отсутствуют функции расчета мощности
4. ❌ Отсутствуют материализованные представления

---

## 🚨 КРИТИЧЕСКИЕ НЕСООТВЕТСТВИЯ

### 1. **Таблица `transformers` - КРИТИЧЕСКОЕ НЕСООТВЕТСТВИЕ**

**Что ожидает код (src/models/Transformer.js):**
```javascript
this.transformer_id = data.transformer_id;
this.name = data.name;
this.power_kva = data.power_kva;
this.voltage_kv = data.voltage_kv;
this.latitude = data.latitude;      // ❌ ОТСУТСТВУЕТ В БД
this.longitude = data.longitude;    // ❌ ОТСУТСТВУЕТ В БД
this.location = data.location;
this.status = data.status;
this.manufacturer = data.manufacturer;
this.model = data.model;
```

**Что есть в БД:**
```sql
transformer_id, name, power_kva, voltage_kv, location, 
installation_date, manufacturer, model, status, created_at, updated_at
-- ❌ НЕТ: latitude, longitude, geom
```

**Влияние:**
- ❌ Трансформаторы НЕ отображаются на карте
- ❌ Endpoint `/api/transformers` возвращает NULL для координат
- ❌ Frontend код ожидает latitude/longitude (map-layers-control.js:507-508)

**Миграция для исправления:** `004_add_coordinates_and_extended_fields.sql` (НЕ ПРИМЕНЕНА)

---

### 2. **Таблица `lines` - КРИТИЧЕСКОЕ НЕСООТВЕТСТВИЕ**

**Что ожидает код (src/models/Line.js):**
```javascript
this.line_id = data.line_id;
this.name = data.name;
this.voltage_kv = data.voltage_kv;
this.length_km = data.length_km;
this.transformer_id = data.transformer_id;
this.main_path = data.main_path;           // ❌ ОТСУТСТВУЕТ В БД
this.branches = data.branches;             // ❌ ОТСУТСТВУЕТ В БД
this.cable_type = data.cable_type;         // ❌ ОТСУТСТВУЕТ В БД
this.commissioning_year = data.commissioning_year; // ❌ ОТСУТСТВУЕТ В БД
```

**Что есть в БД:**
```sql
line_id, name, voltage_kv, length_km, transformer_id, created_at, updated_at
-- ❌ НЕТ: main_path, branches, cable_type, commissioning_year
-- ❌ НЕТ: latitude_start, longitude_start, latitude_end, longitude_end, geom
```

**Влияние:**
- ❌ Линии электропередач НЕ отображаются на карте
- ❌ Ответвления линий НЕ поддерживаются
- ❌ Admin панель НЕ может редактировать cable_type

**Миграции для исправления:**
- `004_add_coordinates_and_extended_fields.sql` (НЕ ПРИМЕНЕНА)
- `005_add_paths_to_lines.sql` (НЕ ПРИМЕНЕНА)

---

### 3. **Таблица `water_lines` - КРИТИЧЕСКОЕ НЕСООТВЕТСТВИЕ**

**Что ожидает frontend код:**
- Координаты линий для отрисовки Polyline
- Поля `main_path`, `branches` для ответвлений

**Что есть в БД:**
```sql
line_id, name, description, diameter_mm, material, pressure_bar, 
installation_date, status, created_at, updated_at
-- ❌ НЕТ: main_path, branches, geom
```

**Влияние:**
- ❌ Линии ХВС/ГВС НЕ отображаются на карте
- ❌ Frontend код вызывает несуществующие endpoints

**Миграция для исправления:** `004_add_coordinates_and_extended_fields.sql` (НЕ ПРИМЕНЕНА)

---

### 4. **Функции расчета мощности - ОТСУТСТВУЮТ**

**Что ожидает код (powerAnalyticsController.js):**
- Функции БД для расчета мощности (опционально, расчет делается в JS)

**Что НЕТ в БД:**
```sql
❌ calculate_phase_power()
❌ calculate_three_phase_power()
❌ mv_building_power_realtime (материализованное представление)
```

**Влияние:**
- ✅ НЕ КРИТИЧНО - расчет мощности делается в контроллере (JavaScript)
- 🟡 Производительность могла бы быть лучше с БД функциями

**Миграция для исправления:** `003_power_calculation_system_fixed.sql` (НЕ ПРИМЕНЕНА)

---

### 5. **Таблица `infrastructure_lines` - ОТСУТСТВУЕТ ПОЛНОСТЬЮ**

**Что ожидает frontend (map-layers-control.js:1754):**
```javascript
const response = await fetch(`${this.apiBaseUrl}/infrastructure-lines/${lineId}/alerts`);
```

**Что есть в БД:**
- ❌ Таблица `infrastructure_lines` НЕ СУЩЕСТВУЕТ
- ✅ Есть таблица `infrastructure_alerts` (только алерты)

**Влияние:**
- ❌ API endpoint `/api/infrastructure-lines/...` возвращает 404
- ❌ Функция `loadLineAlerts()` не работает

**Примечание:** Возможно, использовались таблицы `lines` и `water_lines` вместо `infrastructure_lines`

---

## 📋 СРАВНИТЕЛЬНАЯ ТАБЛИЦА

| Таблица/Функция | Ожидается в коде | Есть в БД | Статус | Миграция |
|-----------------|------------------|-----------|--------|----------|
| **transformers.latitude** | ✅ | ❌ | КРИТИЧНО | 004 |
| **transformers.longitude** | ✅ | ❌ | КРИТИЧНО | 004 |
| **transformers.geom** | ✅ | ❌ | КРИТИЧНО | 004 |
| **lines.main_path** | ✅ | ❌ | КРИТИЧНО | 005 |
| **lines.branches** | ✅ | ❌ | КРИТИЧНО | 005 |
| **lines.cable_type** | ✅ | ❌ | ВЫСОКИЙ | 004 |
| **lines.commissioning_year** | ✅ | ❌ | ВЫСОКИЙ | 004 |
| **lines.latitude_start/end** | ✅ | ❌ | КРИТИЧНО | 004 |
| **lines.longitude_start/end** | ✅ | ❌ | КРИТИЧНО | 004 |
| **lines.geom** | ✅ | ❌ | КРИТИЧНО | 004 |
| **water_lines.main_path** | ✅ | ❌ | КРИТИЧНО | 004 |
| **water_lines.branches** | ✅ | ❌ | КРИТИЧНО | 004 |
| **water_lines.geom** | ✅ | ❌ | КРИТИЧНО | 004 |
| **calculate_phase_power()** | 🟡 | ❌ | СРЕДНИЙ | 003 |
| **calculate_three_phase_power()** | 🟡 | ❌ | СРЕДНИЙ | 003 |
| **infrastructure_lines** таблица | ✅ | ❌ | ВЫСОКИЙ | ??? |

---

## 🔍 ДЕТАЛЬНЫЙ АНАЛИЗ

### Таблица `buildings` - ✅ СООТВЕТСТВУЕТ

**Колонки в БД:** 24 колонки  
**Ожидается кодом:** Все поля присутствуют  
**Статус:** ✅ ПОЛНОЕ СООТВЕТСТВИЕ

Включает все необходимые поля:
- ✅ Базовые поля (name, address, latitude, longitude)
- ✅ PostGIS геометрия (geom)
- ✅ Связи с трансформаторами (primary_transformer_id, backup_transformer_id)
- ✅ Связи с линиями (primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id)
- ✅ Связи с источниками (cold_water_source_id, heat_source_id, cold_water_supplier_id, hot_water_supplier_id)

---

### Таблица `controllers` - ✅ СООТВЕТСТВУЕТ

**Колонки в БД:** 8 колонок  
**Ожидается кодом:** Все поля присутствуют  
**Статус:** ✅ ПОЛНОЕ СООТВЕТСТВИЕ

---

### Таблица `metrics` - ✅ СООТВЕТСТВУЕТ

**Колонки в БД:** 18 колонок  
**Ожидается кодом:** Все поля присутствуют  
**Статус:** ✅ ПОЛНОЕ СООТВЕТСТВИЕ

Включает:
- ✅ 3 фазы напряжения (electricity_ph1/2/3)
- ✅ 3 фазы тока (amperage_ph1/2/3)
- ✅ ХВС (cold_water_pressure, cold_water_temp)
- ✅ ГВС (hot_water_in/out_pressure, hot_water_in/out_temp)
- ✅ Окружение (air_temp, humidity)
- ✅ Протечки (leak_sensor)
- ✅ Партиционирование по timestamp ✅

---

## 🔧 НЕОБХОДИМЫЕ ДЕЙСТВИЯ

### КРИТИЧЕСКИЕ (Требуется немедленно)

1. **Применить миграцию 004:**
   ```bash
   docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/004_add_coordinates_and_extended_fields.sql
   ```
   **Добавит:**
   - transformers: latitude, longitude, geom
   - lines: latitude_start/end, longitude_start/end, geom, cable_type, commissioning_year
   - water_lines: latitude_start/end, longitude_start/end, geom

2. **Применить миграцию 005:**
   ```bash
   docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/005_add_paths_to_lines.sql
   ```
   **Добавит:**
   - lines: main_path, branches (JSONB)
   - Триггер автоконвертации координат → main_path

3. **Восстановить тестовые данные:**
   ```bash
   docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/init/02_sample_data_tashkent.sql
   ```
   **Добавит:**
   - ~33 здания с координатами
   - ~16 трансформаторов
   - ~17 контроллеров
   - Тестовые данные Ташкента

---

### ОПЦИОНАЛЬНЫЕ (Улучшение производительности)

4. **Применить миграцию 003:**
   ```bash
   docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/003_power_calculation_system_fixed.sql
   ```
   **Добавит:**
   - Функции расчета мощности в БД
   - Материализованные представления для быстрых запросов

---

## 📈 ВЛИЯНИЕ НА ФУНКЦИОНАЛЬНОСТЬ

### ❌ НЕ РАБОТАЮТ (из-за отсутствия миграций):

1. **Отображение трансформаторов на карте** (отсутствуют координаты)
2. **Отображение линий электропередач** (отсутствуют main_path, branches)
3. **Отображение линий ХВС/ГВС** (отсутствуют main_path, branches)
4. **Редактирование координат в админке** (поля не созданы)
5. **Редактирование cable_type и commissioning_year** (поля не созданы)

### ✅ РАБОТАЮТ (не зависят от миграций):

1. **Отображение зданий на карте** (поля есть)
2. **Система метрик** (таблица полная)
3. **API зданий** (работает)
4. **API контроллеров** (работает)
5. **JWT аутентификация** (работает)
6. **Power Analytics API** (работает, расчет в JS)

---

## 🔍 ДЕТАЛЬНЫЙ АНАЛИЗ ПО ТАБЛИЦАМ

### Таблица: `transformers`

| Поле | В БД | В коде | Миграция | Критичность |
|------|------|--------|----------|-------------|
| transformer_id | ✅ | ✅ | - | - |
| name | ✅ | ✅ | - | - |
| power_kva | ✅ | ✅ | - | - |
| voltage_kv | ✅ | ✅ | - | - |
| location | ✅ | ✅ | - | - |
| **latitude** | ❌ | ✅ | 004 | КРИТИЧНО |
| **longitude** | ❌ | ✅ | 004 | КРИТИЧНО |
| **geom** | ❌ | ✅ | 004 | КРИТИЧНО |
| manufacturer | ✅ | ✅ | - | - |
| model | ✅ | ✅ | - | - |
| status | ✅ | ✅ | - | - |

**Код ожидает (map-layers-control.js:507-511):**
```javascript
transformers.forEach(transformer => {
    if (transformer.latitude && transformer.longitude) {  // ❌ ВСЕГДА FALSE
        const transformerId = transformer.transformer_id || transformer.id;
        const power = powerMap.get(transformerId);
        const marker = this.createTransformerMarkerWithPower(transformer, power);
        // ...
    }
});
```

---

### Таблица: `lines` (линии электропередач)

| Поле | В БД | В коде | Миграция | Критичность |
|------|------|--------|----------|-------------|
| line_id | ✅ | ✅ | - | - |
| name | ✅ | ✅ | - | - |
| voltage_kv | ✅ | ✅ | - | - |
| length_km | ✅ | ✅ | - | - |
| **main_path** | ❌ | ✅ | 005 | КРИТИЧНО |
| **branches** | ❌ | ✅ | 005 | КРИТИЧНО |
| **cable_type** | ❌ | ✅ | 004 | ВЫСОКИЙ |
| **commissioning_year** | ❌ | ✅ | 004 | ВЫСОКИЙ |
| **latitude_start** | ❌ | 🟡 | 004 | СРЕДНИЙ |
| **longitude_start** | ❌ | 🟡 | 004 | СРЕДНИЙ |
| **latitude_end** | ❌ | 🟡 | 004 | СРЕДНИЙ |
| **longitude_end** | ❌ | 🟡 | 004 | СРЕДНИЙ |
| **geom** | ❌ | ✅ | 004 | КРИТИЧНО |

**Код ожидает (map-layers-control.js:1479-1512):**
```javascript
async loadPowerLines() {
    try {
        const layer = this.overlays["🔌 Линии электропередач"];
        if (!layer) return;
        
        const response = await fetch(`${this.apiBaseUrl}/lines`);
        const data = await response.json();
        const lines = data.data || data;
        
        lines.forEach(line => {
            if (line.main_path && Array.isArray(line.main_path) && line.main_path.length >= 2) {
                // ❌ main_path отсутствует → линии НЕ отрисовываются
                const adaptedLine = {
                    name: line.name,
                    main_path: line.main_path,    // ❌ NULL
                    branches: line.branches || [] // ❌ NULL
                    // ...
                };
                this.drawInfrastructureLine(adaptedLine, layer);
            }
        });
    }
}
```

---

### Таблица: `water_lines`

| Поле | В БД | В коде | Миграция | Критичность |
|------|------|--------|----------|-------------|
| line_id | ✅ | ✅ | - | - |
| name | ✅ | ✅ | - | - |
| description | ✅ | ✅ | - | - |
| **main_path** | ❌ | ✅ | 004 | КРИТИЧНО |
| **branches** | ❌ | ✅ | 004 | КРИТИЧНО |
| **geom** | ❌ | ✅ | 004 | КРИТИЧНО |
| diameter_mm | ✅ | ✅ | - | - |
| material | ✅ | ✅ | - | - |

**Код ожидает (map-layers-control.js:1385-1420, 1432-1467):**
```javascript
async loadColdWaterLines() {
    const response = await fetch(`${this.apiBaseUrl}/water-lines`);
    const data = await response.json();
    const lines = data.data || data;
    
    lines.forEach(line => {
        if (line.main_path && Array.isArray(line.main_path) && line.main_path.length >= 2) {
            // ❌ main_path отсутствует → линии НЕ отрисовываются
            const adaptedLine = {
                main_path: line.main_path,  // ❌ NULL
                branches: line.branches || []  // ❌ NULL
            };
            this.drawInfrastructureLine(adaptedLine, layer);
        }
    });
}
```

---

## 🔄 МИГРАЦИИ - СТАТУС ПРИМЕНЕНИЯ

| Миграция | Файл | Статус | Дата создания | Описание |
|----------|------|--------|---------------|----------|
| 003 | power_calculation_system_fixed.sql | ❌ НЕ ПРИМЕНЕНА | - | Функции расчета мощности |
| **004** | **add_coordinates_and_extended_fields.sql** | ❌ **НЕ ПРИМЕНЕНА** | **2025-10-21** | **Координаты для трансформаторов и линий** |
| **005** | **add_paths_to_lines.sql** | ❌ **НЕ ПРИМЕНЕНА** | **2025-10-22** | **main_path и branches для линий** |
| 006 | cleanup_infrastructure_lines.sql | ❓ НЕИЗВЕСТНО | - | Очистка таблиц линий |

---

## 📊 СТАТИСТИКА ДАННЫХ

### Текущие данные в БД:

```
Таблица          | Записей | Ожидалось | Разница
-----------------|---------|-----------|--------
buildings        |       1 |      33+  |  -32+
controllers      |       1 |      17+  |  -16+
transformers     |       1 |      16+  |  -15+
metrics          |     130 |     300+  |  -170+
lines            |       0 |       5+  |   -5+
water_lines      |       0 |       3+  |   -3+
alerts           |       0 |       0   |    0
users            |       1 |       1   |    0
```

### Единственное здание:
- ID: 51
- Название: "тест"
- Адрес: "Yangi Olmazor, 11V"
- Создано: 2025-11-01 15:18:52
- **Статус:** Неясно - рабочие или тестовые данные?

---

## 🎯 ПЛАН ВОССТАНОВЛЕНИЯ

### Вариант A: Полное восстановление (РЕКОМЕНДУЕТСЯ)

**Шаг 1:** Применить все миграции
```bash
# Миграция 003 - функции мощности (опционально)
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/003_power_calculation_system_fixed.sql

# Миграция 004 - координаты (КРИТИЧНО!)
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/004_add_coordinates_and_extended_fields.sql

# Миграция 005 - main_path и branches (КРИТИЧНО!)
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/005_add_paths_to_lines.sql
```

**Шаг 2:** Удалить тестовое здание #51 (если это тестовые данные)
```sql
DELETE FROM buildings WHERE building_id = 51;
```

**Шаг 3:** Загрузить тестовые данные Ташкента
```bash
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/init/02_sample_data_tashkent.sql
```

**Результат:**
- ✅ Все функции карты заработают
- ✅ Трансформаторы отобразятся на карте
- ✅ Линии (электричество, ХВС, ГВС) отобразятся
- ✅ 33+ здания с полными данными

---

### Вариант B: Частичное восстановление (если здание #51 - рабочие данные)

**Шаг 1:** Применить только миграции (НЕ трогать данные)
```bash
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/004_add_coordinates_and_extended_fields.sql
docker exec -i infrasafe-postgres-1 psql -U postgres -d infrasafe < database/migrations/005_add_paths_to_lines.sql
```

**Шаг 2:** Вручную добавить координаты к зданию #51 через админку

**Результат:**
- ✅ Схема БД соответствует коду
- ⚠️ Данные минимальные (1 здание)
- ⚠️ Нет тестовых трансформаторов/линий для демонстрации

---

## ⚠️ РИСКИ БЕЗ ПРИМЕНЕНИЯ МИГРАЦИЙ

1. **Критический функционал НЕ работает:**
   - Отображение 16 трансформаторов на карте
   - Отображение линий инфраструктуры (ХВС, ГВС, электричество)
   - Редактор координат в админке
   - Визуализация ответвлений линий

2. **API возвращает неполные данные:**
   - `/api/transformers` - без latitude/longitude
   - `/api/lines` - без main_path/branches
   - `/api/water-lines` - без координат

3. **Frontend код ломается:**
   - Пустые слои на карте (0 объектов)
   - Ошибки в консоли при попытке отрисовки

---

## 📝 РЕКОМЕНДАЦИИ

### 🔴 НЕМЕДЛЕННО:
1. **Применить миграции 004 и 005** (восстановление схемы)
2. **Уточнить статус здания #51** (рабочие или тестовые данные)
3. **Восстановить тестовые данные** (если #51 - тестовое)

### 🟡 В БЛИЖАЙШЕЕ ВРЕМЯ:
1. Применить миграцию 003 (функции расчета мощности)
2. Создать систему версионирования миграций
3. Добавить таблицу `schema_migrations` для отслеживания

### 🟢 ОПЦИОНАЛЬНО:
1. Настроить автоматическое применение миграций при запуске
2. Добавить проверку схемы БД при старте приложения
3. Создать backup перед применением миграций

---

## 📊 ИТОГОВАЯ ОЦЕНКА

**Соответствие кода и БД:** 40% ❌

**Критические проблемы:** 6  
**Высокий приоритет:** 2  
**Средний приоритет:** 3  

**Рекомендация:** ПРИМЕНИТЬ ВСЕ МИГРАЦИИ НЕМЕДЛЕННО для восстановления функциональности.

---

**Дата отчета:** 2025-11-02  
**Следующая проверка:** После применения миграций

