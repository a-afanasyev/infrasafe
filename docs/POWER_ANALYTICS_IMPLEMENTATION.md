# 📊 СИСТЕМА РАСЧЁТА МОЩНОСТИ - РЕАЛИЗАЦИЯ

## Обзор

Реализована комплексная система расчёта и анализа потребляемой мощности с детализацией по фазам для зданий, линий электропередач и трансформаторов.

## 🔬 Физические формулы

### Мощность по одной фазе
```
P = U × I × cos(φ) / 1000  (кВт)
```
Где:
- U — напряжение (В)
- I — ток (А)
- cos(φ) = 0.85 (коэффициент мощности для жилых зданий)

### Общая мощность здания
```
P_total = P_ph1 + P_ph2 + P_ph3  (кВт)
```

### Загрузка трансформатора
```
Load% = (P_consumed / P_capacity) × 100%
```

### Дисбаланс фаз
```
Imbalance% = MAX(|Load_ph1 - Avg|, |Load_ph2 - Avg|, |Load_ph3 - Avg|)
```

## 📊 Материализованные представления

### 1. `mv_building_power_realtime`
Текущая мощность каждого здания:
- Агрегация данных всех контроллеров здания
- Мощность по каждой фазе (power_ph1/2/3_kw)
- Общая мощность (total_power_kw)
- Напряжение и ток по фазам
- Последнее измерение (в пределах 1 часа)

**Особенности:**
- Суммирует ток от всех контроллеров
- Усредняет напряжение
- Обрабатывает здания с несколькими контроллерами

### 2. `mv_line_power_realtime`
Суммарная нагрузка по линии:
- Сумма мощности всех зданий на линии
- Детализация по фазам
- Количество подключённых зданий
- Средние напряжение и ток

**Привязка зданий:**
- primary_line_id — основная линия
- backup_line_id — резервная линия

### 3. `mv_transformer_load_realtime`
Загрузка трансформатора:
- Суммарная мощность от всех зданий
- Детализация по фазам
- Процент загрузки (общий и по каждой фазе)
- Количество зданий, линий, контроллеров
- Статистика измерений

## 🎯 SQL функции

### `calculate_phase_power(voltage, amperage, power_factor)`
Расчёт мощности по одной фазе.

**Входные параметры:**
- voltage_v: напряжение в вольтах
- amperage_a: ток в амперах
- power_factor: коэффициент мощности (по умолчанию 0.85)

**Возвращает:** мощность в кВт

### `refresh_power_materialized_views()`
Обновление всех материализованных представлений.

**Порядок обновления:**
1. mv_building_power_realtime
2. mv_line_power_realtime  
3. mv_transformer_load_realtime

## 📈 Представление для анализа

### `v_phase_imbalance_analysis`
Анализ дисбаланса нагрузки по фазам:
- Процент отклонения каждой фазы от среднего
- Статус: OK / WARNING (>10%) / CRITICAL (>20%)

## 🚀 API Endpoints

**Необходимо добавить в src/routes/index.js:**

```javascript
const powerAnalyticsRoutes = require('./powerAnalyticsRoutes');
router.use('/power-analytics', powerAnalyticsRoutes);
```

### Доступные endpoints:

**Здания:**
- `GET /api/power-analytics/buildings` — все здания с мощностью
- `GET /api/power-analytics/buildings/:id` — конкретное здание

**Линии:**
- `GET /api/power-analytics/lines` — все линии с суммарной нагрузкой
- `GET /api/power-analytics/lines/:id` — конкретная линия

**Трансформаторы:**
- `GET /api/power-analytics/transformers` — все трансформаторы с загрузкой
- `GET /api/power-analytics/transformers/:id` — конкретный трансформатор
- `GET /api/power-analytics/phase-imbalance` — анализ дисбаланса фаз
- `POST /api/power-analytics/refresh` — обновить данные (требует JWT)

## 📊 Пример данных

### Здание
```json
{
  "building_id": 36,
  "building_name": "Sebzor, 36",
  "power_transformer_id": "TR-001",
  "controllers_count": 1,
  "voltage_ph1": 210.1,
  "voltage_ph2": 198.6,
  "voltage_ph3": 237.3,
  "amperage_ph1": 15.2,
  "amperage_ph2": 14.8,
  "amperage_ph3": 15.5,
  "power_ph1_kw": 6.88,
  "power_ph2_kw": 4.66,
  "power_ph3_kw": 4.79,
  "total_power_kw": 16.34
}
```

### Трансформатор
```json
{
  "id": "TR-001",
  "name": "Трансформатор Себзор",
  "capacity_kva": 1000,
  "buildings_count": 5,
  "lines_count": 2,
  "total_power_ph1_kw": 45.2,
  "total_power_ph2_kw": 38.7,
  "total_power_ph3_kw": 42.1,
  "total_power_kw": 126.0,
  "load_percent": 12.6,
  "load_percent_ph1": 13.6,
  "load_percent_ph2": 11.6,
  "load_percent_ph3": 12.6
}
```

## ⚙️ Настройка автоматического обновления

Материализованные представления обновляются:
1. Вручную через API: `POST /api/power-analytics/refresh`
2. Автоматически (если установлен pg_cron):
   ```sql
   SELECT cron.schedule(
       'refresh-power-views', 
       '*/5 * * * *',  -- каждые 5 минут
       'SELECT refresh_power_materialized_views();'
   );
   ```

## 🔍 Следующие шаги

1. ✅ SQL функции и представления созданы
2. ✅ Контроллер powerAnalyticsController создан
3. ✅ Маршруты powerAnalyticsRoutes созданы
4. ⏳ Подключить маршруты в src/routes/index.js
5. ⏳ Обновить фронтенд для отображения данных
6. ⏳ Добавить popup с мощностью для линий и трансформаторов
7. ⏳ Тестирование

## 📝 Заметки

- Система учитывает здания с несколькими контроллерами
- Коэффициент мощности cos(φ) = 0.85 (типично для жилых зданий)
- Все расчёты в реальном времени (последний час)
- Данные обновляются через REFRESH MATERIALIZED VIEW
