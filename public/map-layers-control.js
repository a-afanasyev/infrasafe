class MapLayersControl {
    constructor(map) {
        this.map = map;
        this.layers = {};
        this.overlays = {};
        this.activeFilters = {};
        this.metricsInterval = null;
        
        this.initializeLayers();
        this.createLayerControl();
        this.setupEventHandlers();
    }

    initializeLayers() {
        // Базовые слои
        this.baseLayers = {
            "🗺️ Карта": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }),
            "🛰️ Спутник": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '© Esri'
            }),
            "🏔️ Рельеф": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap'
            })
        };

        // Overlay слои
        this.overlays = {
            "🏢 Здания": L.layerGroup(),
            "⚡ Трансформаторы": L.layerGroup(),
            "🔌 Линии электропередач": L.layerGroup(),
            "💧 Источники воды": L.layerGroup(),
            "🚰 Линии водоснабжения": L.layerGroup(),
            "🔥 Источники тепла": L.layerGroup(),
            "📊 Контроллеры": L.layerGroup(),
            "⚠️ Алерты": L.layerGroup()
        };

        // Добавляем базовый слой
        this.baseLayers["🗺️ Карта"].addTo(this.map);
        
        // Добавляем слой зданий по умолчанию
        this.overlays["🏢 Здания"].addTo(this.map);
    }

    createLayerControl() {
        // Создаем кастомную панель управления
        const controlDiv = L.DomUtil.create('div', 'layers-control-panel');
        controlDiv.innerHTML = `
            <div class="layers-header">
                <h3>🗺️ Слои карты</h3>
                <button class="toggle-btn" onclick="this.parentElement.parentElement.classList.toggle('collapsed')">−</button>
            </div>
            
            <div class="base-layers-section">
                <h4>Базовые слои</h4>
                <div class="base-layers-list"></div>
            </div>
            
            <div class="overlay-layers-section">
                <h4>Объекты инфраструктуры</h4>
                <div class="overlay-layers-list"></div>
            </div>
            
            <div class="filters-section">
                <h4>🔍 Фильтры</h4>
                <div class="filters-list">
                    <div class="filter-group">
                        <label>Статус:</label>
                        <select id="status-filter" multiple>
                            <option value="active">Активный</option>
                            <option value="maintenance">Обслуживание</option>
                            <option value="inactive">Неактивный</option>
                            <option value="critical">Критический</option>
                        </select>
                    </div>
                    
                    <div class="filter-group">
                        <label>Загрузка трансформаторов:</label>
                        <input type="range" id="load-filter" min="0" max="100" value="100">
                        <span id="load-value">100%</span>
                    </div>
                    
                    <div class="filter-group">
                        <label>Тип водоснабжения:</label>
                        <select id="water-type-filter">
                            <option value="">Все</option>
                            <option value="cold_water">Холодная вода</option>
                            <option value="hot_water">Горячая вода</option>
                        </select>
                    </div>
                </div>
                
                <button class="apply-filters-btn" onclick="mapLayersControl.applyFilters()">
                    Применить фильтры
                </button>
                <button class="reset-filters-btn" onclick="mapLayersControl.resetFilters()">
                    Сбросить
                </button>
            </div>
            
            <div class="metrics-section">
                <h4>📊 Метрики в реальном времени</h4>
                <label>
                    <input type="checkbox" id="real-time-metrics" onchange="mapLayersControl.toggleRealTimeMetrics(this.checked)">
                    Обновлять метрики (30 сек)
                </label>
            </div>
        `;

        // Создаем Leaflet control
        const LayersControl = L.Control.extend({
            onAdd: function(map) {
                return controlDiv;
            }
        });

        this.layersControl = new LayersControl({ position: 'topright' });
        this.layersControl.addTo(this.map);

        this.populateLayerControls();
    }

    populateLayerControls() {
        const baseLayersList = document.querySelector('.base-layers-list');
        const overlayLayersList = document.querySelector('.overlay-layers-list');

        // Базовые слои
        Object.keys(this.baseLayers).forEach(name => {
            const label = L.DomUtil.create('label', 'layer-control-item', baseLayersList);
            const input = L.DomUtil.create('input', '', label);
            input.type = 'radio';
            input.name = 'base-layer';
            input.value = name;
            input.checked = name === "🗺️ Карта";
            
            const span = L.DomUtil.create('span', '', label);
            span.textContent = name;
            
            input.addEventListener('change', () => {
                if (input.checked) {
                    this.switchBaseLayer(name);
                }
            });
        });

        // Overlay слои
        Object.keys(this.overlays).forEach(name => {
            const label = L.DomUtil.create('label', 'layer-control-item', overlayLayersList);
            const input = L.DomUtil.create('input', '', label);
            input.type = 'checkbox';
            input.value = name;
            input.checked = name === "🏢 Здания";
            
            const span = L.DomUtil.create('span', '', label);
            span.textContent = name;
            
            const countSpan = L.DomUtil.create('span', 'layer-count', label);
            countSpan.textContent = '(0)';
            
            input.addEventListener('change', () => {
                this.toggleOverlay(name, input.checked);
            });
        });
    }

    switchBaseLayer(layerName) {
        // Удаляем все базовые слои
        Object.values(this.baseLayers).forEach(layer => {
            this.map.removeLayer(layer);
        });
        
        // Добавляем выбранный слой
        this.baseLayers[layerName].addTo(this.map);
    }

    toggleOverlay(layerName, show) {
        if (show) {
            this.overlays[layerName].addTo(this.map);
            this.loadLayerData(layerName);
        } else {
            this.map.removeLayer(this.overlays[layerName]);
        }
    }

    async loadLayerData(layerName) {
        const token = localStorage.getItem('token');
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        try {
            switch (layerName) {
                case "🏢 Здания":
                    await this.loadBuildings(headers);
                    break;
                case "⚡ Трансформаторы":
                    await this.loadTransformers(headers);
                    break;
                case "🔌 Линии электропередач":
                    await this.loadPowerLines(headers);
                    break;
                case "💧 Источники воды":
                    await this.loadWaterSources(headers);
                    break;
                case "🚰 Линии водоснабжения":
                    await this.loadWaterLines(headers);
                    break;
                case "🔥 Источники тепла":
                    await this.loadHeatSources(headers);
                    break;
                case "📊 Контроллеры":
                    await this.loadControllers(headers);
                    break;
                case "⚠️ Алерты":
                    await this.loadAlerts(headers);
                    break;
            }
        } catch (error) {
            console.error(`Ошибка загрузки данных для слоя ${layerName}:`, error);
        }
    }

    async loadTransformers(headers) {
        const response = await fetch('/api/analytics/transformers', { headers });
        const data = await response.json();
        
        const layer = this.overlays["⚡ Трансформаторы"];
        layer.clearLayers();

        data.data.forEach(transformer => {
            const marker = this.createTransformerMarker(transformer);
            layer.addLayer(marker);
        });

        this.updateLayerCount("⚡ Трансформаторы", data.data.length);
    }

    createTransformerMarker(transformer) {
        const loadPercent = parseFloat(transformer.load_percent) || 0;
        const color = this.getLoadColor(loadPercent);
        const radius = 8 + (parseFloat(transformer.capacity_kva) / 500);
        
        const marker = L.circleMarker([transformer.latitude, transformer.longitude], {
            radius: Math.min(radius, 20),
            fillColor: color,
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        marker.bindPopup(() => this.createTransformerPopup(transformer));
        
        // Добавляем tooltip
        marker.bindTooltip(`⚡ ${transformer.name}<br/>Загрузка: ${loadPercent.toFixed(1)}%`, {
            permanent: false,
            direction: 'top'
        });

        return marker;
    }

    createTransformerPopup(transformer) {
        const loadPercent = parseFloat(transformer.load_percent) || 0;
        
        return `
            <div class="transformer-popup">
                <h4>⚡ ${transformer.name}</h4>
                <div class="transformer-info">
                    <p><strong>Мощность:</strong> ${transformer.capacity_kva} кВА</p>
                    <p><strong>Загрузка:</strong> 
                        <span class="load-indicator" style="color: ${this.getLoadColor(loadPercent)}">
                            ${loadPercent.toFixed(1)}%
                        </span>
                    </p>
                    <p><strong>Статус:</strong> 
                        <span class="status-badge status-${transformer.status}">${transformer.status}</span>
                    </p>
                    <p><strong>Подключенных зданий:</strong> ${transformer.buildings_count}</p>
                    <p><strong>Контроллеров:</strong> ${transformer.controllers_count}</p>
                </div>
                
                <div class="transformer-actions">
                    <button onclick="mapLayersControl.showTransformerMetrics('${transformer.id}')" class="btn-metrics">
                        📊 Показать метрики
                    </button>
                    <button onclick="mapLayersControl.showNearbyBuildings('${transformer.id}')" class="btn-buildings">
                        🏢 Ближайшие здания
                    </button>
                </div>
                
                <div id="transformer-metrics-${transformer.id}" class="metrics-container" style="display: none;">
                    <div class="loading">Загрузка метрик...</div>
                </div>
            </div>
        `;
    }

    async loadWaterLines(headers) {
        const response = await fetch('/api/water-lines', { headers });
        const data = await response.json();
        
        const layer = this.overlays["🚰 Линии водоснабжения"];
        layer.clearLayers();

        data.data.forEach(line => {
            // Генерируем координаты линии (в реальном проекте они должны быть в БД)
            const coordinates = this.generateLineCoordinates(line);
            const polyline = this.createWaterLine(line, coordinates);
            layer.addLayer(polyline);
        });

        this.updateLayerCount("🚰 Линии водоснабжения", data.data.length);
    }

    createWaterLine(line, coordinates) {
        const pressureColor = this.getPressureColor(parseFloat(line.pressure_rating));
        const weight = 3 + (line.diameter_mm / 100);
        
        const polyline = L.polyline(coordinates, {
            color: pressureColor,
            weight: Math.min(weight, 8),
            opacity: 0.7,
            dashArray: line.line_type === 'hot_water' ? '5, 5' : null
        });

        polyline.bindPopup(`
            <div class="water-line-popup">
                <h4>🚰 ${line.name}</h4>
                <p><strong>Диаметр:</strong> ${line.diameter_mm} мм</p>
                <p><strong>Давление:</strong> ${line.pressure_rating} бар</p>
                <p><strong>Материал:</strong> ${line.material}</p>
                <p><strong>Длина:</strong> ${line.length_km} км</p>
                <p><strong>Тип:</strong> ${line.line_type || 'Не указан'}</p>
                <p><strong>Статус:</strong> 
                    <span class="status-badge status-${line.status}">${line.status}</span>
                </p>
                <p><strong>Подключенных зданий:</strong> ${line.connected_buildings_count}</p>
            </div>
        `);

        return polyline;
    }

    generateLineCoordinates(line) {
        // В реальном проекте координаты должны храниться в БД как GeoJSON
        // Здесь генерируем примерные координаты для демонстрации
        const baseLatitude = 41.3111;
        const baseLongitude = 69.2797;
        
        const startLat = baseLatitude + (Math.random() - 0.5) * 0.1;
        const startLng = baseLongitude + (Math.random() - 0.5) * 0.1;
        const endLat = startLat + (Math.random() - 0.5) * 0.05;
        const endLng = startLng + (Math.random() - 0.5) * 0.05;
        
        return [
            [startLat, startLng],
            [startLat + (endLat - startLat) * 0.3, startLng + (endLng - startLng) * 0.2],
            [startLat + (endLat - startLat) * 0.7, startLng + (endLng - startLng) * 0.8],
            [endLat, endLng]
        ];
    }

    getLoadColor(loadPercent) {
        if (loadPercent > 90) return '#ff4444'; // Критическая загрузка
        if (loadPercent > 75) return '#ff8800'; // Высокая загрузка
        if (loadPercent > 50) return '#ffdd00'; // Средняя загрузка
        return '#44ff44'; // Низкая загрузка
    }

    getPressureColor(pressure) {
        if (pressure > 8) return '#0066cc'; // Высокое давление
        if (pressure > 5) return '#0099ff'; // Среднее давление
        if (pressure > 3) return '#66ccff'; // Низкое давление
        return '#cccccc'; // Очень низкое давление
    }

    updateLayerCount(layerName, count) {
        const label = document.querySelector(`input[value="${layerName}"]`).parentElement;
        const countSpan = label.querySelector('.layer-count');
        if (countSpan) {
            countSpan.textContent = `(${count})`;
        }
    }

    async showTransformerMetrics(transformerId) {
        const container = document.getElementById(`transformer-metrics-${transformerId}`);
        container.style.display = 'block';
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/analytics/transformers/${transformerId}/load`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                container.innerHTML = this.renderMetricsChart(data);
            } else {
                container.innerHTML = '<p>Метрики недоступны</p>';
            }
        } catch (error) {
            container.innerHTML = '<p>Ошибка загрузки метрик</p>';
        }
    }

    renderMetricsChart(data) {
        // Простая визуализация метрик
        return `
            <div class="metrics-chart">
                <h5>📊 Метрики загрузки</h5>
                <div class="metric-item">
                    <span>Текущая загрузка:</span>
                    <div class="progress-bar">
                        <div class="progress" style="width: ${data.current_load || 0}%"></div>
                    </div>
                    <span>${(data.current_load || 0).toFixed(1)}%</span>
                </div>
                <div class="metric-item">
                    <span>Средняя за час:</span>
                    <span>${(data.avg_load_hour || 0).toFixed(1)}%</span>
                </div>
                <div class="metric-item">
                    <span>Пиковая за день:</span>
                    <span>${(data.peak_load_day || 0).toFixed(1)}%</span>
                </div>
            </div>
        `;
    }

    toggleRealTimeMetrics(enabled) {
        if (enabled) {
            this.metricsInterval = setInterval(() => {
                this.updateRealTimeMetrics();
            }, 30000); // Обновление каждые 30 секунд
        } else {
            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
                this.metricsInterval = null;
            }
        }
    }

    async updateRealTimeMetrics() {
        // Обновляем метрики для видимых слоев
        if (this.map.hasLayer(this.overlays["⚡ Трансформаторы"])) {
            await this.loadTransformers({
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            });
        }
    }

    applyFilters() {
        const statusFilter = Array.from(document.getElementById('status-filter').selectedOptions)
            .map(option => option.value);
        const loadFilter = parseInt(document.getElementById('load-filter').value);
        const waterTypeFilter = document.getElementById('water-type-filter').value;

        this.activeFilters = {
            status: statusFilter,
            maxLoad: loadFilter,
            waterType: waterTypeFilter
        };

        // Перезагружаем видимые слои с фильтрами
        Object.keys(this.overlays).forEach(layerName => {
            if (this.map.hasLayer(this.overlays[layerName])) {
                this.loadLayerData(layerName);
            }
        });
    }

    resetFilters() {
        document.getElementById('status-filter').selectedIndex = -1;
        document.getElementById('load-filter').value = 100;
        document.getElementById('load-value').textContent = '100%';
        document.getElementById('water-type-filter').value = '';
        
        this.activeFilters = {};
        this.applyFilters();
    }

    setupEventHandlers() {
        // Обновление значения слайдера загрузки
        document.getElementById('load-filter').addEventListener('input', function() {
            document.getElementById('load-value').textContent = this.value + '%';
        });
    }
}

// Инициализация после загрузки карты
let mapLayersControl;

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapLayersControl;
} 