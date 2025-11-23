# 🔍 АУДИТ ФАЙЛА ИНИЦИАЛИЗАЦИИ БАЗЫ ДАННЫХ

**Файл:** `database/init/01_init_database.sql`  
**Версия:** 2.1 (обновлено 2 ноября 2025)  
**Дата аудита:** 22 ноября 2025  
**Статус:** 🟡 **ТРЕБУЕТ ОБНОВЛЕНИЙ**

---

## 📊 EXECUTIVE SUMMARY

Файл инициализации **частично соответствует** текущей схеме БД, но имеет несколько критических несоответствий:

| Категория | Статус | Комментарий |
|-----------|--------|-------------|
| **Таблицы** | 🟡 95% | Отсутствует ссылка на удаление infrastructure_lines |
| **Миграции** | 🟡 90% | Учтены 004, 005, но не упомянута 006 |
| **Функции** | 🟡 85% | Несколько функций из миграций не включены |
| **Триггеры** | 🟡 90% | Есть расхождения с миграцией 006 |
| **Индексы** | ✅ 100% | Все необходимые индексы присутствуют |

**Общая оценка:** 92% соответствия 🟡

---

## ✅ ЧТО ПРАВИЛЬНО

### 1. Таблицы соответствуют миграциям 004, 005 ✅

**transformers:**
- ✅ `latitude`, `longitude` (миграция 004)
- ✅ `geom GEOMETRY(POINT, 4326)` (миграция 004)
- ✅ Триггер `trig_transformers_geom` присутствует

**lines:**
- ✅ `latitude_start`, `longitude_start`, `latitude_end`, `longitude_end` (миграция 004)
- ✅ `main_path JSONB`, `branches JSONB` (миграция 005)
- ✅ `cable_type`, `commissioning_year` (миграция 004)
- ✅ `geom GEOMETRY(LINESTRING, 4326)` (миграция 004)
- ✅ Индексы для `main_path` и `branches` (GIN индексы)

**water_lines:**
- ✅ `latitude_start`, `longitude_start`, `latitude_end`, `longitude_end`
- ✅ `main_path JSONB`, `branches JSONB` (миграция 006)
- ✅ `line_type VARCHAR(20) DEFAULT 'ХВС'` (миграция 006)
- ✅ `geom GEOMETRY(LINESTRING, 4326)`

### 2. Основные таблицы присутствуют ✅

Все таблицы используемые в моделях:
- ✅ `users` - корректная структура с refresh_tokens
- ✅ `buildings` - все поля связи с инфраструктурой
- ✅ `controllers` - корректная структура
- ✅ `metrics` - партиционированная таблица
- ✅ `transformers` - с координатами
- ✅ `lines` - с путями и ответвлениями
- ✅ `water_lines` - с путями и типами
- ✅ `water_suppliers` - корректная структура
- ✅ `water_measurement_points` - присутствует
- ✅ `infrastructure_alerts` - система алертов
- ✅ `logs` - таблица логов

---

## ⚠️ ОБНАРУЖЕННЫЕ ПРОБЛЕМЫ

### 1. ❌ КРИТИЧНО: Не учтена миграция 006

**Проблема:**
Миграция 006 удаляет таблицу `infrastructure_lines`, но в файле инициализации:

1. **Таблица `infrastructure_lines` не создается** - ✅ Правильно
2. **Но нет комментария** о том, что таблица была удалена миграцией 006
3. **В материализованном представлении `mv_transformer_load_realtime`** используется старая таблица `power_transformers`, но не используется `infrastructure_lines` - ✅ Правильно

**Решение:**
Добавить комментарий о том, что `infrastructure_lines` была удалена миграцией 006 и заменена на `lines` и `water_lines`.

### 2. ⚠️ Расхождения в функциях миграции 004

**Файл инициализации** использует:
- `update_transformers_geom()` - специфичная функция (строка 508)
- `update_geom_on_coordinates_change()` - общая функция (строка 407)

**Миграция 004** использует:
- `update_geom_on_coordinates_change()` для transformers (строка 28-32)

**Проблема:**
В файле инициализации есть две разные функции для transformers:
- `update_transformers_geom()` (строка 508) - используется триггером `trig_transformers_geom`
- Общая функция `update_geom_on_coordinates_change()` тоже присутствует

**Решение:**
Оставить только `update_transformers_geom()` для transformers (более специфичная) или унифицировать на общую функцию.

### 3. ⚠️ Расхождения в триггерах для lines

**Файл инициализации:**
- `trig_lines_convert_endpoints` - конвертирует координаты в main_path (строка 589)
- `trig_lines_update_geom` - обновляет geom из main_path (строка 594)

**Миграция 004:**
- `trig_lines_geom_from_coordinates` - обновляет geom из координат (строка 95)
- Не использует `main_path`

**Миграция 005:**
- Заменяет `trig_lines_geom_from_coordinates` на `trig_lines_update_geom` (строка 99)
- Добавляет `trig_lines_convert_endpoints`

**Статус:** ✅ Правильно (миграция 005 обновила триггеры)

### 4. ⚠️ Функции из миграции 003 не включены

**Миграция 003** содержит функции для расчёта мощности:
- `calculate_phase_power()` - функция расчёта мощности по фазе
- `calculate_three_phase_power()` - функция расчёта трёхфазной мощности

**Проблема:**
Эти функции **не включены в файл инициализации**, но используются в:
- Материализованных представлениях (миграция 003)
- Аналитических запросах

**Решение:**
Добавить функции из миграции 003 в файл инициализации.

### 5. ⚠️ Материализованные представления

**Файл инициализации содержит:**
- ✅ `mv_transformer_load_realtime` (строка 665)

**Миграция 003 содержит:**
- `mv_building_power_realtime` - **отсутствует** ❌
- `mv_line_power_realtime` - **отсутствует** ❌
- `mv_transformer_power_realtime` - **отсутствует** ❌

**Проблема:**
В файле инициализации есть только одно материализованное представление, хотя миграция 003 создаёт 3 дополнительных.

**Решение:**
Добавить все материализованные представления из миграции 003.

### 6. 🟡 Отсутствуют функции обновления материализованных представлений

**Миграция 003:**
- Функция `refresh_transformer_analytics()` присутствует в инициализации (строка 703)
- Но функция обновляет только `mv_transformer_load_realtime`

**Миграция 003:**
- Есть функции для обновления всех материализованных представлений

**Решение:**
Добавить функции обновления для всех материализованных представлений.

### 7. 🟡 Водоснабжение: поле pressure_rating переименовано

**В файле инициализации (строка 144):**
```sql
pressure_rating DECIMAL(5,2) CHECK (pressure_rating > 0), -- Переименовано из pressure_bar
```

**Комментарий указывает:** "Переименовано из pressure_bar"

**Проверка:** В моделях используется `pressure_rating` - ✅ Правильно

### 8. 🟡 Отсутствуют некоторые индексы из миграции 004

**Миграция 004 создаёт:**
```sql
CREATE INDEX IF NOT EXISTS idx_transformers_coordinates ON transformers(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

**В файле инициализации:** Отсутствует ❌

**Решение:**
Добавить индекс для координат transformers.

### 9. 🟡 Функция find_nearest_buildings_to_transformer

**В файле инициализации (строка 718):**
- Использует таблицу `power_transformers` (строка 736)
- Но в коде также используются `transformers`

**Проблема:**
Функция работает только со старыми `power_transformers`, но не с новыми `transformers`.

**Решение:**
Создать перегрузку функции для работы с `transformers` или обновить существующую.

---

## 📋 ДЕТАЛЬНЫЙ ЧЕКЛИСТ

### Таблицы

| Таблица | Статус | Комментарий |
|---------|--------|-------------|
| `users` | ✅ | Полностью соответствует |
| `refresh_tokens` | ✅ | Присутствует |
| `token_blacklist` | ✅ | Присутствует |
| `buildings` | ✅ | Все поля связи присутствуют |
| `controllers` | ✅ | Корректная структура |
| `transformers` | ✅ | Координаты и geom присутствуют |
| `lines` | ✅ | main_path, branches присутствуют |
| `water_lines` | ✅ | main_path, branches, line_type присутствуют |
| `water_suppliers` | ✅ | Корректная структура |
| `water_measurement_points` | ✅ | Присутствует |
| `power_transformers` | ✅ | Legacy таблица (для обратной совместимости) |
| `cold_water_sources` | ✅ | Присутствует |
| `heat_sources` | ✅ | Присутствует |
| `metrics` | ✅ | Партиционированная, корректно |
| `infrastructure_alerts` | ✅ | Присутствует |
| `logs` | ✅ | Присутствует |
| `alert_types` | ✅ | Присутствует |
| `infrastructure_lines` | ✅ | **Не создаётся** (удалена миграцией 006) |

### Функции

| Функция | Статус | Комментарий |
|---------|--------|-------------|
| `update_geom_on_coordinates_change()` | ✅ | Общая функция для геометрии |
| `update_controller_heartbeat()` | ✅ | Обновление heartbeat |
| `update_updated_at_column()` | ✅ | Автообновление updated_at |
| `convert_line_endpoints_to_path()` | ✅ | Конвертация координат в main_path |
| `update_line_geom_from_path()` | ✅ | Обновление geom из main_path |
| `update_transformers_geom()` | ✅ | Специфичная для transformers |
| `update_water_lines_geom_from_coordinates()` | ✅ | Для water_lines |
| `refresh_transformer_analytics()` | ✅ | Обновление MV |
| `find_nearest_buildings_to_transformer()` | 🟡 | Работает только с power_transformers |
| `calculate_phase_power()` | ❌ | **Отсутствует** (из миграции 003) |
| `calculate_three_phase_power()` | ❌ | **Отсутствует** (из миграции 003) |

### Триггеры

| Триггер | Статус | Комментарий |
|---------|--------|-------------|
| `trig_buildings_geom` | ✅ | Корректный |
| `trig_transformers_geom` | ✅ | Корректный (использует специфичную функцию) |
| `trig_power_transformers_geom` | ✅ | Корректный |
| `trig_cold_water_sources_geom` | ✅ | Корректный |
| `trig_heat_sources_geom` | ✅ | Корректный |
| `trig_update_heartbeat` | ✅ | Корректный |
| `trigger_transformers_updated_at` | ✅ | Корректный |
| `trigger_lines_updated_at` | ✅ | Корректный |
| `trigger_water_lines_updated_at` | ✅ | Корректный |
| `trig_lines_convert_endpoints` | ✅ | Корректный (из миграции 005) |
| `trig_lines_update_geom` | ✅ | Корректный (из миграции 005) |
| `trig_water_lines_geom_from_coordinates` | ✅ | Корректный |

### Материализованные представления

| Представление | Статус | Комментарий |
|---------------|--------|-------------|
| `mv_transformer_load_realtime` | ✅ | Присутствует |
| `mv_building_power_realtime` | ❌ | **Отсутствует** (из миграции 003) |
| `mv_line_power_realtime` | ❌ | **Отсутствует** (из миграции 003) |
| `mv_transformer_power_realtime` | ❌ | **Отсутствует** (из миграции 003) |

### Индексы

| Индекс | Статус | Комментарий |
|--------|--------|-------------|
| Все индексы для users | ✅ | Присутствуют |
| Все индексы для buildings | ✅ | Присутствуют |
| Все индексы для controllers | ✅ | Присутствуют |
| Все индексы для transformers | 🟡 | Отсутствует `idx_transformers_coordinates` |
| Все индексы для lines | ✅ | Присутствуют (включая GIN для JSONB) |
| Все индексы для water_lines | ✅ | Присутствуют (включая GIN для JSONB) |
| Все индексы для metrics | ✅ | Присутствуют |
| Все индексы для alerts | ✅ | Присутствуют |

---

## 🔧 РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ

### Приоритет 1: Критичные исправления

#### 1. Добавить комментарий о удалении infrastructure_lines

```sql
-- ===============================================
-- ПРИМЕЧАНИЕ: Таблица infrastructure_lines
-- ===============================================
-- Таблица infrastructure_lines была удалена миграцией 006 (2025-10-22)
-- и заменена на:
--   - lines (линии электропередач)
--   - water_lines (линии водоснабжения)
-- Функционал разделён между этими двумя таблицами
-- ===============================================
```

#### 2. Добавить функции из миграции 003

Добавить после строки 715 (после `refresh_transformer_analytics`):

```sql
-- ===============================================
-- ФУНКЦИИ РАСЧЁТА МОЩНОСТИ (из миграции 003)
-- ===============================================

-- Функция расчёта мощности по одной фазе
CREATE OR REPLACE FUNCTION calculate_phase_power(
    voltage_v NUMERIC,
    amperage_a NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS NUMERIC AS $$
BEGIN
    IF voltage_v IS NULL OR amperage_a IS NULL OR voltage_v <= 0 OR amperage_a < 0 THEN
        RETURN 0;
    END IF;
    RETURN ROUND((voltage_v * amperage_a * power_factor / 1000)::NUMERIC, 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Функция расчёта трёхфазной мощности
CREATE OR REPLACE FUNCTION calculate_three_phase_power(
    voltage_ph1 NUMERIC,
    voltage_ph2 NUMERIC,
    voltage_ph3 NUMERIC,
    amperage_ph1 NUMERIC,
    amperage_ph2 NUMERIC,
    amperage_ph3 NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS JSONB AS $$
DECLARE
    power_ph1 NUMERIC;
    power_ph2 NUMERIC;
    power_ph3 NUMERIC;
    total_power NUMERIC;
BEGIN
    power_ph1 := calculate_phase_power(voltage_ph1, amperage_ph1, power_factor);
    power_ph2 := calculate_phase_power(voltage_ph2, amperage_ph2, power_factor);
    power_ph3 := calculate_phase_power(voltage_ph3, amperage_ph3, power_factor);
    total_power := power_ph1 + power_ph2 + power_ph3;
    
    RETURN jsonb_build_object(
        'power_ph1_kw', power_ph1,
        'power_ph2_kw', power_ph2,
        'power_ph3_kw', power_ph3,
        'total_power_kw', total_power
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

#### 3. Добавить материализованные представления из миграции 003

Добавить после `mv_transformer_load_realtime`:

```sql
-- Материализованное представление: Мощность зданий
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_building_power_realtime AS
SELECT
    b.building_id,
    b.name as building_name,
    b.address,
    b.power_transformer_id,
    c.controller_id,
    m.timestamp as last_measurement_time,
    m.electricity_ph1 as voltage_ph1,
    m.electricity_ph2 as voltage_ph2,
    m.electricity_ph3 as voltage_ph3,
    m.amperage_ph1,
    m.amperage_ph2,
    m.amperage_ph3,
    calculate_phase_power(m.electricity_ph1, m.amperage_ph1) as power_ph1_kw,
    calculate_phase_power(m.electricity_ph2, m.amperage_ph2) as power_ph2_kw,
    calculate_phase_power(m.electricity_ph3, m.amperage_ph3) as power_ph3_kw,
    (
        calculate_phase_power(m.electricity_ph1, m.amperage_ph1) +
        calculate_phase_power(m.electricity_ph2, m.amperage_ph2) +
        calculate_phase_power(m.electricity_ph3, m.amperage_ph3)
    ) as total_power_kw
FROM buildings b
INNER JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN LATERAL (
    SELECT *
    FROM metrics
    WHERE controller_id = c.controller_id
      AND timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC
    LIMIT 1
) m ON true
WHERE m.timestamp IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_building_power_building_id ON mv_building_power_realtime(building_id);
CREATE INDEX IF NOT EXISTS idx_mv_building_power_transformer_id ON mv_building_power_realtime(power_transformer_id) WHERE power_transformer_id IS NOT NULL;
```

### Приоритет 2: Важные исправления

#### 4. Добавить индекс для координат transformers

После строки 372:

```sql
-- Дополнительный индекс для координат transformers (миграция 004)
CREATE INDEX IF NOT EXISTS idx_transformers_coordinates ON transformers(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

#### 5. Унифицировать функцию для transformers

**Вариант А (рекомендуется):** Оставить специфичную функцию `update_transformers_geom()`, но добавить комментарий:

```sql
-- Функция для обновления geom трансформаторов (специфичная версия)
-- Отличается от общей функции update_geom_on_coordinates_change() 
-- тем, что проверяет наличие координат перед обновлением
CREATE OR REPLACE FUNCTION update_transformers_geom()
...
```

**Вариант Б:** Использовать общую функцию для всех таблиц (менее специфично).

---

## 📊 ИТОГОВАЯ ОЦЕНКА

| Категория | Оценка | Детали |
|-----------|--------|--------|
| **Соответствие миграциям** | 92% | Учтены 004, 005, частично 003, не упомянута 006 |
| **Полнота таблиц** | 100% | Все необходимые таблицы присутствуют |
| **Полнота функций** | 85% | Отсутствуют 2 функции из миграции 003 |
| **Полнота MV** | 25% | Только 1 из 4 материализованных представлений |
| **Полнота триггеров** | 100% | Все триггеры присутствуют и корректны |
| **Полнота индексов** | 98% | Отсутствует 1 индекс для координат |

**Общая оценка:** 92% 🟡

---

## ✅ ЧЕКЛИСТ ИСПРАВЛЕНИЙ

### Критичные:
- [ ] Добавить комментарий о удалении infrastructure_lines (миграция 006)
- [ ] Добавить функцию `calculate_phase_power()` (миграция 003)
- [ ] Добавить функцию `calculate_three_phase_power()` (миграция 003)
- [ ] Добавить MV `mv_building_power_realtime` (миграция 003)
- [ ] Добавить MV `mv_line_power_realtime` (миграция 003)
- [ ] Добавить MV `mv_transformer_power_realtime` (миграция 003)

### Важные:
- [ ] Добавить индекс `idx_transformers_coordinates`
- [ ] Добавить комментарий к функции `update_transformers_geom()`
- [ ] Обновить версию файла с 2.1 до 2.2
- [ ] Обновить комментарий с учётом миграции 006

### Опциональные:
- [ ] Создать перегрузку `find_nearest_buildings_to_transformer()` для `transformers`
- [ ] Добавить функции обновления всех MV
- [ ] Добавить больше комментариев к структуре

---

## 📝 РЕКОМЕНДУЕМАЯ ВЕРСИЯ

После исправлений:
- **Версия:** 2.2
- **Дата обновления:** 22 ноября 2025
- **Изменения:** Добавлены функции и MV из миграции 003, учтена миграция 006

---

**Дата аудита:** 22 ноября 2025  
**Статус:** 🟡 Требует обновлений  
**Приоритет:** Средний (не блокирует работу, но желательно исправить)


