class MapLayersControl {
    constructor(map) {
        this.map = map;
        this.layers = {};
        this.overlays = {};
        this.activeFilters = {};
        this.metricsInterval = null;
        // Базовый URL API
        this.apiBaseUrl = window.BACKEND_URL || '/api';
        // Хранилище счетчиков слоев для обновления после создания DOM
        this.layerCounts = new Map();
        
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Вспомогательные функции для безопасной работы с данными
        this.escapeHTML = (text) => {
            if (text === null || text === undefined) return '';
            if (window.DOMSecurity && window.DOMSecurity.escapeHTML) {
                return window.DOMSecurity.escapeHTML(text);
            }
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        };
        
        this.sanitizePopup = (html) => {
            if (window.DOMSecurity && window.DOMSecurity.sanitizePopupContent) {
                return window.DOMSecurity.sanitizePopupContent(html);
            }
            return html; // Fallback если DOMSecurity не загружен
        };
        
        // Проверяем что карта действительно передана
        if (!this.map) {
            console.error('❌ MapLayersControl: map parameter is required!');
            return;
        }
        
        // Ждем полной загрузки DOM только если DOM еще не готов
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.init();
            });
        } else {
            // DOM уже готов, инициализируем сразу
            // Используем setTimeout для гарантии что карта полностью инициализирована
            setTimeout(() => {
                this.init();
            }, 0);
        }
    }

    // Проверяем наличие токена (авторизован ли пользователь)
    isAuthenticated() {
        if (window.DOMSecurity && window.DOMSecurity.getValidToken) {
            return !!window.DOMSecurity.getValidToken();
        }
        return !!localStorage.getItem('admin_token');
    }

    // Обработка смены состояния авторизации (вызывается из script.js)
    async handleAuthChange(isLoggedIn) {
        if (isLoggedIn) {
            // Загружаем данные инфраструктурных слоев
            await this.loadInfrastructureLayers();
        } else {
            // Очищаем инфраструктурные слои
            this.clearInfrastructureLayers();
        }
    }

    // Загрузка только инфраструктурных слоев (требуют JWT)
    async loadInfrastructureLayers() {
        const infraLayers = [
            "⚡ Трансформаторы",
            "🔌 Линии электропередач",
            "💧 Источники воды",
            "🚰 Линии водоснабжения",
            "🔥 Источники тепла",
            "📊 Контроллеры",
            "⚠️ Алерты"
        ];
        await Promise.all(infraLayers.map(layer => this.loadLayerDataSilent(layer)));
    }

    // Очистка инфраструктурных слоев при выходе
    clearInfrastructureLayers() {
        const infraLayerNames = [
            "⚡ Трансформаторы", "🔌 Линии электропередач", "💧 Источники воды",
            "🚰 Линии водоснабжения", "🔥 Источники тепла", "📊 Контроллеры", "⚠️ Алерты"
        ];
        for (const name of infraLayerNames) {
            if (this.overlays[name]) {
                this.overlays[name].clearLayers();
                if (this.map.hasLayer(this.overlays[name])) {
                    this.map.removeLayer(this.overlays[name]);
                }
            }
            this.layerCounts.set(name, 0);
        }
    }

    async init() {
        console.log('🗺️ Initializing map layers control...');

        // Проверяем что карта существует
        if (!this.map) {
            console.error('❌ Map is not defined! Cannot initialize MapLayersControl');
            return;
        }

        try {
            this.initializeLayers();
            // Не создаем визуальную панель если используется IndustrialPushPanel
            if (!window.USE_INDUSTRIAL_PANEL) {
                this.createLayerControl();
            }
            this.setupEventHandlers();

            // Загружаем данные для слоев — инфраструктурные только при наличии токена
            const layerPromises = [
                this.loadLayerDataSilent("🏢 Здания")
            ];

            if (this.isAuthenticated()) {
                layerPromises.push(
                    this.loadLayerDataSilent("⚡ Трансформаторы"),
                    this.loadLayerDataSilent("🔌 Линии электропередач"),
                    this.loadLayerDataSilent("💧 Источники воды"),
                    this.loadLayerDataSilent("🚰 Линии водоснабжения"),
                    this.loadLayerDataSilent("🔥 Источники тепла"),
                    this.loadLayerDataSilent("📊 Контроллеры"),
                    this.loadLayerDataSilent("⚠️ Алерты")
                );
            }

            await Promise.all(layerPromises);

            console.log('✅ Map layers control initialized successfully');
            console.log('✅ All layer data loaded, layerCounts:', Array.from(this.layerCounts.entries()));
        } catch (error) {
            console.error('❌ Error initializing MapLayersControl:', error);
        }
    }
    
    // Загружаем данные слоя без отображения на карте (только для обновления счетчика)
    async loadLayerDataSilent(layerName) {
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем валидацию токена
        let token = null;
        if (window.DOMSecurity && window.DOMSecurity.getValidToken) {
            token = window.DOMSecurity.getValidToken();
        } else {
            token = localStorage.getItem('admin_token');
        }
        
        const headers = {
            'Authorization': token ? `Bearer ${token}` : undefined,
            'Content-Type': 'application/json'
        };
        
        // Удаляем Authorization если токена нет
        if (!token) {
            delete headers['Authorization'];
        }
        
        try {
            switch (layerName) {
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
            // Тихо обрабатываем 401 — пользователь не авторизован, слой просто не загружается
            if (error && error.message && error.message.includes('401')) {
                console.log(`🔒 Слой "${layerName}" требует авторизации, пропускаем`);
            } else {
                console.error(`Ошибка при загрузке данных для ${layerName}:`, error);
            }
        }
    }

    initializeLayers() {
        // Базовые слои
        // ИСПРАВЛЕНИЕ: Убираем атрибуцию из tile layers, чтобы избежать дублирования
        // Атрибуция будет добавлена через единый контрол в script.js
        this.baseLayers = {
            "🗺️ Карта": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '', // Пустая атрибуция, чтобы избежать дублирования
                maxZoom: this.map.getMaxZoom() || 19
            }),
            "🛰️ Спутник": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '', // Пустая атрибуция для спутникового слоя
                maxZoom: this.map.getMaxZoom() || 19
            }),
            "🏔️ Рельеф": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '', // Пустая атрибуция для рельефного слоя
                maxZoom: this.map.getMaxZoom() || 19
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

        // Добавляем базовый слой карты
        if (this.map && this.baseLayers["🗺️ Карта"]) {
            try {
                this.baseLayers["🗺️ Карта"].addTo(this.map);
                console.log('✅ Base map layer added');
            } catch (error) {
                console.error('❌ Error adding base map layer:', error);
            }
        }
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
            // Все слои по умолчанию не выбраны при загрузке
            input.checked = false;
            
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
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем валидацию токена
        let token = null;
        if (window.DOMSecurity && window.DOMSecurity.getValidToken) {
            token = window.DOMSecurity.getValidToken();
        } else {
            token = localStorage.getItem('admin_token');
        }
        
        const headers = {
            'Authorization': token ? `Bearer ${token}` : undefined,
            'Content-Type': 'application/json'
        };
        
        // Удаляем Authorization если токена нет
        if (!token) {
            delete headers['Authorization'];
        }

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
        const response = await fetch(`${this.apiBaseUrl}/buildings-metrics`, { headers });
        const data = await response.json();
        
        const layer = this.overlays["🏢 Здания"];
        layer.clearLayers();

        // API возвращает данные в формате { data: [...], pagination: {...} }
        const buildings = Array.isArray(data) ? data : (data.data || []);
        
        if (!Array.isArray(buildings)) {
            console.error('❌ Invalid buildings data format:', data);
            this.updateLayerCount("🏢 Здания", 0);
            return;
        }

        buildings.forEach(building => {
            const marker = this.createBuildingMarker(building);
            layer.addLayer(marker);
        });

        this.updateLayerCount("🏢 Здания", buildings.length);
    }

    async loadTransformers(headers) {
        try {
            // Параллельно загружаем данные трансформаторов и их мощность
            const [transformersResponse, powerResponse] = await Promise.all([
                fetch(`${this.apiBaseUrl}/transformers?page=1&limit=100`, { headers }),
                fetch(`${this.apiBaseUrl}/power-analytics/transformers`, { headers }).catch(() => null)
            ]);

            if (transformersResponse.status === 401) {
                throw new Error('401 Unauthorized');
            }

            const transformersData = await transformersResponse.json();
            const powerData = powerResponse ? await powerResponse.json() : null;
            
            // Создаём Map для быстрого доступа к данным мощности по id
            const powerMap = new Map();
            if (powerData && powerData.data) {
                powerData.data.forEach(p => {
                    powerMap.set(p.id, p);
                });
            }
            
            const layer = this.overlays["⚡ Трансформаторы"];
            layer.clearLayers();

            const transformers = transformersData.data || [];
            let displayedCount = 0;
            const criticalTransformers = [];

            transformers.forEach(transformer => {
                if (transformer.latitude && transformer.longitude) {
                    // Используем transformer_id для поиска данных мощности
                    const transformerId = transformer.transformer_id || transformer.id;
                    const power = powerMap.get(transformerId);
                    const marker = this.createTransformerMarkerWithPower(transformer, power);
                    layer.addLayer(marker);
                    displayedCount++;
                    
                    if (power && parseFloat(power.load_percent) > 90) {
                        criticalTransformers.push({ transformer, power, marker });
                    }
                }
            });

            this.updateLayerCount("⚡ Трансформаторы", displayedCount);
            
            if (criticalTransformers.length > 0) {
                this.handleOverloadedTransformers(criticalTransformers);
            }
            
        } catch (error) {
            console.error('Ошибка при загрузке трансформаторов:', error);
            this.updateLayerCount("⚡ Трансформаторы", 0);
        }
    }

    createTransformerMarkerWithPower(transformer, power) {
        const lat = parseFloat(transformer.latitude);
        const lng = parseFloat(transformer.longitude);
        const loadPercent = power ? parseFloat(power.load_percent) || 0 : 0;
        const isOverloaded = loadPercent > 90;
        
        const markerHTML = window.PowerUtils 
            ? window.PowerUtils.createTransformerMarkerHTML(loadPercent, isOverloaded)
            : '<div class="transformer-marker-container"><div class="transformer-icon">⚡</div></div>';
        
        const transformerIcon = L.divIcon({
            className: 'transformer-marker-custom',
            html: markerHTML,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -20]
        });
        
        const marker = L.marker([lat, lng], { icon: transformerIcon });
        marker.bindPopup(() => this.createTransformerPopupWithPower(transformer, power));
        
        const transformerName = this.escapeHTML(transformer.name || '');
        const loadInfo = power ? ` (${loadPercent.toFixed(1)}%)` : '';
        marker.bindTooltip(`⚡ ${transformerName}${loadInfo}`, {
            permanent: false,
            direction: 'top',
            opacity: 0.9
        });
        
        marker._powerData = power;
        marker._transformerData = transformer;
        return marker;
    }

    createTransformerPopupWithPower(transformer, power) {
        const transformerName = this.escapeHTML(transformer.name || 'Без названия');
        const transformerAddress = transformer.address ? this.escapeHTML(transformer.address) : '';
        const transformerStatus = this.escapeHTML(transformer.status || 'active');
        const powerKVA = parseFloat(transformer.power_kva) || parseFloat(transformer.capacity_kva) || 0;
        
        let popupHTML = `
            <div style="min-width: 280px; color: #2d3748;">
                <h4 style="margin: 0 0 10px 0; color: #1a202c;">⚡ ${transformerName}</h4>
                ${transformerAddress ? `<p style="margin: 5px 0;"><strong>Адрес:</strong> ${transformerAddress}</p>` : ''}
                <p style="margin: 5px 0;"><strong>Мощность:</strong> ${this.escapeHTML(String(powerKVA))} кВА</p>
                <p style="margin: 5px 0;"><strong>Статус:</strong> ${transformerStatus}</p>
        `;
        
        if (power && window.PowerUtils) {
            popupHTML += window.PowerUtils.formatTransformerLoadInfo(
                { ...transformer, capacity_kva: powerKVA },
                power
            );
        } else {
            popupHTML += '<p style="margin: 10px 0; color: #718096;">Нет данных о текущей загрузке</p>';
        }
        
        popupHTML += `</div>`;
        return this.sanitizePopup(popupHTML);
    }

    handleOverloadedTransformers(criticalTransformers) {
        console.warn(`⚠️ Обнаружено ${criticalTransformers.length} перегруженных трансформаторов!`);
        window.criticalTransformers = criticalTransformers;
        
        if (criticalTransformers.length > 0) {
            const first = criticalTransformers[0];
            setTimeout(() => {
                this.map.setView(
                    [parseFloat(first.transformer.latitude), parseFloat(first.transformer.longitude)],
                    15
                );
                first.marker.openPopup();
            }, 500);
            
            if (window.showToast) {
                window.showToast(
                    `⚠️ ПЕРЕГРУЗКА! ${first.transformer.name}: ${parseFloat(first.power.load_percent).toFixed(1)}%`,
                    'error'
                );
            }
        }
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
        
        // ИСПРАВЛЕНИЕ XSS: Санитизируем tooltip для здания
        const buildingTooltipName = this.escapeHTML(building.building_name || '');
        const buildingTooltipStatus = building.controller_status ? this.escapeHTML(building.controller_status) : 'Нет данных';
        marker.bindTooltip(`🏢 ${buildingTooltipName}<br/>Статус: ${buildingTooltipStatus}`, {
            permanent: false,
            direction: 'top'
        });

        return marker;
    }

    createBuildingPopup(building) {
        // ИСПРАВЛЕНИЕ XSS: Санитизируем все пользовательские данные
        const hasController = building.controller_id !== null;
        const hasMetrics = building.timestamp !== null;
        
        const buildingName = this.escapeHTML(building.building_name || '');
        const address = this.escapeHTML(building.address || '');
        const town = this.escapeHTML(building.town || '');
        const managementCompany = this.escapeHTML(building.management_company || 'Не указана');
        const controllerSerial = building.controller_serial ? this.escapeHTML(building.controller_serial) : '';
        const controllerStatus = building.controller_status ? this.escapeHTML(building.controller_status) : '';
        const buildingId = this.escapeHTML(String(building.building_id || ''));
        
        // Форматируем метрики безопасно
        const formatMetric = (value, suffix = '') => {
            if (value === null || value === undefined) return '';
            return this.escapeHTML(String(value) + suffix);
        };
        
        let metricsHTML = '';
        if (hasMetrics) {
            const ph1 = building.electricity_ph1 ? formatMetric(building.electricity_ph1, ' В') : '';
            const ph2 = building.electricity_ph2 ? formatMetric(building.electricity_ph2, ' В') : '';
            const ph3 = building.electricity_ph3 ? formatMetric(building.electricity_ph3, ' В') : '';
            const coldPressure = building.cold_water_pressure ? formatMetric(building.cold_water_pressure, ' бар') : '';
            const coldTemp = building.cold_water_temp ? formatMetric(building.cold_water_temp, '°C') : '';
            const hotTemp = building.hot_water_in_temp ? formatMetric(building.hot_water_in_temp, '°C') : '';
            const timestampRaw = building.timestamp ? new Date(building.timestamp).toLocaleString('ru-RU') : '';
            const timestamp = timestampRaw ? this.escapeHTML(timestampRaw) : '';

            // Формируем компактный список значений, который затем отображаем сеткой
            const metricParts = [];

            if (ph1) metricParts.push(`⚡ Напряжение Ф1: ${ph1}`);
            if (ph2) metricParts.push(`⚡ Напряжение Ф2: ${ph2}`);
            if (ph3) metricParts.push(`⚡ Напряжение Ф3: ${ph3}`);

            if (coldPressure || coldTemp) {
                const coldSegments = [];
                if (coldPressure) coldSegments.push(`Давление: ${coldPressure}`);
                if (coldTemp) coldSegments.push(`Температура: ${coldTemp}`);
                metricParts.push(`💧 ХВС — ${coldSegments.join(', ')}`);
            }

            if (hotTemp) {
                metricParts.push(`🔥 ГВС: ${hotTemp}`);
            }

            if (building.leak_sensor !== null) {
                const leakLabel = building.leak_sensor ? '⚠️ Протечка' : '✅ Норма';
                metricParts.push(`🚨 Датчик протечки: ${leakLabel}`);
            }

            metricsHTML = `
                    <div class="building-metrics building-metrics-compact">
                        <div class="metrics-title">📊 Последние метрики</div>
                        <div class="metrics-grid" title="Последние метрики">
                            ${metricParts.map(part => `<span>${this.escapeHTML(part)}</span>`).join('')}
                        </div>
                        ${timestamp ? `<div class="metrics-timestamp">🕒 ${timestamp}</div>` : ''}
                    </div>
                `;
        }
        
        let popupHTML = `
            <div class="building-popup">
                <h4>🏢 ${buildingName}</h4>
                <div class="building-info">
                    <div class="info-row">
                        <span class="info-label">Адрес</span>
                        <span class="info-value">${address || 'Не указан'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Город</span>
                        <span class="info-value">${town || 'Не указан'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Управляющая компания</span>
                        <span class="info-value">${managementCompany}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Горячая вода</span>
                        <span class="info-value">${building.hot_water ? '✅ Есть' : '❌ Нет'}</span>
                    </div>
                    ${hasController ? `
                        <div class="info-row">
                            <span class="info-label">Контроллер</span>
                            <span class="info-value">${controllerSerial}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Статус контроллера</span>
                            <span class="info-value">
                                <span class="status-badge status-${controllerStatus}">${controllerStatus}</span>
                            </span>
                        </div>
                    ` : `
                        <div class="info-row">
                            <span class="info-label">Контроллер</span>
                            <span class="info-value">❌ Не подключен</span>
                        </div>
                    `}
                </div>
                ${metricsHTML}
                <div class="building-actions">
                    ${hasController ? `<button onclick="mapLayersControl.showBuildingMetrics('${buildingId}')" class="btn-metrics">📊 Показать метрики</button>` : ''}
                    <button onclick="mapLayersControl.showBuildingDetails('${buildingId}')" class="btn-details">ℹ️ Подробности</button>
                </div>
            </div>
        `;
        
        // Санитизируем весь popup контент перед возвратом
        return this.sanitizePopup(popupHTML);
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
        try {
            const response = await fetch(`${this.apiBaseUrl}/water-lines`, { headers });
            if (response.status === 401) throw new Error('401 Unauthorized');

            if (!response.ok) {
                if (response.status === 404 || response.status === 500) {
                    console.warn('Линии водоснабжения не доступны');
                    this.updateLayerCount("🚰 Линии водоснабжения", 0);
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const allLines = result.data || [];

            const normalize = (t) => (t || '').trim().toUpperCase();

            // Фильтруем ХВС и ГВС линии
            const coldLines = allLines.filter(l => normalize(l.line_type) === 'ХВС');
            const hotLines = allLines.filter(l => normalize(l.line_type) === 'ГВС');

            const layer = this.overlays["🚰 Линии водоснабжения"];
            layer.clearLayers();

            // Отрисовываем линии ХВС (холодное водоснабжение)
            coldLines.forEach(line => {
                if (line.main_path && line.main_path.length >= 2) {
                    const adaptedLine = {
                        ...line,
                        line_type: 'cold_water',
                        display_color: '#0066FF',
                        line_width: 4,
                        branches: line.branches || []
                    };
                    this.drawInfrastructureLine(adaptedLine, layer);
                }
            });

            // Отрисовываем линии ГВС (горячее водоснабжение)
            hotLines.forEach(line => {
                if (line.main_path && line.main_path.length >= 2) {
                    const adaptedLine = {
                        ...line,
                        line_type: 'hot_water',
                        display_color: '#FF0000',
                        line_width: 4,
                        branches: line.branches || []
                    };
                    this.drawInfrastructureLine(adaptedLine, layer);
                }
            });

            this.updateLayerCount("🚰 Линии водоснабжения", coldLines.length + hotLines.length);
        } catch (error) {
            console.warn('Ошибка при загрузке линий водоснабжения:', error);
            this.updateLayerCount("🚰 Линии водоснабжения", 0);
        }
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

        // ИСПРАВЛЕНИЕ XSS: Санитизируем данные линии водоснабжения
        const lineName = this.escapeHTML(line.name || '');
        const lineDiameter = line.diameter_mm ? this.escapeHTML(String(line.diameter_mm) + ' мм') : '';
        const linePressure = line.pressure_rating ? this.escapeHTML(String(line.pressure_rating) + ' бар') : '';
        const lineMaterial = this.escapeHTML(line.material || '');
        const lineLength = line.length_km ? this.escapeHTML(String(line.length_km) + ' км') : '';
        const lineType = this.escapeHTML(line.line_type || 'Не указан');
        const lineStatus = this.escapeHTML(line.status || '');
        const lineBuildingsCount = line.connected_buildings_count ? this.escapeHTML(String(line.connected_buildings_count)) : '0';
        
        const popupHTML = `
            <div class="water-line-popup">
                <h4>🚰 ${lineName}</h4>
                ${lineDiameter ? `<p><strong>Диаметр:</strong> ${lineDiameter}</p>` : ''}
                ${linePressure ? `<p><strong>Давление:</strong> ${linePressure}</p>` : ''}
                ${lineMaterial ? `<p><strong>Материал:</strong> ${lineMaterial}</p>` : ''}
                ${lineLength ? `<p><strong>Длина:</strong> ${lineLength}</p>` : ''}
                <p><strong>Тип:</strong> ${lineType}</p>
                ${lineStatus ? `<p><strong>Статус:</strong> <span class="status-badge status-${lineStatus}">${lineStatus}</span></p>` : ''}
                <p><strong>Подключенных зданий:</strong> ${lineBuildingsCount}</p>
            </div>
        `;
        
        // Санитизируем popup перед использованием
        const sanitizedPopup = this.sanitizePopup(popupHTML);
        polyline.bindPopup(sanitizedPopup);

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
        // Сохраняем счетчик для последующего обновления DOM
        this.layerCounts.set(layerName, count);
        
        // Пытаемся обновить счетчик в DOM если элементы уже созданы
        const input = document.querySelector(`input[value="${layerName}"]`);
        if (input) {
            const label = input.parentElement;
            if (label) {
                const countSpan = label.querySelector('.layer-count');
                if (countSpan) {
                    countSpan.textContent = `(${count})`;
                    return;
                }
            }
        }
        
        // Если элементы DOM еще не созданы, счетчик сохранен в layerCounts
        // и будет обновлен позже в populateLayerControls
    }
    
    /**
     * Обновляет все счетчики слоев из сохраненных значений
     * Вызывается после создания DOM элементов
     */
    refreshLayerCounts() {
        this.layerCounts.forEach((count, layerName) => {
            const input = document.querySelector(`input[value="${layerName}"]`);
            if (input) {
                const label = input.parentElement;
                if (label) {
                    const countSpan = label.querySelector('.layer-count');
                    if (countSpan) {
                        countSpan.textContent = `(${count})`;
                    }
                }
            }
        });
    }

    async showTransformerMetrics(transformerId) {
        const container = document.getElementById(`transformer-metrics-${transformerId}`);
        container.style.display = 'block';
        
        try {
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем валидацию токена
            let token = null;
            if (window.DOMSecurity && window.DOMSecurity.getValidToken) {
                token = window.DOMSecurity.getValidToken();
            } else {
                token = localStorage.getItem('admin_token');
            }
            
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/analytics/transformers/${transformerId}/load`, {
                headers: headers
            });
            
            if (response.ok) {
                const data = await response.json();
                // ИСПРАВЛЕНИЕ XSS: Используем DOMSecurity для безопасной вставки HTML
                if (window.DOMSecurity) {
                    const chartHTML = this.renderMetricsChart(data);
                    window.DOMSecurity.setSecureHTML(container, chartHTML);
                } else {
                    // Fallback: создаем элемент вручную
                    // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
                    container.textContent = '';
                    const p = document.createElement('p');
                    p.textContent = 'Метрики загружены';
                    container.appendChild(p);
                }
            } else {
                // ИСПРАВЛЕНИЕ XSS: Используем textContent для простого сообщения
                container.textContent = '';
                const p = document.createElement('p');
                p.textContent = 'Метрики недоступны';
                container.appendChild(p);
            }
        } catch (error) {
            // ИСПРАВЛЕНИЕ XSS: Используем textContent для сообщения об ошибке
            container.textContent = '';
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
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем валидацию токена
        let token = null;
        if (window.DOMSecurity && window.DOMSecurity.getValidToken) {
            token = window.DOMSecurity.getValidToken();
        } else {
            token = localStorage.getItem('admin_token');
        }
        
        if (this.map.hasLayer(this.overlays["⚡ Трансформаторы"])) {
            await this.loadTransformers({
                'Authorization': token ? `Bearer ${token}` : undefined,
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
        // Обновление значения слайдера загрузки (только если элемент существует)
        const loadFilter = document.getElementById('load-filter');
        if (loadFilter) {
            loadFilter.addEventListener('input', function() {
                const loadValue = document.getElementById('load-value');
                if (loadValue) {
                    loadValue.textContent = this.value + '%';
                }
            });
        }
    }

    // Загрузка линий электропередач на карту (старая версия — заменена полной реализацией ниже)

    // Загрузка источников воды на карту
    async loadWaterSources(headers) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/water-sources`, { headers });

            if (response.status === 401) throw new Error('401 Unauthorized');
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

                    // ИСПРАВЛЕНИЕ XSS: Санитизируем данные источника воды
                    const sourceName = this.escapeHTML(source.name || 'N/A');
                    const sourceType = this.escapeHTML(source.type || 'N/A');
                    const sourceCapacity = source.capacity ? this.escapeHTML(String(source.capacity) + ' м³/час') : '';
                    const sourceStatus = source.status ? this.escapeHTML(source.status) : '';
                    
                    const popupContent = `
                        <div style="min-width: 250px;">
                            <h4 style="margin: 0 0 10px 0;">💧 Источник воды</h4>
                            <p style="margin: 5px 0;"><strong>Название:</strong> ${sourceName}</p>
                            <p style="margin: 5px 0;"><strong>Тип:</strong> ${sourceType}</p>
                            ${sourceCapacity ? `<p style="margin: 5px 0;"><strong>Мощность:</strong> ${sourceCapacity}</p>` : ''}
                            ${sourceStatus ? `<p style="margin: 5px 0;"><strong>Статус:</strong> ${sourceStatus}</p>` : ''}
                        </div>
                    `;
                    
                    // Санитизируем popup перед использованием
                    const sanitizedPopup = this.sanitizePopup(popupContent);
                    marker.bindPopup(sanitizedPopup);
                    marker.bindTooltip(`💧 ${sourceName}`, {
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
            const response = await fetch(`${this.apiBaseUrl}/heat-sources`, { headers });

            if (response.status === 401) throw new Error('401 Unauthorized');
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

                    // ИСПРАВЛЕНИЕ XSS: Санитизируем данные источника тепла
                    const heatSourceName = this.escapeHTML(source.name || 'N/A');
                    const heatSourceType = this.escapeHTML(source.type || 'N/A');
                    const heatSourceCapacity = source.capacity ? this.escapeHTML(String(source.capacity) + ' Гкал/час') : '';
                    const heatSourceStatus = source.status ? this.escapeHTML(source.status) : '';
                    
                    const popupContent = `
                        <div style="min-width: 250px;">
                            <h4 style="margin: 0 0 10px 0;">🔥 Источник тепла</h4>
                            <p style="margin: 5px 0;"><strong>Название:</strong> ${heatSourceName}</p>
                            <p style="margin: 5px 0;"><strong>Тип:</strong> ${heatSourceType}</p>
                            ${heatSourceCapacity ? `<p style="margin: 5px 0;"><strong>Мощность:</strong> ${heatSourceCapacity}</p>` : ''}
                            ${heatSourceStatus ? `<p style="margin: 5px 0;"><strong>Статус:</strong> ${heatSourceStatus}</p>` : ''}
                        </div>
                    `;
                    
                    // Санитизируем popup перед использованием
                    const sanitizedPopup = this.sanitizePopup(popupContent);
                    marker.bindPopup(sanitizedPopup);
                    marker.bindTooltip(`🔥 ${heatSourceName}`, {
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
        const response = await fetch(`${this.apiBaseUrl}/buildings-metrics`, { headers });
        if (response.status === 401) throw new Error('401 Unauthorized');
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

            // ИСПРАВЛЕНИЕ XSS: Создаём popup с санитизацией данных контроллера
            const controllerId = this.escapeHTML(String(building.controller_id || ''));
            const controllerBuildingName = this.escapeHTML(building.building_name || 'N/A');
            const controllerAddress = this.escapeHTML(building.address || 'N/A');
            const controllerStatus = building.controller_status ? this.escapeHTML(building.controller_status) : 'unknown';
            const controllerStatusColor = building.controller_status === 'online' ? 'green' : 'red';
            const latestMetricTime = building.latest_metric_time ? new Date(building.latest_metric_time).toLocaleString('ru-RU') : '';
            
            const popupContent = `
                <div style="min-width: 250px;">
                    <h4 style="margin: 0 0 10px 0;">📊 Контроллер</h4>
                    <p style="margin: 5px 0;"><strong>ID:</strong> ${controllerId}</p>
                    <p style="margin: 5px 0;"><strong>Здание:</strong> ${controllerBuildingName}</p>
                    <p style="margin: 5px 0;"><strong>Адрес:</strong> ${controllerAddress}</p>
                    <p style="margin: 5px 0;"><strong>Статус:</strong> <span style="color: ${controllerStatusColor};">${controllerStatus}</span></p>
                    ${latestMetricTime ? `<p style="margin: 5px 0;"><strong>Последние данные:</strong> ${latestMetricTime}</p>` : ''}
                </div>
            `;
            
            // Санитизируем popup перед использованием
            const sanitizedPopup = this.sanitizePopup(popupContent);
            marker.bindPopup(sanitizedPopup);
            marker.bindTooltip(`📊 Контроллер #${controllerId}`, {
                permanent: false,
                direction: 'top'
            });

            layer.addLayer(marker);
        });

        this.updateLayerCount("📊 Контроллеры", buildingsWithControllers.length);
    }

    // Загрузка алертов на карту
    async loadAlerts(headers) {
        const response = await fetch(`${this.apiBaseUrl}/alerts?status=active`, { headers });
        if (response.status === 401) throw new Error('401 Unauthorized');
        const data = await response.json();
        
        const layer = this.overlays["⚠️ Алерты"];
        layer.clearLayers();

        const alerts = data.data || [];

        // Получаем данные о зданиях для координат
        const buildingsResponse = await fetch(`${this.apiBaseUrl}/buildings-metrics`, { headers });
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

                    // ИСПРАВЛЕНИЕ XSS: Санитизируем данные алерта
                    const alertType = this.escapeHTML(alert.type || 'Алерт');
                    const alertSeverity = this.escapeHTML(alert.severity || '');
                    const alertMessage = this.escapeHTML(alert.message || 'N/A');
                    const alertBuildingName = this.escapeHTML(building.building_name || 'N/A');
                    const alertCreatedAt = alert.created_at ? new Date(alert.created_at).toLocaleString('ru-RU') : '';
                    const alertResolvedAt = alert.resolved_at ? new Date(alert.resolved_at).toLocaleString('ru-RU') : '';
                    const alertColor = this.getAlertColor(alert.severity);
                    
                    const popupContent = `
                        <div style="min-width: 280px;">
                            <h4 style="margin: 0 0 10px 0; color: ${alertColor};">⚠️ ${alertType}</h4>
                            <p style="margin: 5px 0;"><strong>Важность:</strong> <span style="color: ${alertColor};">${alertSeverity}</span></p>
                            <p style="margin: 5px 0;"><strong>Сообщение:</strong> ${alertMessage}</p>
                            <p style="margin: 5px 0;"><strong>Здание:</strong> ${alertBuildingName}</p>
                            <p style="margin: 5px 0;"><strong>Создан:</strong> ${alertCreatedAt}</p>
                            ${alertResolvedAt ? `<p style="margin: 5px 0;"><strong>Решён:</strong> ${alertResolvedAt}</p>` : '<p style="margin: 5px 0; color: red;"><strong>Статус:</strong> Активный</p>'}
                        </div>
                    `;
                    
                    // Санитизируем popup перед использованием
                    const sanitizedPopup = this.sanitizePopup(popupContent);
                    marker.bindPopup(sanitizedPopup);
                    marker.bindTooltip(`⚠️ ${alertType} (${alertSeverity})`, {
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

    /**
     * Загрузка линий электропередач
     * Цвет: желто-оранжевый (#FFA500)
     */
    async loadPowerLines(headers) {
        try {
            const layer = this.overlays["🔌 Линии электропередач"];
            layer.clearLayers();

            // Загружаем линии из lines (линии электропередач)
            const linesResponse = await fetch(`${this.apiBaseUrl}/lines`, { headers });
            if (linesResponse.status === 401) throw new Error('401 Unauthorized');

            if (!linesResponse.ok) {
                if (linesResponse.status === 404 || linesResponse.status === 500) {
                    console.warn('Линии электропередач не доступны');
                    this.updateLayerCount("🔌 Линии электропередач", 0);
                    return;
                }
                throw new Error(`HTTP ${linesResponse.status}`);
            }
            
            const linesResult = await linesResponse.json();
            const lines = linesResult.data || [];
            
            let drawnCount = 0;
            
            // Отрисовываем линии с main_path
            lines.forEach(line => {
                if (line.main_path && line.main_path.length >= 2) {
                    const adaptedLine = {
                        ...line,
                        line_type: 'electricity',
                        display_color: '#FFA500',
                        line_width: 4,
                        line_id: line.line_id,
                        branches: line.branches || []
                    };
                    
                    this.drawInfrastructureLine(adaptedLine, layer);
                    drawnCount++;
                }
            });

            this.updateLayerCount("🔌 Линии электропередач", drawnCount);
        } catch (error) {
            console.warn('Ошибка при загрузке линий электропередач:', error);
            this.updateLayerCount("🔌 Линии электропередач", 0);
        }
    }

    /**
     * Отрисовка линии инфраструктуры на карте
     * 
     * @param {Object} lineData - Данные линии из API
     * @param {Object} layer - Leaflet layer group для добавления
     */
    drawInfrastructureLine(lineData, layer) {
        try {
            // Парсим координаты основной линии из main_path
            const mainPath = lineData.main_path.map(point => [
                parseFloat(point.lat),
                parseFloat(point.lng)
            ]);

            // Создаем основную линию
            const mainLine = L.polyline(mainPath, {
                color: lineData.display_color,
                weight: lineData.line_width || 4,
                opacity: lineData.status === 'active' ? 0.8 : 0.5,
                smoothFactor: 1,
                lineCap: 'round',
                lineJoin: 'round'
            });

            // Добавляем popup с информацией о линии
            const popupContent = this.createLinePopup(lineData);
            mainLine.bindPopup(popupContent);

            // ИСПРАВЛЕНИЕ XSS: Санитизируем tooltip для линии
            const lineTooltipName = this.escapeHTML(lineData.name || '');
            mainLine.bindTooltip(lineTooltipName, {
                permanent: false,
                direction: 'top',
                opacity: 0.9
            });

            // Добавляем линию на слой
            mainLine.addTo(layer);

            // Отрисовываем ответвления (branches), если есть
            if (lineData.branches && lineData.branches.length > 0) {
                lineData.branches.forEach(branch => {
                    this.drawBranch(branch, lineData, layer);
                });
            }

            // Загружаем и отображаем алерты на линии (если есть)
            this.loadLineAlerts(lineData.line_id, lineData, layer);

        } catch (error) {
            console.error('Ошибка при отрисовке линии:', error);
        }
    }

    /**
     * Отрисовка ответвления от основной линии
     * 
     * @param {Object} branch - Данные ответвления
     * @param {Object} lineData - Данные основной линии
     * @param {Object} layer - Leaflet layer group
     */
    drawBranch(branch, lineData, layer) {
        try {
            // Парсим координаты ответвления
            const branchPath = branch.points.map(point => [
                parseFloat(point.lat),
                parseFloat(point.lng)
            ]);

            // Создаем линию ответвления (пунктирная, тоньше)
            const branchLine = L.polyline(branchPath, {
                color: lineData.display_color,
                weight: 2,
                opacity: 0.6,
                dashArray: '10, 10', // Пунктирная линия
                smoothFactor: 1,
                lineCap: 'round',
                lineJoin: 'round'
            });

            // ИСПРАВЛЕНИЕ XSS: Санитизируем данные ответвления
            const branchName = this.escapeHTML(branch.name || '');
            const branchLineName = this.escapeHTML(lineData.name || '');
            const branchPointsCount = branch.points ? branch.points.length : 0;
            
            const branchPopupHTML = `
                <div style="min-width: 200px;">
                    <h4 style="margin: 0 0 10px 0;">Ответвление</h4>
                    <p style="margin: 5px 0;"><strong>Название:</strong> ${branchName}</p>
                    <p style="margin: 5px 0;"><strong>Основная линия:</strong> ${branchLineName}</p>
                    <p style="margin: 5px 0;"><strong>Точек:</strong> ${branchPointsCount}</p>
                </div>
            `;
            
            // Санитизируем popup перед использованием
            const sanitizedBranchPopup = this.sanitizePopup(branchPopupHTML);
            branchLine.bindPopup(sanitizedBranchPopup);
            
            // ИСПРАВЛЕНИЕ XSS: Санитизируем tooltip для ответвления
            const branchTooltipName = this.escapeHTML(branch.name || '');
            branchLine.bindTooltip(`Ответвление: ${branchTooltipName}`, {
                permanent: false,
                direction: 'top',
                opacity: 0.8
            });

            // Добавляем на карту
            branchLine.addTo(layer);

        } catch (error) {
            console.error('Ошибка при отрисовке ответвления:', error);
        }
    }

    /**
     * Создание содержимого popup для линии
     * 
     * @param {Object} lineData - Данные линии
     * @returns {string} HTML содержимое popup
     */
    createLinePopup(lineData) {
        // Определяем иконку и название типа
        let typeIcon = '';
        let typeName = '';
        
        switch (lineData.line_type) {
            case 'cold_water':
                typeIcon = '❄️';
                typeName = 'Холодное водоснабжение';
                break;
            case 'hot_water':
                typeIcon = '🔥';
                typeName = 'Горячее водоснабжение';
                break;
            case 'electricity':
                typeIcon = '⚡';
                typeName = 'Электроснабжение';
                break;
        }

        // Статус с цветовой индикацией
        const statusColors = {
            'active': 'green',
            'maintenance': 'orange',
            'emergency': 'red',
            'inactive': 'gray'
        };
        const statusColor = statusColors[lineData.status] || 'gray';

        // ИСПРАВЛЕНИЕ XSS: Санитизируем данные линии перед созданием popup
        const lineName = this.escapeHTML(lineData.name || '');
        const lineDescription = lineData.description ? this.escapeHTML(lineData.description) : '';
        const lineStatus = this.escapeHTML(lineData.status || '');
        const lineLength = lineData.length_km ? this.escapeHTML(String(lineData.length_km) + ' км') : '';
        const lineMaterial = lineData.material ? this.escapeHTML(lineData.material) : '';
        const lineBranchesCount = lineData.branches && lineData.branches.length > 0 ? lineData.branches.length : 0;
        
        // Определяем технические параметры безопасно
        let technicalParams = '';
        if (lineData.line_type === 'electricity' && lineData.voltage_kv) {
            technicalParams = `<p style="margin: 5px 0;"><strong>Напряжение:</strong> ${this.escapeHTML(String(lineData.voltage_kv) + ' кВ')}</p>`;
        } else if ((lineData.line_type === 'cold_water' || lineData.line_type === 'hot_water') && lineData.diameter_mm) {
            technicalParams = `<p style="margin: 5px 0;"><strong>Диаметр:</strong> ${this.escapeHTML(String(lineData.diameter_mm) + ' мм')}</p>`;
        }
        
        const popupHTML = `
            <div style="min-width: 250px; color: #2d3748;">
                <h4 style="margin: 0 0 10px 0; color: #1a202c;">${typeIcon} ${lineName}</h4>
                <p style="margin: 5px 0;"><strong>Тип:</strong> ${typeName}</p>
                ${lineDescription ? `<p style="margin: 5px 0;"><strong>Описание:</strong> ${lineDescription}</p>` : ''}
                <p style="margin: 5px 0;"><strong>Статус:</strong> <span style="color: ${statusColor}; font-weight: bold;">${lineStatus}</span></p>
                ${lineLength ? `<p style="margin: 5px 0;"><strong>Длина:</strong> ${lineLength}</p>` : ''}
                ${technicalParams}
                ${lineMaterial ? `<p style="margin: 5px 0;"><strong>Материал:</strong> ${lineMaterial}</p>` : ''}
                ${lineBranchesCount > 0 ? `<p style="margin: 5px 0;"><strong>Ответвлений:</strong> ${lineBranchesCount}</p>` : ''}
                
                <!-- Power data for electricity lines - placeholder -->
                ${lineData.line_type === 'electricity' ? `<div id="line-power-${lineData.line_id}" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.1);"><p style="color: #718096; font-size: 12px;">Загрузка данных мощности...</p></div>` : ''}
            </div>
        `;
        
        // Для линий электричества загружаем данные мощности асинхронно
        if (lineData.line_type === 'electricity' && lineData.line_id) {
            setTimeout(async () => {
                try {
                    const powerResponse = await fetch(`${this.apiBaseUrl}/power-analytics/lines/${lineData.line_id}`);
                    if (powerResponse.ok) {
                        const powerData = await powerResponse.json();
                        const powerContainer = document.getElementById(`line-power-${lineData.line_id}`);
                        
                        if (powerContainer && powerData.data) {
                            const lineP = powerData.data;
                            const totalPower = parseFloat(lineP.total_power_kw) || 0;
                            const buildingsCount = lineP.buildings_count || 0;
                            
                            powerContainer.textContent = '';

                            const p1 = document.createElement('p');
                            p1.style.cssText = 'margin: 5px 0; color: #2d3748;';
                            const icon1 = document.createElement('strong');
                            icon1.textContent = '⚡ Суммарная нагрузка:';
                            p1.appendChild(icon1);
                            p1.appendChild(document.createTextNode(` ${(parseFloat(totalPower) || 0).toFixed(2)} кВт`));

                            const p2 = document.createElement('p');
                            p2.style.cssText = 'margin: 5px 0; font-size: 12px; color: #4a5568;';
                            const ph1 = (parseFloat(lineP.total_power_ph1_kw) || 0).toFixed(1);
                            const ph2 = (parseFloat(lineP.total_power_ph2_kw) || 0).toFixed(1);
                            const ph3 = (parseFloat(lineP.total_power_ph3_kw) || 0).toFixed(1);
                            p2.textContent = `Зданий на линии: ${parseInt(buildingsCount, 10) || 0} | По фазам: ${ph1} / ${ph2} / ${ph3} кВт`;

                            powerContainer.appendChild(p1);
                            powerContainer.appendChild(p2);
                        }
                    }
                } catch (error) {
                    console.warn('Не удалось загрузить данные мощности для линии:', error);
                    const powerContainer = document.getElementById(`line-power-${lineData.line_id}`);
                    if (powerContainer) {
                        powerContainer.textContent = '';
                    }
                }
            }, 100);
        }
        
        // Санитизируем popup перед использованием
        return this.sanitizePopup(popupHTML);
    }

    /**
     * Загрузка и отображение алертов на линии
     * 
     * @param {number} lineId - ID линии
     * @param {Object} lineData - Данные линии
     * @param {Object} layer - Leaflet layer group
     */
    async loadLineAlerts(lineId, lineData, layer) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/infrastructure-lines/${lineId}/alerts?active_only=true`);
            
            if (!response.ok) {
                return; // Алерты опциональны
            }

            const result = await response.json();
            const alerts = result.data || [];

            // Отображаем каждый алерт
            alerts.forEach(alert => {
                this.displayLineAlert(alert, lineData, layer);
            });

        } catch (error) {
            console.warn(`Не удалось загрузить алерты для линии ${lineId}:`, error);
        }
    }

    /**
     * Отображение алерта на линии
     * 
     * @param {Object} alert - Данные алерта
     * @param {Object} lineData - Данные линии
     * @param {Object} layer - Leaflet layer group
     */
    displayLineAlert(alert, lineData, layer) {
        try {
            // Парсим координаты точки алерта
            const alertPoint = alert.alert_point;
            const lat = parseFloat(alertPoint.lat);
            const lng = parseFloat(alertPoint.lng);

            // Цвет маркера в зависимости от серьезности
            const severityColors = {
                'INFO': '#2196F3',
                'WARNING': '#FF9800',
                'CRITICAL': '#F44336'
            };
            const markerColor = severityColors[alert.severity] || '#757575';

            // Создаем маркер аварии
            const alertMarker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: markerColor,
                color: '#FFFFFF',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });

            // ИСПРАВЛЕНИЕ XSS: Санитизируем данные алерта на линии
            const alertLineName = this.escapeHTML(lineData.name || '');
            const alertSeverity = this.escapeHTML(alert.severity || '');
            const alertDescription = alert.description ? this.escapeHTML(alert.description) : '';
            const alertMessage = alert.alert_message ? this.escapeHTML(alert.alert_message) : '';
            const alertCreatedAt = alert.created_at ? new Date(alert.created_at).toLocaleString('ru-RU') : '';
            
            const alertPopupHTML = `
                <div style="min-width: 200px;">
                    <h4 style="margin: 0 0 10px 0; color: ${markerColor};">⚠️ Авария на линии</h4>
                    <p style="margin: 5px 0;"><strong>Линия:</strong> ${alertLineName}</p>
                    <p style="margin: 5px 0;"><strong>Серьезность:</strong> <span style="color: ${markerColor}; font-weight: bold;">${alertSeverity}</span></p>
                    ${alertDescription ? `<p style="margin: 5px 0;"><strong>Описание:</strong> ${alertDescription}</p>` : ''}
                    ${alertMessage ? `<p style="margin: 5px 0;"><strong>Сообщение:</strong> ${alertMessage}</p>` : ''}
                    <p style="margin: 5px 0; font-size: 11px; color: #757575;"><strong>Создан:</strong> ${alertCreatedAt}</p>
                </div>
            `;
            
            // Санитизируем popup перед использованием
            const sanitizedAlertPopup = this.sanitizePopup(alertPopupHTML);
            alertMarker.bindPopup(sanitizedAlertPopup);
            
            // Tooltip с безопасным текстом
            const alertTooltipSeverity = this.escapeHTML(alert.severity || '');
            const alertTooltipDescription = alert.description ? this.escapeHTML(alert.description) : 'Авария';
            alertMarker.bindTooltip(`⚠️ ${alertTooltipSeverity}: ${alertTooltipDescription}`, {
                permanent: false,
                direction: 'top'
            });

            // Добавляем на карту
            alertMarker.addTo(layer);

            // Подсвечиваем проблемный сегмент линии (опционально)
            if (alert.segment_start_index !== undefined && alert.segment_end_index !== undefined) {
                this.highlightLineSegment(lineData, alert.segment_start_index, alert.segment_end_index, layer);
            }

        } catch (error) {
            console.error('Ошибка при отображении алерта:', error);
        }
    }

    /**
     * Подсветка проблемного сегмента линии
     * 
     * @param {Object} lineData - Данные линии
     * @param {number} startIndex - Индекс начальной точки
     * @param {number} endIndex - Индекс конечной точки
     * @param {Object} layer - Leaflet layer group
     */
    highlightLineSegment(lineData, startIndex, endIndex, layer) {
        try {
            // Извлекаем сегмент из main_path
            const segment = lineData.main_path.slice(startIndex, endIndex + 1);
            
            if (segment.length < 2) {
                return; // Нужно минимум 2 точки
            }

            const segmentPath = segment.map(point => [
                parseFloat(point.lat),
                parseFloat(point.lng)
            ]);

            // Создаем подсвеченную линию (более толстая, красная)
            const highlightLine = L.polyline(segmentPath, {
                color: '#F44336', // Красный
                weight: 6,
                opacity: 1.0,
                className: 'pulsing-line', // CSS анимация (если добавить)
                lineCap: 'round',
                lineJoin: 'round'
            });

            // Добавляем на карту
            highlightLine.addTo(layer);

        } catch (error) {
            console.error('Ошибка при подсветке сегмента:', error);
        }
    }
}

// Инициализация после загрузки карты
let mapLayersControl;

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapLayersControl;
} 