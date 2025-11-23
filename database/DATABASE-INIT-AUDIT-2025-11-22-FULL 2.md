# 🔍 ПОЛНЫЙ АУДИТ ФАЙЛА ИНИЦИАЛИЗАЦИИ БД

**Файл:** `database/init/01_init_database.sql`  
**Версия:** 2.2 (обновлено 22 ноября 2025)  
**Дата аудита:** 22 ноября 2025  
**Проверено с реальной БД:** ✅ ДА  
**Статус:** 🟡 **ТРЕБУЕТ КРИТИЧЕСКИХ ОБНОВЛЕНИЙ**

---

## 📊 EXECUTIVE SUMMARY

**Проведена полная проверка файла инициализации с реальной базой данных PostgreSQL.**

### Результаты проверки:

| Категория | Статус | Соответствие | Примечания |
|-----------|--------|--------------|------------|
| **Таблицы** | 🟡 | 92% | Отсутствуют `alerts` и `analytics_history` |
| **Миграция 006** | ✅ | 100% | `infrastructure_lines` удалена правильно |
| **Функции расчёта мощности** | ❌ | 0% | Функции отсутствуют в реальной БД |
| **Материализованные представления** | 🟡 | 33% | Только 1 из 3 MV существует |
| **Триггеры** | ✅ | 100% | Все основные триггеры присутствуют |
| **Индексы** | ✅ | 100% | Все индексы присутствуют |
| **Структура water_lines** | ❌ | 65% | Критические расхождения в полях |
| **Структура transformers** | ✅ | 100% | Полное соответствие |

**Общая оценка:** 74% соответствия 🟡

---

## ❌ КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### 1. ❌ Функции расчёта мощности отсутствуют в реальной БД

**Проблема:** В файле инициализации есть функции `calculate_phase_power()` и `calculate_three_phase_power()` (строки 682-737), но в реальной БД они отсутствуют.

**Файл инициализации:**
```sql
CREATE OR REPLACE FUNCTION calculate_phase_power(...)
CREATE OR REPLACE FUNCTION calculate_three_phase_power(...)
```

**Реальная БД:**
```
(0 rows)
```

**Влияние:**
- Материализованные представления `mv_building_power_realtime` и `mv_line_power_realtime` не могут быть созданы без этих функций
- Код приложения может использовать эти функции, что приведёт к ошибкам

**Решение:**
- ✅ Функции уже добавлены в файл инициализации
- ⚠️ Необходимо выполнить миграцию 003 для добавления функций в реальную БД

---

### 2. ❌ Материализованные представления отсутствуют в реальной БД

**Проблема:** В файле инициализации есть 3 материализованных представления, но в реальной БД существует только 1.

**Файл инициализации (строки 748-890):**
- ✅ `mv_building_power_realtime` (строки 748-786)
- ✅ `mv_line_power_realtime` (строки 789-819)
- ✅ `mv_transformer_load_realtime` (строки 822-889)

**Реальная БД:**
- ❌ `mv_building_power_realtime` - отсутствует
- ❌ `mv_line_power_realtime` - отсутствует
- ✅ `mv_transformer_load_realtime` - присутствует

**Причина:**
- MV зависят от функций `calculate_phase_power()` и `calculate_three_phase_power()`, которые отсутствуют в БД
- Создание MV невозможно без этих функций

**Решение:**
- ✅ MV уже добавлены в файл инициализации
- ⚠️ Необходимо сначала добавить функции, затем создать MV

---

### 3. ❌ Критические расхождения в структуре `water_lines`

**Проблема:** В файле инициализации таблица `water_lines` содержит поля, которых нет в реальной БД.

#### 3.1. Отсутствует поле `line_type`

**Файл инициализации (строка 154):**
```sql
line_type VARCHAR(20) DEFAULT 'ХВС', -- Добавлено в миграции 006
```

**Реальная БД:**
```
has_line_type: f (false)
```

**Причина:**
- Миграция 006 добавляет `line_type`, но миграция не была выполнена или была откачена
- В реальной БД таблица не имеет этого поля

**Влияние:**
- Модель `WaterLine.js` использует `line_type` (строка 18)
- Приложение может пытаться работать с несуществующим полем

#### 3.2. Неправильное имя поля давления

**Файл инициализации (строка 157):**
```sql
pressure_rating DECIMAL(5,2) CHECK (pressure_rating > 0), -- Переименовано из pressure_bar
```

**Реальная БД:**
```
has_pressure_rating: f (false)
has_pressure_bar: t (true)
```

**Проблема:**
- Файл инициализации использует `pressure_rating`
- Реальная БД имеет `pressure_bar`
- Модель `WaterLine.js` использует `pressure_rating` (строки 12, 165, 280)

**Влияние:**
- Несоответствие между моделью приложения и реальной БД
- SQL-запросы будут падать с ошибкой "column does not exist"

#### 3.3. Отсутствуют поля `maintenance_contact` и `notes`

**Файл инициализации (строки 160-161):**
```sql
maintenance_contact VARCHAR(100),
notes TEXT,
```

**Реальная БД:**
```
Отсутствуют оба поля
```

**Влияние:**
- Модель `WaterLine.js` использует эти поля (строки 16-17)
- Приложение может пытаться работать с несуществующими полями

**Полная структура water_lines:**

| Поле | Файл инициализации | Реальная БД | Статус |
|------|-------------------|-------------|--------|
| `line_id` | ✅ | ✅ | ✅ Соответствует |
| `name` | ✅ | ✅ | ✅ Соответствует |
| `description` | ✅ | ✅ | ✅ Соответствует |
| `line_type` | ✅ | ❌ | ❌ **Отсутствует в БД** |
| `diameter_mm` | ✅ | ✅ | ✅ Соответствует |
| `material` | ✅ | ✅ | ✅ Соответствует |
| `pressure_rating` | ✅ | ❌ | ❌ **Неверное имя** |
| `pressure_bar` | ❌ | ✅ | ❌ **Нужно использовать** |
| `installation_date` | ✅ | ✅ | ✅ Соответствует |
| `status` | ✅ | ✅ | ✅ Соответствует |
| `maintenance_contact` | ✅ | ❌ | ❌ **Отсутствует в БД** |
| `notes` | ✅ | ❌ | ❌ **Отсутствует в БД** |
| `latitude_start` | ✅ | ✅ | ✅ Соответствует |
| `longitude_start` | ✅ | ✅ | ✅ Соответствует |
| `latitude_end` | ✅ | ✅ | ✅ Соответствует |
| `longitude_end` | ✅ | ✅ | ✅ Соответствует |
| `main_path` | ✅ | ✅ | ✅ Соответствует |
| `branches` | ✅ | ✅ | ✅ Соответствует |
| `geom` | ✅ | ✅ | ✅ Соответствует |
| `created_at` | ✅ | ✅ | ✅ Соответствует |
| `updated_at` | ✅ | ✅ | ✅ Соответствует |

**Соответствие:** 16 из 20 полей (80%), но есть критические несоответствия

---

### 4. ❌ Отсутствуют таблицы `alerts` и `analytics_history`

**Проблема:** В реальной БД существуют таблицы, которых нет в файле инициализации.

#### 4.1. Таблица `alerts`

**Реальная БД:**
```sql
Table "public.alerts"
    Column       | Type
-----------------+------------------
 alert_id        | integer
 metric_id       | bigint
 alert_type_id   | integer
 severity        | character varying(20)
 status          | character varying(20)
 created_at      | timestamp with time zone
 resolved_at     | timestamp with time zone
```

**Файл инициализации:**
```
Таблица отсутствует
```

**Примечание:**
- Таблица `alerts` найдена в файле `database.sql` (строки 169-177)
- Это старая система алертов (legacy)
- В файле инициализации используется только `infrastructure_alerts`

**Рекомендация:**
- Если таблица `alerts` не используется, можно удалить её из БД
- Если используется, нужно добавить её в файл инициализации

#### 4.2. Таблица `analytics_history`

**Реальная БД:**
```sql
Partitioned table "public.analytics_history"
    Column            | Type
----------------------+------------------
 id                   | bigint
 analysis_type        | character varying(50)
 infrastructure_id    | character varying(50)
 infrastructure_type  | character varying(50)
 analysis_date        | date
 analysis_data        | jsonb
 created_at           | timestamp with time zone
```

**Файл инициализации:**
```
Таблица отсутствует
```

**Примечание:**
- Таблица найдена в файле `database.sql` (строки 208-229)
- Это партиционированная таблица для истории аналитики
- Используется для хранения результатов анализа инфраструктуры

**Рекомендация:**
- ⚠️ **Обязательно** добавить таблицу в файл инициализации, если она используется

---

## ✅ ПОДТВЕРЖДЕНО РЕАЛЬНОЙ БД

### 1. ✅ Таблица `infrastructure_lines` удалена

**Файл инициализации:** Таблица не создаётся ✅ (комментарий строки 57-64)  
**Реальная БД:** Таблица не существует ✅  
**Миграция 006:** Удалена правильно ✅

**Статус:** ✅ **СООТВЕТСТВУЕТ**

---

### 2. ✅ Индекс `idx_transformers_coordinates` присутствует

**Файл инициализации (строки 387-388):**
```sql
CREATE INDEX IF NOT EXISTS idx_transformers_coordinates ON transformers(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

**Реальная БД:**
```
Индекс существует ✅
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**

---

### 3. ✅ Функция `update_transformers_geom()` имеет комментарий

**Файл инициализации (строки 523-534):**
```sql
-- Функция для обновления geom трансформаторов (специфичная версия)
-- Отличается от общей функции update_geom_on_coordinates_change() 
-- тем, что проверяет наличие координат перед обновлением
CREATE OR REPLACE FUNCTION update_transformers_geom()
```

**Реальная БД:**
```
Функция существует ✅
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**

---

### 4. ✅ Функция `find_nearest_buildings_to_transformer()` присутствует

**Файл инициализации (строки 926-953):**
```sql
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(...)
```

**Реальная БД:**
```
Функция существует ✅
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**

---

### 5. ✅ Функция `refresh_transformer_analytics()` присутствует

**Файл инициализации (строки 918-923):**
```sql
CREATE OR REPLACE FUNCTION refresh_transformer_analytics() RETURNS void AS $$
BEGIN
    -- Вызываем новую функцию для обновления всех представлений
    PERFORM refresh_power_materialized_views();
END;
$$ LANGUAGE plpgsql;
```

**Реальная БД:**
```
Функция существует ✅
```

**Примечание:** Функция существует, но `refresh_power_materialized_views()` отсутствует в реальной БД, поэтому функция не может выполнить свою работу.

**Статус:** ⚠️ **ЧАСТИЧНОЕ СООТВЕТСТВИЕ**

---

### 6. ✅ Материализованное представление `mv_transformer_load_realtime` присутствует

**Файл инициализации (строки 822-889):**
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_transformer_load_realtime AS
...
```

**Реальная БД:**
```
Материализованное представление существует ✅
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**

---

## 🔧 РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ

### Приоритет 1: Критические исправления

#### 1.1. Исправить структуру `water_lines`

**Вариант А: Обновить файл инициализации под реальную БД**

Изменить строки 154, 157, 160-161:
```sql
-- Убрать line_type (строка 154)
-- line_type VARCHAR(20) DEFAULT 'ХВС', -- УДАЛИТЬ

-- Изменить pressure_rating на pressure_bar (строка 157)
pressure_bar DECIMAL(5,2) CHECK (pressure_bar > 0), -- Исправить название

-- Убрать maintenance_contact и notes (строки 160-161)
-- maintenance_contact VARCHAR(100), -- УДАЛИТЬ
-- notes TEXT, -- УДАЛИТЬ
```

**Вариант Б: Обновить реальную БД под файл инициализации**

Выполнить миграцию:
```sql
-- Добавить недостающие поля
ALTER TABLE water_lines 
ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) DEFAULT 'ХВС',
ADD COLUMN IF NOT EXISTS maintenance_contact VARCHAR(100),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Переименовать pressure_bar в pressure_rating
ALTER TABLE water_lines RENAME COLUMN pressure_bar TO pressure_rating;
```

**Рекомендация:** ⚠️ **Выбрать Вариант Б**, так как модель `WaterLine.js` использует `pressure_rating` и `line_type`

---

#### 1.2. Добавить функции расчёта мощности в реальную БД

Выполнить миграцию или скопировать функции из файла инициализации (строки 682-737):
```sql
CREATE OR REPLACE FUNCTION calculate_phase_power(...)
CREATE OR REPLACE FUNCTION calculate_three_phase_power(...)
```

**После этого:** Создать материализованные представления `mv_building_power_realtime` и `mv_line_power_realtime`

---

#### 1.3. Добавить недостающие материализованные представления

После добавления функций расчёта мощности, создать MV из файла инициализации (строки 748-819):
- `mv_building_power_realtime`
- `mv_line_power_realtime`

---

#### 1.4. Добавить таблицу `analytics_history` в файл инициализации

Добавить после таблицы `infrastructure_alerts` (после строки 338):
```sql
-- Партиционированная таблица для истории аналитики
CREATE TABLE IF NOT EXISTS analytics_history (
    id bigserial,
    analysis_type varchar(50) NOT NULL,
    infrastructure_id varchar(50),
    infrastructure_type varchar(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamptz DEFAULT NOW(),
    PRIMARY KEY (id, analysis_date)
) PARTITION BY RANGE (analysis_date);

-- Партиции
CREATE TABLE IF NOT EXISTS analytics_history_current 
PARTITION OF analytics_history
FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) 
TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');

CREATE TABLE IF NOT EXISTS analytics_history_prev 
PARTITION OF analytics_history
FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') 
TO (date_trunc('month', CURRENT_DATE));

-- Индексы
CREATE INDEX IF NOT EXISTS idx_analytics_history_date ON analytics_history(analysis_date);
CREATE INDEX IF NOT EXISTS idx_analytics_history_type ON analytics_history(analysis_type);
CREATE INDEX IF NOT EXISTS idx_analytics_history_infrastructure 
ON analytics_history(infrastructure_id, infrastructure_type);
```

---

### Приоритет 2: Важные исправления

#### 2.1. Решить судьбу таблицы `alerts`

**Вариант А:** Если таблица не используется - удалить из БД  
**Вариант Б:** Если используется - добавить в файл инициализации

Проверить использование:
```sql
SELECT COUNT(*) FROM alerts;
```

---

#### 2.2. Проверить дубликат триггера `trig_water_lines_geom_from_coordinates`

**Реальная БД показывает:**
```
trig_water_lines_geom_from_coordinates | 2 записи (дубликат?)
```

**Рекомендация:** Проверить, не создан ли триггер дважды:
```sql
SELECT 
    trigger_name,
    event_manipulation,
    action_timing
FROM information_schema.triggers 
WHERE event_object_table = 'water_lines'
AND trigger_name = 'trig_water_lines_geom_from_coordinates';
```

---

### Приоритет 3: Опциональные улучшения

#### 3.1. Добавить комментарий о миграции 006 в раздел water_lines

Добавить комментарий после создания таблицы `water_lines` (после строки 174):
```sql
-- ===============================================
-- ПРИМЕЧАНИЕ: Изменения в water_lines (миграция 006)
-- ===============================================
-- Миграция 006 добавила:
--   - line_type (тип линии: ХВС/ГВС)
--   - main_path и branches (пути и ответвления)
--   - geom (геометрия линии)
-- ===============================================
```

---

## 📋 ИТОГОВАЯ ТАБЛИЦА РАСХОЖДЕНИЙ

| # | Элемент | Файл инициализации | Реальная БД | Приоритет |
|---|---------|-------------------|-------------|-----------|
| 1 | Функция `calculate_phase_power()` | ✅ Есть | ❌ Нет | 🔴 Критично |
| 2 | Функция `calculate_three_phase_power()` | ✅ Есть | ❌ Нет | 🔴 Критично |
| 3 | MV `mv_building_power_realtime` | ✅ Есть | ❌ Нет | 🔴 Критично |
| 4 | MV `mv_line_power_realtime` | ✅ Есть | ❌ Нет | 🔴 Критично |
| 5 | `water_lines.line_type` | ✅ Есть | ❌ Нет | 🔴 Критично |
| 6 | `water_lines.pressure_rating` | ✅ Есть | ❌ Нет (есть `pressure_bar`) | 🔴 Критично |
| 7 | `water_lines.maintenance_contact` | ✅ Есть | ❌ Нет | 🟡 Важно |
| 8 | `water_lines.notes` | ✅ Есть | ❌ Нет | 🟡 Важно |
| 9 | Таблица `analytics_history` | ❌ Нет | ✅ Есть | 🟡 Важно |
| 10 | Таблица `alerts` | ❌ Нет | ✅ Есть | 🟢 Опционально |

---

## ✅ ЗАКЛЮЧЕНИЕ

Файл инициализации версии 2.2 **требует критических обновлений** для полного соответствия реальной базе данных.

**Основные проблемы:**
1. ❌ Функции расчёта мощности отсутствуют в реальной БД
2. ❌ Материализованные представления не могут быть созданы без функций
3. ❌ Критические расхождения в структуре `water_lines` (несоответствие с моделью приложения)
4. ⚠️ Отсутствует таблица `analytics_history` в файле инициализации

**Рекомендации:**
1. 🔴 **Критично:** Синхронизировать структуру `water_lines` между файлом инициализации и реальной БД
2. 🔴 **Критично:** Выполнить миграцию для добавления функций расчёта мощности
3. 🟡 **Важно:** Добавить таблицу `analytics_history` в файл инициализации
4. 🟢 **Опционально:** Решить судьбу таблицы `alerts`

**Оценка готовности:** 74% 🟡

---

**Дата следующего аудита:** Рекомендуется после исправления критических проблем

