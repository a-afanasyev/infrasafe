# 📊 ВЫГРУЗКА СТРУКТУРЫ БАЗЫ ДАННЫХ

**Дата:** 23 ноября 2025  
**База данных:** infrasafe  
**Версия PostgreSQL:** 15.4  
**Версия PostGIS:** 3.3.4

---

## 📋 ОГЛАВЛЕНИЕ

1. [Таблицы](#таблицы)
2. [Материализованные представления](#материализованные-представления)
3. [Функции](#функции)
4. [Триггеры](#триггеры)
5. [Представления](#представления)

---

## 📊 ТАБЛИЦЫ

### Список всех таблиц в схеме `public`:

1. `alert_types` - Типы оповещений
2. `alerts` - Таблица алертов (legacy система)
3. `analytics_history` - Партиционированная таблица для истории аналитики
   - `analytics_history_current` - Партиция текущего месяца
   - `analytics_history_prev` - Партиция предыдущего месяца
4. `buildings` - Здания
5. `cold_water_sources` - Источники холодной воды
6. `controllers` - Контроллеры
7. `heat_sources` - Источники тепла
8. `infrastructure_alerts` - Алерты инфраструктуры (основная система)
9. `lines` - Линии электропередач
10. `logs` - Логи системы
11. `metrics` - Партиционированная таблица метрик
    - `metrics_current_month` - Партиция текущего месяца
    - `metrics_prev_month` - Партиция предыдущего месяца
    - `metrics_2025_11` - Дополнительная партиция (ноябрь 2025)
12. `power_transformers` - Трансформаторы (legacy)
13. `refresh_tokens` - Refresh токены для аутентификации
14. `spatial_ref_sys` - Системная таблица PostGIS
15. `token_blacklist` - Черный список токенов
16. `transformers` - Трансформаторы (новая система)
17. `users` - Пользователи системы
18. `water_lines` - Линии водоснабжения
19. `water_measurement_points` - Точки измерения воды
20. `water_suppliers` - Поставщики воды

**Всего таблиц:** 25 (включая партиции и системные)

---

## 📈 МАТЕРИАЛИЗОВАННЫЕ ПРЕДСТАВЛЕНИЯ

### 1. `mv_transformer_load_realtime`

**Описание:** Загрузка трансформаторов в реальном времени

**Колонки:**
- `id` (character varying(50))
- `name` (character varying(100))
- `capacity_kva` (numeric(8,2))
- `status` (character varying(20))
- `latitude` (numeric(9,6))
- `longitude` (numeric(9,6))
- `buildings_count` (bigint)
- `controllers_count` (bigint)
- `active_controllers_count` (bigint)
- `avg_total_voltage` (numeric)
- `avg_total_amperage` (numeric)
- `load_percent` (numeric)
- `last_metric_time` (timestamp with time zone)
- `recent_metrics_count` (bigint)

**Индексы:**
- `idx_mv_transformer_load_id` (UNIQUE, btree) - на поле `id`
- `idx_mv_transformer_load_percent` (btree DESC) - на поле `load_percent`
- `idx_mv_transformer_load_status` (btree) - на поле `status`

**Определение:**
```sql
SELECT 
    pt.id,
    pt.name,
    pt.capacity_kva,
    pt.status,
    pt.latitude,
    pt.longitude,
    count(DISTINCT b.building_id) AS buildings_count,
    count(DISTINCT c.controller_id) AS controllers_count,
    count(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) AS active_controllers_count,
    avg(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) AS avg_total_voltage,
    avg(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) AS avg_total_amperage,
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, avg(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / pt.capacity_kva * 100)
        ELSE 0
    END AS load_percent,
    max(m.timestamp) AS last_metric_time,
    count(CASE WHEN m.timestamp > (now() - '01:00:00'::interval) THEN 1 END) AS recent_metrics_count
FROM power_transformers pt
LEFT JOIN buildings b ON pt.id::text = b.power_transformer_id::text
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id 
    AND m.timestamp > (now() - '24:00:00'::interval)
GROUP BY pt.id, pt.name, pt.capacity_kva, pt.status, pt.latitude, pt.longitude;
```

---

## 🔧 ФУНКЦИИ

### Пользовательские функции в схеме `public`:

1. **`archive_daily_analytics()`**
   - **Тип:** FUNCTION
   - **Возвращает:** void
   - **Описание:** Архивирует ежедневную аналитику трансформаторов

2. **`convert_line_endpoints_to_path()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Конвертирует координаты начала/конца линии в main_path

3. **`find_nearest_buildings_to_transformer(transformer_id_param VARCHAR, radius_meters INTEGER)`**
   - **Тип:** FUNCTION
   - **Возвращает:** TABLE(building_id, building_name, distance_meters)
   - **Описание:** Находит ближайшие здания к трансформатору в заданном радиусе

4. **`refresh_transformer_analytics()`**
   - **Тип:** FUNCTION
   - **Возвращает:** void
   - **Описание:** Обновляет материализованное представление загрузки трансформаторов

5. **`update_controller_heartbeat()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Обновляет last_heartbeat в контроллерах при вставке метрик

6. **`update_geom_on_coordinates_change()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Обновляет геометрию при изменении координат

7. **`update_line_geom_from_path()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Обновляет геометрию линии из main_path

8. **`update_transformers_geom()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Обновляет геометрию трансформаторов при изменении координат

9. **`update_updated_at_column()`**
   - **Тип:** TRIGGER FUNCTION
   - **Возвращает:** trigger
   - **Описание:** Автоматически обновляет поле updated_at

10. **`update_water_lines_geom_from_coordinates()`**
    - **Тип:** TRIGGER FUNCTION
    - **Возвращает:** trigger
    - **Описание:** Обновляет геометрию линий водоснабжения из координат начала/конца

---

## ⚡ ТРИГГЕРЫ

### Список всех триггеров:

1. **`trig_buildings_geom`** на таблице `buildings`
   - **Функция:** `update_geom_on_coordinates_change()`
   - **Тип:** BEFORE INSERT OR UPDATE OF latitude, longitude

2. **`trig_cold_water_sources_geom`** на таблице `cold_water_sources`
   - **Функция:** `update_geom_on_coordinates_change()`
   - **Тип:** BEFORE INSERT OR UPDATE OF latitude, longitude

3. **`trig_heat_sources_geom`** на таблице `heat_sources`
   - **Функция:** `update_geom_on_coordinates_change()`
   - **Тип:** BEFORE INSERT OR UPDATE OF latitude, longitude

4. **`trig_lines_convert_endpoints`** на таблице `lines`
   - **Функция:** `convert_line_endpoints_to_path()`
   - **Тип:** BEFORE INSERT OR UPDATE

5. **`trig_lines_update_geom`** на таблице `lines`
   - **Функция:** `update_line_geom_from_path()`
   - **Тип:** BEFORE INSERT OR UPDATE

6. **`trigger_lines_updated_at`** на таблице `lines`
   - **Функция:** `update_updated_at_column()`
   - **Тип:** BEFORE UPDATE

7. **`trig_update_heartbeat`** на таблицах `metrics` и всех её партициях
   - **Функция:** `update_controller_heartbeat()`
   - **Тип:** AFTER INSERT
   - **Применяется к:** metrics, metrics_2025_11, metrics_current_month, metrics_prev_month

8. **`trig_power_transformers_geom`** на таблице `power_transformers`
   - **Функция:** `update_geom_on_coordinates_change()`
   - **Тип:** BEFORE INSERT OR UPDATE OF latitude, longitude

9. **`trig_transformers_geom`** на таблице `transformers`
   - **Функция:** `update_transformers_geom()`
   - **Тип:** BEFORE INSERT OR UPDATE OF latitude, longitude
   - **Условие:** WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)

10. **`trigger_transformers_updated_at`** на таблице `transformers`
    - **Функция:** `update_updated_at_column()`
    - **Тип:** BEFORE UPDATE

11. **`trig_water_lines_geom_from_coordinates`** на таблице `water_lines`
    - **Функция:** `update_water_lines_geom_from_coordinates()`
    - **Тип:** BEFORE INSERT OR UPDATE OF latitude_start, longitude_start, latitude_end, longitude_end

12. **`trigger_water_lines_updated_at`** на таблице `water_lines`
    - **Функция:** `update_updated_at_column()`
    - **Тип:** BEFORE UPDATE

13. **`trigger_water_measurement_points_updated_at`** на таблице `water_measurement_points`
    - **Функция:** `update_updated_at_column()`
    - **Тип:** BEFORE UPDATE

14. **`trigger_water_suppliers_updated_at`** на таблице `water_suppliers`
    - **Функция:** `update_updated_at_column()`
    - **Тип:** BEFORE UPDATE

**Всего триггеров:** 17 (включая триггеры на партициях)

---

## 👁️ ПРЕДСТАВЛЕНИЯ (VIEWS)

1. **`geography_columns`** - Системное представление PostGIS
2. **`geometry_columns`** - Системное представление PostGIS

---

## 📝 ПРИМЕЧАНИЯ

- Все пользовательские функции используют язык **plpgsql**
- Все триггерные функции возвращают тип **trigger**
- Материализованное представление обновляется функцией `refresh_transformer_analytics()`
- Партиционирование используется для таблиц `metrics` и `analytics_history`
- PostGIS расширение активно и используется для работы с географическими данными

---

**Экспорт выполнен:** 23 ноября 2025  
**Полная схема сохранена в:** `database/export/schema_export_*.sql`

