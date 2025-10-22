# ПЛАН: Объединение редактирования линий (T020)

**Дата:** 22 октября 2025  
**Задача:** Унифицировать редактирование линий электропередач и инфраструктурных линий

---

## 📋 ПРОБЛЕМА

Сейчас существуют **2 разные системы линий**:

### 1. Старые Линии (`lines` table)
- ❌ Только начальная/конечная точки (latitude_start, longitude_start, latitude_end, longitude_end)
- ❌ **НЕ отрисовываются на карте** (TODO в коде)
- ❌ Нет поддержки изломов и ответвлений
- ❌ Примитивный редактор (только текстовые поля)
- ✅ Поля: cable_type, commissioning_year, voltage_kv

### 2. Новые Линии (`infrastructure_lines` table)
- ✅ Полные пути с изломами (main_path JSONB)
- ✅ Поддержка ответвлений (branches JSONB)
- ✅ Отрисовка на карте с интерактивным редактором
- ✅ Leaflet мини-карта для редактирования
- ✅ Поля: cable_type, commissioning_year, voltage_kv

---

## 🎯 ЦЕЛЬ

Сделать **единый редактор с картой** для всех типов линий, чтобы:
- ✅ Любую линию можно редактировать через интерактивную карту
- ✅ Поддержка изломов и ответвлений для всех линий
- ✅ Сохранение в правильную таблицу
- ✅ Отображение на главной карте

---

## 📊 СТРАТЕГИЯ РЕШЕНИЯ

### Вариант 1: Добавить main_path/branches к таблице `lines` ⭐ РЕКОМЕНДУЕТСЯ
**Плюсы:**
- Минимальные изменения в коде
- Обратная совместимость (start/end остаются для fallback)
- Единый формат данных

**Минусы:**
- Дублирование полей (start/end + main_path)

**Реализация:**
1. Миграция: добавить `main_path JSONB` и `branches JSONB` к `lines`
2. Триггер: автоконвертация start/end → main_path при старом формате
3. UI: использовать `InfrastructureLineEditor` для всех линий
4. API: обновить для поддержки обоих форматов

### Вариант 2: Объединить таблицы в одну
**Плюсы:**
- Единый источник данных
- Чистая архитектура

**Минусы:**
- Большая миграция данных
- Риск потери данных
- Больше изменений в коде

---

## 🛠️ ПЛАН РЕАЛИЗАЦИИ (Вариант 1)

### Этап 1: Database Migration
```sql
-- Добавляем поля к таблице lines
ALTER TABLE lines 
ADD COLUMN main_path JSONB,
ADD COLUMN branches JSONB DEFAULT '[]'::jsonb;

-- Создаем функцию автоконвертации start/end → main_path
CREATE OR REPLACE FUNCTION convert_line_endpoints_to_path()
RETURNS TRIGGER AS $$
BEGIN
    -- Если main_path пуст, но есть start/end координаты
    IF (NEW.main_path IS NULL OR NEW.main_path = '[]'::jsonb) 
       AND NEW.latitude_start IS NOT NULL 
       AND NEW.longitude_start IS NOT NULL 
       AND NEW.latitude_end IS NOT NULL 
       AND NEW.longitude_end IS NOT NULL THEN
        
        NEW.main_path = jsonb_build_array(
            jsonb_build_object(
                'lat', NEW.latitude_start,
                'lng', NEW.longitude_start,
                'order', 0,
                'description', 'Начало'
            ),
            jsonb_build_object(
                'lat', NEW.latitude_end,
                'lng', NEW.longitude_end,
                'order', 1,
                'description', 'Конец'
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоконвертации
CREATE TRIGGER trig_lines_convert_endpoints
BEFORE INSERT OR UPDATE ON lines
FOR EACH ROW
EXECUTE FUNCTION convert_line_endpoints_to_path();

-- Конвертируем существующие данные
UPDATE lines 
SET main_path = jsonb_build_array(
    jsonb_build_object(
        'lat', latitude_start,
        'lng', longitude_start,
        'order', 0,
        'description', 'Начало'
    ),
    jsonb_build_object(
        'lat', latitude_end,
        'lng', longitude_end,
        'order', 1,
        'description', 'Конец'
    )
)
WHERE main_path IS NULL 
  AND latitude_start IS NOT NULL 
  AND latitude_end IS NOT NULL;
```

### Этап 2: Backend Model Update
**Файл:** `src/models/Line.js`

Добавить поддержку:
- `main_path` при создании/обновлении
- `branches` при создании/обновлении
- Возврат данных в формате как у `infrastructure_lines`

### Этап 3: Frontend Integration
**Цель:** Использовать `InfrastructureLineEditor` для редактирования обычных линий

**Изменения в `public/admin.js`:**
```javascript
// Заменить старую функцию editLine на:
async function editLine(lineId) {
    try {
        const response = await fetch(`/api/lines/${lineId}`);
        const line = await response.json();
        
        // Открываем редактор линий инфраструктуры
        // но с адаптацией для таблицы lines
        openLineEditorUnified({
            lineId: lineId,
            lineType: 'electricity', // все lines - электричество
            existingData: line,
            apiEndpoint: '/api/lines', // используем старый endpoint
            onSave: () => {
                dataLoaded.lines = false;
                loadLines();
            }
        });
    } catch (error) {
        console.error('Error loading line:', error);
        showToast('Ошибка загрузки линии', 'error');
    }
}
```

### Этап 4: Универсальный Редактор
**Файл:** `public/unified-line-editor.js`

Создать обёртку над `InfrastructureLineEditor`, которая:
- Принимает параметр `apiEndpoint` (lines или infrastructure-lines)
- Адаптирует данные под нужный формат
- Сохраняет в правильную таблицу
- Поддерживает дополнительные поля (cable_type, commissioning_year для электролиний)

### Этап 5: Map Visualization
**Файл:** `public/map-layers-control.js`

Обновить `loadPowerLines()`:
```javascript
async loadPowerLines() {
    try {
        const response = await fetch('/api/lines');
        const result = await response.json();
        const lines = result.data || [];
        
        const layer = this.overlays["🔌 Линии электропередач"];
        layer.clearLayers();
        
        lines.forEach(line => {
            // Теперь у линий есть main_path!
            if (line.main_path && line.main_path.length >= 2) {
                // Адаптируем формат к infrastructure_lines
                const adaptedLine = {
                    ...line,
                    line_type: 'electricity',
                    display_color: '#FFA500',
                    line_width: 4
                };
                
                this.drawInfrastructureLine(adaptedLine, layer);
            }
        });
        
        this.updateLayerCount("🔌 Линии электропередач", lines.length);
    } catch (error) {
        console.warn('Ошибка при загрузке линий электропередач:', error);
        this.updateLayerCount("🔌 Линии электропередач", 0);
    }
}
```

---

## 📝 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ

### Для Линий Электропередач
При редактировании через карту также показывать текстовые поля:
- ✅ Тип кабеля (cable_type)
- ✅ Год ввода в эксплуатацию (commissioning_year)
- ✅ Напряжение (voltage_kv)
- ✅ Трансформатор (transformer_id)

---

## ✅ ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

После реализации:
1. ✅ Любая линия редактируется через интерактивную карту
2. ✅ Все линии отображаются на главной карте с изломами и ответвлениями
3. ✅ Единый UX для всех типов линий
4. ✅ Обратная совместимость со старыми данными
5. ✅ Дополнительные поля (cable_type, commissioning_year) доступны в редакторе

---

## 🔄 ЭТАПЫ ВЫПОЛНЕНИЯ

- [ ] 1. Миграция БД: добавить main_path/branches к `lines`
- [ ] 2. Обновить модель `Line.js`
- [ ] 3. Создать универсальный редактор
- [ ] 4. Обновить `loadPowerLines()` для отрисовки
- [ ] 5. Интегрировать в админ-панель
- [ ] 6. Протестировать через Chrome MCP

---

**Оценка времени:** ~2-3 часа  
**Сложность:** Medium  
**Приоритет:** High

