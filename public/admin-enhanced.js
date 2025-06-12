console.log('🚀 НОВАЯ ВЕРСИЯ ФАЙЛА ЗАГРУЖЕНА - v=1749768508');

document.addEventListener("DOMContentLoaded", function () {
    const backendURL = "/api";

    // Переменные для пагинации всех сущностей
    const pagination = {
        buildings: { page: 1, limit: 10, total: 0 },
        controllers: { page: 1, limit: 10, total: 0 },
        transformers: { page: 1, limit: 10, total: 0 },
        lines: { page: 1, limit: 10, total: 0 },
        'water-lines': { page: 1, limit: 10, total: 0 },
        metrics: { page: 1, limit: 10, total: 0 },
        waterSources: { page: 1, limit: 10, total: 0 },
        heatSources: { page: 1, limit: 10, total: 0 }
    };

    // Флаги для отслеживания загрузки данных
    const dataLoaded = {
        buildings: false,
        controllers: false,
        transformers: false,
        lines: false,
        'water-lines': false,
        metrics: false,
        waterSources: false,
        heatSources: false
    };

    // Состояние фильтров
    const filters = {
        buildings: {},
        controllers: {},
        transformers: {},
        lines: {},
        'water-lines': {},
        metrics: {},
        waterSources: {},
        heatSources: {}
    };

    // Состояние сортировки
    const sorting = {
        buildings: { column: 'building_id', direction: 'asc' },
        controllers: { column: 'controller_id', direction: 'asc' },
        transformers: { column: 'transformer_id', direction: 'asc' },
        lines: { column: 'line_id', direction: 'asc' },
        'water-lines': { column: 'line_id', direction: 'asc' },
        metrics: { column: 'metric_id', direction: 'desc' }
    };

    // Выбранные элементы для batch операций
    const selectedItems = {
        buildings: new Set(),
        controllers: new Set(),
        transformers: new Set(),
        lines: new Set(),
        'water-lines': new Set(),
        metrics: new Set(),
        waterSources: new Set(),
        heatSources: new Set()
    };

    // ===============================================
    // УТИЛИТЫ И ОБЩИЕ ФУНКЦИИ
    // ===============================================

    // Toast уведомления
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        const container = document.getElementById('toast-container');
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    // Функция для безопасного получения значений
    function safeValue(value, defaultValue = "N/A") {
        return value !== null && value !== undefined && value !== '' ? value : defaultValue;
    }

    // Функция для форматирования чисел
    function formatNumber(value, decimals = 2) {
        if (value === null || value === undefined || value === '') return 'N/A';
        return parseFloat(value).toFixed(decimals);
    }

    // Функция для форматирования дат
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleString('ru-RU');
    }

    // ===============================================
    // НАВИГАЦИЯ МЕЖДУ СЕКЦИЯМИ
    // ===============================================

    // Обработчики навигации
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const section = this.dataset.section;
            switchSection(section);
        });
    });

    function switchSection(sectionName) {
        // Скрываем все секции
        document.querySelectorAll('.admin-section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Убираем активный класс с кнопок
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Показываем нужную секцию
        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        // Активируем кнопку
        const targetBtn = document.querySelector(`[data-section="${sectionName}"]`);
        if (targetBtn) {
            targetBtn.classList.add('active');
        }
        
        // Загружаем данные для секции
        loadSectionData(sectionName);
    }

    function loadSectionData(sectionName) {
        console.log('loadSectionData called with:', sectionName);
        switch(sectionName) {
            case 'buildings':
                if (!dataLoaded.buildings) loadBuildings();
                // Перезагружаем данные формы при каждом переходе в секцию зданий
                console.log('Reloading form data for buildings section...');
                loadFormData();
                break;
            case 'controllers':
                console.log('Calling loadControllers...');
                if (!dataLoaded.controllers) loadControllers();
                break;
            case 'transformers':
                if (!dataLoaded.transformers) loadTransformers();
                break;
            case 'lines':
                if (!dataLoaded.lines) loadLines();
                break;
            case 'water-lines':
                console.log('Calling loadWaterLines...');
                if (!dataLoaded['water-lines']) loadWaterLines();
                break;
            case 'metrics':
                console.log('Calling loadMetrics...');
                if (!dataLoaded.metrics) loadMetrics();
                break;
            case 'water-sources':
                if (!dataLoaded.waterSources) loadWaterSources();
                break;
            case 'heat-sources':
                if (!dataLoaded.heatSources) loadHeatSources();
                break;
        }
    }

    // ===============================================
    // ЗАГРУЗКА КОНТРОЛЛЕРОВ
    // ===============================================

    async function loadControllers() {
        console.log('✅ loadControllers function called successfully');
        if (dataLoaded.controllers) return;
        
        const tableBody = document.querySelector("#controllers-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="7">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/admin/controllers', 'controllers');
            renderControllersTable(data);
            updatePagination('controllers');
            dataLoaded.controllers = true;
        } catch (error) {
            console.error("Error loading controllers:", error);
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderControllersTable(data) {
        const tableBody = document.querySelector("#controllers-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((controller) => {
                const row = document.createElement("tr");
                const statusClass = controller.status === 'online' ? 'status-online' : 
                                  controller.status === 'offline' ? 'status-offline' : 'status-maintenance';
                
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${controller.controller_id}"></td>
                    <td>${safeValue(controller.controller_id)}</td>
                    <td>${safeValue(controller.serial_number)}</td>
                    <td>${safeValue(controller.vendor)}</td>
                    <td>${safeValue(controller.model)}</td>
                    <td>${safeValue(controller.building_id)}</td>
                    <td><span class="status-badge ${statusClass}">${getStatusLabel(controller.status)}</span></td>
                    <td>
                        <button onclick="editController(${controller.controller_id})" class="btn-sm">Изменить</button>
                        <button onclick="deleteController(${controller.controller_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#controllers-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('controllers');
    }

    // ===============================================
    // ЗАГРУЗКА МЕТРИК
    // ===============================================

    async function loadMetrics() {
        console.log('✅ loadMetrics function called successfully');
        if (dataLoaded.metrics) return;
        
        const tableBody = document.querySelector("#metrics-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="13">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/admin/metrics', 'metrics');
            renderMetricsTable(data);
            updatePagination('metrics');
            dataLoaded.metrics = true;
        } catch (error) {
            console.error("Error loading metrics:", error);
            tableBody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderMetricsTable(data) {
        const tableBody = document.querySelector("#metrics-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((metric) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${metric.metric_id}"></td>
                    <td>${safeValue(metric.metric_id)}</td>
                    <td>${safeValue(metric.controller_id)}</td>
                    <td>${formatDate(metric.timestamp)}</td>
                    <td>${formatNumber(metric.electricity_ph1, 1)}</td>
                    <td>${formatNumber(metric.electricity_ph2, 1)}</td>
                    <td>${formatNumber(metric.electricity_ph3, 1)}</td>
                    <td>${formatNumber(metric.cold_water_pressure, 2)}</td>
                    <td>${formatNumber(metric.hot_water_in_temp, 1)}</td>
                    <td>${formatNumber(metric.air_temp, 1)}</td>
                    <td>${formatNumber(metric.humidity, 1)}</td>
                    <td>${metric.leak_sensor ? '<span class="alert-badge">Есть</span>' : '<span class="ok-badge">Нет</span>'}</td>
                    <td>
                        <button onclick="deleteMetric(${metric.metric_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="13" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#metrics-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('metrics');
    }

    // ===============================================
    // ЗАГРУЗКА ЛИНИЙ ВОДОСНАБЖЕНИЯ
    // ===============================================

    async function loadWaterLines() {
        console.log('✅ loadWaterLines function called successfully');
        if (dataLoaded['water-lines']) return;
        
        const tableBody = document.querySelector("#water-lines-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="11">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/admin/water-lines', 'water-lines');
            renderWaterLinesTable(data);
            updatePagination('water-lines');
            dataLoaded['water-lines'] = true;
        } catch (error) {
            console.error("Error loading water lines:", error);
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderWaterLinesTable(data) {
        const tableBody = document.querySelector("#water-lines-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((waterLine) => {
                const row = document.createElement("tr");
                const statusClass = waterLine.status === 'active' ? 'status-online' : 
                                  waterLine.status === 'inactive' ? 'status-offline' : 'status-maintenance';
                
                const connectedBuildings = waterLine.connected_buildings && waterLine.connected_buildings.length > 0 
                    ? waterLine.connected_buildings.join(', ') 
                    : 'Нет подключений';
                
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${waterLine.line_id}"></td>
                    <td>${safeValue(waterLine.line_id)}</td>
                    <td>${safeValue(waterLine.name)}</td>
                    <td>${safeValue(waterLine.description)}</td>
                    <td>${safeValue(waterLine.diameter_mm)}</td>
                    <td>${safeValue(waterLine.material)}</td>
                    <td>${formatNumber(waterLine.pressure_bar, 1)}</td>
                    <td>${formatDate(waterLine.installation_date)}</td>
                    <td><span class="status-badge ${statusClass}">${getWaterLineStatusLabel(waterLine.status)}</span></td>
                    <td title="${connectedBuildings}">${connectedBuildings.length > 50 ? connectedBuildings.substring(0, 50) + '...' : connectedBuildings}</td>
                    <td>
                        <button onclick="editWaterLine(${waterLine.line_id})" class="btn-sm">Изменить</button>
                        <button onclick="deleteWaterLine(${waterLine.line_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="11" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#water-lines-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('water-lines');
    }

    function getWaterLineStatusLabel(status) {
        switch(status) {
            case 'active': return 'Активная';
            case 'maintenance': return 'Обслуживание';
            case 'inactive': return 'Неактивная';
            default: return status || 'Неизвестно';
        }
    }

    // ===============================================
    // ГЛОБАЛЬНЫЙ ПОИСК
    // ===============================================

    document.getElementById('search-btn').addEventListener('click', performGlobalSearch);
    document.getElementById('global-search').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performGlobalSearch();
        }
    });

    document.getElementById('clear-search').addEventListener('click', function() {
        document.getElementById('global-search').value = '';
        clearAllFilters();
    });

    async function performGlobalSearch() {
        const searchTerm = document.getElementById('global-search').value.trim();
        if (!searchTerm) return;

        showToast(`Поиск: "${searchTerm}"`, 'info');
        
        // Применяем поиск ко всем секциям
        filters.buildings.name = searchTerm;
        filters.controllers.serial_number = searchTerm;
        filters.transformers.name = searchTerm;
        filters.lines.name = searchTerm;
        
        // Перезагружаем данные
        dataLoaded.buildings = false;
        dataLoaded.controllers = false;
        dataLoaded.transformers = false;
        dataLoaded.lines = false;
        
        // Загружаем данные для текущей активной секции
        const activeSection = document.querySelector('.admin-section.active');
        if (activeSection) {
            const sectionName = activeSection.id.replace('-section', '');
            loadSectionData(sectionName);
        }
    }

    function clearAllFilters() {
        Object.keys(filters).forEach(section => {
            filters[section] = {};
        });
        
        // Очищаем поля фильтров
        document.querySelectorAll('.filters-panel input, .filters-panel select').forEach(input => {
            input.value = '';
        });
        
        // Перезагружаем данные
        Object.keys(dataLoaded).forEach(section => {
            dataLoaded[section] = false;
        });
        
        showToast('Фильтры очищены', 'info');
    }

    // ===============================================
    // ЗАГРУЗКА ДАННЫХ
    // ===============================================

    async function loadData(endpoint, section) {
        try {
            const params = new URLSearchParams();
            params.append('page', pagination[section].page);
            params.append('limit', pagination[section].limit);
            
            // Добавляем фильтры
            Object.keys(filters[section]).forEach(key => {
                if (filters[section][key]) {
                    params.append(key, filters[section][key]);
                }
            });
            
            // Добавляем сортировку
            if (sorting[section]) {
                params.append('sort', sorting[section].column);
                params.append('order', sorting[section].direction);
            }
            
            const url = `${endpoint}?${params.toString()}`;
            console.log(`Загрузка данных с ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const responseData = await response.json();
            
            if (responseData && responseData.data) {
                if (responseData.pagination) {
                    pagination[section] = { ...pagination[section], ...responseData.pagination };
                }
                return responseData.data;
            }
            
            return responseData;
        } catch (error) {
            console.error(`Error loading data from ${endpoint}:`, error);
            showToast(`Ошибка загрузки данных: ${error.message}`, 'error');
            return [];
        }
    }

    // ===============================================
    // ЗАГРУЗКА ЗДАНИЙ
    // ===============================================

    async function loadBuildings() {
        if (dataLoaded.buildings) return;
        
        const tableBody = document.querySelector("#buildings-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="11">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/buildings', 'buildings');
            renderBuildingsTable(data);
            updatePagination('buildings');
            dataLoaded.buildings = true;
        } catch (error) {
            console.error("Error loading buildings:", error);
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderBuildingsTable(data) {
        const tableBody = document.querySelector("#buildings-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((building) => {
                // Строка 1: Основная информация
                const row1 = document.createElement("tr");
                row1.className = "building-row-1";
                row1.innerHTML = `
                    <td rowspan="3"><input type="checkbox" class="item-checkbox" data-id="${building.building_id}"></td>
                    <td rowspan="3">${safeValue(building.building_id)}</td>
                    <td rowspan="3">${safeValue(building.name)}</td>
                    <td>${safeValue(building.address)}</td>
                    <td>${safeValue(building.town)}</td>
                    <td>${safeValue(building.region)}</td>
                    <td>${formatNumber(building.latitude, 6)}</td>
                    <td>${formatNumber(building.longitude, 6)}</td>
                    <td rowspan="3">
                        <button onclick="editBuilding(${building.building_id})" class="btn-sm">Изменить</button><br>
                        <button onclick="deleteBuilding(${building.building_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                
                // Строка 2: Инфраструктура
                const row2 = document.createElement("tr");
                row2.className = "building-row-2";
                row2.innerHTML = `
                    <td>${safeValue(building.management_company)}</td>
                    <td>${building.hot_water ? "Да" : "Нет"}</td>
                    <td>${safeValue(building.primary_transformer_name)}</td>
                    <td>${safeValue(building.backup_transformer_name)}</td>
                    <td>${safeValue(building.primary_line_name)}</td>
                `;
                
                // Строка 3: Водоснабжение
                const row3 = document.createElement("tr");
                row3.className = "building-row-3 building-group";
                row3.innerHTML = `
                    <td>${safeValue(building.backup_line_name)}</td>
                    <td>${safeValue(building.cold_water_line_name)}</td>
                    <td>${safeValue(building.hot_water_line_name)}</td>
                    <td>${safeValue(building.cold_water_supplier_name)}</td>
                    <td>${safeValue(building.hot_water_supplier_name)}</td>
                `;
                
                newTableBody.appendChild(row1);
                newTableBody.appendChild(row2);
                newTableBody.appendChild(row3);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#buildings-table");
        table.replaceChild(newTableBody, tableBody);
        
        // Обновляем обработчики чекбоксов
        updateCheckboxHandlers('buildings');
    }

    // ===============================================
    // ЗАГРУЗКА ТРАНСФОРМАТОРОВ
    // ===============================================

    async function loadTransformers() {
        if (dataLoaded.transformers) return;
        
        const tableBody = document.querySelector("#transformers-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="7">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/transformers', 'transformers');
            renderTransformersTable(data);
            updatePagination('transformers');
            dataLoaded.transformers = true;
        } catch (error) {
            console.error("Error loading transformers:", error);
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderTransformersTable(data) {
        const tableBody = document.querySelector("#transformers-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((transformer) => {
                const row = document.createElement("tr");
                const primaryBuildings = Array.isArray(transformer.primary_buildings) 
                    ? transformer.primary_buildings.filter(b => b !== null).join(', ') 
                    : '';
                const backupBuildings = Array.isArray(transformer.backup_buildings) 
                    ? transformer.backup_buildings.filter(b => b !== null).join(', ') 
                    : '';
                
                const buildingsText = [];
                if (primaryBuildings) buildingsText.push(`Основные: ${primaryBuildings}`);
                if (backupBuildings) buildingsText.push(`Резервные: ${backupBuildings}`);
                
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${transformer.transformer_id}"></td>
                    <td>${safeValue(transformer.transformer_id)}</td>
                    <td>${safeValue(transformer.name)}</td>
                    <td>${formatNumber(transformer.power_kva, 1)}</td>
                    <td>${formatNumber(transformer.voltage_kv, 1)}</td>
                    <td>${buildingsText.join('<br>') || 'Нет подключенных зданий'}</td>
                    <td>
                        <button onclick="editTransformer(${transformer.transformer_id})" class="btn-sm">Изменить</button>
                        <button onclick="deleteTransformer(${transformer.transformer_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#transformers-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('transformers');
    }

    // ===============================================
    // ЗАГРУЗКА ЛИНИЙ
    // ===============================================

    async function loadLines() {
        if (dataLoaded.lines) return;
        
        const tableBody = document.querySelector("#lines-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="7">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/lines', 'lines');
            renderLinesTable(data);
            updatePagination('lines');
            dataLoaded.lines = true;
        } catch (error) {
            console.error("Error loading lines:", error);
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderLinesTable(data) {
        const tableBody = document.querySelector("#lines-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((line) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${line.line_id}"></td>
                    <td>${safeValue(line.line_id)}</td>
                    <td>${safeValue(line.name)}</td>
                    <td>${formatNumber(line.voltage_kv, 1)}</td>
                    <td>${formatNumber(line.length_km, 3)}</td>
                    <td>${safeValue(line.transformer_id)}</td>
                    <td>
                        <button onclick="editLine(${line.line_id})" class="btn-sm">Изменить</button>
                        <button onclick="deleteLine(${line.line_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#lines-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('lines');
    }

    // ===============================================
    // ЗАГРУЗКА ИСТОЧНИКОВ ВОДЫ
    // ===============================================

    async function loadWaterSources() {
        if (dataLoaded.waterSources) return;
        
        const tableBody = document.querySelector("#water-sources-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="9">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/cold-water-sources', 'waterSources');
            renderWaterSourcesTable(data);
            updatePagination('waterSources');
            dataLoaded.waterSources = true;
        } catch (error) {
            console.error("Error loading water sources:", error);
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderWaterSourcesTable(data) {
        const tableBody = document.querySelector("#water-sources-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((source) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${source.id}"></td>
                    <td>${safeValue(source.id)}</td>
                    <td>${safeValue(source.name)}</td>
                    <td>${safeValue(source.address)}</td>
                    <td>${getSourceTypeLabel(source.source_type, 'water')}</td>
                    <td>${formatNumber(source.capacity_m3_per_hour, 1)}</td>
                    <td>${formatNumber(source.operating_pressure_bar, 1)}</td>
                    <td>${getStatusLabel(source.status)}</td>
                    <td>
                        <button onclick="editWaterSource('${source.id}')" class="btn-sm">Изменить</button>
                        <button onclick="deleteWaterSource('${source.id}')" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#water-sources-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('waterSources');
    }

    // ===============================================
    // ЗАГРУЗКА ИСТОЧНИКОВ ТЕПЛА
    // ===============================================

    async function loadHeatSources() {
        if (dataLoaded.heatSources) return;
        
        const tableBody = document.querySelector("#heat-sources-table tbody");
        tableBody.innerHTML = `<tr class="loading-row"><td colspan="9">Загрузка данных...</td></tr>`;
        
        try {
            const data = await loadData('/api/heat-sources', 'heatSources');
            renderHeatSourcesTable(data);
            updatePagination('heatSources');
            dataLoaded.heatSources = true;
        } catch (error) {
            console.error("Error loading heat sources:", error);
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: red;">Ошибка загрузки данных</td></tr>`;
        }
    }

    function renderHeatSourcesTable(data) {
        const tableBody = document.querySelector("#heat-sources-table tbody");
        const newTableBody = document.createElement('tbody');
        
        if (data && data.length > 0) {
            data.forEach((source) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${source.id}"></td>
                    <td>${safeValue(source.id)}</td>
                    <td>${safeValue(source.name)}</td>
                    <td>${safeValue(source.address)}</td>
                    <td>${getSourceTypeLabel(source.source_type, 'heat')}</td>
                    <td>${formatNumber(source.capacity_mw, 1)}</td>
                    <td>${safeValue(source.fuel_type)}</td>
                    <td>${getStatusLabel(source.status)}</td>
                    <td>
                        <button onclick="editHeatSource('${source.id}')" class="btn-sm">Изменить</button>
                        <button onclick="deleteHeatSource('${source.id}')" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">Нет данных</td></tr>`;
        }
        
        const table = document.querySelector("#heat-sources-table");
        table.replaceChild(newTableBody, tableBody);
        
        updateCheckboxHandlers('heatSources');
    }

    // ===============================================
    // УТИЛИТЫ ДЛЯ ФОРМАТИРОВАНИЯ
    // ===============================================

    function getSourceTypeLabel(type, category) {
        if (category === 'water') {
            const waterTypes = {
                'pumping_station': 'Насосная станция',
                'well': 'Скважина',
                'reservoir': 'Резервуар'
            };
            return waterTypes[type] || type;
        } else if (category === 'heat') {
            const heatTypes = {
                'boiler_house': 'Котельная',
                'heat_plant': 'Тепловая станция',
                'chp': 'ТЭЦ'
            };
            return heatTypes[type] || type;
        }
        return type;
    }

    function getStatusLabel(status) {
        const statusLabels = {
            'active': 'Активный',
            'inactive': 'Неактивный',
            'maintenance': 'На обслуживании'
        };
        return statusLabels[status] || status;
    }

    // ===============================================
    // ОБРАБОТЧИКИ ЧЕКБОКСОВ И BATCH ОПЕРАЦИЙ
    // ===============================================

    function updateCheckboxHandlers(section) {
        // Обработчик для "выбрать все"
        const selectAllCheckbox = document.getElementById(`${section}-select-all-checkbox`);
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function() {
                const checkboxes = document.querySelectorAll(`#${section}-section .item-checkbox`);
                checkboxes.forEach(checkbox => {
                    checkbox.checked = this.checked;
                    const id = checkbox.dataset.id;
                    if (this.checked) {
                        selectedItems[section].add(id);
                    } else {
                        selectedItems[section].delete(id);
                    }
                });
                updateBatchButtons(section);
            });
        }

        // Обработчики для отдельных чекбоксов
        const itemCheckboxes = document.querySelectorAll(`#${section}-section .item-checkbox`);
        itemCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const id = this.dataset.id;
                if (this.checked) {
                    selectedItems[section].add(id);
                } else {
                    selectedItems[section].delete(id);
                }
                updateBatchButtons(section);
                
                // Обновляем состояние "выбрать все"
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = itemCheckboxes.length > 0 && 
                        Array.from(itemCheckboxes).every(cb => cb.checked);
                }
            });
        });
    }

    function updateBatchButtons(section) {
        const selectedCount = selectedItems[section].size;
        const bulkDeleteBtn = document.getElementById(`${section}-bulk-delete`);
        const bulkStatusBtn = document.getElementById(`${section}-bulk-status`);
        const bulkStatusSelect = document.getElementById(`${section}-bulk-status-select`);
        
        if (bulkDeleteBtn) {
            bulkDeleteBtn.disabled = selectedCount === 0;
            bulkDeleteBtn.textContent = `Удалить выбранные (${selectedCount})`;
        }
        
        if (bulkStatusBtn) {
            bulkStatusBtn.disabled = selectedCount === 0;
            bulkStatusBtn.textContent = `Изменить статус (${selectedCount})`;
        }
        
        if (bulkStatusSelect) {
            bulkStatusSelect.disabled = selectedCount === 0;
        }
    }

    // ===============================================
    // ПАГИНАЦИЯ
    // ===============================================

    function updatePagination(section) {
        const pageInfo = document.getElementById(`${section}-page-info`);
        const prevBtn = document.getElementById(`${section}-prev-page`);
        const nextBtn = document.getElementById(`${section}-next-page`);
        
        if (pageInfo) {
            const currentPage = pagination[section].page;
            const totalPages = Math.ceil(pagination[section].total / pagination[section].limit);
            pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
        }
        
        if (prevBtn) {
            prevBtn.disabled = pagination[section].page <= 1;
            prevBtn.onclick = () => {
                if (pagination[section].page > 1) {
                    pagination[section].page--;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            };
        }
        
        if (nextBtn) {
            const totalPages = Math.ceil(pagination[section].total / pagination[section].limit);
            nextBtn.disabled = pagination[section].page >= totalPages;
            nextBtn.onclick = () => {
                const totalPages = Math.ceil(pagination[section].total / pagination[section].limit);
                if (pagination[section].page < totalPages) {
                    pagination[section].page++;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            };
        }
    }

    // ===============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ===============================================

    // Загружаем данные для активной секции при старте
    loadSectionData('buildings');
    
    // Показываем таблицы после загрузки
    document.querySelectorAll('.table-container').forEach(container => {
        container.style.opacity = '1';
    });

    // Глобальные функции для кнопок (будут доступны из HTML)
    window.editBuilding = function(id) { /* реализация */ };
    window.deleteBuilding = function(id) { /* реализация */ };
    window.editController = function(id) { /* реализация */ };
    window.deleteController = function(id) { /* реализация */ };
    window.deleteMetric = function(id) { /* реализация */ };
    window.editTransformer = function(id) { /* реализация */ };
    window.deleteTransformer = function(id) { /* реализация */ };
    window.editLine = function(id) { /* реализация */ };
    window.deleteLine = function(id) { /* реализация */ };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ КОНТРОЛЛЕРОВ
    // ===============================================

    window.editController = async function(id) {
        try {
            const response = await fetch(`/api/admin/controllers/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки контроллера');
            
            const controller = await response.json();
            
            // Открываем универсальное модальное окно
            openUniversalModal('controller', controller, {
                title: 'Редактировать контроллер',
                fields: [
                    { name: 'serial_number', label: 'Серийный номер', type: 'text', required: true },
                    { name: 'vendor', label: 'Производитель', type: 'text' },
                    { name: 'model', label: 'Модель', type: 'text' },
                    { name: 'building_id', label: 'ID здания', type: 'number', required: true },
                    { name: 'status', label: 'Статус', type: 'select', options: [
                        { value: 'online', text: 'Online' },
                        { value: 'offline', text: 'Offline' },
                        { value: 'maintenance', text: 'Maintenance' }
                    ]}
                ],
                onSave: async (data) => {
                    const updateResponse = await fetch(`/api/admin/controllers/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    if (!updateResponse.ok) throw new Error('Ошибка обновления контроллера');
                    
                    showToast('Контроллер успешно обновлен', 'success');
                    dataLoaded.controllers = false;
                    loadControllers();
                }
            });
        } catch (error) {
            console.error('Error loading controller:', error);
            showToast('Ошибка загрузки данных контроллера', 'error');
        }
    };

    window.deleteController = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить этот контроллер?')) return;
        
        try {
            const response = await fetch(`/api/admin/controllers/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления контроллера');
            
            showToast('Контроллер успешно удален', 'success');
            dataLoaded.controllers = false;
            loadControllers();
        } catch (error) {
            console.error('Error deleting controller:', error);
            showToast('Ошибка удаления контроллера', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ МЕТРИК
    // ===============================================

    window.deleteMetric = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить эту метрику?')) return;
        
        try {
            const response = await fetch(`/api/admin/metrics/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления метрики');
            
            showToast('Метрика успешно удалена', 'success');
            dataLoaded.metrics = false;
            loadMetrics();
        } catch (error) {
            console.error('Error deleting metric:', error);
            showToast('Ошибка удаления метрики', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ ЛИНИЙ ВОДОСНАБЖЕНИЯ
    // ===============================================

    window.editWaterLine = async function(id) {
        try {
            const response = await fetch(`/api/admin/water-lines/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки линии водоснабжения');
            
            const waterLine = await response.json();
            const data = waterLine.data || waterLine;
            
            // Открываем универсальное модальное окно
            openUniversalModal('water-line', data, {
                title: 'Редактировать линию водоснабжения',
                fields: [
                    { name: 'name', label: 'Название', type: 'text', required: true },
                    { name: 'description', label: 'Описание', type: 'textarea' },
                    { name: 'diameter_mm', label: 'Диаметр (мм)', type: 'number', required: true },
                    { name: 'material', label: 'Материал', type: 'select', required: true, options: [
                        { value: 'Сталь', text: 'Сталь' },
                        { value: 'Полиэтилен', text: 'Полиэтилен' },
                        { value: 'Чугун', text: 'Чугун' },
                        { value: 'Медь', text: 'Медь' },
                        { value: 'ПВХ', text: 'ПВХ' }
                    ]},
                    { name: 'pressure_bar', label: 'Давление (бар)', type: 'number', step: '0.1', required: true },
                    { name: 'installation_date', label: 'Дата установки', type: 'date' },
                    { name: 'status', label: 'Статус', type: 'select', options: [
                        { value: 'active', text: 'Активная' },
                        { value: 'maintenance', text: 'На обслуживании' },
                        { value: 'inactive', text: 'Неактивная' }
                    ]}
                ],
                onSave: async (formData) => {
                    const updateResponse = await fetch(`/api/admin/water-lines/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });
                    
                    if (!updateResponse.ok) throw new Error('Ошибка обновления линии водоснабжения');
                    
                    showToast('Линия водоснабжения успешно обновлена', 'success');
                    dataLoaded['water-lines'] = false;
                    loadWaterLines();
                }
            });
        } catch (error) {
            console.error('Error loading water line:', error);
            showToast('Ошибка загрузки данных линии водоснабжения', 'error');
        }
    };

    window.deleteWaterLine = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить эту линию водоснабжения? Это может повлиять на связанные здания.')) return;
        
        try {
            const response = await fetch(`/api/admin/water-lines/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Ошибка удаления линии водоснабжения');
            }
            
            showToast('Линия водоснабжения успешно удалена', 'success');
            dataLoaded['water-lines'] = false;
            loadWaterLines();
        } catch (error) {
            console.error('Error deleting water line:', error);
            showToast(error.message || 'Ошибка удаления линии водоснабжения', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ ТРАНСФОРМАТОРОВ
    // ===============================================

    window.editTransformer = async function(id) {
        try {
            const response = await fetch(`/api/transformers/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки трансформатора');
            
            const transformer = await response.json();
            
            // Заполняем форму редактирования
            document.getElementById('edit-transformer-id').value = transformer.transformer_id;
            document.getElementById('edit-transformer-name').value = transformer.name || '';
            document.getElementById('edit-transformer-power').value = transformer.power_kva || '';
            document.getElementById('edit-transformer-voltage').value = transformer.voltage_kv || '';
            document.getElementById('edit-transformer-building-id').value = transformer.building_id || '';
            
            // Показываем модальное окно
            document.getElementById('edit-transformer-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading transformer:', error);
            showToast('Ошибка загрузки данных трансформатора', 'error');
        }
    };

    window.deleteTransformer = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить этот трансформатор?')) return;
        
        try {
            const response = await fetch(`/api/transformers/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления трансформатора');
            
            showToast('Трансформатор успешно удален', 'success');
            dataLoaded.transformers = false;
            loadTransformers();
        } catch (error) {
            console.error('Error deleting transformer:', error);
            showToast('Ошибка удаления трансформатора', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ ЛИНИЙ
    // ===============================================

    window.editLine = async function(id) {
        try {
            const response = await fetch(`/api/lines/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки линии');
            
            const line = await response.json();
            
            // Заполняем форму редактирования
            document.getElementById('edit-line-id').value = line.line_id;
            document.getElementById('edit-line-name').value = line.name || '';
            document.getElementById('edit-line-voltage').value = line.voltage_kv || '';
            document.getElementById('edit-line-length').value = line.length_km || '';
            document.getElementById('edit-line-transformer-id').value = line.transformer_id || '';
            
            // Показываем модальное окно
            document.getElementById('edit-line-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading line:', error);
            showToast('Ошибка загрузки данных линии', 'error');
        }
    };

    window.deleteLine = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить эту линию?')) return;
        
        try {
            const response = await fetch(`/api/lines/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления линии');
            
            showToast('Линия успешно удалена', 'success');
            dataLoaded.lines = false;
            loadLines();
        } catch (error) {
            console.error('Error deleting line:', error);
            showToast('Ошибка удаления линии', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ ИСТОЧНИКОВ ВОДЫ
    // ===============================================

    window.editWaterSource = async function(id) {
        try {
            const response = await fetch(`/api/cold-water-sources/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки источника воды');
            
            const source = await response.json();
            
            // Заполняем форму редактирования
            document.getElementById('edit-water-source-id').value = source.id;
            document.getElementById('edit-water-source-name').value = source.name || '';
            document.getElementById('edit-water-source-address').value = source.address || '';
            document.getElementById('edit-water-source-latitude').value = source.latitude || '';
            document.getElementById('edit-water-source-longitude').value = source.longitude || '';
            document.getElementById('edit-water-source-type').value = source.source_type || '';
            document.getElementById('edit-water-source-capacity').value = source.capacity_m3_per_hour || '';
            document.getElementById('edit-water-source-pressure').value = source.operating_pressure_bar || '';
            document.getElementById('edit-water-source-contact').value = source.maintenance_contact || '';
            document.getElementById('edit-water-source-notes').value = source.notes || '';
            document.getElementById('edit-water-source-status').value = source.status || 'active';
            
            // Показываем модальное окно
            document.getElementById('edit-water-source-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading water source:', error);
            showToast('Ошибка загрузки данных источника воды', 'error');
        }
    };

    window.deleteWaterSource = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить этот источник воды?')) return;
        
        try {
            const response = await fetch(`/api/cold-water-sources/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления источника воды');
            
            showToast('Источник воды успешно удален', 'success');
            dataLoaded.waterSources = false;
            loadWaterSources();
        } catch (error) {
            console.error('Error deleting water source:', error);
            showToast('Ошибка удаления источника воды', 'error');
        }
    };

    // ===============================================
    // ФУНКЦИИ РЕДАКТИРОВАНИЯ ИСТОЧНИКОВ ТЕПЛА
    // ===============================================

    window.editHeatSource = async function(id) {
        try {
            const response = await fetch(`/api/heat-sources/${id}`);
            if (!response.ok) throw new Error('Ошибка загрузки источника тепла');
            
            const source = await response.json();
            
            // Заполняем форму редактирования
            document.getElementById('edit-heat-source-id').value = source.id;
            document.getElementById('edit-heat-source-name').value = source.name || '';
            document.getElementById('edit-heat-source-address').value = source.address || '';
            document.getElementById('edit-heat-source-latitude').value = source.latitude || '';
            document.getElementById('edit-heat-source-longitude').value = source.longitude || '';
            document.getElementById('edit-heat-source-type').value = source.source_type || '';
            document.getElementById('edit-heat-source-capacity').value = source.capacity_mw || '';
            document.getElementById('edit-heat-source-fuel').value = source.fuel_type || '';
            document.getElementById('edit-heat-source-contact').value = source.maintenance_contact || '';
            document.getElementById('edit-heat-source-notes').value = source.notes || '';
            document.getElementById('edit-heat-source-status').value = source.status || 'active';
            
            // Показываем модальное окно
            document.getElementById('edit-heat-source-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading heat source:', error);
            showToast('Ошибка загрузки данных источника тепла', 'error');
        }
    };

    window.deleteHeatSource = async function(id) {
        if (!confirm('Вы уверены, что хотите удалить этот источник тепла?')) return;
        
        try {
            const response = await fetch(`/api/heat-sources/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Ошибка удаления источника тепла');
            
            showToast('Источник тепла успешно удален', 'success');
            dataLoaded.heatSources = false;
            loadHeatSources();
        } catch (error) {
            console.error('Error deleting heat source:', error);
            showToast('Ошибка удаления источника тепла', 'error');
        }
    };

    // ===============================================
    // ОБРАБОТЧИКИ ФОРМ РЕДАКТИРОВАНИЯ
    // ===============================================

    // Обработчик формы редактирования трансформаторов
    document.getElementById('edit-transformer-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const id = document.getElementById('edit-transformer-id').value;
        const data = {
            name: document.getElementById('edit-transformer-name').value,
            power_kva: parseFloat(document.getElementById('edit-transformer-power').value),
            voltage_kv: parseFloat(document.getElementById('edit-transformer-voltage').value),
            building_id: parseInt(document.getElementById('edit-transformer-building-id').value)
        };
        
        try {
            const response = await fetch(`/api/transformers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) throw new Error('Ошибка обновления трансформатора');
            
            showToast('Трансформатор успешно обновлен', 'success');
            document.getElementById('edit-transformer-modal').style.display = 'none';
            dataLoaded.transformers = false;
            loadTransformers();
        } catch (error) {
            console.error('Error updating transformer:', error);
            showToast('Ошибка обновления трансформатора', 'error');
        }
    });

    // Обработчик формы редактирования линий
    document.getElementById('edit-line-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const id = document.getElementById('edit-line-id').value;
        const data = {
            name: document.getElementById('edit-line-name').value,
            voltage_kv: parseFloat(document.getElementById('edit-line-voltage').value),
            length_km: parseFloat(document.getElementById('edit-line-length').value),
            transformer_id: parseInt(document.getElementById('edit-line-transformer-id').value)
        };
        
        try {
            const response = await fetch(`/api/lines/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) throw new Error('Ошибка обновления линии');
            
            showToast('Линия успешно обновлена', 'success');
            document.getElementById('edit-line-modal').style.display = 'none';
            dataLoaded.lines = false;
            loadLines();
        } catch (error) {
            console.error('Error updating line:', error);
            showToast('Ошибка обновления линии', 'error');
        }
    });

    // Обработчик формы редактирования источников воды
    document.getElementById('edit-water-source-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const id = document.getElementById('edit-water-source-id').value;
        const data = {
            name: document.getElementById('edit-water-source-name').value,
            address: document.getElementById('edit-water-source-address').value,
            latitude: parseFloat(document.getElementById('edit-water-source-latitude').value),
            longitude: parseFloat(document.getElementById('edit-water-source-longitude').value),
            source_type: document.getElementById('edit-water-source-type').value,
            capacity_m3_per_hour: parseFloat(document.getElementById('edit-water-source-capacity').value) || null,
            operating_pressure_bar: parseFloat(document.getElementById('edit-water-source-pressure').value) || null,
            maintenance_contact: document.getElementById('edit-water-source-contact').value,
            notes: document.getElementById('edit-water-source-notes').value,
            status: document.getElementById('edit-water-source-status').value
        };
        
        try {
            const response = await fetch(`/api/cold-water-sources/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) throw new Error('Ошибка обновления источника воды');
            
            showToast('Источник воды успешно обновлен', 'success');
            document.getElementById('edit-water-source-modal').style.display = 'none';
            dataLoaded.waterSources = false;
            loadWaterSources();
        } catch (error) {
            console.error('Error updating water source:', error);
            showToast('Ошибка обновления источника воды', 'error');
        }
    });

    // Обработчик формы редактирования источников тепла
    document.getElementById('edit-heat-source-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const id = document.getElementById('edit-heat-source-id').value;
        const data = {
            name: document.getElementById('edit-heat-source-name').value,
            address: document.getElementById('edit-heat-source-address').value,
            latitude: parseFloat(document.getElementById('edit-heat-source-latitude').value),
            longitude: parseFloat(document.getElementById('edit-heat-source-longitude').value),
            source_type: document.getElementById('edit-heat-source-type').value,
            capacity_mw: parseFloat(document.getElementById('edit-heat-source-capacity').value) || null,
            fuel_type: document.getElementById('edit-heat-source-fuel').value,
            maintenance_contact: document.getElementById('edit-heat-source-contact').value,
            notes: document.getElementById('edit-heat-source-notes').value,
            status: document.getElementById('edit-heat-source-status').value
        };
        
        try {
            const response = await fetch(`/api/heat-sources/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) throw new Error('Ошибка обновления источника тепла');
            
            showToast('Источник тепла успешно обновлен', 'success');
            document.getElementById('edit-heat-source-modal').style.display = 'none';
            dataLoaded.heatSources = false;
            loadHeatSources();
        } catch (error) {
            console.error('Error updating heat source:', error);
            showToast('Ошибка обновления источника тепла', 'error');
        }
    });

    // Обработчики кнопок отмены
    document.getElementById('cancel-edit-transformer').addEventListener('click', function() {
        document.getElementById('edit-transformer-modal').style.display = 'none';
    });

    document.getElementById('cancel-edit-line').addEventListener('click', function() {
        document.getElementById('edit-line-modal').style.display = 'none';
    });

    document.getElementById('cancel-edit-water-source').addEventListener('click', function() {
        document.getElementById('edit-water-source-modal').style.display = 'none';
    });

    document.getElementById('cancel-edit-heat-source').addEventListener('click', function() {
        document.getElementById('edit-heat-source-modal').style.display = 'none';
    });

    // ===============================================
    // ФОРМА ДОБАВЛЕНИЯ ЗДАНИЯ - ЗАГРУЗКА ДАННЫХ
    // ===============================================

    // Функции загрузки данных для dropdown'ов
    async function loadFormData() {
        try {
            // Загружаем все необходимые данные параллельно
            const [transformersResponse, linesResponse, waterLinesResponse, waterSuppliersResponse] = await Promise.all([
                fetch('/api/transformers').then(r => r.json()),
                fetch('/api/lines').then(r => r.json()),
                fetch('/api/water-lines').then(r => r.json()),
                fetch('/api/water-suppliers').then(r => r.json())
            ]);

            // Извлекаем массивы данных из ответов API
            const transformersData = transformersResponse.data || transformersResponse;
            const linesData = linesResponse.data || linesResponse;
            const waterLinesData = waterLinesResponse.data || waterLinesResponse;
            const waterSuppliersData = waterSuppliersResponse.data || waterSuppliersResponse;

            console.log('Transformers data:', transformersData);
            console.log('Lines data:', linesData);
            console.log('Water lines data:', waterLinesData);
            console.log('Water suppliers data:', waterSuppliersData);
            
            // ОТЛАДКА: Проверяем каждого поставщика
            if (Array.isArray(waterSuppliersData)) {
                waterSuppliersData.forEach((supplier, index) => {
                    console.log(`Supplier ${index}:`, supplier.name, 'type:', supplier.type);
                });
            }

            // Заполняем dropdown трансформаторов
            fillDropdown('building-primary-transformer', transformersData, 'transformer_id', 'name');
            fillDropdown('building-backup-transformer', transformersData, 'transformer_id', 'name');

            // Заполняем dropdown линий
            fillDropdown('building-primary-line', linesData, 'line_id', 'name');
            fillDropdown('building-backup-line', linesData, 'line_id', 'name');

            // Разделяем водные линии на ХВС и ГВС
            const coldWaterLines = Array.isArray(waterLinesData) ? 
                waterLinesData.filter(line => line.name.includes('ХВС')) : [];
            const hotWaterLines = Array.isArray(waterLinesData) ? 
                waterLinesData.filter(line => line.name.includes('ГВС')) : [];

            // Заполняем dropdown линий водоснабжения
            fillDropdown('building-cold-water-line', coldWaterLines, 'line_id', 'name');
            fillDropdown('building-hot-water-line', hotWaterLines, 'line_id', 'name');

            // Разделяем поставщиков на ХВС и ГВС
            console.log('🔍 ОТЛАДКА: waterSuppliersData before filtering:', waterSuppliersData);
            console.log('🔍 ОТЛАДКА: Is waterSuppliersData array?', Array.isArray(waterSuppliersData));
            
            // Дополнительная проверка структуры данных
            if (Array.isArray(waterSuppliersData)) {
                console.log('🔍 ОТЛАДКА: Количество поставщиков:', waterSuppliersData.length);
                waterSuppliersData.forEach((supplier, index) => {
                    console.log(`🔍 ОТЛАДКА: Supplier ${index}:`, supplier.name, 'type:', supplier.type, 'typeof:', typeof supplier.type);
                });
            }
            
            const coldSuppliers = Array.isArray(waterSuppliersData) ? 
                waterSuppliersData.filter(s => {
                    console.log('🔍 ОТЛАДКА: Checking supplier:', s.name, 'type:', s.type, 'is cold_water?', s.type === 'cold_water');
                    return s.type === 'cold_water';
                }) : [];
            const hotSuppliers = Array.isArray(waterSuppliersData) ? 
                waterSuppliersData.filter(s => {
                    console.log('🔍 ОТЛАДКА: Checking supplier:', s.name, 'type:', s.type, 'is hot_water?', s.type === 'hot_water');
                    return s.type === 'hot_water';
                }) : [];

            console.log('🔍 ОТЛАДКА: Cold suppliers result:', coldSuppliers);
            console.log('🔍 ОТЛАДКА: Hot suppliers result:', hotSuppliers);

            fillDropdown('building-cold-water-supplier', coldSuppliers, 'supplier_id', 'name');
            fillDropdown('building-hot-water-supplier', hotSuppliers, 'supplier_id', 'name');

        } catch (error) {
            console.error('Ошибка загрузки данных для формы:', error);
            showToast('Ошибка загрузки данных для формы', 'error');
        }
    }

    // Функция заполнения dropdown
    function fillDropdown(elementId, data, valueField, textField) {
        console.log(`fillDropdown called for ${elementId}:`, {data, valueField, textField});
        
        const dropdown = document.getElementById(elementId);
        if (!dropdown) {
            console.warn(`Dropdown с ID ${elementId} не найден`);
            return;
        }

        if (!Array.isArray(data)) {
            console.warn(`Данные для ${elementId} не являются массивом:`, data);
            return;
        }

        // Сохраняем первую опцию (placeholder)
        const firstOption = dropdown.firstElementChild ? dropdown.firstElementChild.cloneNode(true) : null;
        dropdown.innerHTML = '';
        if (firstOption) {
            dropdown.appendChild(firstOption);
        }

        // Добавляем данные
        data.forEach((item, index) => {
            console.log(`Processing item ${index} for ${elementId}:`, item);
            if (item && item[valueField] !== undefined && item[textField]) {
                const option = document.createElement('option');
                option.value = item[valueField];
                option.textContent = item[textField];
                dropdown.appendChild(option);
                console.log(`Added option: ${item[textField]} (${item[valueField]})`);
            } else {
                console.warn(`Skipped item ${index} for ${elementId}:`, item, `valueField: ${valueField}, textField: ${textField}`);
            }
        });

        console.log(`Заполнен dropdown ${elementId} с ${data.length} элементами`);
    }

    // Загружаем данные при загрузке страницы (перенесено в конец файла)
    // loadFormData();

    // ===============================================
    // ОБРАБОТЧИК ФОРМЫ ДОБАВЛЕНИЯ ЗДАНИЯ
    // ===============================================

    document.getElementById('add-building-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const data = {
            name: document.getElementById('building-name').value,
            address: document.getElementById('building-address').value,
            town: document.getElementById('building-town').value,
            region: document.getElementById('building-region').value,
            latitude: parseFloat(document.getElementById('building-latitude').value),
            longitude: parseFloat(document.getElementById('building-longitude').value),
            management_company: document.getElementById('building-management').value,
            hot_water: document.getElementById('building-hot-water').checked,
            primary_transformer_id: document.getElementById('building-primary-transformer').value || null,
            backup_transformer_id: document.getElementById('building-backup-transformer').value || null,
            primary_line_id: document.getElementById('building-primary-line').value || null,
            backup_line_id: document.getElementById('building-backup-line').value || null,
            cold_water_line_id: document.getElementById('building-cold-water-line').value || null,
            hot_water_line_id: document.getElementById('building-hot-water-line').value || null,
            cold_water_supplier_id: document.getElementById('building-cold-water-supplier').value || null,
            hot_water_supplier_id: document.getElementById('building-hot-water-supplier').value || null
        };
        
        try {
            const response = await fetch('/api/buildings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания здания');
            }
            
            showToast('Здание успешно добавлено', 'success');
            
            // Очищаем форму
            document.getElementById('add-building-form').reset();
            
            // Перезагружаем данные зданий
            dataLoaded.buildings = false;
            loadBuildings();
            
        } catch (error) {
            console.error('Error creating building:', error);
            showToast('Ошибка создания здания: ' + error.message, 'error');
        }
    });

    // ===============================================
    // ОБРАБОТЧИК ФОРМЫ ДОБАВЛЕНИЯ КОНТРОЛЛЕРА
    // ===============================================

    document.getElementById('add-controller-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const data = {
            serial_number: document.getElementById('controller-serial').value,
            vendor: document.getElementById('controller-vendor').value,
            model: document.getElementById('controller-model').value,
            building_id: parseInt(document.getElementById('controller-building-id').value),
            status: document.getElementById('controller-status').value
        };
        
        try {
            const response = await fetch('/api/admin/controllers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания контроллера');
            }
            
            showToast('Контроллер успешно добавлен', 'success');
            
            // Очищаем форму
            document.getElementById('add-controller-form').reset();
            
            // Перезагружаем данные контроллеров
            dataLoaded.controllers = false;
            loadControllers();
            
        } catch (error) {
            console.error('Error creating controller:', error);
            showToast('Ошибка создания контроллера: ' + error.message, 'error');
        }
    });

    // Обработчик формы добавления метрики
    document.getElementById('add-metric-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const data = {
            controller_id: parseInt(document.getElementById('metric-controller-id').value),
            electricity_ph1: parseFloat(document.getElementById('metric-electricity-ph1').value),
            electricity_ph2: parseFloat(document.getElementById('metric-electricity-ph2').value),
            electricity_ph3: parseFloat(document.getElementById('metric-electricity-ph3').value),
            cold_water_pressure: parseFloat(document.getElementById('metric-cold-water-pressure').value),
            hot_water_in_temp: parseFloat(document.getElementById('metric-hot-water-in-temp').value),
            air_temp: parseFloat(document.getElementById('metric-air-temp').value),
            humidity: parseFloat(document.getElementById('metric-humidity').value),
            leak_sensor: document.getElementById('metric-leak-sensor').checked
        };
        
        try {
            const response = await fetch('/api/admin/metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания метрики');
            }
            
            showToast('Метрика успешно добавлена', 'success');
            
            // Очищаем форму
            document.getElementById('add-metric-form').reset();
            
            // Перезагружаем данные метрик
            dataLoaded.metrics = false;
            loadMetrics();
            
        } catch (error) {
            console.error('Error creating metric:', error);
            showToast('Ошибка создания метрики: ' + error.message, 'error');
        }
    });

    // ===============================================
    // ОБРАБОТЧИК ФОРМЫ ДОБАВЛЕНИЯ ЛИНИЙ ВОДОСНАБЖЕНИЯ
    // ===============================================

    document.getElementById('add-water-line-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const data = {
            name: document.getElementById('water-line-name').value,
            description: document.getElementById('water-line-description').value,
            diameter_mm: parseInt(document.getElementById('water-line-diameter').value),
            material: document.getElementById('water-line-material').value,
            pressure_bar: parseFloat(document.getElementById('water-line-pressure').value),
            installation_date: document.getElementById('water-line-installation-date').value || null,
            status: document.getElementById('water-line-status').value
        };
        
        try {
            const response = await fetch('/api/admin/water-lines', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания линии водоснабжения');
            }
            
            showToast('Линия водоснабжения успешно добавлена', 'success');
            
            // Очищаем форму
            document.getElementById('add-water-line-form').reset();
            
            // Перезагружаем данные линий водоснабжения
            dataLoaded['water-lines'] = false;
            loadWaterLines();
            
        } catch (error) {
            console.error('Error creating water line:', error);
            showToast('Ошибка создания линии водоснабжения: ' + error.message, 'error');
        }
    });

    // ===============================================
    // УНИВЕРСАЛЬНАЯ СИСТЕМА МОДАЛЬНЫХ ОКОН
    // ===============================================

    function openUniversalModal(type, data, config) {
        const modal = document.getElementById('universal-modal');
        const title = document.getElementById('universal-modal-title');
        const formFields = document.getElementById('universal-form-fields');
        const form = document.getElementById('universal-form');
        
        // Устанавливаем заголовок
        title.textContent = config.title;
        
        // Очищаем поля формы
        formFields.innerHTML = '';
        
        // Генерируем поля формы
        config.fields.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'form-field';
            
            let fieldHTML = '';
            const value = data[field.name] || '';
            
            if (field.type === 'select') {
                fieldHTML = `
                    <label for="${field.name}">${field.label}:</label>
                    <select id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>
                        ${field.options.map(opt => 
                            `<option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.text}</option>`
                        ).join('')}
                    </select>
                `;
            } else if (field.type === 'textarea') {
                fieldHTML = `
                    <label for="${field.name}">${field.label}:</label>
                    <textarea id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>${value}</textarea>
                `;
            } else if (field.type === 'checkbox') {
                fieldHTML = `
                    <label>
                        <input type="checkbox" id="${field.name}" name="${field.name}" ${value ? 'checked' : ''}>
                        ${field.label}
                    </label>
                `;
            } else {
                fieldHTML = `
                    <label for="${field.name}">${field.label}:</label>
                    <input type="${field.type}" id="${field.name}" name="${field.name}" 
                           value="${value}" ${field.required ? 'required' : ''}
                           ${field.step ? `step="${field.step}"` : ''}>
                `;
            }
            
            fieldDiv.innerHTML = fieldHTML;
            formFields.appendChild(fieldDiv);
        });
        
        // Удаляем старые обработчики событий
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
        // Добавляем обработчик сохранения
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(newForm);
            const submitData = {};
            
            config.fields.forEach(field => {
                const element = document.getElementById(field.name);
                if (field.type === 'checkbox') {
                    submitData[field.name] = element.checked;
                } else if (field.type === 'number') {
                    const value = element.value;
                    submitData[field.name] = value ? parseFloat(value) : null;
                } else {
                    submitData[field.name] = element.value || null;
                }
            });
            
            try {
                await config.onSave(submitData);
                closeUniversalModal();
            } catch (error) {
                console.error('Error saving:', error);
                showToast('Ошибка сохранения: ' + error.message, 'error');
            }
        });
        
        // Добавляем обработчик отмены
        document.getElementById('universal-cancel').onclick = closeUniversalModal;
        
        // Показываем модальное окно
        modal.style.display = 'flex';
    }

    function closeUniversalModal() {
        document.getElementById('universal-modal').style.display = 'none';
    }

    // Создаем универсальное модальное окно
    function createUniversalModal() {
        const modalHTML = `
            <div id="universal-modal" class="edit-form-overlay" style="display: none;">
                <div class="edit-form">
                    <h3 id="universal-modal-title">Редактировать запись</h3>
                    <form id="universal-form">
                        <div id="universal-form-fields">
                            <!-- Поля генерируются динамически -->
                        </div>
                        <div class="form-buttons">
                            <button type="submit">Сохранить</button>
                            <button type="button" id="universal-cancel">Отмена</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // Создаем универсальное модальное окно при загрузке
    createUniversalModal();

    // Добавляем стили для статусов контроллеров
    const statusStyles = `
        <style>
        .status-badge {
            padding: 2px 8px;
            border-radius: 12px;
            color: white;
            font-size: 12px;
            font-weight: bold;
        }
        .status-online { background-color: #4CAF50; }
        .status-offline { background-color: #f44336; }
        .status-maintenance { background-color: #ff9800; }
        .alert-badge { 
            background-color: #f44336; 
            color: white; 
            padding: 2px 6px; 
            border-radius: 8px; 
            font-size: 11px; 
        }
        .ok-badge { 
            background-color: #4CAF50; 
            color: white; 
            padding: 2px 6px; 
            border-radius: 8px; 
            font-size: 11px; 
        }
        .form-field {
            margin-bottom: 15px;
        }
        .form-field label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-field input, .form-field select, .form-field textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .form-field textarea {
            min-height: 60px;
            resize: vertical;
        }
        </style>
    `;
    
    document.head.insertAdjacentHTML('beforeend', statusStyles);
    
    // Загружаем данные для форм после инициализации всех функций
    console.log('🔄 Вызываем loadFormData() в конце инициализации');
    loadFormData();
}); 