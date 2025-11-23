# ⚡ СИСТЕМА РАСЧЁТА И АНАЛИЗА МОЩНОСТИ - ПОЛНЫЙ ОТЧЁТ

## 📋 Резюме

Реализована комплексная система расчёта электрической мощности с физически корректными формулами и детализацией по фазам для всех уровней инфраструктуры.

## ✅ Что реализовано

### 1. SQL Функции (БД)

**`calculate_phase_power(voltage, amperage, power_factor)`**
- Расчёт активной мощности по физической формуле: P = U × I × cos(φ) / 1000
- Коэффициент мощности по умолчанию: 0.85 (жилые здания)
- Результат в кВт с точностью 3 знака после запятой

**`refresh_power_materialized_views()`**
- Обновление всех материализованных представлений
- Порядок: здания → линии → трансформаторы

### 2. Материализованные представления

#### `mv_building_power_realtime`
Мощность каждого здания:
- ✅ Агрегация данных всех контроллеров здания
- ✅ Мощность по каждой фазе (кВт)
- ✅ Общая мощность здания (кВт)
- ✅ Напряжение (усреднённое) и ток (суммарный) по фазам
- ✅ Привязка к трансформатору и линии
- ✅ Последнее измерение (в пределах 1 часа)

**Пример данных:**
| Building | Power Ph1 | Power Ph2 | Power Ph3 | Total Power |
|----------|-----------|-----------|-----------|-------------|
| Sebzor, 36 | 6.88 кВт | 4.66 кВт | 4.79 кВт | 16.34 кВт |

#### `mv_line_power_realtime`
Суммарная мощность по линии:
- ✅ Сумма мощности всех зданий на линии
- ✅ Детализация по фазам (кВт)
- ✅ Количество подключённых зданий
- ✅ Средние напряжение и ток
- ✅ Привязка к трансформатору

**Пример данных:**
| Line | Buildings | Total Power | Ph1 | Ph2 | Ph3 |
|------|-----------|-------------|-----|-----|-----|
| Olmazor 2 | 1 | 16.34 кВт | 6.88 | 4.66 | 4.79 |

#### `mv_transformer_load_realtime`
Загрузка трансформатора:
- ✅ Суммарная мощность от всех зданий
- ✅ Детализация по фазам (кВт и %)
- ✅ Общий процент загрузки
- ✅ Процент загрузки каждой фазы
- ✅ Количество зданий, линий, контроллеров
- ✅ Средние значения напряжения и тока

**Формула загрузки:**
```
Load% = (Total_Power_kW / Capacity_kVA) × 100%
Load_Ph% = (Phase_Power_kW / (Capacity_kVA / 3)) × 100%
```

### 3. Представление для анализа

#### `v_phase_imbalance_analysis`
Анализ дисбаланса нагрузки:
- ✅ Расчёт отклонения каждой фазы от среднего
- ✅ Автоматическая классификация:
  - **OK**: отклонение < 10%
  - **WARNING**: отклонение 10-20%
  - **CRITICAL**: отклонение > 20%

### 4. Backend API

**Контроллер:** `src/controllers/powerAnalyticsController.js`
**Маршруты:** `src/routes/powerAnalyticsRoutes.js`

#### Endpoints:

**Здания:**
- `GET /api/power-analytics/buildings` — все здания
- `GET /api/power-analytics/buildings/:id` — конкретное здание

**Линии:**
- `GET /api/power-analytics/lines` — все линии
- `GET /api/power-analytics/lines/:id` — конкретная линия

**Трансформаторы:**
- `GET /api/power-analytics/transformers` — все трансформаторы
- `GET /api/power-analytics/transformers/:id` — конкретный трансформатор

**Анализ:**
- `GET /api/power-analytics/phase-imbalance` — дисбаланс фаз
- `POST /api/power-analytics/refresh` — обновить данные (требует JWT)

## 📊 Примеры работы

### Тестовые данные из БД

**Здания (топ по мощности):**
```
Building ID | Name              | Total Power | Ph1   | Ph2   | Ph3
------------|-------------------|-------------|-------|-------|-------
38          | Olamzor City 11V  | 20.37 кВт   | 9.74  | 5.43  | 5.20
42          | Olmazor City 15V  | 18.35 кВт   | 7.65  | 2.80  | 7.90
36          | Sebzor, 36        | 16.34 кВт   | 6.88  | 4.66  | 4.79
```

**Линии:**
```
Line ID | Name       | Buildings | Total Power | Ph1   | Ph2   | Ph3
--------|------------|-----------|-------------|-------|-------|-------
21      | Olmazor 2  | 1         | 16.34 кВт   | 6.88  | 4.66  | 4.79
29      | Olmazor 1  | 0         | 0.00 кВт    | —     | —     | —
```

### API Responses

**Пример успешного ответа:**
```bash
curl http://localhost:3000/api/power-analytics/buildings

{
  "success": true,
  "data": [
    {
      "building_id": 36,
      "building_name": "Sebzor, 36",
      "total_power_kw": "16.34",
      "power_ph1_kw": "6.88",
      "power_ph2_kw": "4.66",
      "power_ph3_kw": "4.79"
    }
  ],
  "count": 8
}
```

## 🎯 Преимущества реализации

1. **Физически корректные расчёты**
   - Используются реальные формулы электротехники
   - Учитывается коэффициент мощности cos(φ)
   - Правильный расчёт для трёхфазной сети

2. **Детализация по фазам**
   - Мощность, напряжение, ток для каждой фазы
   - Возможность выявления дисбаланса
   - Точная диагностика проблем

3. **Агрегация на всех уровнях**
   - Здание → суммируются все контроллеры
   - Линия → суммируются все здания
   - Трансформатор → суммируются все подключённые объекты

4. **Производительность**
   - Материализованные представления
   - Расчёты на уровне БД
   - Индексы для быстрого доступа
   - Опциональное кэширование

5. **Мониторинг в реальном времени**
   - Данные за последний час
   - Счётчик свежих метрик
   - Автоматическое обнаружение перегрузки

## 📁 Созданные файлы

```
database/migrations/
  └── 003_power_calculation_v2.sql         # SQL миграция

src/controllers/
  └── powerAnalyticsController.js          # Контроллер API

src/routes/
  └── powerAnalyticsRoutes.js              # Маршруты API
  └── index.js (обновлён)                  # Подключение маршрутов

docs/
  └── POWER-ANALYTICS-API.md               # Документация API
  └── POWER-ANALYTICS-COMPLETE-REPORT.md   # Этот отчёт
```

## 🔧 Техническая документация

### Архитектура расчётов

```
Метрики (metrics)
    ↓
Мощность зданий (mv_building_power_realtime)
    ↓
Мощность линий (mv_line_power_realtime)
    ↓
Загрузка трансформаторов (mv_transformer_load_realtime)
    ↓
Анализ дисбаланса (v_phase_imbalance_analysis)
```

### Зависимости представлений

1. **mv_building_power_realtime** — независимое (данные из metrics)
2. **mv_line_power_realtime** — зависит от mv_building_power_realtime
3. **mv_transformer_load_realtime** — зависит от mv_building_power_realtime

### Индексы

**Оптимизация запросов:**
- UNIQUE INDEX по building_id, line_id, transformer_id
- INDEX по power_transformer_id, primary_line_id (для JOIN)
- INDEX по load_percent DESC (для сортировки)

## 🔄 Обновление данных

### Автоматическое (рекомендуется)
Если установлен pg_cron:
```sql
SELECT cron.schedule(
    'refresh-power-views',
    '*/5 * * * *',  -- каждые 5 минут
    'SELECT refresh_power_materialized_views();'
);
```

### Ручное
Через API:
```bash
curl -X POST http://localhost:3000/api/power-analytics/refresh \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Напрямую в БД:
```sql
SELECT refresh_power_materialized_views();
```

## 🧪 Тестирование

### Проверка работы функций
```sql
-- Тест расчёта мощности
SELECT calculate_phase_power(220, 15.0, 0.85);  -- Ожидается: 2.805 кВт

-- Проверка данных зданий
SELECT building_id, building_name, total_power_kw 
FROM mv_building_power_realtime 
ORDER BY total_power_kw DESC 
LIMIT 5;

-- Проверка данных линий
SELECT line_id, line_name, buildings_count, total_power_kw 
FROM mv_line_power_realtime 
ORDER BY total_power_kw DESC;
```

### Проверка API
```bash
# Мощность зданий
curl http://localhost:3000/api/power-analytics/buildings

# Мощность линий
curl http://localhost:3000/api/power-analytics/lines

# Загрузка трансформаторов
curl http://localhost:3000/api/power-analytics/transformers

# Анализ дисбаланса
curl http://localhost:3000/api/power-analytics/phase-imbalance
```

## 🎨 Интеграция с фронтендом

### Для popup зданий
```javascript
// Добавить в popup здания
const powerResponse = await fetch(`/api/power-analytics/buildings/${buildingId}`);
const powerData = await powerResponse.json();

popupHTML += `
    <p><strong>💡 Потребляемая мощность:</strong></p>
    <table>
        <tr><td>Фаза 1:</td><td>${powerData.data.power_ph1_kw} кВт</td></tr>
        <tr><td>Фаза 2:</td><td>${powerData.data.power_ph2_kw} кВт</td></tr>
        <tr><td>Фаза 3:</td><td>${powerData.data.power_ph3_kw} кВт</td></tr>
        <tr><td><strong>Всего:</strong></td><td><strong>${powerData.data.total_power_kw} кВт</strong></td></tr>
    </table>
`;
```

### Для popup линий
```javascript
// Добавить в popup линии
const lineResponse = await fetch(`/api/power-analytics/lines/${lineId}`);
const lineData = await lineResponse.json();

popupHTML += `
    <p><strong>⚡ Суммарная нагрузка линии:</strong></p>
    <p>Зданий на линии: ${lineData.data.buildings_count}</p>
    <p>Общая мощность: <strong>${lineData.data.total_power_kw} кВт</strong></p>
    <p>По фазам: ${lineData.data.total_power_ph1_kw} / ${lineData.data.total_power_ph2_kw} / ${lineData.data.total_power_ph3_kw} кВт</p>
`;
```

### Для popup трансформаторов
```javascript
// Добавить в popup трансформатора
const transformerResponse = await fetch(`/api/power-analytics/transformers/${transformerId}`);
const transformerData = await transformerResponse.json();

const loadStatus = transformerData.data.load_percent > 80 ? 'ПЕРЕГРУЗКА' :
                   transformerData.data.load_percent > 60 ? 'ВЫСОКАЯ' :
                   transformerData.data.load_percent > 40 ? 'СРЕДНЯЯ' : 'НОРМАЛЬНАЯ';

popupHTML += `
    <p><strong>📊 Загрузка трансформатора:</strong></p>
    <p>Мощность: ${transformerData.data.total_power_kw} / ${transformerData.data.capacity_kva} кВА</p>
    <p>Загрузка: <strong>${transformerData.data.load_percent}%</strong> (${loadStatus})</p>
    <p>По фазам:</p>
    <ul>
        <li>Фаза 1: ${transformerData.data.load_percent_ph1}% (${transformerData.data.total_power_ph1_kw} кВт)</li>
        <li>Фаза 2: ${transformerData.data.load_percent_ph2}% (${transformerData.data.total_power_ph2_kw} кВт)</li>
        <li>Фаза 3: ${transformerData.data.load_percent_ph3}% (${transformerData.data.total_power_ph3_kw} кВт)</li>
    </ul>
    <p>Зданий: ${transformerData.data.buildings_count}, Линий: ${transformerData.data.lines_count}</p>
`;
```

## 📈 Примеры использования

### Мониторинг перегрузки
```javascript
async function checkOverloadedTransformers() {
    const response = await fetch('/api/power-analytics/transformers');
    const data = await response.json();
    
    const overloaded = data.data.filter(t => t.load_percent > 80);
    
    if (overloaded.length > 0) {
        alert(`⚠️ Перегружено ${overloaded.length} трансформаторов!`);
        overloaded.forEach(t => {
            console.log(`${t.name}: ${t.load_percent}% (${t.total_power_kw}/${t.capacity_kva} кВА)`);
        });
    }
}
```

### Анализ дисбаланса фаз
```javascript
async function checkPhaseImbalance() {
    const response = await fetch('/api/power-analytics/phase-imbalance');
    const data = await response.json();
    
    const critical = data.data.filter(t => t.imbalance_status === 'CRITICAL');
    const warning = data.data.filter(t => t.imbalance_status === 'WARNING');
    
    console.log(`Критический дисбаланс: ${critical.length} трансформаторов`);
    console.log(`Предупреждение: ${warning.length} трансформаторов`);
}
```

### Dashboard загрузки линий
```javascript
async function createLineLoadDashboard() {
    const response = await fetch('/api/power-analytics/lines');
    const lines = await response.json();
    
    lines.data.forEach(line => {
        const avgLoad = (
            parseFloat(line.total_power_ph1_kw) +
            parseFloat(line.total_power_ph2_kw) +
            parseFloat(line.total_power_ph3_kw)
        ) / 3;
        
        console.log(`${line.line_name}:`);
        console.log(`  Здания: ${line.buildings_count}`);
        console.log(`  Мощность: ${line.total_power_kw} кВт`);
        console.log(`  Средняя по фазам: ${avgLoad.toFixed(2)} кВт`);
    });
}
```

## 🔍 Диагностика и отладка

### Проверка расчётов
```sql
-- Проверить мощность конкретного здания вручную
SELECT 
    b.building_id,
    m.electricity_ph1,
    m.amperage_ph1,
    calculate_phase_power(m.electricity_ph1, m.amperage_ph1) as calculated_power_ph1,
    -- Ожидаемый результат: 220 * 15 * 0.85 / 1000 = 2.805 кВт
FROM buildings b
JOIN controllers c ON b.building_id = c.building_id
JOIN metrics m ON c.controller_id = m.controller_id
WHERE b.building_id = 36
ORDER BY m.timestamp DESC
LIMIT 1;
```

### Обновление данных
```sql
-- Вручную обновить все представления
SELECT refresh_power_materialized_views();

-- Проверить время последнего обновления
SELECT 
    schemaname,
    matviewname,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) as size
FROM pg_matviews
WHERE matviewname LIKE 'mv_%power%';
```

## ⚠️ Важные замечания

1. **Коэффициент мощности (cos φ)**
   - Текущее значение: 0.85
   - Можно изменить в функции `calculate_phase_power()`
   - Разные типы нагрузок могут иметь разные коэффициенты

2. **Обработка NULL значений**
   - Функция возвращает 0 при NULL напряжении или токе
   - COALESCE используется для безопасности

3. **Временные рамки**
   - Используются метрики за последний час
   - Можно изменить в запросах (NOW() - INTERVAL '1 hour')

4. **Агрегация контроллеров**
   - Здания с несколькими контроллерами корректно обрабатываются
   - Ток суммируется, напряжение усредняется

5. **Производительность**
   - Материализованные представления требуют периодического обновления
   - Рекомендуется обновлять каждые 5 минут
   - Используйте CONCURRENTLY для обновления без блокировок

## 📝 Следующие шаги

### Обязательно:
- [ ] Обновить фронтенд (popup зданий, линий, трансформаторов)
- [ ] Добавить индикаторы загрузки на карте
- [ ] Настроить автоматическое обновление (pg_cron или Node.js scheduler)
- [ ] Добавить алерты при перегрузке и дисбалансе

### Опционально:
- [ ] Визуализация дисбаланса фаз (графики)
- [ ] История изменения загрузки
- [ ] Прогнозирование перегрузки
- [ ] Экспорт данных в CSV/Excel
- [ ] Dashboard для диспетчера

## 🎉 Статус реализации

✅ **SQL миграция** — выполнена  
✅ **Функции расчёта** — созданы  
✅ **Материализованные представления** — созданы и заполнены  
✅ **Backend API** — реализован и протестирован  
✅ **Документация API** — создана  
⏳ **Фронтенд** — требует обновления  
⏳ **Автообновление** — требует настройки  

---

**Дата реализации:** 2025-11-02  
**Версия:** 1.0.0  
**Статус:** Backend готов, фронтенд в ожидании
