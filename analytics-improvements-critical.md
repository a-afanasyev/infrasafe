# Критические улучшения плана инфраструктурной аналитики

## 🚨 **Проблемы оригинального плана и их решения**

### **1. Производительность и масштабируемость**

#### ❌ **Проблема:** Аналитические запросы могут стать узким местом
Оригинальный план предполагает частые JOIN'ы между зданиями, контроллерами и метриками.

#### ✅ **Решение:** Материализованные представления с автообновлением
```sql
-- Материализованное представление для загрузки трансформаторов
CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
SELECT 
    pt.id,
    pt.name,
    pt.capacity_kva,
    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_load,
    MAX(m.timestamp) as last_update
FROM power_transformers pt
LEFT JOIN buildings b ON pt.id = b.power_transformer_id
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id 
    AND m.timestamp > NOW() - INTERVAL '2 hours'
GROUP BY pt.id, pt.name, pt.capacity_kva;

-- Индексы для ускорения обновления
CREATE UNIQUE INDEX ON mv_transformer_load_realtime (id);
CREATE INDEX ON mv_transformer_load_realtime (avg_total_load DESC);

-- Функция автообновления каждые 5 минут
CREATE OR REPLACE FUNCTION refresh_transformer_analytics() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
END;
$$ LANGUAGE plpgsql;

-- Планировщик обновления
SELECT cron.schedule('refresh-analytics', '*/5 * * * *', 'SELECT refresh_transformer_analytics();');
```

### **2. Кэширование критически важных данных**

#### ❌ **Проблема:** Повторные запросы к медленным аналитическим представлениям

#### ✅ **Решение:** Многоуровневое кэширование
```javascript
// src/services/cacheService.js
const Redis = require('redis');
const client = Redis.createClient(process.env.REDIS_URL);

class CacheService {
    constructor() {
        this.defaultTTL = 300; // 5 минут
        this.analyticsCache = new Map(); // In-memory для критических данных
    }
    
    // Для часто запрашиваемой аналитики
    async getTransformerAnalytics(transformerId) {
        const cacheKey = `transformer:${transformerId}:analytics`;
        
        // Сначала проверяем memory cache
        if (this.analyticsCache.has(cacheKey)) {
            const cached = this.analyticsCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 60000) { // 1 минута в памяти
                return cached.data;
            }
        }
        
        // Затем Redis
        try {
            const redisData = await client.get(cacheKey);
            if (redisData) {
                const parsed = JSON.parse(redisData);
                this.analyticsCache.set(cacheKey, {
                    data: parsed,
                    timestamp: Date.now()
                });
                return parsed;
            }
        } catch (error) {
            console.warn('Redis недоступен, используем БД:', error.message);
        }
        
        return null; // Кэш пуст, нужно загрузить из БД
    }
    
    async setTransformerAnalytics(transformerId, data) {
        const cacheKey = `transformer:${transformerId}:analytics`;
        
        // Memory cache
        this.analyticsCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
        
        // Redis cache
        try {
            await client.setEx(cacheKey, this.defaultTTL, JSON.stringify(data));
        } catch (error) {
            console.warn('Не удалось сохранить в Redis:', error.message);
        }
    }
    
    // Инвалидация кэша при обновлении данных
    async invalidateTransformerCache(transformerId) {
        const cacheKey = `transformer:${transformerId}:analytics`;
        this.analyticsCache.delete(cacheKey);
        
        try {
            await client.del(cacheKey);
        } catch (error) {
            console.warn('Не удалось очистить Redis:', error.message);
        }
    }
}

module.exports = new CacheService();
```

### **3. Обработка ошибок и отказоустойчивость**

#### ❌ **Проблема:** План не учитывает сценарии отказа инфраструктуры

#### ✅ **Решение:** Circuit Breaker паттерн для критических запросов
```javascript
// src/utils/circuitBreaker.js
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
    }
    
    async execute(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.failureCount = 0;
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

// Использование в аналитических сервисах
const analyticsCircuitBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 30000
});

class AnalyticsService {
    static async getTransformerLoad(transformerId) {
        return await analyticsCircuitBreaker.execute(async () => {
            // Сначала пытаемся получить из кэша
            const cached = await cacheService.getTransformerAnalytics(transformerId);
            if (cached) return cached;
            
            // Если кэш пуст, запрашиваем из материализованного представления
            const query = `
                SELECT * FROM mv_transformer_load_realtime 
                WHERE id = $1
            `;
            const result = await db.query(query, [transformerId]);
            
            if (result.rows.length === 0) {
                throw new Error(`Трансформатор ${transformerId} не найден`);
            }
            
            const data = result.rows[0];
            await cacheService.setTransformerAnalytics(transformerId, data);
            
            return data;
        });
    }
}
```

### **4. Мониторинг и алертинг инфраструктуры**

#### ❌ **Проблема:** План не включает систему уведомлений о критических изменениях

#### ✅ **Решение:** Система алертов с приоритизацией
```javascript
// src/services/alertService.js
class InfrastructureAlertService {
    constructor() {
        this.thresholds = {
            transformer_overload: 85, // % загрузки
            transformer_critical: 95,
            water_pressure_low: 2.0, // бар
            water_pressure_critical: 1.5,
            heating_temp_delta_low: 15 // °C разность температур
        };
    }
    
    async checkTransformerLoad(transformerId) {
        try {
            const loadData = await AnalyticsService.getTransformerLoad(transformerId);
            const loadPercent = loadData.load_percent;
            
            if (loadPercent > this.thresholds.transformer_critical) {
                await this.createAlert({
                    type: 'TRANSFORMER_CRITICAL_OVERLOAD',
                    infrastructure_id: transformerId,
                    severity: 'CRITICAL',
                    message: `Критическая перегрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`,
                    affected_buildings: loadData.buildings_count,
                    data: loadData
                });
            } else if (loadPercent > this.thresholds.transformer_overload) {
                await this.createAlert({
                    type: 'TRANSFORMER_OVERLOAD',
                    infrastructure_id: transformerId,
                    severity: 'WARNING',
                    message: `Высокая загрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`,
                    affected_buildings: loadData.buildings_count,
                    data: loadData
                });
            }
        } catch (error) {
            console.error(`Ошибка проверки трансформатора ${transformerId}:`, error);
        }
    }
    
    async createAlert(alertData) {
        // Сохраняем в БД
        const query = `
            INSERT INTO infrastructure_alerts 
            (type, infrastructure_id, severity, message, affected_buildings, data, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING alert_id
        `;
        
        const result = await db.query(query, [
            alertData.type,
            alertData.infrastructure_id,
            alertData.severity,
            alertData.message,
            alertData.affected_buildings,
            JSON.stringify(alertData.data)
        ]);
        
        const alertId = result.rows[0].alert_id;
        
        // Отправляем уведомления в зависимости от серьезности
        if (alertData.severity === 'CRITICAL') {
            await this.sendImmediateNotification(alertData);
        }
        
        // WebSocket уведомление для активных пользователей
        this.broadcastAlert(alertData);
        
        return alertId;
    }
    
    async sendImmediateNotification(alertData) {
        // Email, SMS, Telegram, Slack - в зависимости от настроек
        const recipients = await this.getCriticalAlertRecipients();
        
        for (const recipient of recipients) {
            switch (recipient.notification_type) {
                case 'email':
                    await this.sendEmail(recipient.address, alertData);
                    break;
                case 'telegram':
                    await this.sendTelegram(recipient.chat_id, alertData);
                    break;
            }
        }
    }
}
```

### **5. Геопространственная аналитика**

#### ❌ **Проблема:** План не использует преимущества PostGIS для пространственного анализа

#### ✅ **Решение:** Расширенная геоаналитика
```sql
-- Включаем PostGIS если еще не включен
CREATE EXTENSION IF NOT EXISTS postgis;

-- Добавляем геометрические поля
ALTER TABLE power_transformers ADD COLUMN geom geometry(POINT, 4326);
ALTER TABLE buildings ADD COLUMN geom geometry(POINT, 4326);

-- Заполняем геометрию из существующих координат
UPDATE power_transformers SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
UPDATE buildings SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);

-- Создаем пространственные индексы
CREATE INDEX idx_transformers_geom ON power_transformers USING GIST(geom);
CREATE INDEX idx_buildings_geom ON buildings USING GIST(geom);

-- Функция для поиска ближайших зданий к трансформатору
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id VARCHAR(50),
    max_distance_meters INTEGER DEFAULT 1000,
    limit_count INTEGER DEFAULT 50
) RETURNS TABLE (
    building_id INTEGER,
    building_name VARCHAR(100),
    distance_meters NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.building_id,
        b.name,
        ST_Distance(pt.geom::geography, b.geom::geography) as distance_meters
    FROM power_transformers pt
    CROSS JOIN buildings b
    WHERE pt.id = transformer_id
      AND ST_DWithin(pt.geom::geography, b.geom::geography, max_distance_meters)
    ORDER BY distance_meters
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Анализ покрытия зон обслуживания
CREATE VIEW infrastructure_coverage_analysis AS
SELECT 
    iz.zone_id,
    iz.zone_name,
    COUNT(DISTINCT b.building_id) as total_buildings,
    COUNT(DISTINCT CASE WHEN b.power_transformer_id IS NOT NULL THEN b.building_id END) as buildings_with_power,
    COUNT(DISTINCT CASE WHEN b.cold_water_source_id IS NOT NULL THEN b.building_id END) as buildings_with_water,
    COUNT(DISTINCT CASE WHEN b.has_hot_water THEN b.building_id END) as buildings_with_heating,
    ST_Area(iz.boundary::geography) / 1000000 as area_km2 -- если есть границы зон
FROM infrastructure_zones iz
LEFT JOIN buildings b ON ST_Within(b.geom, iz.boundary)
GROUP BY iz.zone_id, iz.zone_name, iz.boundary;
```

### **6. Система резервного копирования аналитических данных**

#### ❌ **Проблема:** Потеря исторических данных аналитики

#### ✅ **Решение:** Архивирование и бэкапы
```sql
-- Таблица для архивирования исторической аналитики
CREATE TABLE analytics_history (
    id BIGSERIAL PRIMARY KEY,
    analysis_type VARCHAR(50) NOT NULL,
    infrastructure_id VARCHAR(50),
    analysis_date DATE NOT NULL,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (analysis_date);

-- Партиции по месяцам
CREATE TABLE analytics_history_2024_01 PARTITION OF analytics_history
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Функция ежедневного архивирования
CREATE OR REPLACE FUNCTION archive_daily_analytics() RETURNS void AS $$
BEGIN
    -- Архивируем загрузку трансформаторов
    INSERT INTO analytics_history (analysis_type, infrastructure_id, analysis_date, analysis_data)
    SELECT 
        'transformer_load',
        id,
        CURRENT_DATE,
        row_to_json(t)
    FROM mv_transformer_load_realtime t;
    
    -- Архивируем другие типы аналитики...
END;
$$ LANGUAGE plpgsql;

-- Планировщик архивирования (выполняется в 2:00 каждый день)
SELECT cron.schedule('archive-analytics', '0 2 * * *', 'SELECT archive_daily_analytics();');
```

### **7. API Rate Limiting и защита**

#### ❌ **Проблема:** Аналитические API могут быть перегружены

#### ✅ **Решение:** Ограничение скорости запросов
```javascript
// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// Ограничения для аналитических эндпоинтов
const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 30, // максимум 30 запросов в минуту
    message: {
        success: false,
        message: 'Слишком много запросов к аналитике. Попробуйте позже.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Замедление при превышении лимитов
const analyticsSlowDown = slowDown({
    windowMs: 60 * 1000,
    delayAfter: 20, // начинаем замедлять после 20 запросов
    delayMs: 500, // задержка 500ms за каждый запрос сверх лимита
    maxDelayMs: 5000 // максимальная задержка 5 секунд
});

// Применение к роутам
app.use('/api/analytics', analyticsLimiter, analyticsSlowDown);
app.use('/api/infrastructure', analyticsLimiter);
```

## 📊 **Дополнительные метрики для мониторинга**

### **Операционные метрики:**
- Время ответа аналитических запросов
- Процент попаданий в кэш
- Количество активированных circuit breaker'ов
- Частота обновления материализованных представлений

### **Бизнес-метрики:**
- Количество критических алертов по инфраструктуре
- Среднее время реакции на инциденты
- Покрытие зданий инфраструктурными объектами
- Эффективность использования ресурсов

## 🎯 **План развертывания улучшений:**

### **Неделя 1:** Производительность
- [ ] Создание материализованных представлений
- [ ] Настройка автообновления
- [ ] Базовое кэширование

### **Неделя 2:** Отказоустойчивость  
- [ ] Реализация Circuit Breaker
- [ ] Система алертов
- [ ] Rate limiting

### **Неделя 3:** Геопространственный анализ
- [ ] Включение PostGIS
- [ ] Пространственные индексы
- [ ] Геоаналитические функции

### **Неделя 4:** Архивирование и мониторинг
- [ ] Система бэкапов аналитики
- [ ] Операционные метрики
- [ ] Документация по maintenance

## ✅ **Ожидаемые результаты:**
- **Производительность:** Уменьшение времени ответа аналитики в 5-10 раз
- **Надежность:** 99.9% uptime для критических аналитических запросов  
- **Масштабируемость:** Поддержка до 10,000 зданий без деградации
- **Операционная эффективность:** Автоматическое обнаружение 95% инцидентов 