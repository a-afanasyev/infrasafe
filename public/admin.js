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
    window.showToast = function(message, type = 'success') {
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

    // БЕЗОПАСНАЯ функция для создания ячеек таблицы (ИСПРАВЛЕНИЕ XSS)
    function createSecureTableCell(content, attributes = {}) {
        const cell = document.createElement('td');
        
        // Добавляем атрибуты
        Object.keys(attributes).forEach(key => {
            if (key === 'rowspan' || key === 'colspan') {
                cell.setAttribute(key, attributes[key]);
            } else if (key === 'class') {
                cell.className = attributes[key];
            }
        });
        
        // Безопасно устанавливаем содержимое
        if (typeof content === 'string') {
            cell.textContent = content;
        } else if (content && content.nodeType) {
            // Если передан DOM элемент
            cell.appendChild(content);
        } else {
            cell.textContent = String(content || '');
        }
        
        return cell;
    }

    // БЕЗОПАСНЫЕ функции для отображения статических сообщений (ИСПРАВЛЕНИЕ СРЕДНИХ XSS)
    function showLoadingMessage(tableBodySelector, colSpan) {
        const tableBody = document.querySelector(tableBodySelector);
        if (tableBody) {
            const loadingRow = document.createElement('tr');
            loadingRow.className = 'loading-row';
            const loadingCell = document.createElement('td');
            loadingCell.setAttribute('colspan', colSpan);
            loadingCell.textContent = 'Загрузка данных...';
            loadingRow.appendChild(loadingCell);
            tableBody.innerHTML = ''; // Очищаем перед добавлением
            tableBody.appendChild(loadingRow);
        }
    }

    function showErrorMessage(tableBodySelector, colSpan, message = 'Ошибка загрузки данных') {
        const tableBody = document.querySelector(tableBodySelector);
        if (tableBody) {
            const errorRow = document.createElement('tr');
            const errorCell = document.createElement('td');
            errorCell.setAttribute('colspan', colSpan);
            errorCell.style.textAlign = 'center';
            errorCell.style.color = 'red';
            errorCell.textContent = message;
            errorRow.appendChild(errorCell);
            tableBody.innerHTML = ''; // Очищаем перед добавлением
            tableBody.appendChild(errorRow);
        }
    }

    function showNoDataMessage(tableBody, colSpan, message = 'Нет данных') {
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.setAttribute('colspan', colSpan);
        noDataCell.style.textAlign = 'center';
        noDataCell.textContent = message;
        noDataRow.appendChild(noDataCell);
        return noDataRow;
    }

    // БЕЗОПАСНАЯ функция для создания строки таблицы buildings (ИСПРАВЛЕНИЕ XSS)
    function createSecureBuildingRow(building, rowType) {
        const row = document.createElement('tr');
        row.className = `building-row-${rowType}`;
        
        if (rowType === 1) {
            // Строка 1: Основная информация
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'item-checkbox';
            checkbox.setAttribute('data-id', building.building_id);
            
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-sm';
            editBtn.textContent = 'Изменить';
            editBtn.onclick = () => editBuilding(building.building_id);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-sm btn-danger';
            deleteBtn.textContent = 'Удалить';
            deleteBtn.onclick = () => deleteBuilding(building.building_id);
            
            const buttonCell = document.createElement('td');
            buttonCell.setAttribute('rowspan', '3');
            buttonCell.appendChild(editBtn);
            buttonCell.appendChild(document.createElement('br'));
            buttonCell.appendChild(deleteBtn);
            
            row.appendChild(createSecureTableCell(checkbox, {rowspan: 3}));
            row.appendChild(createSecureTableCell(safeValue(building.building_id), {rowspan: 3}));
            row.appendChild(createSecureTableCell(safeValue(building.name), {rowspan: 3}));
            row.appendChild(createSecureTableCell(safeValue(building.address)));
            row.appendChild(createSecureTableCell(safeValue(building.town)));
            row.appendChild(createSecureTableCell(safeValue(building.region)));
            row.appendChild(createSecureTableCell(formatNumber(building.latitude, 6)));
            row.appendChild(createSecureTableCell(formatNumber(building.longitude, 6)));
            row.appendChild(buttonCell);
            
        } else if (rowType === 2) {
            // Строка 2: Инфраструктура
            row.appendChild(createSecureTableCell(safeValue(building.management_company)));
            row.appendChild(createSecureTableCell(building.hot_water ? "Да" : "Нет"));
            row.appendChild(createSecureTableCell(safeValue(building.primary_transformer_name)));
            row.appendChild(createSecureTableCell(safeValue(building.backup_transformer_name)));
            row.appendChild(createSecureTableCell(safeValue(building.primary_line_name)));
        }
        
        return row;
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
                // Загружаем контроллеры для формы метрик
                loadControllersForMetrics();
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#controllers-table tbody", "8");

        try {
            const data = await loadData('/api/admin/controllers', 'controllers');
            renderControllersTable(data);
            updatePagination('controllers');
            dataLoaded.controllers = true;
        } catch (error) {
            console.error("Error loading controllers:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#controllers-table tbody", "8");
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

                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'item-checkbox';
                checkbox.setAttribute('data-id', controller.controller_id);
                
                const statusSpan = document.createElement('span');
                statusSpan.className = `status-badge ${statusClass}`;
                statusSpan.textContent = getStatusLabel(controller.status);
                
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-sm';
                editBtn.textContent = 'Изменить';
                editBtn.onclick = () => editController(controller.controller_id);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-sm btn-danger';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.onclick = () => deleteController(controller.controller_id);
                
                const buttonCell = document.createElement('td');
                buttonCell.appendChild(editBtn);
                buttonCell.appendChild(deleteBtn);
                
                const statusCell = document.createElement('td');
                statusCell.appendChild(statusSpan);
                
                row.appendChild(createSecureTableCell(checkbox));
                row.appendChild(createSecureTableCell(safeValue(controller.controller_id)));
                row.appendChild(createSecureTableCell(safeValue(controller.serial_number)));
                row.appendChild(createSecureTableCell(safeValue(controller.vendor)));
                row.appendChild(createSecureTableCell(safeValue(controller.model)));
                row.appendChild(createSecureTableCell(safeValue(controller.building_id)));
                row.appendChild(statusCell);
                row.appendChild(buttonCell);
                newTableBody.appendChild(row);
            });
        } else {
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.setAttribute('colspan', '8');
            noDataCell.style.textAlign = 'center';
            noDataCell.textContent = 'Нет данных';
            noDataRow.appendChild(noDataCell);
            newTableBody.appendChild(noDataRow);
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#metrics-table tbody", "13");

        try {
            const data = await loadData('/api/admin/metrics', 'metrics');
            renderMetricsTable(data);
            updatePagination('metrics');
            dataLoaded.metrics = true;
        } catch (error) {
            console.error("Error loading metrics:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#metrics-table tbody", "13");
        }
    }

    function renderMetricsTable(data) {
        const tableBody = document.querySelector("#metrics-table tbody");
        const newTableBody = document.createElement('tbody');

        if (data && data.length > 0) {
            data.forEach((metric) => {
                const row = document.createElement("tr");
                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'item-checkbox';
                checkbox.setAttribute('data-id', metric.metric_id);
                
                const leakSensorSpan = document.createElement('span');
                leakSensorSpan.className = metric.leak_sensor ? 'alert-badge' : 'ok-badge';
                leakSensorSpan.textContent = metric.leak_sensor ? 'Есть' : 'Нет';
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-sm btn-danger';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.onclick = () => deleteMetric(metric.metric_id);
                
                const leakSensorCell = document.createElement('td');
                leakSensorCell.appendChild(leakSensorSpan);
                
                const buttonCell = document.createElement('td');
                buttonCell.appendChild(deleteBtn);
                
                row.appendChild(createSecureTableCell(checkbox));
                row.appendChild(createSecureTableCell(safeValue(metric.metric_id)));
                row.appendChild(createSecureTableCell(safeValue(metric.controller_id)));
                row.appendChild(createSecureTableCell(formatDate(metric.timestamp)));
                row.appendChild(createSecureTableCell(formatNumber(metric.electricity_ph1, 1)));
                row.appendChild(createSecureTableCell(formatNumber(metric.electricity_ph2, 1)));
                row.appendChild(createSecureTableCell(formatNumber(metric.electricity_ph3, 1)));
                row.appendChild(createSecureTableCell(formatNumber(metric.cold_water_pressure, 2)));
                row.appendChild(createSecureTableCell(formatNumber(metric.hot_water_in_temp, 1)));
                row.appendChild(createSecureTableCell(formatNumber(metric.air_temp, 1)));
                row.appendChild(createSecureTableCell(formatNumber(metric.humidity, 1)));
                row.appendChild(leakSensorCell);
                row.appendChild(buttonCell);
                newTableBody.appendChild(row);
            });
        } else {
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.setAttribute('colspan', '13');
            noDataCell.style.textAlign = 'center';
            noDataCell.textContent = 'Нет данных';
            noDataRow.appendChild(noDataCell);
            newTableBody.appendChild(noDataRow);
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#water-lines-table tbody", "7");

        try {
            const data = await loadData('/api/admin/water-lines', 'water-lines');
            renderWaterLinesTable(data);
            updatePagination('water-lines');
            dataLoaded['water-lines'] = true;
        } catch (error) {
            console.error("Error loading water lines:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#water-lines-table tbody", "7");
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
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            newTableBody.appendChild(showNoDataMessage(newTableBody, "7"));
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#buildings-table tbody", "9");

        try {
            const data = await loadData('/api/buildings', 'buildings');
            renderBuildingsTable(data);
            updatePagination('buildings');
            dataLoaded.buildings = true;
        } catch (error) {
            console.error("Error loading buildings:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#buildings-table tbody", "9");
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
                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'item-checkbox';
                checkbox.setAttribute('data-id', building.building_id);
                
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-sm';
                editBtn.textContent = 'Изменить';
                editBtn.onclick = () => editBuilding(building.building_id);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-sm btn-danger';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.onclick = () => deleteBuilding(building.building_id);
                
                const buttonCell = document.createElement('td');
                buttonCell.setAttribute('rowspan', '3');
                buttonCell.appendChild(editBtn);
                buttonCell.appendChild(document.createElement('br'));
                buttonCell.appendChild(deleteBtn);
                
                row1.appendChild(createSecureTableCell(checkbox, {rowspan: 3}));
                row1.appendChild(createSecureTableCell(safeValue(building.building_id), {rowspan: 3}));
                row1.appendChild(createSecureTableCell(safeValue(building.name), {rowspan: 3}));
                row1.appendChild(createSecureTableCell(safeValue(building.address)));
                row1.appendChild(createSecureTableCell(safeValue(building.town)));
                row1.appendChild(createSecureTableCell(safeValue(building.region)));
                row1.appendChild(createSecureTableCell(formatNumber(building.latitude, 6)));
                row1.appendChild(createSecureTableCell(formatNumber(building.longitude, 6)));
                row1.appendChild(buttonCell);

                // Строка 2: Инфраструктура
                const row2 = document.createElement("tr");
                row2.className = "building-row-2";
                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                row2.appendChild(createSecureTableCell(safeValue(building.management_company)));
                row2.appendChild(createSecureTableCell(building.hot_water ? "Да" : "Нет"));
                row2.appendChild(createSecureTableCell(safeValue(building.primary_transformer_name)));
                row2.appendChild(createSecureTableCell(safeValue(building.backup_transformer_name)));
                row2.appendChild(createSecureTableCell(safeValue(building.primary_line_name)));

                // Строка 3: Водоснабжение
                const row3 = document.createElement("tr");
                row3.className = "building-row-3 building-group";
                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                row3.appendChild(createSecureTableCell(safeValue(building.backup_line_name)));
                row3.appendChild(createSecureTableCell(safeValue(building.cold_water_line_name)));
                row3.appendChild(createSecureTableCell(safeValue(building.hot_water_line_name)));
                row3.appendChild(createSecureTableCell(safeValue(building.cold_water_supplier_name)));
                row3.appendChild(createSecureTableCell(safeValue(building.hot_water_supplier_name)));

                newTableBody.appendChild(row1);
                newTableBody.appendChild(row2);
                newTableBody.appendChild(row3);
            });
        } else {
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.setAttribute('colspan', '9');
            noDataCell.style.textAlign = 'center';
            noDataCell.textContent = 'Нет данных';
            noDataRow.appendChild(noDataCell);
            newTableBody.appendChild(noDataRow);
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#transformers-table tbody", "7");

        try {
            const data = await loadData('/api/transformers', 'transformers');
            renderTransformersTable(data);
            updatePagination('transformers');
            dataLoaded.transformers = true;
        } catch (error) {
            console.error("Error loading transformers:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#transformers-table tbody", "7");
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

                // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'item-checkbox';
                checkbox.setAttribute('data-id', transformer.transformer_id);
                
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-sm';
                editBtn.textContent = 'Изменить';
                editBtn.onclick = () => editTransformer(transformer.transformer_id);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-sm btn-danger';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.onclick = () => deleteTransformer(transformer.transformer_id);
                
                const buttonCell = document.createElement('td');
                buttonCell.appendChild(editBtn);
                buttonCell.appendChild(deleteBtn);
                
                row.appendChild(createSecureTableCell(checkbox));
                row.appendChild(createSecureTableCell(safeValue(transformer.transformer_id)));
                row.appendChild(createSecureTableCell(safeValue(transformer.name)));
                row.appendChild(createSecureTableCell(formatNumber(transformer.power_kva, 1)));
                row.appendChild(createSecureTableCell(formatNumber(transformer.voltage_kv, 1)));
                row.appendChild(createSecureTableCell(buildingsText.join(', ') || 'Нет подключенных зданий'));
                row.appendChild(buttonCell);
                newTableBody.appendChild(row);
            });
        } else {
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            newTableBody.appendChild(showNoDataMessage(newTableBody, "7"));
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#lines-table tbody", "7");

        try {
            const data = await loadData('/api/lines', 'lines');
            renderLinesTable(data);
            updatePagination('lines');
            dataLoaded.lines = true;
        } catch (error) {
            console.error("Error loading lines:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#lines-table tbody", "7");
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
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            newTableBody.appendChild(showNoDataMessage(newTableBody, "7"));
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#water-sources-table tbody", "9");

        try {
            const data = await loadData('/api/cold-water-sources', 'waterSources');
            renderWaterSourcesTable(data);
            updatePagination('waterSources');
            dataLoaded.waterSources = true;
        } catch (error) {
            console.error("Error loading water sources:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#water-sources-table tbody", "9");
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
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            newTableBody.appendChild(showNoDataMessage(newTableBody, "9"));
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

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#heat-sources-table tbody", "9");

        try {
            const data = await loadData('/api/heat-sources', 'heatSources');
            renderHeatSourcesTable(data);
            updatePagination('heatSources');
            dataLoaded.heatSources = true;
        } catch (error) {
            console.error("Error loading heat sources:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#heat-sources-table tbody", "9");
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
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение "Нет данных"
            newTableBody.appendChild(showNoDataMessage(newTableBody, "9"));
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
        // Обработчик для кнопки "Выбрать все" (button, не checkbox!)
        const selectAllBtn = document.getElementById(`${section}-select-all`);
        if (selectAllBtn && !selectAllBtn.dataset.handlerSet) {
            selectAllBtn.addEventListener('click', function() {
                const checkboxes = document.querySelectorAll(`#${section}-section .item-checkbox`);
                const allChecked = Array.from(checkboxes).every(cb => cb.checked);
                
                console.log(`🔘 Выбрать все в секции ${section}: текущее состояние all checked = ${allChecked}`);
                
                // Если все выбраны - снимаем выбор, иначе выбираем все
                checkboxes.forEach(checkbox => {
                    checkbox.checked = !allChecked;
                    const id = checkbox.dataset.id;
                    if (!allChecked) {
                        selectedItems[section].add(id);
                    } else {
                        selectedItems[section].delete(id);
                    }
                });
                
                // Обновляем текст кнопки
                this.textContent = allChecked ? 'Выбрать все' : 'Снять выбор';
                updateBatchButtons(section);
                
                console.log(`✅ Выбрано элементов: ${selectedItems[section].size}`);
            });
            selectAllBtn.dataset.handlerSet = 'true';
        }
        
        // Обработчик для чекбокса "выбрать все" (если есть в заголовке таблицы)
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

                // Обновляем текст кнопки "Выбрать все"
                const selectAllBtn = document.getElementById(`${section}-select-all`);
                if (selectAllBtn) {
                    const allChecked = Array.from(itemCheckboxes).every(cb => cb.checked);
                    selectAllBtn.textContent = allChecked ? 'Снять выбор' : 'Выбрать все';
                }
                
                // Обновляем состояние чекбокса "выбрать все" (если есть)
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
            
            // Устанавливаем обработчик только один раз
            if (!bulkDeleteBtn.dataset.handlerSet) {
                bulkDeleteBtn.addEventListener('click', () => handleBulkDelete(section));
                bulkDeleteBtn.dataset.handlerSet = 'true';
            }
        }

        if (bulkStatusBtn) {
            bulkStatusBtn.disabled = selectedCount === 0;
            bulkStatusBtn.textContent = `Изменить статус (${selectedCount})`;
            
            // Устанавливаем обработчик только один раз
            if (!bulkStatusBtn.dataset.handlerSet) {
                bulkStatusBtn.addEventListener('click', () => handleBulkStatusChange(section));
                bulkStatusBtn.dataset.handlerSet = 'true';
            }
        }

        if (bulkStatusSelect) {
            bulkStatusSelect.disabled = selectedCount === 0;
        }
    }
    
    // Обработчик массового удаления
    async function handleBulkDelete(section) {
        const selectedCount = selectedItems[section].size;
        const selectedIds = Array.from(selectedItems[section]);
        
        if (selectedCount === 0) {
            showToast('Не выбрано элементов для удаления', 'warning');
            return;
        }
        
        const sectionNames = {
            'buildings': 'зданий',
            'controllers': 'контроллеров',
            'transformers': 'трансформаторов',
            'lines': 'линий электропередач',
            'water-lines': 'линий водоснабжения',
            'water-sources': 'источников воды',
            'heat-sources': 'источников тепла',
            'metrics': 'метрик'
        };
        
        const sectionName = sectionNames[section] || 'элементов';
        
        if (!confirm(`⚠️ ВНИМАНИЕ!\n\nВы уверены, что хотите удалить ${selectedCount} ${sectionName}?\n\nЭта операция необратима!`)) {
            return;
        }
        
        console.log(`🔥 Массовое удаление ${selectedCount} элементов из секции ${section}`);
        
        let deleted = 0;
        let errors = [];
        
        // Показываем прогресс
        showToast(`Удаление ${selectedCount} ${sectionName}...`, 'info');
        
        // Определяем endpoint для каждой секции
        const endpoints = {
            'buildings': '/api/buildings',
            'controllers': '/api/controllers',
            'transformers': '/api/transformers',
            'lines': '/api/lines',
            'water-lines': '/api/water-lines',
            'water-sources': '/api/water-sources',
            'heat-sources': '/api/heat-sources',
            'metrics': '/api/metrics'
        };
        
        const endpoint = endpoints[section];
        
        if (!endpoint) {
            showToast(`Ошибка: неизвестная секция ${section}`, 'error');
            return;
        }
        
        // Удаляем элементы по одному
        for (const id of selectedIds) {
            try {
                const response = await fetch(`${endpoint}/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                    }
                });
                
                if (response.ok) {
                    deleted++;
                    console.log(`  ✅ Удалён ${section} #${id}`);
                } else {
                    const errorData = await response.json();
                    const errorMsg = errorData.error || errorData.message || 'Ошибка удаления';
                    errors.push(`${section} #${id}: ${errorMsg}`);
                    console.error(`  ❌ Ошибка удаления ${section} #${id}:`, errorMsg);
                }
            } catch (error) {
                errors.push(`${section} #${id}: ${error.message}`);
                console.error(`  ❌ Ошибка удаления ${section} #${id}:`, error);
            }
        }
        
        // Показываем результат
        console.log(`✅ Завершено: Удалено ${deleted}/${selectedCount}`);
        
        if (errors.length > 0) {
            showToast(`Удалено: ${deleted}/${selectedCount}. Ошибок: ${errors.length}`, 'warning');
            console.warn('Ошибки при массовом удалении:', errors);
        } else {
            showToast(`✅ Успешно удалено ${deleted} ${sectionName}`, 'success');
        }
        
        // Очищаем выбранные элементы
        selectedItems[section].clear();
        
        // Перезагружаем данные
        dataLoaded[section] = false;
        loadSectionData(section);
    }
    
    // Обработчик массового изменения статуса
    async function handleBulkStatusChange(section) {
        const selectedCount = selectedItems[section].size;
        const selectedIds = Array.from(selectedItems[section]);
        const statusSelect = document.getElementById(`${section}-bulk-status-select`);
        
        if (selectedCount === 0) {
            showToast('Не выбрано элементов для изменения статуса', 'warning');
            return;
        }
        
        if (!statusSelect || !statusSelect.value) {
            showToast('Выберите новый статус', 'warning');
            return;
        }
        
        const newStatus = statusSelect.value;
        
        if (!confirm(`Изменить статус для ${selectedCount} элементов на "${newStatus}"?`)) {
            return;
        }
        
        console.log(`🔄 Массовое изменение статуса ${selectedCount} элементов из секции ${section}`);
        
        let updated = 0;
        let errors = [];
        
        // Показываем прогресс
        showToast(`Изменение статуса для ${selectedCount} элементов...`, 'info');
        
        // Определяем endpoint для каждой секции
        const endpoints = {
            'controllers': '/api/controllers'
        };
        
        const endpoint = endpoints[section];
        
        if (!endpoint) {
            showToast(`Массовое изменение статуса не поддерживается для ${section}`, 'error');
            return;
        }
        
        // Обновляем статус для каждого элемента
        for (const id of selectedIds) {
            try {
                const response = await fetch(`${endpoint}/${id}/status`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('admin_token')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (response.ok) {
                    updated++;
                    console.log(`  ✅ Обновлён статус ${section} #${id} на ${newStatus}`);
                } else {
                    const errorData = await response.json();
                    const errorMsg = errorData.error || errorData.message || 'Ошибка обновления';
                    errors.push(`${section} #${id}: ${errorMsg}`);
                    console.error(`  ❌ Ошибка обновления ${section} #${id}:`, errorMsg);
                }
            } catch (error) {
                errors.push(`${section} #${id}: ${error.message}`);
                console.error(`  ❌ Ошибка обновления ${section} #${id}:`, error);
            }
        }
        
        // Показываем результат
        console.log(`✅ Завершено: Обновлено ${updated}/${selectedCount}`);
        
        if (errors.length > 0) {
            showToast(`Обновлено: ${updated}/${selectedCount}. Ошибок: ${errors.length}`, 'warning');
            console.warn('Ошибки при массовом изменении статуса:', errors);
        } else {
            showToast(`✅ Успешно обновлено ${updated} элементов`, 'success');
        }
        
        // Очищаем выбранные элементы
        selectedItems[section].clear();
        
        // Перезагружаем данные
        dataLoaded[section] = false;
        loadSectionData(section);
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
    window.editBuilding = async function(id) {
        console.log('🏠 editBuilding вызвана для ID:', id);
        try {
            const response = await fetch(`/api/buildings/${id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                }
            });
            if (!response.ok) throw new Error('Ошибка загрузки здания');

            const building = await response.json();

            // Заполняем базовые поля
            document.getElementById('edit-building-id').value = building.building_id;
            document.getElementById('edit-building-name').value = building.name || '';
            document.getElementById('edit-building-address').value = building.address || '';
            document.getElementById('edit-building-town').value = building.town || '';
            document.getElementById('edit-building-region').value = building.region || '';
            document.getElementById('edit-building-latitude').value = building.latitude || '';
            document.getElementById('edit-building-longitude').value = building.longitude || '';
            document.getElementById('edit-building-management').value = building.management_company || '';
            document.getElementById('edit-building-hot-water').checked = building.has_hot_water || false;

            // Заполняем dropdown'ы (они должны быть предварительно загружены через loadFormData)
            // Электроснабжение
            document.getElementById('edit-building-primary-transformer').value = building.primary_transformer_id || '';
            document.getElementById('edit-building-backup-transformer').value = building.backup_transformer_id || '';
            document.getElementById('edit-building-primary-line').value = building.primary_line_id || '';
            document.getElementById('edit-building-backup-line').value = building.backup_line_id || '';
            
            // Водоснабжение
            document.getElementById('edit-building-cold-water-line').value = building.cold_water_line_id || '';
            document.getElementById('edit-building-hot-water-line').value = building.hot_water_line_id || '';
            document.getElementById('edit-building-cold-water-supplier').value = building.cold_water_supplier_id || '';
            document.getElementById('edit-building-hot-water-supplier').value = building.hot_water_supplier_id || '';
            
            // Включаем select'ы поставщиков если выбраны линии
            if (building.cold_water_line_id) {
                document.getElementById('edit-building-cold-water-supplier').disabled = false;
            }
            if (building.hot_water_line_id) {
                document.getElementById('edit-building-hot-water-supplier').disabled = false;
            }

            // Показываем модальное окно
            document.getElementById('edit-building-modal').style.display = 'flex';

        } catch (error) {
            console.error('Error loading building:', error);
            showToast('Ошибка загрузки данных здания', 'error');
        }
    };

    window.deleteBuilding = async function(id) {
        console.log('🗑️ deleteBuilding вызвана для ID:', id);
        
        try {
            // Сначала пробуем удалить без каскада
            const response = await fetch(`/api/buildings/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                
                // Специальная обработка ошибки BUILDING_HAS_CONTROLLERS
                if (response.status === 400 && errorData.controllers) {
                    const controllerList = errorData.controllers
                        .map(c => `  • Контроллер #${c.controller_id} (${c.serial_number}) - ${c.status}`)
                        .join('\n');
                    
                    const message = `⚠️ ВНИМАНИЕ: Невозможно удалить здание\n\n` +
                                  `${errorData.error}\n\n` +
                                  `Привязанные контроллеры:\n${controllerList}\n\n` +
                                  `Выберите действие:\n` +
                                  `• ОК - Удалить здание вместе с контроллерами и всеми метриками (НЕОБРАТИМО)\n` +
                                  `• Отмена - Отменить удаление`;
                    
                    if (confirm(message)) {
                        // Пользователь согласился на каскадное удаление
                        await deleteBuildingCascade(id, errorData.controllers);
                    }
                    return;
                }
                
                throw new Error(errorData.error || errorData.message || 'Ошибка удаления здания');
            }

            showToast('Здание успешно удалено', 'success');
            dataLoaded.buildings = false;
            loadBuildings();
        } catch (error) {
            console.error('Error deleting building:', error);
            showToast(error.message || 'Ошибка удаления здания', 'error');
        }
    };

    // Каскадное удаление здания с контроллерами
    async function deleteBuildingCascade(buildingId, controllers) {
        console.log('🔥 Каскадное удаление здания', buildingId, 'с', controllers.length, 'контроллерами');
        
        try {
            let deletedControllers = 0;
            let deletedMetrics = 0;
            let errors = [];

            // Для каждого контроллера: удаляем метрики, затем контроллер
            for (const controller of controllers) {
                try {
                    console.log(`🔄 Обработка контроллера #${controller.controller_id}...`);
                    
                    // Шаг 1: Получаем метрики контроллера
                    const metricsResponse = await fetch(`/api/metrics?controller_id=${controller.controller_id}&limit=10000`, {
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                        }
                    });
                    
                    if (metricsResponse.ok) {
                        const metricsData = await metricsResponse.json();
                        const metrics = metricsData.data || [];
                        
                        console.log(`  📊 Найдено метрик: ${metrics.length}`);
                        
                        // Шаг 2: Удаляем все метрики контроллера
                        if (metrics.length > 0) {
                            for (const metric of metrics) {
                                try {
                                    const deleteMetricResponse = await fetch(`/api/metrics/${metric.metric_id}`, {
                                        method: 'DELETE',
                                        headers: {
                                            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                                        }
                                    });
                                    
                                    if (deleteMetricResponse.ok) {
                                        deletedMetrics++;
                                    }
                                } catch (metricError) {
                                    console.warn(`  ⚠️ Не удалось удалить метрику ${metric.metric_id}:`, metricError);
                                }
                            }
                            console.log(`  ✅ Удалено метрик: ${deletedMetrics} из ${metrics.length}`);
                        }
                    }
                    
                    // Шаг 3: Теперь удаляем контроллер (уже без метрик)
                    const controllerResponse = await fetch(`/api/controllers/${controller.controller_id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                        }
                    });

                    if (controllerResponse.ok) {
                        deletedControllers++;
                        console.log(`  ✅ Контроллер ${controller.controller_id} удален`);
                    } else {
                        const errorData = await controllerResponse.json();
                        const errorMsg = `Контроллер #${controller.controller_id}: ${errorData.error || 'Ошибка удаления'}`;
                        errors.push(errorMsg);
                        console.error(`  ❌ ${errorMsg}`);
                    }
                } catch (error) {
                    const errorMsg = `Контроллер #${controller.controller_id}: ${error.message}`;
                    errors.push(errorMsg);
                    console.error(`  ❌ ${errorMsg}`);
                }
            }

            // Шаг 4: Теперь удаляем здание
            console.log('🏢 Удаление здания...');
            const buildingResponse = await fetch(`/api/buildings/${buildingId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                }
            });

            if (!buildingResponse.ok) {
                const errorData = await buildingResponse.json();
                throw new Error(errorData.error || 'Ошибка удаления здания после удаления контроллеров');
            }

            // Показываем результат
            console.log(`✅ Завершено: Контроллеров ${deletedControllers}/${controllers.length}, Метрик ${deletedMetrics}`);
            
            if (errors.length > 0) {
                showToast(`Здание удалено. Контроллеров: ${deletedControllers}/${controllers.length}. Метрик: ${deletedMetrics}. Ошибки: ${errors.length}`, 'warning');
                console.warn('Ошибки при удалении:', errors);
            } else {
                showToast(`✅ Здание, ${deletedControllers} контроллер(ов) и ${deletedMetrics} метрик успешно удалены`, 'success');
            }

            // Обновляем список зданий
            dataLoaded.buildings = false;
            loadBuildings();

        } catch (error) {
            console.error('❌ Error in cascade delete:', error);
            showToast(error.message || 'Ошибка каскадного удаления', 'error');
        }
    }
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
            const response = await fetch(`/api/controllers/${id}`);
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

            // Определяем тип линии (ХВС или ГВС)
            // ВАЖНО: используем 'ХВС' или 'ГВС' напрямую для правильного отображения полей
            const lineType = data.line_type || (data.line_type === 'ГВС' ? 'ГВС' : 'ХВС');

            // Открываем универсальный редактор с картой
            const editor = new InfrastructureLineEditor({
                lineType: lineType,
                lineId: id,
                existingData: data,
                apiEndpoint: '/api/water-lines',
                additionalFields: {
                    diameter_mm: data.diameter_mm,
                    material: data.material,
                    pressure_rating: data.pressure_rating,
                    installation_date: data.installation_date
                },
                onSave: () => {
                    dataLoaded['water-lines'] = false;
                    loadWaterLines();
                }
            });
            
            editor.show();
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

            const transformerResponse = await response.json();
            const transformer = transformerResponse.data || transformerResponse;

            // Заполняем форму редактирования
            document.getElementById('edit-transformer-id').value = transformer.transformer_id;
            document.getElementById('edit-transformer-name').value = transformer.name || '';
            document.getElementById('edit-transformer-power').value = transformer.power_kva || '';
            document.getElementById('edit-transformer-voltage').value = transformer.voltage_kv || '';
            document.getElementById('edit-transformer-latitude').value = transformer.latitude || '';
            document.getElementById('edit-transformer-longitude').value = transformer.longitude || '';

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

            const lineResponse = await response.json();
            const line = lineResponse.data || lineResponse;

            console.log('📋 Загружены данные линии для редактирования:', line);
            console.log('📍 main_path:', line.main_path);
            console.log('🌿 branches:', line.branches);

            // Открываем универсальный редактор линий с картой
            const editor = new InfrastructureLineEditor({
                lineType: 'electricity', // Линии электропередач
                lineId: id,
                existingData: line,
                apiEndpoint: '/api/lines', // Используем endpoint для обычных линий
                additionalFields: {
                    voltage_kv: line.voltage_kv,
                    transformer_id: line.transformer_id,
                    length_km: line.length_km
                },
                onSave: () => {
                    dataLoaded.lines = false;
                    loadLines();
                }
            });
            
            editor.show();
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
            latitude: parseFloat(document.getElementById('edit-transformer-latitude').value),
            longitude: parseFloat(document.getElementById('edit-transformer-longitude').value)
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

            // Заполняем dropdown трансформаторов (форма создания)
            fillDropdown('building-primary-transformer', transformersData, 'transformer_id', 'name');
            fillDropdown('building-backup-transformer', transformersData, 'transformer_id', 'name');
            
            // Заполняем dropdown трансформаторов (форма редактирования)
            fillDropdown('edit-building-primary-transformer', transformersData, 'transformer_id', 'name');
            fillDropdown('edit-building-backup-transformer', transformersData, 'transformer_id', 'name');

            // Заполняем dropdown линий (форма создания)
            fillDropdown('building-primary-line', linesData, 'line_id', 'name');
            fillDropdown('building-backup-line', linesData, 'line_id', 'name');
            
            // Заполняем dropdown линий (форма редактирования)
            fillDropdown('edit-building-primary-line', linesData, 'line_id', 'name');
            fillDropdown('edit-building-backup-line', linesData, 'line_id', 'name');

            // Разделяем водные линии на ХВС и ГВС
            const coldWaterLines = Array.isArray(waterLinesData) ?
                waterLinesData.filter(line => line.name.includes('ХВС')) : [];
            const hotWaterLines = Array.isArray(waterLinesData) ?
                waterLinesData.filter(line => line.name.includes('ГВС')) : [];

            // Заполняем dropdown линий водоснабжения (форма создания)
            fillDropdown('building-cold-water-line', coldWaterLines, 'line_id', 'name');
            fillDropdown('building-hot-water-line', hotWaterLines, 'line_id', 'name');
            
            // Заполняем dropdown линий водоснабжения (форма редактирования)
            fillDropdown('edit-building-cold-water-line', coldWaterLines, 'line_id', 'name');
            fillDropdown('edit-building-hot-water-line', hotWaterLines, 'line_id', 'name');

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

            // Заполняем dropdown поставщиков (форма создания)
            fillDropdown('building-cold-water-supplier', coldSuppliers, 'supplier_id', 'name');
            fillDropdown('building-hot-water-supplier', hotSuppliers, 'supplier_id', 'name');
            
            // Заполняем dropdown поставщиков (форма редактирования)
            fillDropdown('edit-building-cold-water-supplier', coldSuppliers, 'supplier_id', 'name');
            fillDropdown('edit-building-hot-water-supplier', hotSuppliers, 'supplier_id', 'name');

            // Настраиваем связанные выпадающие списки после загрузки данных
            setupCascadingDropdowns();

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

    // Настройка связанных выпадающих списков
    function setupCascadingDropdowns() {
        // При выборе ОСНОВНОЙ линии электропередачи - автоматически выбираем связанный трансформатор
        const primaryLineSelect = document.getElementById('building-primary-line');
        const primaryTransformerSelect = document.getElementById('building-primary-transformer');

        if (primaryLineSelect && primaryTransformerSelect) {
            primaryLineSelect.addEventListener('change', async function() {
                const lineId = this.value;
                if (!lineId) {
                    primaryTransformerSelect.value = '';
                    return;
                }

                try {
                    const response = await fetch(`/api/lines/${lineId}`);
                    if (response.ok) {
                        const result = await response.json();
                        const lineData = result.data || result;
                        if (lineData.transformer_id) {
                            primaryTransformerSelect.value = lineData.transformer_id;
                            showToast('Автоматически выбран основной трансформатор для линии', 'info');
                        }
                    }
                } catch (error) {
                    console.error('Ошибка получения данных основной линии:', error);
                }
            });
        }

        // При выборе РЕЗЕРВНОЙ линии электропередачи - автоматически выбираем связанный трансформатор
        const backupLineSelect = document.getElementById('building-backup-line');
        const backupTransformerSelect = document.getElementById('building-backup-transformer');

        if (backupLineSelect && backupTransformerSelect) {
            backupLineSelect.addEventListener('change', async function() {
                const lineId = this.value;
                if (!lineId) {
                    backupTransformerSelect.value = '';
                    return;
                }

                try {
                    const response = await fetch(`/api/lines/${lineId}`);
                    if (response.ok) {
                        const result = await response.json();
                        const lineData = result.data || result;
                        if (lineData.transformer_id) {
                            backupTransformerSelect.value = lineData.transformer_id;
                            showToast('Автоматически выбран резервный трансформатор для линии', 'info');
                        }
                    }
                } catch (error) {
                    console.error('Ошибка получения данных резервной линии:', error);
                }
            });
        }

        // При выборе линии ХОЛОДНОГО водоснабжения - показываем связанных поставщиков ХВС
        const coldWaterLineSelect = document.getElementById('building-cold-water-line');
        const coldWaterSupplierSelect = document.getElementById('building-cold-water-supplier');

        if (coldWaterLineSelect && coldWaterSupplierSelect) {
            coldWaterLineSelect.addEventListener('change', async function() {
                const lineId = this.value;
                await updateWaterSuppliers(lineId, 'cold_water', coldWaterSupplierSelect);
            });
        }

        // При выборе линии ГОРЯЧЕГО водоснабжения - показываем связанных поставщиков ГВС
        const hotWaterLineSelect = document.getElementById('building-hot-water-line');
        const hotWaterSupplierSelect = document.getElementById('building-hot-water-supplier');

        if (hotWaterLineSelect && hotWaterSupplierSelect) {
            hotWaterLineSelect.addEventListener('change', async function() {
                const lineId = this.value;
                await updateWaterSuppliers(lineId, 'hot_water', hotWaterSupplierSelect);
            });
        }
    }

    async function updateWaterSuppliers(lineId, supplierType, selectElement) {
        if (!lineId) {
            // Деактивируем поле и очищаем
            selectElement.disabled = true;
            selectElement.innerHTML = `<option value="">Сначала выберите линию ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'}</option>`;
            return;
        }

        try {
            // Активируем поле
            selectElement.disabled = false;
            selectElement.innerHTML = '<option value="">Загрузка поставщика...</option>';

            // Получаем поставщика для конкретной линии
            const response = await fetch(`/api/water-lines/${lineId}/supplier`);
            if (response.ok) {
                const result = await response.json();

                if (result.supplier) {
                    // Есть привязанный поставщик - выбираем его автоматически
                    selectElement.innerHTML = '<option value="">Выберите поставщика</option>';

                    const option = document.createElement('option');
                    option.value = result.supplier.supplier_id;
                    option.textContent = `${result.supplier.name} (${result.supplier.tariff_per_m3} руб/м³)`;
                    option.selected = true;
                    selectElement.appendChild(option);

                    showToast(`✅ Автоматически выбран поставщик для линии "${result.line.name}": ${result.supplier.name}`, 'success');
                } else {
                    // Нет привязанного поставщика - загружаем всех поставщиков этого типа
                    const suppliersResponse = await fetch(`/api/water-suppliers?type=${supplierType}&limit=100`);
                    if (suppliersResponse.ok) {
                        const suppliersResult = await suppliersResponse.json();
                        const suppliersData = suppliersResult.data || suppliersResult;

                        selectElement.innerHTML = '<option value="">Выберите поставщика</option>';

                        if (Array.isArray(suppliersData) && suppliersData.length > 0) {
                            suppliersData.forEach(supplier => {
                                const option = document.createElement('option');
                                option.value = supplier.supplier_id;
                                option.textContent = `${supplier.name} (${supplier.tariff_per_m3} руб/м³)`;
                                selectElement.appendChild(option);
                            });
                            showToast(`📋 К линии не привязан поставщик. Загружено ${suppliersData.length} поставщиков ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'}`, 'info');
                        } else {
                            selectElement.innerHTML = '<option value="">Поставщики не найдены</option>';
                            showToast(`⚠️ Поставщики ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'} не найдены`, 'warning');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка получения поставщика для линии:', error);
            selectElement.disabled = true;
            selectElement.innerHTML = '<option value="">Ошибка загрузки</option>';
            showToast('❌ Ошибка загрузки поставщика для линии', 'error');
        }
    }

    // Функция сброса формы метрик
    window.resetMetricsForm = function() {
        document.getElementById('metric-controller-id').value = '';
        document.getElementById('metric-electricity-ph1').value = '220.0';
        document.getElementById('metric-electricity-ph2').value = '220.0';
        document.getElementById('metric-electricity-ph3').value = '220.0';
        document.getElementById('metric-amperage-ph1').value = '15.0';
        document.getElementById('metric-amperage-ph2').value = '15.0';
        document.getElementById('metric-amperage-ph3').value = '15.0';
        document.getElementById('metric-cold-water-pressure').value = '5.0';
        document.getElementById('metric-cold-water-temp').value = '15.0';
        document.getElementById('metric-hot-water-in-pressure').value = '4.0';
        document.getElementById('metric-hot-water-out-pressure').value = '3.5';
        document.getElementById('metric-hot-water-in-temp').value = '65.0';
        document.getElementById('metric-hot-water-out-temp').value = '45.0';
        document.getElementById('metric-air-temp').value = '22.0';
        document.getElementById('metric-humidity').value = '45.0';
        document.getElementById('metric-leak-sensor').checked = false;
    };

    // Функция загрузки контроллеров для формы метрик
    async function loadControllersForMetrics() {
        try {
            const response = await fetch('/api/controllers?limit=100');
            if (response.ok) {
                const data = await response.json();
                const select = document.getElementById('metric-controller-id');

                // Очищаем существующие опции кроме первой
                const firstOption = select.firstElementChild;
                select.innerHTML = '';
                if (firstOption) {
                    select.appendChild(firstOption);
                }

                const controllersData = data.data || data;
                controllersData.forEach(controller => {
                    const option = document.createElement('option');
                    option.value = controller.controller_id;
                    option.textContent = `ID: ${controller.controller_id} - ${controller.serial_number} (${controller.status})`;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки контроллеров:', error);
        }
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
                headers: {
                    'Content-Type': 'application/json'
                },
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
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
            electricity_ph1: parseFloat(document.getElementById('metric-electricity-ph1').value) || null,
            electricity_ph2: parseFloat(document.getElementById('metric-electricity-ph2').value) || null,
            electricity_ph3: parseFloat(document.getElementById('metric-electricity-ph3').value) || null,
            amperage_ph1: parseFloat(document.getElementById('metric-amperage-ph1').value) || null,
            amperage_ph2: parseFloat(document.getElementById('metric-amperage-ph2').value) || null,
            amperage_ph3: parseFloat(document.getElementById('metric-amperage-ph3').value) || null,
            cold_water_pressure: parseFloat(document.getElementById('metric-cold-water-pressure').value) || null,
            cold_water_temp: parseFloat(document.getElementById('metric-cold-water-temp').value) || null,
            hot_water_in_pressure: parseFloat(document.getElementById('metric-hot-water-in-pressure').value) || null,
            hot_water_out_pressure: parseFloat(document.getElementById('metric-hot-water-out-pressure').value) || null,
            hot_water_in_temp: parseFloat(document.getElementById('metric-hot-water-in-temp').value) || null,
            hot_water_out_temp: parseFloat(document.getElementById('metric-hot-water-out-temp').value) || null,
            air_temp: parseFloat(document.getElementById('metric-air-temp').value) || null,
            humidity: parseFloat(document.getElementById('metric-humidity').value) || null,
            leak_sensor: document.getElementById('metric-leak-sensor').checked
        };

        try {
            const response = await fetch('/api/admin/metrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания метрики');
            }

            showToast('Метрика успешно добавлена', 'success');

            // Очищаем форму
            resetMetricsForm();

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
    // ОТКЛЮЧЕН - используется InfrastructureLineEditor
    // ===============================================

    /* document.getElementById('add-water-line-form')?.addEventListener('submit', async function(e) {
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания линии водоснабжения');
            }

            showToast('Линия водоснабжения успешно добавлена', 'success');

            // Очищаем форму
            document.getElementById('add-water-line-form')?.reset();

            // Перезагружаем данные линий водоснабжения
            dataLoaded['water-lines'] = false;
            loadWaterLines();

        } catch (error) {
            console.error('Error creating water line:', error);
            showToast('Ошибка создания линии водоснабжения: ' + error.message, 'error');
        }
    }); */

    // ===============================================
    // ОБРАБОТЧИК ФОРМЫ ДОБАВЛЕНИЯ ТРАНСФОРМАТОРА
    // ===============================================

    document.getElementById('add-transformer-form').addEventListener('submit', async function(e) {
        e.preventDefault();

        const data = {
            name: document.getElementById('transformer-name').value,
            power_kva: parseFloat(document.getElementById('transformer-power').value),
            voltage_kv: parseFloat(document.getElementById('transformer-voltage').value),
            latitude: parseFloat(document.getElementById('transformer-latitude').value),
            longitude: parseFloat(document.getElementById('transformer-longitude').value)
        };

        try {
            const response = await fetch('/api/transformers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка создания трансформатора');
            }

            showToast('Трансформатор успешно добавлен', 'success');

            // Очищаем форму
            document.getElementById('add-transformer-form').reset();

            // Перезагружаем данные трансформаторов
            dataLoaded.transformers = false;
            loadTransformers();

        } catch (error) {
            console.error('Error creating transformer:', error);
            showToast('Ошибка создания трансформатора: ' + error.message, 'error');
        }
    });

    // ===============================================
    // УНИВЕРСАЛЬНАЯ СИСТЕМА МОДАЛЬНЫХ ОКОН
    // ===============================================

    function openUniversalModal(type, data, config) {
        console.log('🔧 openUniversalModal вызвана:', { type, data, config });
        const modal = document.getElementById('universal-modal');
        const title = document.getElementById('universal-modal-title');
        const formFields = document.getElementById('universal-form-fields');
        const form = document.getElementById('universal-form');

        console.log('📋 Найденные элементы:', { modal, title, formFields, form });

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
    console.log('🚀 Создаем универсальное модальное окно...');
    createUniversalModal();
    console.log('✅ Универсальное модальное окно создано');

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

    // ===============================================
    // ОБРАБОТЧИКИ ДЛЯ МОДАЛЬНЫХ ОКОН РЕДАКТИРОВАНИЯ
    // ===============================================

    // Обработчик формы редактирования здания
    document.getElementById('edit-building-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-building-id').value;

        const data = {
            name: document.getElementById('edit-building-name').value,
            address: document.getElementById('edit-building-address').value,
            town: document.getElementById('edit-building-town').value,
            region: document.getElementById('edit-building-region').value,
            latitude: parseFloat(document.getElementById('edit-building-latitude').value),
            longitude: parseFloat(document.getElementById('edit-building-longitude').value),
            management_company: document.getElementById('edit-building-management').value,
            has_hot_water: document.getElementById('edit-building-hot-water').checked
        };

        // Добавляем поля электроснабжения (если выбраны)
        const primaryTransformer = document.getElementById('edit-building-primary-transformer').value;
        const backupTransformer = document.getElementById('edit-building-backup-transformer').value;
        const primaryLine = document.getElementById('edit-building-primary-line').value;
        const backupLine = document.getElementById('edit-building-backup-line').value;
        
        if (primaryTransformer) data.primary_transformer_id = parseInt(primaryTransformer);
        if (backupTransformer) data.backup_transformer_id = parseInt(backupTransformer);
        if (primaryLine) data.primary_line_id = parseInt(primaryLine);
        if (backupLine) data.backup_line_id = parseInt(backupLine);
        
        // Добавляем поля водоснабжения (если выбраны)
        const coldWaterLine = document.getElementById('edit-building-cold-water-line').value;
        const hotWaterLine = document.getElementById('edit-building-hot-water-line').value;
        const coldWaterSupplier = document.getElementById('edit-building-cold-water-supplier').value;
        const hotWaterSupplier = document.getElementById('edit-building-hot-water-supplier').value;
        
        if (coldWaterLine) data.cold_water_line_id = parseInt(coldWaterLine);
        if (hotWaterLine) data.hot_water_line_id = parseInt(hotWaterLine);
        if (coldWaterSupplier) data.cold_water_supplier_id = parseInt(coldWaterSupplier);
        if (hotWaterSupplier) data.hot_water_supplier_id = parseInt(hotWaterSupplier);

        try {
            const response = await fetch(`/api/buildings/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error('Ошибка обновления здания');

            showToast('Здание успешно обновлено', 'success');
            document.getElementById('edit-building-modal').style.display = 'none';
            dataLoaded.buildings = false;
            loadBuildings();

        } catch (error) {
            console.error('Error updating building:', error);
            showToast('Ошибка обновления здания: ' + error.message, 'error');
        }
    });

    // Обработчик кнопки отмены редактирования здания
    document.getElementById('cancel-edit-building').addEventListener('click', () => {
        document.getElementById('edit-building-modal').style.display = 'none';
    });

    // Обработчики для включения поставщиков при выборе линий (форма редактирования)
    document.getElementById('edit-building-cold-water-line').addEventListener('change', function() {
        const supplierSelect = document.getElementById('edit-building-cold-water-supplier');
        supplierSelect.disabled = !this.value;
        if (!this.value) {
            supplierSelect.value = '';
        }
    });

    document.getElementById('edit-building-hot-water-line').addEventListener('change', function() {
        const supplierSelect = document.getElementById('edit-building-hot-water-supplier');
        supplierSelect.disabled = !this.value;
        if (!this.value) {
            supplierSelect.value = '';
        }
    });

    // ===============================================
    // ОБРАБОТЧИКИ КНОПОК СОЗДАНИЯ ЛИНИЙ С КАРТОЙ
    // ===============================================
    
    // Кнопка создания линии ХВС
    document.getElementById('create-new-cold-water-line')?.addEventListener('click', () => {
        const editor = new InfrastructureLineEditor({
            lineType: 'ХВС',
            lineId: null,
            existingData: null,
            apiEndpoint: '/api/water-lines',
            additionalFields: {
                line_type: 'ХВС'
            },
            onSave: () => {
                dataLoaded['water-lines'] = false;
                loadWaterLines();
            }
        });
        editor.show();
    });
    
    // Кнопка создания линии ГВС
    document.getElementById('create-new-hot-water-line')?.addEventListener('click', () => {
        const editor = new InfrastructureLineEditor({
            lineType: 'ГВС',
            lineId: null,
            existingData: null,
            apiEndpoint: '/api/water-lines',
            additionalFields: {
                line_type: 'ГВС'
            },
            onSave: () => {
                dataLoaded['water-lines'] = false;
                loadWaterLines();
            }
        });
        editor.show();
    });
    
    // Кнопка создания линии электропередач
    document.getElementById('create-new-electricity-line')?.addEventListener('click', () => {
        const editor = new InfrastructureLineEditor({
            lineType: 'electricity',
            lineId: null,
            existingData: null,
            apiEndpoint: '/api/lines',
            onSave: () => {
                dataLoaded.lines = false;
                loadLines();
            }
        });
        editor.show();
    });

    // Загружаем данные для форм после инициализации всех функций
    console.log('🔄 Вызываем loadFormData() в конце инициализации');
    loadFormData();
});