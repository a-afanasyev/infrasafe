# 🔴 ПЛАН T012: Исправление критических уязвимостей безопасности

**Дата создания:** 2025-01-16 16:00:00  
**Приоритет:** КРИТИЧЕСКИЙ  
**Время выполнения:** 2-3 дня  
**Блокирует:** Production deployment

---

## 📊 АНАЛИЗ УЯЗВИМОСТЕЙ

### 🔴 SQL Injection - 8 критических точек
**Расположение:** `src/controllers/adminController.js`

| Строка | Метод | Уязвимая конструкция |
|--------|-------|---------------------|
| 54 | `getOptimizedBuildings` | `ORDER BY ${sort} ${order.toUpperCase()}` |
| 126 | `getOptimizedControllers` | `ORDER BY ${sort} ${order.toUpperCase()}` |
| 193 | `getOptimizedMetrics` | `ORDER BY ${sort} ${order.toUpperCase()}` |
| 361 | `getOptimizedTransformers` | `ORDER BY t.${sortField} ${order.toUpperCase()}` |
| 635 | `getOptimizedLines` | `ORDER BY l.${sortField} ${order.toUpperCase()}` |
| 915 | `getOptimizedWaterLines` | `ORDER BY wl.${sort} ${order.toUpperCase()}` |
| 1309 | `getOptimizedWaterSources` | `ORDER BY ${sort} ${order.toUpperCase()}` |
| 1547 | `getOptimizedHeatSources` | `ORDER BY ${sort} ${order.toUpperCase()}` |

**Критичность:** МАКСИМАЛЬНАЯ - возможна полная компрометация БД

### 🟠 XSS уязвимости - 66 точек через innerHTML
**Расположение:** `public/` директория

| Файл | Количество | Критичность |
|------|------------|-------------|
| `admin.js` | 44 точки | ВЫСОКАЯ |
| `script.js` | 13 точек | ВЫСОКАЯ |
| `login.html` | 5 точек | СРЕДНЯЯ |
| `map-layers-control.js` | 4 точки | СРЕДНЯЯ |

**Из них исправлено:** 28 точек используют `textContent`  
**Остается исправить:** 38 точек

---

## 🛠️ ПЛАН ИСПРАВЛЕНИЯ

### Фаза 1: SQL Injection (День 1-2) 🔴
**Критичность:** МАКСИМАЛЬНАЯ

#### 1.1 Создание системы валидации sort/order
```javascript
// Создать файл: src/utils/queryValidation.js
const allowedSortColumns = {
    buildings: ['building_id', 'name', 'address', 'created_at', 'updated_at'],
    controllers: ['controller_id', 'serial_number', 'status', 'last_seen', 'created_at'],
    metrics: ['metric_id', 'timestamp', 'controller_id', 'created_at'],
    transformers: ['transformer_id', 'name', 'capacity', 'load_percent', 'status'],
    lines: ['line_id', 'name', 'voltage', 'status', 'transformer_id'],
    water_lines: ['line_id', 'name', 'pressure', 'flow_rate', 'status'],
    water_sources: ['source_id', 'name', 'type', 'capacity', 'status'],
    heat_sources: ['source_id', 'name', 'type', 'capacity', 'temperature', 'status']
};

const allowedOrderDirections = ['ASC', 'DESC'];

function validateSortOrder(entityType, sort, order) {
    const validSort = allowedSortColumns[entityType]?.includes(sort) ? sort : allowedSortColumns[entityType][0];
    const validOrder = allowedOrderDirections.includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';
    
    return { validSort, validOrder };
}

module.exports = { validateSortOrder, allowedSortColumns, allowedOrderDirections };
```

#### 1.2 Исправление каждого метода в adminController.js
**Было (уязвимо):**
```javascript
query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
```

**Станет (безопасно):**
```javascript
const { validateSortOrder } = require('../utils/queryValidation');
// В начале каждого метода:
const { validSort, validOrder } = validateSortOrder('buildings', sort, order);
query += ` ORDER BY ${validSort} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
```

#### 1.3 Приоритет исправления:
1. **getOptimizedBuildings** (строка 54) - самый используемый
2. **getOptimizedControllers** (строка 126) - критическая функциональность
3. **getOptimizedMetrics** (строка 193) - данные телеметрии
4. **getOptimizedTransformers** (строка 361) - инфраструктура
5. **getOptimizedLines** (строка 635) - электросети
6. **getOptimizedWaterLines** (строка 915) - водоснабжение
7. **getOptimizedWaterSources** (строка 1309) - источники воды
8. **getOptimizedHeatSources** (строка 1547) - теплоснабжение

### Фаза 2: XSS исправления (День 2-3) 🟠
**Приоритет:** ВЫСОКИЙ

#### 2.1 Критические точки в admin.js (44 места)
**Стратегия исправления:**

1. **Статический контент** → `textContent`
```javascript
// Было:
tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;

// Станет:
const row = document.createElement('tr');
const cell = document.createElement('td');
cell.setAttribute('colspan', '7');
cell.style.textAlign = 'center';
cell.style.color = 'red';
cell.textContent = 'Ошибка загрузки данных';
row.appendChild(cell);
tableBody.appendChild(row);
```

2. **Динамический HTML** → `createElement` + `textContent`
```javascript
// Было:
row.innerHTML = `
    <td>${item.building_id}</td>
    <td>${item.name}</td>
    <td>${item.address}</td>
`;

// Станет:
const createCell = (text) => {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
};

row.appendChild(createCell(item.building_id));
row.appendChild(createCell(item.name));
row.appendChild(createCell(item.address));
```

#### 2.2 Средние риски в script.js (13 мест)
```javascript
// Было:
header.innerHTML = `<div class="icon normal-icon"></div><span>${text}</span>`;

// Станет:
header.innerHTML = ''; // Очистка
const icon = document.createElement('div');
icon.className = 'icon normal-icon';
const span = document.createElement('span');
span.textContent = text;
header.appendChild(icon);
header.appendChild(span);
```

#### 2.3 Низкие риски в login.html (5 мест)
```javascript
// Было:
errorContainer.innerHTML = `<div class="error-message">${message}</div>`;

// Станет:
errorContainer.innerHTML = ''; // Очистка
const errorDiv = document.createElement('div');
errorDiv.className = 'error-message';
errorDiv.textContent = message;
errorContainer.appendChild(errorDiv);
```

### Фаза 3: Content Security Policy (День 3) 🟡
**Приоритет:** СРЕДНИЙ

#### 3.1 Добавление CSP headers в nginx.conf
```nginx
# Добавить в nginx.conf
add_header Content-Security-Policy "
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:;
    font-src 'self';
    connect-src 'self';
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self'
" always;
```

#### 3.2 Удаление 'unsafe-inline' после исправления XSS
После исправления всех `innerHTML` можно убрать `'unsafe-inline'`

---

## 🧪 СТРАТЕГИЯ ТЕСТИРОВАНИЯ

### Автоматические тесты безопасности
```javascript
// tests/security/sql-injection.test.js
describe('SQL Injection Protection', () => {
    test('should reject malicious sort parameter', async () => {
        const response = await request(app)
            .get('/api/admin/buildings')
            .query({ sort: "'; DROP TABLE buildings; --", order: 'ASC' });
        
        expect(response.status).toBe(200);
        // Проверить, что данные не повреждены
        expect(response.body.data).toBeDefined();
    });
    
    test('should use default sort for invalid column', async () => {
        const response = await request(app)
            .get('/api/admin/buildings')
            .query({ sort: 'invalid_column', order: 'ASC' });
        
        expect(response.status).toBe(200);
        // Проверить, что используется дефолтная сортировка
    });
});
```

### Ручное тестирование XSS
```javascript
// tests/security/xss.test.js
describe('XSS Protection', () => {
    test('should escape malicious script in building name', async () => {
        const maliciousName = '<script>alert("XSS")</script>';
        // Создать здание с вредоносным именем
        // Проверить, что скрипт не выполняется в админке
    });
});
```

---

## 📋 ЧЕКЛИСТ ВЫПОЛНЕНИЯ

### День 1: SQL Injection
- [ ] Создать `src/utils/queryValidation.js`
- [ ] Исправить `getOptimizedBuildings` (строка 54)
- [ ] Исправить `getOptimizedControllers` (строка 126)
- [ ] Исправить `getOptimizedMetrics` (строка 193)
- [ ] Написать тесты для первых 3 методов
- [ ] Тестирование исправлений

### День 2: SQL Injection (продолжение) + XSS
- [ ] Исправить `getOptimizedTransformers` (строка 361)
- [ ] Исправить `getOptimizedLines` (строка 635)
- [ ] Исправить `getOptimizedWaterLines` (строка 915)
- [ ] Исправить `getOptimizedWaterSources` (строка 1309)
- [ ] Исправить `getOptimizedHeatSources` (строка 1547)
- [ ] Начать исправление критических XSS в admin.js (первые 20 мест)

### День 3: XSS + CSP
- [ ] Завершить исправление XSS в admin.js
- [ ] Исправить XSS в script.js
- [ ] Исправить XSS в login.html
- [ ] Исправить XSS в map-layers-control.js
- [ ] Добавить Content Security Policy
- [ ] Полное тестирование безопасности

---

## 🎯 КРИТЕРИИ УСПЕХА

### Обязательные требования:
- ✅ 0 SQL Injection уязвимостей
- ✅ 0 XSS уязвимостей через innerHTML
- ✅ Все тесты безопасности проходят
- ✅ Функциональность не нарушена

### Дополнительные улучшения:
- ✅ CSP настроен и работает
- ✅ Время отклика API не увеличилось
- ✅ Админка работает без JavaScript ошибок

---

## ⚠️ РИСКИ И МИТИГАЦИЯ

### Высокие риски:
1. **Поломка функциональности админки** 
   - Митигация: Пошаговое тестирование после каждого исправления

2. **Увеличение времени отклика**
   - Митигация: Кэширование валидированных параметров

3. **Сложность отладки XSS исправлений**
   - Митигация: Создание утилит для безопасного создания DOM элементов

### Средние риски:
1. **CSP блокирует легитимный код**
   - Митигация: Постепенное ужесточение CSP после тестирования

---

## 📈 МЕТРИКИ ОТСЛЕЖИВАНИЯ

- **SQL Injection точек:** 8 → 0
- **XSS уязвимостей:** 38 → 0  
- **Время отклика API:** < 100ms (сохранить)
- **Тесты безопасности:** 0 → 15+ тестов
- **Покрытие тестами:** +25% для админских методов

---

**Статус:** Готов к выполнению  
**Ответственный:** Команда разработки  
**Следующий шаг:** Создание utils/queryValidation.js

