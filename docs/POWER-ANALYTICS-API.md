# 📊 POWER ANALYTICS API - Документация

## Обзор

API для получения данных о реальном потреблении электроэнергии с детализацией по фазам.

## Принципы расчёта

### Формула мощности по фазе
```
P (кВт) = U (В) × I (А) × cos(φ) / 1000

где cos(φ) = 0.85 (для жилых зданий)
```

### Примеры
- Напряжение: 220V, Ток: 15A → Мощность: 220 × 15 × 0.85 / 1000 = **2.81 кВт**
- Три фазы: 2.81 + 2.65 + 2.89 = **8.35 кВт** (общая мощность здания)

## API Endpoints

### 🏢 Здания

#### Получить мощность всех зданий
```http
GET /api/power-analytics/buildings
```

**Ответ:**
```json
{
  "success": true,
  "data": [
    {
      "building_id": 36,
      "building_name": "Sebzor, 36",
      "address": "Sebzor, 36",
      "power_transformer_id": null,
      "primary_line_id": 21,
      "controllers_count": 1,
      "voltage_ph1": 210.1,
      "voltage_ph2": 198.6,
      "voltage_ph3": 237.3,
      "amperage_ph1": 15.20,
      "amperage_ph2": 14.80,
      "amperage_ph3": 15.50,
      "power_ph1_kw": 6.88,
      "power_ph2_kw": 4.66,
      "power_ph3_kw": 4.79,
      "total_power_kw": 16.34,
      "last_measurement_time": "2025-11-01T20:45:00Z"
    }
  ],
  "count": 8
}
```

#### Получить мощность конкретного здания
```http
GET /api/power-analytics/buildings/36
```

---

### 🔌 Линии электропередач

#### Получить суммарную мощность всех линий
```http
GET /api/power-analytics/lines
```

**Ответ:**
```json
{
  "success": true,
  "data": [
    {
      "line_id": 21,
      "line_name": "Линия Себзор",
      "transformer_id": "TR-001",
      "voltage_kv": 10.0,
      "buildings_count": 3,
      "total_power_ph1_kw": 20.45,
      "total_power_ph2_kw": 18.32,
      "total_power_ph3_kw": 19.87,
      "total_power_kw": 58.64,
      "avg_voltage_ph1": 215.3,
      "avg_voltage_ph2": 217.1,
      "avg_voltage_ph3": 214.8,
      "last_measurement_time": "2025-11-01T20:45:00Z"
    }
  ],
  "count": 2
}
```

#### Получить мощность конкретной линии
```http
GET /api/power-analytics/lines/21
```

---

### ⚡ Трансформаторы

#### Получить загрузку всех трансформаторов
```http
GET /api/power-analytics/transformers
```

**Ответ:**
```json
{
  "success": true,
  "data": [
    {
      "id": "TR-001",
      "name": "Трансформатор Себзор",
      "address": "Себзор, промзона",
      "capacity_kva": 1000,
      "voltage_primary": 10.0,
      "voltage_secondary": 0.4,
      "status": "active",
      "buildings_count": 5,
      "lines_count": 2,
      "controllers_count": 6,
      "active_controllers_count": 5,
      "total_power_ph1_kw": 45.23,
      "total_power_ph2_kw": 38.76,
      "total_power_ph3_kw": 42.15,
      "total_power_kw": 126.14,
      "load_percent": 12.6,
      "load_percent_ph1": 13.6,
      "load_percent_ph2": 11.6,
      "load_percent_ph3": 12.6,
      "avg_voltage_ph1": 215.4,
      "avg_voltage_ph2": 216.8,
      "avg_voltage_ph3": 214.2,
      "last_measurement_time": "2025-11-01T20:45:00Z",
      "recent_metrics_count": 5
    }
  ],
  "count": 1
}
```

#### Получить загрузку конкретного трансформатора
```http
GET /api/power-analytics/transformers/TR-001
```

---

### 🔍 Анализ дисбаланса фаз

#### Получить анализ дисбаланса
```http
GET /api/power-analytics/phase-imbalance
```

**Ответ:**
```json
{
  "success": true,
  "data": [
    {
      "id": "TR-001",
      "name": "Трансформатор Себзор",
      "capacity_kva": 1000,
      "total_power_kw": 126.14,
      "load_percent": 12.6,
      "load_percent_ph1": 13.6,
      "load_percent_ph2": 11.6,
      "load_percent_ph3": 12.6,
      "phase_imbalance_percent": 1.3,
      "imbalance_status": "OK"
    }
  ]
}
```

**Статусы дисбаланса:**
- `OK` — отклонение < 10%
- `WARNING` — отклонение 10-20%
- `CRITICAL` — отклонение > 20%

---

### 🔄 Обновление данных

#### Обновить материализованные представления
```http
POST /api/power-analytics/refresh
Authorization: Bearer <JWT_TOKEN>
```

**Ответ:**
```json
{
  "success": true,
  "message": "Power materialized views refreshed successfully"
}
```

**Примечание:** Требуется JWT авторизация.

---

## Использование во фронтенде

### Пример: Получить мощность зданий
```javascript
const response = await fetch('http://localhost:3000/api/power-analytics/buildings');
const data = await response.json();

data.data.forEach(building => {
    console.log(`${building.building_name}: ${building.total_power_kw} кВт`);
    console.log(`  Фаза 1: ${building.power_ph1_kw} кВт`);
    console.log(`  Фаза 2: ${building.power_ph2_kw} кВт`);
    console.log(`  Фаза 3: ${building.power_ph3_kw} кВт`);
});
```

### Пример: Мониторинг перегруженных трансформаторов
```javascript
const response = await fetch('http://localhost:3000/api/power-analytics/transformers');
const transformers = await response.json();

const overloaded = transformers.data.filter(t => t.load_percent > 80);
console.log(`Перегружено трансформаторов: ${overloaded.length}`);
```

### Пример: Проверка дисбаланса фаз
```javascript
const response = await fetch('http://localhost:3000/api/power-analytics/phase-imbalance');
const analysis = await response.json();

const critical = analysis.data.filter(t => t.imbalance_status === 'CRITICAL');
console.log(`Критический дисбаланс: ${critical.length} трансформаторов`);
```

---

## Частота обновления данных

- **Метрики зданий**: обновляются в реальном времени (используется последнее измерение за 1 час)
- **Материализованные представления**: обновляются вручную через `/refresh` или автоматически (если настроен pg_cron)
- **Рекомендуемая частота**: обновление каждые 5 минут

---

## Важные замечания

1. Данные доступны только для зданий с активными контроллерами и свежими метриками (< 1 часа)
2. Мощность рассчитывается по реальным измерениям напряжения и тока
3. Система корректно обрабатывает здания с несколькими контроллерами
4. Все расчёты выполняются на уровне БД для максимальной производительности
