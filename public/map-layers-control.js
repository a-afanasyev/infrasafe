class MapLayersControl {
    constructor(map) {
        this.map = map;
        this.layers = {};
        this.overlays = {};
        this.activeFilters = {};
        this.metricsInterval = null;
        
        // Ждем полной загрузки DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.init();
            });
        } else {
            this.init();
        }
    }

    init() {
        console.log('🗺️ Initializing map layers control...');
        this.initializeLayers();
        this.createLayerControl();
        this.setupEventHandlers();
        
        // Автоматически загружаем слой зданий при старте
        this.overlays["🏢 Здания"].addTo(this.map);
        this.loadLayerData("🏢 Здания");
        
        console.log('✅ Map layers control initialized successfully');
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
        // ИСПРАВЛЕНИЕ XSS: Создаем панель управления безопасно через DOM API
        // Заменено innerHTML на createElement + addEventListener для CSP compliance
        const controlDiv = L.DomUtil.create('div', 'layers-control-panel');
        
        // Header с кнопкой закрытия
        const header = document.createElement('div');
        header.className = 'layers-header';
        
        const title = document.createElement('h3');
        title.textContent = '🗺️ Слои карты';
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-btn';
        toggleBtn.textContent = '−';
        toggleBtn.addEventListener('click', function() {
            this.parentElement.parentElement.classList.toggle('collapsed');
        });
        
        header.appendChild(title);
        header.appendChild(toggleBtn);
        controlDiv.appendChild(header);
        
        // Base layers section
        const baseSection = document.createElement('div');
        baseSection.className = 'base-layers-section';
        const baseTitle = document.createElement('h4');
        baseTitle.textContent = 'Базовые слои';
        const baseList = document.createElement('div');
        baseList.className = 'base-layers-list';
        baseSection.appendChild(baseTitle);
        baseSection.appendChild(baseList);
        controlDiv.appendChild(baseSection);
        
        // Overlay layers section
        const overlaySection = document.createElement('div');
        overlaySection.className = 'overlay-layers-section';
        const overlayTitle = document.createElement('h4');
        overlayTitle.textContent = 'Объекты инфраструктуры';
        const overlayList = document.createElement('div');
        overlayList.className = 'overlay-layers-list';
        overlaySection.appendChild(overlayTitle);
        overlaySection.appendChild(overlayList);
        controlDiv.appendChild(overlaySection);
        
        // Filters section
        const filtersSection = document.createElement('div');
        filtersSection.className = 'filters-section';
        const filtersTitle = document.createElement('h4');
        filtersTitle.textContent = '🔍 Фильтры';
        filtersSection.appendChild(filtersTitle);
        
        const filtersList = document.createElement('div');
        filtersList.className = 'filters-list';
        
        // Status filter
        const statusGroup = document.createElement('div');
        statusGroup.className = 'filter-group';
        const statusLabel = document.createElement('label');
        statusLabel.textContent = 'Статус:';
        const statusSelect = document.createElement('select');
        statusSelect.id = 'status-filter';
        statusSelect.multiple = true;
        ['active', 'maintenance', 'inactive', 'critical'].forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = {
                'active': 'Активный',
                'maintenance': 'Обслуживание',
                'inactive': 'Неактивный',
                'critical': 'Критический'
            }[value];
            statusSelect.appendChild(option);
        });
        statusGroup.appendChild(statusLabel);
        statusGroup.appendChild(statusSelect);
        filtersList.appendChild(statusGroup);
        
        // Load filter
        const loadGroup = document.createElement('div');
        loadGroup.className = 'filter-group';
        const loadLabel = document.createElement('label');
        loadLabel.textContent = 'Загрузка трансформаторов:';
        const loadInput = document.createElement('input');
        loadInput.type = 'range';
        loadInput.id = 'load-filter';
        loadInput.min = '0';
        loadInput.max = '100';
        loadInput.value = '100';
        const loadSpan = document.createElement('span');
        loadSpan.id = 'load-value';
        loadSpan.textContent = '100%';
        loadGroup.appendChild(loadLabel);
        loadGroup.appendChild(loadInput);
        loadGroup.appendChild(loadSpan);
        filtersList.appendChild(loadGroup);
        
        // Water type filter
        const waterGroup = document.createElement('div');
        waterGroup.className = 'filter-group';
        const waterLabel = document.createElement('label');
        waterLabel.textContent = 'Тип водоснабжения:';
        const waterSelect = document.createElement('select');
        waterSelect.id = 'water-type-filter';
        [['', 'Все'], ['cold_water', 'Холодная вода'], ['hot_water', 'Горячая вода']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            waterSelect.appendChild(option);
        });
        waterGroup.appendChild(waterLabel);
        waterGroup.appendChild(waterSelect);
        filtersList.appendChild(waterGroup);
        
        filtersSection.appendChild(filtersList);
        
        // Apply filters button
        const applyBtn = document.createElement('button');
        applyBtn.className = 'apply-filters-btn';
        applyBtn.textContent = 'Применить фильтры';
        applyBtn.addEventListener('click', () => this.applyFilters());
        filtersSection.appendChild(applyBtn);
        
        // Reset filters button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'reset-filters-btn';
        resetBtn.textContent = 'Сбросить';
        resetBtn.addEventListener('click', () => this.resetFilters());
        filtersSection.appendChild(resetBtn);
        
        controlDiv.appendChild(filtersSection);
        
        // Metrics section
        const metricsSection = document.createElement('div');
        metricsSection.className = 'metrics-section';
        const metricsTitle = document.createElement('h4');
        metricsTitle.textContent = '📊 Метрики в реальном времени';
        const metricsLabel = document.createElement('label');
        const metricsCheckbox = document.createElement('input');
        metricsCheckbox.type = 'checkbox';
        metricsCheckbox.id = 'real-time-metrics';
        metricsCheckbox.addEventListener('change', (e) => this.toggleRealTimeMetrics(e.target.checked));
        metricsLabel.appendChild(metricsCheckbox);
        metricsLabel.appendChild(document.createTextNode(' Обновлять метрики (30 сек)'));
        metricsSection.appendChild(metricsTitle);
        metricsSection.appendChild(metricsLabel);
        controlDiv.appendChild(metricsSection);

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

    async loadBuildings(headers) {
        const response = await fetch('/api/buildings-metrics', { headers });
        const data = await response.json();
        
        const layer = this.overlays["🏢 Здания"];
        layer.clearLayers();

        data.data.forEach(building => {
            const marker = this.createBuildingMarker(building);
            layer.addLayer(marker);
        });

        this.updateLayerCount("🏢 Здания", data.data.length);
    }

    async loadTransformers(headers) {
        // Используем основной endpoint transformers который возвращает координаты
        const response = await fetch('/api/transformers?page=1&limit=100', { headers });
        const data = await response.json();
        
        const layer = this.overlays["⚡ Трансформаторы"];
        layer.clearLayers();

        const transformers = data.data || [];
        let displayedCount = 0;

        transformers.forEach(transformer => {
            // Проверяем наличие координат
            if (transformer.latitude && transformer.longitude) {
                const marker = this.createTransformerMarker(transformer);
                layer.addLayer(marker);
                displayedCount++;
            }
        });

        this.updateLayerCount("⚡ Трансформаторы", displayedCount);
    }

    createBuildingMarker(building) {
        // Определяем цвет маркера на основе статуса контроллера
        let color = '#666'; // По умолчанию серый
        if (building.controller_status === 'online') {
            color = '#28a745'; // Зеленый для онлайн
        } else if (building.controller_status === 'warning') {
            color = '#ffc107'; // Желтый для предупреждения
        } else if (building.controller_status === 'offline') {
            color = '#dc3545'; // Красный для офлайн
        }
        
        const lat = parseFloat(building.latitude);
        const lng = parseFloat(building.longitude);
        
        const marker = L.circleMarker([lat, lng], {
            radius: 6,
            fillColor: color,
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        marker.bindPopup(() => this.createBuildingPopup(building));
        
        // Добавляем tooltip
        const statusText = building.controller_status ? building.controller_status : 'Нет данных';
        marker.bindTooltip(`🏢 ${building.building_name}<br/>Статус: ${statusText}`, {
            permanent: false,
            direction: 'top'
        });

        return marker;
    }

    createTransformerMarker(transformer) {
        const powerKVA = parseFloat(transformer.power_kva) || 0;
        // Цвет по мощности: зелёный для малых, жёлтый для средних, оранжевый для больших
        let color = '#4CAF50'; // зелёный (< 500 кВА)
        if (powerKVA >= 500 && powerKVA < 1000) {
            color = '#FFC107'; // жёлтый
        } else if (powerKVA >= 1000) {
            color = '#FF9800'; // оранжевый
        }
        
        const radius = 8 + Math.min(powerKVA / 200, 10);
        
        // Преобразуем координаты в числа (API возвращает строки)
        const lat = parseFloat(transformer.latitude);
        const lng = parseFloat(transformer.longitude);
        
        const marker = L.circleMarker([lat, lng], {
            radius: Math.min(radius, 18),
            fillColor: color,
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        // Создаём popup
        const popupContent = `
            <div style="min-width: 260px;">
                <h4 style="margin: 0 0 10px 0;">⚡ Трансформатор</h4>
                <p style="margin: 5px 0;"><strong>Название:</strong> ${transformer.name}</p>
                <p style="margin: 5px 0;"><strong>Мощность:</strong> ${powerKVA} кВА</p>
                <p style="margin: 5px 0;"><strong>Напряжение:</strong> ${transformer.voltage_kv || 'N/A'} кВ</p>
                ${transformer.location ? `<p style="margin: 5px 0;"><strong>Адрес:</strong> ${transformer.location}</p>` : ''}
                ${transformer.status ? `<p style="margin: 5px 0;"><strong>Статус:</strong> <span style="color: ${transformer.status === 'active' ? 'green' : 'red'};">${transformer.status}</span></p>` : ''}
                ${transformer.primary_buildings && transformer.primary_buildings.length > 0 ? `<p style="margin: 5px 0;"><strong>Основные здания:</strong> ${transformer.primary_buildings.join(', ')}</p>` : ''}
                ${transformer.backup_buildings && transformer.backup_buildings.length > 0 ? `<p style="margin: 5px 0;"><strong>Резервные здания:</strong> ${transformer.backup_buildings.join(', ')}</p>` : ''}
            </div>
        `;

        marker.bindPopup(popupContent);
        
        // Добавляем tooltip
        marker.bindTooltip(`⚡ ${transformer.name}<br/>Мощность: ${powerKVA} кВА`, {
            permanent: false,
            direction: 'top'
        });

        return marker;
    }

    createBuildingPopup(building) {
        const hasController = building.controller_id !== null;
        const hasMetrics = building.timestamp !== null;
        
        return `
            <div class="building-popup">
                <h4>🏢 ${building.building_name}</h4>
                <div class="building-info">
                    <p><strong>Адрес:</strong> ${building.address}</p>
                    <p><strong>Город:</strong> ${building.town}</p>
                    <p><strong>Управляющая компания:</strong> ${building.management_company || 'Не указана'}</p>
                    <p><strong>Горячая вода:</strong> ${building.hot_water ? '✅ Есть' : '❌ Нет'}</p>
                    ${hasController ? `
                        <p><strong>Контроллер:</strong> ${building.controller_serial}</p>
                        <p><strong>Статус контроллера:</strong> 
                            <span class="status-badge status-${building.controller_status}">${building.controller_status}</span>
                        </p>
                    ` : '<p><strong>Контроллер:</strong> ❌ Не подключен</p>'}
                </div>
                
                ${hasMetrics ? `
                    <div class="building-metrics">
                        <h5>📊 Последние метрики</h5>
                        <div class="metrics-grid">
                            ${building.electricity_ph1 ? `
                                <div class="metric-item">
                                    <span class="metric-label">⚡ Напряжение Ф1:</span>
                                    <span class="metric-value">${building.electricity_ph1} В</span>
                                </div>
                            ` : ''}
                            ${building.electricity_ph2 ? `
                                <div class="metric-item">
                                    <span class="metric-label">⚡ Напряжение Ф2:</span>
                                    <span class="metric-value">${building.electricity_ph2} В</span>
                                </div>
                            ` : ''}
                            ${building.electricity_ph3 ? `
                                <div class="metric-item">
                                    <span class="metric-label">⚡ Напряжение Ф3:</span>
                                    <span class="metric-value">${building.electricity_ph3} В</span>
                                </div>
                            ` : ''}
                            ${building.cold_water_pressure ? `
                                <div class="metric-item">
                                    <span class="metric-label">💧 Давление ХВ:</span>
                                    <span class="metric-value">${building.cold_water_pressure} бар</span>
                                </div>
                            ` : ''}
                            ${building.cold_water_temp ? `
                                <div class="metric-item">
                                    <span class="metric-label">🌡️ Температура ХВ:</span>
                                    <span class="metric-value">${building.cold_water_temp}°C</span>
                                </div>
                            ` : ''}
                            ${building.hot_water_in_temp ? `
                                <div class="metric-item">
                                    <span class="metric-label">🔥 Температура ГВ (подача):</span>
                                    <span class="metric-value">${building.hot_water_in_temp}°C</span>
                                </div>
                            ` : ''}
                            ${building.leak_sensor !== null ? `
                                <div class="metric-item">
                                    <span class="metric-label">🚨 Датчик протечки:</span>
                                    <span class="metric-value ${building.leak_sensor ? 'alert' : 'normal'}">
                                        ${building.leak_sensor ? '⚠️ Обнаружена протечка' : '✅ Норма'}
                                    </span>
                                </div>
                            ` : ''}
                        </div>
                        <p class="timestamp">🕒 Обновлено: ${new Date(building.timestamp).toLocaleString('ru-RU')}</p>
                    </div>
                ` : ''}
                
                <div class="building-actions">
                    ${hasController ? `
                        <button onclick="mapLayersControl.showBuildingMetrics('${building.building_id}')" class="btn-metrics">
                            📊 Показать метрики
                        </button>
                    ` : ''}
                    <button onclick="mapLayersControl.showBuildingDetails('${building.building_id}')" class="btn-details">
                        ℹ️ Подробности
                    </button>
                </div>
            </div>
        `;
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
                // ИСПРАВЛЕНИЕ XSS: Используем DOMSecurity для безопасной вставки HTML
                if (window.DOMSecurity) {
                    const chartHTML = this.renderMetricsChart(data);
                    window.DOMSecurity.setSecureHTML(container, chartHTML);
                } else {
                    // Fallback: создаем элемент вручную
                    container.innerHTML = '';
                    const p = document.createElement('p');
                    p.textContent = 'Метрики загружены';
                    container.appendChild(p);
                }
            } else {
                // ИСПРАВЛЕНИЕ XSS: Используем textContent для простого сообщения
                container.innerHTML = '';
                const p = document.createElement('p');
                p.textContent = 'Метрики недоступны';
                container.appendChild(p);
            }
        } catch (error) {
            // ИСПРАВЛЕНИЕ XSS: Используем textContent для сообщения об ошибке
            container.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = 'Ошибка загрузки метрик';
            container.appendChild(p);
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

    // Загрузка линий электропередач на карту
    async loadPowerLines(headers) {
        const response = await fetch('/api/lines', { headers });
        const data = await response.json();
        
        const layer = this.overlays["🔌 Линии электропередач"];
        layer.clearLayers();

        const lines = data.data || [];

        lines.forEach(line => {
            // Для линий нужны координаты трансформаторов которые они соединяют
            // Пока отобразим как текстовые маркеры в центре карты или не отображаем
            // TODO: Реализовать получение координат трансформаторов и рисование линий
        });

        this.updateLayerCount("🔌 Линии электропередач", lines.length);
    }

    // Загрузка источников воды на карту
    async loadWaterSources(headers) {
        try {
            const response = await fetch('/api/water-sources', { headers });
            
            // Endpoint может не существовать (404)
            if (response.status === 404) {
                console.warn('Water sources endpoint not available');
                this.updateLayerCount("💧 Источники воды", 0);
                return;
            }
            
            const data = await response.json();
            const layer = this.overlays["💧 Источники воды"];
            layer.clearLayers();

            const sources = data.data || [];

            sources.forEach(source => {
                if (source.latitude && source.longitude) {
                    const lat = parseFloat(source.latitude);
                    const lng = parseFloat(source.longitude);
                    
                    const marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'water-source-marker',
                            html: `<div style="background: #03A9F4; color: white; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">💧</div>`,
                            iconSize: [32, 32]
                        })
                    });

                    const popupContent = `
                        <div style="min-width: 250px;">
                            <h4 style="margin: 0 0 10px 0;">💧 Источник воды</h4>
                            <p style="margin: 5px 0;"><strong>Название:</strong> ${source.name || 'N/A'}</p>
                            <p style="margin: 5px 0;"><strong>Тип:</strong> ${source.type || 'N/A'}</p>
                            ${source.capacity ? `<p style="margin: 5px 0;"><strong>Мощность:</strong> ${source.capacity} м³/час</p>` : ''}
                            ${source.status ? `<p style="margin: 5px 0;"><strong>Статус:</strong> ${source.status}</p>` : ''}
                        </div>
                    `;

                    marker.bindPopup(popupContent);
                    marker.bindTooltip(`💧 ${source.name || 'Источник воды'}`, {
                        permanent: false,
                        direction: 'top'
                    });

                    layer.addLayer(marker);
                }
            });

            this.updateLayerCount("💧 Источники воды", sources.length);
        } catch (error) {
            console.warn('Error loading water sources:', error);
            this.updateLayerCount("💧 Источники воды", 0);
        }
    }

    // Загрузка источников тепла на карту
    async loadHeatSources(headers) {
        try {
            const response = await fetch('/api/heat-sources', { headers });
            
            // Endpoint может вернуть ошибку
            if (!response.ok) {
                console.warn('Heat sources endpoint error:', response.status);
                this.updateLayerCount("🔥 Источники тепла", 0);
                return;
            }
            
            const data = await response.json();
            const layer = this.overlays["🔥 Источники тепла"];
            layer.clearLayers();

            const sources = data.data || [];

            sources.forEach(source => {
                if (source.latitude && source.longitude) {
                    const lat = parseFloat(source.latitude);
                    const lng = parseFloat(source.longitude);
                    
                    const marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'heat-source-marker',
                            html: `<div style="background: #FF5722; color: white; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">🔥</div>`,
                            iconSize: [32, 32]
                        })
                    });

                    const popupContent = `
                        <div style="min-width: 250px;">
                            <h4 style="margin: 0 0 10px 0;">🔥 Источник тепла</h4>
                            <p style="margin: 5px 0;"><strong>Название:</strong> ${source.name || 'N/A'}</p>
                            <p style="margin: 5px 0;"><strong>Тип:</strong> ${source.type || 'N/A'}</p>
                            ${source.capacity ? `<p style="margin: 5px 0;"><strong>Мощность:</strong> ${source.capacity} Гкал/час</p>` : ''}
                            ${source.status ? `<p style="margin: 5px 0;"><strong>Статус:</strong> ${source.status}</p>` : ''}
                        </div>
                    `;

                    marker.bindPopup(popupContent);
                    marker.bindTooltip(`🔥 ${source.name || 'Источник тепла'}`, {
                        permanent: false,
                        direction: 'top'
                    });

                    layer.addLayer(marker);
                }
            });

            this.updateLayerCount("🔥 Источники тепла", sources.length);
        } catch (error) {
            console.warn('Error loading heat sources:', error);
            this.updateLayerCount("🔥 Источники тепла", 0);
        }
    }

    // Загрузка контроллеров на карту
    async loadControllers(headers) {
        const response = await fetch('/api/buildings-metrics', { headers });
        const data = await response.json();
        
        const layer = this.overlays["📊 Контроллеры"];
        layer.clearLayers();

        // Фильтруем только здания с контроллерами
        const buildingsWithControllers = (data.data || []).filter(b => b.controller_id);

        buildingsWithControllers.forEach(building => {
            // Создаём маркер для контроллера (используем те же координаты что и здание)
            const lat = parseFloat(building.latitude);
            const lng = parseFloat(building.longitude);
            
            const marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'controller-marker',
                    html: `<div style="background: #2196F3; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">📊</div>`,
                    iconSize: [30, 30]
                })
            });

            // Создаём popup с информацией о контроллере
            const popupContent = `
                <div style="min-width: 250px;">
                    <h4 style="margin: 0 0 10px 0;">📊 Контроллер</h4>
                    <p style="margin: 5px 0;"><strong>ID:</strong> ${building.controller_id}</p>
                    <p style="margin: 5px 0;"><strong>Здание:</strong> ${building.building_name || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Адрес:</strong> ${building.address || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Статус:</strong> <span style="color: ${building.controller_status === 'online' ? 'green' : 'red'};">${building.controller_status || 'unknown'}</span></p>
                    ${building.latest_metric_time ? `<p style="margin: 5px 0;"><strong>Последние данные:</strong> ${new Date(building.latest_metric_time).toLocaleString('ru-RU')}</p>` : ''}
                </div>
            `;

            marker.bindPopup(popupContent);
            marker.bindTooltip(`📊 Контроллер #${building.controller_id}`, {
                permanent: false,
                direction: 'top'
            });

            layer.addLayer(marker);
        });

        this.updateLayerCount("📊 Контроллеры", buildingsWithControllers.length);
    }

    // Загрузка алертов на карту
    async loadAlerts(headers) {
        const response = await fetch('/api/alerts?status=active', { headers });
        const data = await response.json();
        
        const layer = this.overlays["⚠️ Алерты"];
        layer.clearLayers();

        const alerts = data.data || [];

        // Получаем данные о зданиях для координат
        const buildingsResponse = await fetch('/api/buildings-metrics', { headers });
        const buildingsData = await buildingsResponse.json();
        const buildingsMap = {};
        (buildingsData.data || []).forEach(b => {
            buildingsMap[b.building_id] = b;
        });

        let displayedAlerts = 0;

        alerts.forEach(alert => {
            // Пробуем получить координаты из affected_buildings
            const affectedBuildingIds = alert.affected_buildings || [];
            
            if (affectedBuildingIds.length > 0) {
                const buildingId = affectedBuildingIds[0];
                const building = buildingsMap[buildingId];
                
                if (building && building.latitude && building.longitude) {
                    const lat = parseFloat(building.latitude);
                    const lng = parseFloat(building.longitude);
                    
                    const marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'alert-marker',
                            html: `<div style="background: ${this.getAlertColor(alert.severity)}; color: white; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">⚠️</div>`,
                            iconSize: [35, 35]
                        })
                    });

                    const popupContent = `
                        <div style="min-width: 280px;">
                            <h4 style="margin: 0 0 10px 0; color: ${this.getAlertColor(alert.severity)};">⚠️ ${alert.type || 'Алерт'}</h4>
                            <p style="margin: 5px 0;"><strong>Важность:</strong> <span style="color: ${this.getAlertColor(alert.severity)};">${alert.severity}</span></p>
                            <p style="margin: 5px 0;"><strong>Сообщение:</strong> ${alert.message || 'N/A'}</p>
                            <p style="margin: 5px 0;"><strong>Здание:</strong> ${building.building_name || 'N/A'}</p>
                            <p style="margin: 5px 0;"><strong>Создан:</strong> ${new Date(alert.created_at).toLocaleString('ru-RU')}</p>
                            ${alert.resolved_at ? `<p style="margin: 5px 0;"><strong>Решён:</strong> ${new Date(alert.resolved_at).toLocaleString('ru-RU')}</p>` : '<p style="margin: 5px 0; color: red;"><strong>Статус:</strong> Активный</p>'}
                        </div>
                    `;

                    marker.bindPopup(popupContent);
                    marker.bindTooltip(`⚠️ ${alert.type || 'Алерт'} (${alert.severity})`, {
                        permanent: false,
                        direction: 'top'
                    });

                    layer.addLayer(marker);
                    displayedAlerts++;
                }
            }
        });

        this.updateLayerCount("⚠️ Алерты", displayedAlerts);
    }

    // Получить цвет для алерта по важности
    getAlertColor(severity) {
        const colors = {
            'critical': '#d32f2f',
            'high': '#f57c00',
            'medium': '#fbc02d',
            'low': '#388e3c'
        };
        return colors[severity] || '#757575';
    }
}

// Инициализация после загрузки карты
let mapLayersControl;

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapLayersControl;
} 