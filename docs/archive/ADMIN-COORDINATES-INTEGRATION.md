# Руководство: Интеграция редактора координат в админку

**Дата:** 2025-10-21  
**Компонент:** CoordinateEditor  
**Файл:** `public/admin-coordinate-editor.js`  
**Статус:** ✅ Готово к интеграции

---

## 📋 Что реализовано

### ✅ База данных
- Transformers: добавлены latitude, longitude, geom
- Lines (электропередачи): добавлены координаты + cable_type + commissioning_year
- Water Lines: добавлены координаты
- Infrastructure Lines: добавлены cable_type + commissioning_year
- Water Sources: координаты уже были
- Heat Sources: координаты уже были

### ✅ Backend модели
- Transformer.update() - поддерживает latitude/longitude
- InfrastructureLine - поддерживает cable_type/commissioning_year

### ✅ Frontend компонент
- CoordinateEditor класс создан
- Modal UI с формами
- Leaflet мини-карта
- Валидация координат
- API интеграция

---

## 🔧 Как использовать компонент

### Простой пример

```javascript
// Открыть редактор координат для трансформатора
openCoordinateEditor(
    'transformers',        // тип объекта
    5,                     // ID объекта
    55.751244,             // текущая широта
    37.618423,             // текущая долгота
    'Трансформатор №5',    // название для отображения
    (updatedData) => {     // callback после сохранения
        console.log('Обновлено:', updatedData);
        // Перезагрузить таблицу
        loadTransformers();
    }
);
```

---

## 📝 Интеграция в таблицы админки

### Пример 1: Трансформаторы

**Где:** `public/admin.js` - функция отрисовки таблицы трансформаторов

**Добавить кнопку в каждую строку:**

```javascript
// В функции renderTransformersTable() или аналогичной
// Добавить колонку "Действия" в таблицу

function renderTransformersTable(transformers) {
    const tbody = document.getElementById('transformers-tbody');
    tbody.innerHTML = '';
    
    transformers.forEach(transformer => {
        const row = document.createElement('tr');
        
        // ... существующие ячейки ...
        
        // Добавляем ячейку с кнопками
        const actionsCell = document.createElement('td');
        
        // Кнопка редактирования координат
        const coordBtn = document.createElement('button');
        coordBtn.textContent = '📍 Координаты';
        coordBtn.className = 'btn-edit';
        coordBtn.onclick = () => {
            openCoordinateEditor(
                'transformers',
                transformer.transformer_id,
                transformer.latitude,
                transformer.longitude,
                transformer.name,
                () => loadTransformers() // Перезагрузить таблицу после сохранения
            );
        };
        
        actionsCell.appendChild(coordBtn);
        
        // ... другие кнопки (Изменить, Удалить) ...
        
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    });
}
```

### Пример 2: Источники воды

```javascript
// В функции renderWaterSourcesTable()

const coordBtn = document.createElement('button');
coordBtn.textContent = '📍';
coordBtn.className = 'btn-edit';
coordBtn.title = 'Редактировать координаты';
coordBtn.onclick = () => {
    openCoordinateEditor(
        'water-sources',
        source.id,
        source.latitude,
        source.longitude,
        source.name,
        () => loadWaterSources()
    );
};
```

### Пример 3: Источники тепла

```javascript
// В функции renderHeatSourcesTable()

const coordBtn = document.createElement('button');
coordBtn.textContent = '📍';
coordBtn.className = 'btn-edit';
coordBtn.title = 'Редактировать координаты';
coordBtn.onclick = () => {
    openCoordinateEditor(
        'heat-sources',
        source.id,
        source.latitude,
        source.longitude,
        source.name,
        () => loadHeatSources()
            );
};
```

---

## 🎨 Стили кнопок

Кнопка координат уже использует существующий класс `.btn-edit`:

```css
.btn-edit {
    background-color: #2196F3;
    color: white;
    border: none;
    padding: 5px 10px;
    cursor: pointer;
    border-radius: 3px;
    font-size: 12px;
}

.btn-edit:hover {
    background-color: #0b7dda;
}
```

---

## 📊 Поддерживаемые типы объектов

| Тип объекта | API Endpoint | Координаты | Статус |
|-------------|--------------|------------|--------|
| transformers | /api/transformers | latitude, longitude | ✅ Готово |
| water-sources | /api/cold-water-sources | latitude, longitude | ✅ Готово |
| heat-sources | /api/heat-sources | latitude, longitude | ✅ Готово |
| infrastructure-lines | /api/infrastructure-lines | main_path (JSON) | ✅ Готово |

---

## 🔍 Тестирование компонента

### Ручной тест

1. Откройте админку: http://localhost:8080/admin.html
2. Перейдите в раздел "Трансформаторы" или "Источники"
3. В консоли браузера выполните:

```javascript
openCoordinateEditor(
    'transformers',
    1,
    55.751,
    37.618,
    'Тестовый объект',
    (data) => console.log('Сохранено:', data)
);
```

4. Должно открыться modal окно
5. Можно:
   - Ввести координаты вручную
   - Нажать "Выбрать на карте"
   - Кликнуть на карте или перетащить маркер
   - Сохранить изменения

---

## 📝 Дополнительные поля для линий электропередач

Для линий электропередач нужны дополнительные поля. Расширим форму:

```javascript
// В admin.js - функция редактирования линии электропередач

function editLine(lineId) {
    // ... загрузка данных линии ...
    
    // Создаем расширенную форму
    const formHTML = `
        <form id="edit-line-form">
            <!-- Основные поля -->
            <input type="text" id="line-name" value="${line.name}" required>
            <input type="number" id="line-voltage" value="${line.voltage_kv}" required>
            
            <!-- Координаты начала -->
            <label>Начальная точка:</label>
            <input type="number" step="0.000001" min="-90" max="90"
                   id="line-lat-start" value="${line.latitude_start}" placeholder="Широта">
            <input type="number" step="0.000001" min="-180" max="180"
                   id="line-lng-start" value="${line.longitude_start}" placeholder="Долгота">
            
            <!-- Координаты конца -->
            <label>Конечная точка:</label>
            <input type="number" step="0.000001" min="-90" max="90"
                   id="line-lat-end" value="${line.latitude_end}" placeholder="Широта">
            <input type="number" step="0.000001" min="-180" max="180"
                   id="line-lng-end" value="${line.longitude_end}" placeholder="Долгота">
            
            <!-- НОВЫЕ ПОЛЯ -->
            <label>Тип кабеля:</label>
            <select id="line-cable-type">
                <option value="">Не указан</option>
                <option value="copper">Медный (Cu)</option>
                <option value="aluminum">Алюминиевый (Al)</option>
                <option value="steel_aluminum">Сталеалюминиевый (AC)</option>
                <option value="fiber">Оптоволоконный</option>
                <option value="other">Другой</option>
            </select>
            
            <label>Год ввода в эксплуатацию:</label>
            <input type="number" min="1900" max="2100" 
                   id="line-commissioning-year" 
                   value="${line.commissioning_year || ''}"
                   placeholder="YYYY">
            
            <button type="submit">Сохранить</button>
        </form>
    `;
    
    // ... показать modal с формой ...
}
```

---

## ✅ Валидация

### Frontend валидация

```javascript
function validateCoordinate(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) {
        return { valid: false, error: 'Координаты должны быть числами' };
    }
    
    if (lat < -90 || lat > 90) {
        return { valid: false, error: 'Широта: [-90, 90]' };
    }
    
    if (lng < -180 || lng > 180) {
        return { valid: false, error: 'Долгота: [-180, 180]' };
    }
    
    return { valid: true };
}
```

### Backend валидация

Триггеры БД автоматически валидируют координаты и создают геометрию.

---

## 🚀 Следующие шаги

### 1. Добавить кнопки в таблицы

Найти в `admin.js` функции отрисовки таблиц и добавить кнопки "📍 Координаты".

### 2. Протестировать

Открыть админку и проверить:
- Modal открывается
- Карта работает
- Сохранение работает
- Главная карта обновляется

### 3. Расширить для линий

Создать специальный редактор для линий с несколькими точками (для infrastructure_lines).

---

## 📚 API Reference

### CoordinateEditor класс

**Методы:**
- `show()` - показать modal
- `close()` - закрыть modal
- `save()` - сохранить координаты
- `validateCoordinates(lat, lng)` - валидация
- `initMiniMap()` - инициализация карты
- `toggleMap()` - показать/скрыть карту

**Параметры конструктора:**
- `objectType` - тип объекта
- `objectId` - ID объекта
- `latitude` - текущая широта
- `longitude` - текущая долгота
- `objectName` - название объекта
- `onSave` - callback функция

### Глобальная функция

```javascript
openCoordinateEditor(objectType, objectId, latitude, longitude, objectName, onSave)
```

---

**Компонент готов к использованию!**  
Остаётся только добавить кнопки в таблицы админки.

