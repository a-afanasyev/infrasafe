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
        heatSources: { page: 1, limit: 10, total: 0 },
        alerts: { page: 1, limit: 10, total: 0 }
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
        heatSources: false,
        alerts: false,
        integration: false
    };

    // Integration UK state
    const integrationState = {
        config: {},
        rules: [],
        logs: { logs: [], total: 0 },
        logFilters: { page: 1, limit: 20, direction: '', status: '' }
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
        heatSources: {},
        alerts: {}
    };

    // Состояние сортировки
    const sorting = {
        buildings: { column: 'building_id', direction: 'asc' },
        controllers: { column: 'controller_id', direction: 'asc' },
        transformers: { column: 'transformer_id', direction: 'asc' },
        lines: { column: 'line_id', direction: 'asc' },
        'water-lines': { column: 'line_id', direction: 'asc' },
        metrics: { column: 'metric_id', direction: 'desc' },
        alerts: { column: 'created_at', direction: 'desc' }
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
        heatSources: new Set(),
        alerts: new Set()
    };

    // Entity cache for displaying names instead of IDs
    const entityCache = {
        buildings: {},
        controllers: {},
        transformers: {}
    };

    async function loadEntityCache() {
        const fetches = [
            fetch('/api/buildings?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
            fetch('/api/controllers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
            fetch('/api/transformers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => [])
        ];
        const [buildings, controllers, transformers] = await Promise.all(fetches);
        buildings.forEach(b => { entityCache.buildings[b.building_id] = b.name; });
        controllers.forEach(c => { entityCache.controllers[c.controller_id] = c.serial_number; });
        transformers.forEach(t => { entityCache.transformers[t.transformer_id] = t.name; });
    }

    // ===============================================
    // MODAL UTILITIES
    // ===============================================

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.style.display = 'flex';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        // Focus first input
        const firstInput = modal.querySelector('input, select, textarea');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') closeModal(modalId);
        };
        document.addEventListener('keydown', escHandler);
        modal._escHandler = escHandler;

        // Close on overlay click (not content click)
        const clickHandler = (e) => {
            if (e.target === modal) closeModal(modalId);
        };
        modal.addEventListener('click', clickHandler);
        modal._clickHandler = clickHandler;
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.style.display = 'none';

        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
            delete modal._escHandler;
        }
        if (modal._clickHandler) {
            modal.removeEventListener('click', modal._clickHandler);
            delete modal._clickHandler;
        }
    }

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
            // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
            tableBody.textContent = ''; // Очищаем перед добавлением
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
            // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
            tableBody.textContent = ''; // Очищаем перед добавлением
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

    // ===============================================
    // GENERIC TABLE RENDERER
    // ===============================================

    function renderEntityTable({ tableId, entityType, data, columns, actions, idKey, emptyMessage }) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const oldTbody = table.querySelector('tbody');
        const newTbody = document.createElement('tbody');

        if (!data || data.length === 0) {
            // +2 accounts for checkbox column + actions column
            const colSpan = String(columns.length + (actions ? 2 : 1));
            newTbody.appendChild(showNoDataMessage(newTbody, colSpan, emptyMessage));
            table.replaceChild(newTbody, oldTbody);
            updateCheckboxHandlers(entityType);
            return;
        }

        data.forEach(item => {
            const tr = document.createElement('tr');

            // Checkbox cell
            const checkTd = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'item-checkbox';
            checkbox.dataset.id = item[idKey];
            checkTd.appendChild(checkbox);
            tr.appendChild(checkTd);

            // Data cells from column config
            columns.forEach(col => {
                const td = document.createElement('td');
                if (col.render) {
                    const rendered = col.render(item[col.key], item);
                    if (rendered instanceof HTMLElement) {
                        td.appendChild(rendered);
                    } else {
                        td.textContent = rendered;
                    }
                } else {
                    td.textContent = item[col.key] ?? '—';
                }
                tr.appendChild(td);
            });

            // Action cells
            if (actions && actions.length > 0) {
                const actionTd = document.createElement('td');
                actions.forEach(action => {
                    if (action.condition && !action.condition(item)) return;
                    const btn = document.createElement('button');
                    btn.className = action.className || 'btn-sm';
                    btn.textContent = action.label;
                    btn.addEventListener('click', () => action.handler(item));
                    actionTd.appendChild(btn);
                });
                tr.appendChild(actionTd);
            }

            newTbody.appendChild(tr);
        });

        table.replaceChild(newTbody, oldTbody);
        updateCheckboxHandlers(entityType);
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

    function formatHeartbeat(timestamp) {
        if (!timestamp) return '—';
        const diff = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'Только что';
        if (minutes < 60) return minutes + ' мин назад';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + ' ч назад';
        return Math.floor(hours / 24) + ' д назад';
    }

    function getHeartbeatColor(timestamp) {
        if (!timestamp) return 'grey';
        const minutes = (Date.now() - new Date(timestamp).getTime()) / 60000;
        if (minutes < 5) return 'green';
        if (minutes < 30) return 'yellow';
        return 'red';
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

        // Убираем активный класс с кнопок и обновляем aria-selected
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
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
            targetBtn.setAttribute('aria-selected', 'true');
        }

        // Загружаем данные для секции
        loadSectionData(sectionName);
    }

    function loadSectionData(sectionName) {
        switch(sectionName) {
            case 'buildings':
                if (!dataLoaded.buildings) loadBuildings();
                // Перезагружаем данные формы при каждом переходе в секцию зданий
                loadFormData();
                break;
            case 'controllers':
                if (!dataLoaded.controllers) loadControllers();
                break;
            case 'transformers':
                if (!dataLoaded.transformers) loadTransformers();
                break;
            case 'lines':
                if (!dataLoaded.lines) loadLines();
                break;
            case 'water-lines':
                if (!dataLoaded['water-lines']) loadWaterLines();
                break;
            case 'metrics':
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
            case 'alerts':
                if (!dataLoaded.alerts) loadAlerts();
                break;
            case 'integration':
                loadIntegrationConfig();
                loadIntegrationRules();
                loadIntegrationLogs();
                break;
        }
    }

    // ===============================================
    // ЗАГРУЗКА КОНТРОЛЛЕРОВ
    // ===============================================

    async function loadControllers() {
        if (dataLoaded.controllers) return;

        // ИСПРАВЛЕНИЕ XSS: Безопасное отображение загрузки
        showLoadingMessage("#controllers-table tbody", "9");

        try {
            const data = await loadData('/api/admin/controllers', 'controllers');
            renderControllersTable(data);
            updatePagination('controllers');
            dataLoaded.controllers = true;
        } catch (error) {
            console.error("Error loading controllers:", error);
            // ИСПРАВЛЕНИЕ XSS: Безопасное отображение ошибки
            showErrorMessage("#controllers-table tbody", "9");
        }
    }

    function renderControllersTable(data) {
        renderEntityTable({
            tableId: 'controllers-table',
            entityType: 'controllers',
            idKey: 'controller_id',
            data,
            columns: [
                { key: 'controller_id', label: 'ID' },
                { key: 'serial_number', label: 'Серийный номер' },
                { key: 'vendor', label: 'Производитель' },
                { key: 'model', label: 'Модель' },
                { key: 'building_id', label: 'Здание', render: (val) => entityCache.buildings[val] || val },
                { key: 'status', label: 'Статус', render: (val) => {
                    const statusClass = val === 'online' ? 'status-online' :
                                        val === 'offline' ? 'status-offline' : 'status-maintenance';
                    const span = document.createElement('span');
                    span.className = `status-badge ${statusClass}`;
                    span.textContent = getStatusLabel(val);
                    return span;
                }},
                { key: 'last_heartbeat', label: 'Пульс', render: (val) => {
                    const container = document.createElement('span');
                    container.className = 'heartbeat-indicator';
                    const dot = document.createElement('span');
                    dot.className = 'heartbeat-dot ' + getHeartbeatColor(val);
                    container.appendChild(dot);
                    const text = document.createTextNode(formatHeartbeat(val));
                    container.appendChild(text);
                    return container;
                }}
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editController(item.controller_id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteController(item.controller_id) }
            ]
        });
    }

    // ===============================================
    // ЗАГРУЗКА МЕТРИК
    // ===============================================

    async function loadMetrics() {
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
        renderEntityTable({
            tableId: 'metrics-table',
            entityType: 'metrics',
            idKey: 'metric_id',
            data,
            columns: [
                { key: 'metric_id', label: 'ID' },
                { key: 'controller_id', label: 'Контроллер', render: (val) => entityCache.controllers[val] || val },
                { key: 'timestamp', label: 'Время', render: (v) => formatDate(v) },
                { key: 'electricity_ph1', label: 'Эл. Ф1', render: (v) => formatNumber(v, 1) },
                { key: 'electricity_ph2', label: 'Эл. Ф2', render: (v) => formatNumber(v, 1) },
                { key: 'electricity_ph3', label: 'Эл. Ф3', render: (v) => formatNumber(v, 1) },
                { key: 'cold_water_pressure', label: 'Давл. ХВС', render: (v) => formatNumber(v, 2) },
                { key: 'hot_water_in_temp', label: 'Темп. ГВС', render: (v) => formatNumber(v, 1) },
                { key: 'air_temp', label: 'Темп. возд.', render: (v) => formatNumber(v, 1) },
                { key: 'humidity', label: 'Влажн.', render: (v) => formatNumber(v, 1) },
                { key: 'leak_sensor', label: 'Утечка', render: (val) => {
                    const span = document.createElement('span');
                    span.className = val ? 'alert-badge' : 'ok-badge';
                    span.textContent = val ? 'Есть' : 'Нет';
                    return span;
                }}
            ],
            actions: [
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteMetric(item.metric_id) }
            ]
        });
    }

    // ===============================================
    // ЗАГРУЗКА ЛИНИЙ ВОДОСНАБЖЕНИЯ
    // ===============================================

    async function loadWaterLines() {
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
        renderEntityTable({
            tableId: 'water-lines-table',
            entityType: 'water-lines',
            idKey: 'line_id',
            data,
            columns: [
                { key: 'line_id', label: 'ID' },
                { key: 'name', label: 'Название' },
                { key: 'description', label: 'Описание' },
                { key: 'diameter_mm', label: 'Диаметр, мм' },
                { key: 'material', label: 'Материал' },
                { key: 'pressure_bar', label: 'Давление, бар', render: (v) => formatNumber(v, 1) },
                { key: 'installation_date', label: 'Дата установки', render: (v) => formatDate(v) },
                { key: 'status', label: 'Статус', render: (val) => {
                    const statusClass = val === 'active' ? 'status-online' :
                                        val === 'inactive' ? 'status-offline' : 'status-maintenance';
                    const span = document.createElement('span');
                    span.className = `status-badge ${statusClass}`;
                    span.textContent = getWaterLineStatusLabel(val);
                    return span;
                }},
                { key: 'connected_buildings', label: 'Здания', render: (val) => {
                    const fullText = val && val.length > 0 ? val.join(', ') : 'Нет подключений';
                    const span = document.createElement('span');
                    span.textContent = fullText.length > 50 ? fullText.substring(0, 50) + '...' : fullText;
                    span.title = fullText;
                    return span;
                }}
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editWaterLine(item.line_id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteWaterLine(item.line_id) }
            ]
        });
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
                // Main row — core fields only
                const mainRow = document.createElement('tr');
                mainRow.className = 'building-main-row';
                mainRow.dataset.buildingId = building.building_id;

                // Checkbox cell
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'item-checkbox';
                checkbox.setAttribute('data-id', building.building_id);
                mainRow.appendChild(createSecureTableCell(checkbox));

                // Text cells — all use textContent (XSS-safe)
                mainRow.appendChild(createSecureTableCell(safeValue(building.building_id)));
                mainRow.appendChild(createSecureTableCell(safeValue(building.name)));
                mainRow.appendChild(createSecureTableCell(safeValue(building.address)));
                mainRow.appendChild(createSecureTableCell(safeValue(building.town)));
                mainRow.appendChild(createSecureTableCell(safeValue(building.region)));
                mainRow.appendChild(createSecureTableCell(safeValue(building.management_company)));

                // Actions cell
                const actionsCell = document.createElement('td');

                const expandBtn = document.createElement('button');
                expandBtn.className = 'btn-expand';
                expandBtn.textContent = '\u25B6';
                expandBtn.title = 'Подробности';
                actionsCell.appendChild(expandBtn);

                const editBtn = document.createElement('button');
                editBtn.className = 'btn-sm';
                editBtn.textContent = 'Изменить';
                editBtn.addEventListener('click', () => editBuilding(building.building_id));
                actionsCell.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-sm btn-danger';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.addEventListener('click', () => deleteBuilding(building.building_id));
                actionsCell.appendChild(deleteBtn);

                mainRow.appendChild(actionsCell);
                newTableBody.appendChild(mainRow);

                // Detail row (hidden by default)
                const detailRow = document.createElement('tr');
                detailRow.className = 'building-detail-row';
                detailRow.style.display = 'none';
                detailRow.dataset.detailFor = building.building_id;

                const detailCell = document.createElement('td');
                detailCell.colSpan = 8;

                const detailGrid = document.createElement('div');
                detailGrid.className = 'detail-grid';

                const details = [
                    ['Координаты', formatNumber(building.latitude, 6) + ', ' + formatNumber(building.longitude, 6)],
                    ['Горячая вода', building.hot_water ? 'Да' : 'Нет'],
                    ['Осн. трансформатор', safeValue(building.primary_transformer_name, '\u2014')],
                    ['Рез. трансформатор', safeValue(building.backup_transformer_name, '\u2014')],
                    ['Осн. линия', safeValue(building.primary_line_name, '\u2014')],
                    ['Рез. линия', safeValue(building.backup_line_name, '\u2014')],
                    ['Линия ХВС', safeValue(building.cold_water_line_name, '\u2014')],
                    ['Линия ГВС', safeValue(building.hot_water_line_name, '\u2014')],
                    ['Поставщик ХВС', safeValue(building.cold_water_supplier_name, '\u2014')],
                    ['Поставщик ГВС', safeValue(building.hot_water_supplier_name, '\u2014')]
                ];

                details.forEach(([label, value]) => {
                    const div = document.createElement('div');
                    const strong = document.createElement('strong');
                    strong.textContent = label + ': ';
                    div.appendChild(strong);
                    div.appendChild(document.createTextNode(value));
                    detailGrid.appendChild(div);
                });

                detailCell.appendChild(detailGrid);
                detailRow.appendChild(detailCell);
                newTableBody.appendChild(detailRow);
            });
        } else {
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.setAttribute('colspan', '8');
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
        renderEntityTable({
            tableId: 'transformers-table',
            entityType: 'transformers',
            idKey: 'transformer_id',
            data,
            columns: [
                { key: 'transformer_id', label: 'ID' },
                { key: 'name', label: 'Название' },
                { key: 'power_kva', label: 'Мощность, кВА', render: (v) => formatNumber(v, 1) },
                { key: 'voltage_kv', label: 'Напряжение, кВ', render: (v) => formatNumber(v, 1) },
                { key: 'primary_buildings', label: 'Здания', render: (val, item) => {
                    const primary = Array.isArray(item.primary_buildings) ? item.primary_buildings.filter(b => b !== null).join(', ') : '';
                    const backup = Array.isArray(item.backup_buildings) ? item.backup_buildings.filter(b => b !== null).join(', ') : '';
                    const parts = [];
                    if (primary) parts.push('Основные: ' + primary);
                    if (backup) parts.push('Резервные: ' + backup);
                    return parts.join(', ') || 'Нет подключенных зданий';
                }}
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editTransformer(item.transformer_id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteTransformer(item.transformer_id) }
            ]
        });
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
        renderEntityTable({
            tableId: 'lines-table',
            entityType: 'lines',
            idKey: 'line_id',
            data,
            columns: [
                { key: 'line_id', label: 'ID' },
                { key: 'name', label: 'Название' },
                { key: 'voltage_kv', label: 'Напряжение, кВ', render: (v) => formatNumber(v, 1) },
                { key: 'length_km', label: 'Длина, км', render: (v) => formatNumber(v, 3) },
                { key: 'transformer_id', label: 'Трансформатор', render: (val) => entityCache.transformers[val] || val }
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editLine(item.line_id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteLine(item.line_id) }
            ]
        });
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
        renderEntityTable({
            tableId: 'water-sources-table',
            entityType: 'waterSources',
            idKey: 'id',
            data,
            columns: [
                { key: 'id', label: 'ID' },
                { key: 'name', label: 'Название' },
                { key: 'address', label: 'Адрес' },
                { key: 'source_type', label: 'Тип', render: (val) => getSourceTypeLabel(val, 'water') },
                { key: 'capacity_m3_per_hour', label: 'Мощность, м³/ч', render: (v) => formatNumber(v, 1) },
                { key: 'operating_pressure_bar', label: 'Давление, бар', render: (v) => formatNumber(v, 1) },
                { key: 'status', label: 'Статус', render: (val) => getStatusLabel(val) }
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editWaterSource(item.id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteWaterSource(item.id) }
            ]
        });
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
        renderEntityTable({
            tableId: 'heat-sources-table',
            entityType: 'heatSources',
            idKey: 'id',
            data,
            columns: [
                { key: 'id', label: 'ID' },
                { key: 'name', label: 'Название' },
                { key: 'address', label: 'Адрес' },
                { key: 'source_type', label: 'Тип', render: (val) => getSourceTypeLabel(val, 'heat') },
                { key: 'capacity_mw', label: 'Мощность, МВт', render: (v) => formatNumber(v, 1) },
                { key: 'fuel_type', label: 'Тип топлива' },
                { key: 'status', label: 'Статус', render: (val) => getStatusLabel(val) }
            ],
            actions: [
                { label: 'Изменить', className: 'btn-sm', handler: (item) => editHeatSource(item.id) },
                { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteHeatSource(item.id) }
            ]
        });
    }

    // ===============================================
    // ЗАГРУЗКА ТРЕВОГ
    // ===============================================

    async function loadAlerts() {
        if (dataLoaded.alerts) return;
        showLoadingMessage("#alerts-table tbody", "9");

        try {
            const data = await loadData('/api/alerts', 'alerts');
            renderAlertsTable(data);
            updatePagination('alerts');
            dataLoaded.alerts = true;
        } catch (error) {
            console.error("Error loading alerts:", error);
            showErrorMessage("#alerts-table tbody", "9");
        }
    }

    function getAlertStatusLabel(status) {
        const labels = {
            'active': 'Активная',
            'acknowledged': 'Подтверждена',
            'resolved': 'Закрыта'
        };
        return labels[status] || status;
    }

    function getInfraTypeLabel(type) {
        const labels = {
            'transformer': 'Трансформатор',
            'controller': 'Контроллер',
            'water_source': 'Источник воды',
            'heat_source': 'Источник тепла'
        };
        return labels[type] || type;
    }

    function renderAlertsTable(data) {
        renderEntityTable({
            tableId: 'alerts-table',
            entityType: 'alerts',
            idKey: 'alert_id',
            data,
            columns: [
                { key: 'alert_id', label: 'ID' },
                { key: 'infrastructure_type', label: 'Тип', render: (val) => getInfraTypeLabel(val) },
                { key: 'severity', label: 'Важность', render: (val) => {
                    const span = document.createElement('span');
                    span.className = 'severity-badge severity-' + (val || '').toLowerCase();
                    span.textContent = val;
                    return span;
                }},
                { key: 'message', label: 'Сообщение' },
                { key: 'infrastructure_id', label: 'Объект' },
                { key: 'status', label: 'Статус', render: (val) => {
                    const span = document.createElement('span');
                    span.className = 'alert-status-badge alert-status-' + val;
                    span.textContent = getAlertStatusLabel(val);
                    return span;
                }},
                { key: 'created_at', label: 'Создан', render: (val) => formatDate(val) }
            ],
            actions: [
                {
                    label: 'Подтвердить',
                    className: 'btn-sm',
                    condition: (item) => item.status === 'active',
                    handler: (item) => acknowledgeAlert(item.alert_id)
                },
                {
                    label: 'Закрыть',
                    className: 'btn-sm btn-danger',
                    condition: (item) => item.status !== 'resolved',
                    handler: (item) => resolveAlert(item.alert_id)
                }
            ]
        });
    }

    async function acknowledgeAlert(alertId) {
        if (!confirm('Подтвердить тревогу?')) return;
        try {
            const response = await fetch('/api/alerts/' + alertId + '/acknowledge', { method: 'PATCH' });
            if (!response.ok) throw new Error('Ошибка подтверждения');
            showToast('Тревога подтверждена', 'success');
            dataLoaded.alerts = false;
            loadAlerts();
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    async function resolveAlert(alertId) {
        if (!confirm('Закрыть тревогу?')) return;
        try {
            const response = await fetch('/api/alerts/' + alertId + '/resolve', { method: 'PATCH' });
            if (!response.ok) throw new Error('Ошибка закрытия');
            showToast('Тревога закрыта', 'success');
            dataLoaded.alerts = false;
            loadAlerts();
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    // Alert filter handlers
    ['alert-filter-severity', 'alert-filter-status', 'alert-filter-infra'].forEach(filterId => {
        const el = document.getElementById(filterId);
        if (el) {
            el.addEventListener('change', function() {
                filters.alerts = {};
                const severity = document.getElementById('alert-filter-severity').value;
                const status = document.getElementById('alert-filter-status').value;
                const infra = document.getElementById('alert-filter-infra').value;
                if (severity) filters.alerts.severity = severity;
                if (status) filters.alerts.status = status;
                if (infra) filters.alerts.infrastructure_type = infra;
                pagination.alerts.page = 1;
                dataLoaded.alerts = false;
                loadAlerts();
            });
        }
    });

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
            'maintenance': 'На обслуживании',
            'online': 'В сети',
            'offline': 'Не в сети'
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
            });
            selectAllBtn.dataset.handlerSet = 'true';
        }
        
        // Обработчик для чекбокса "выбрать все" (если есть в заголовке таблицы)
        const selectAllCheckbox = document.getElementById(`${section}-select-all-checkbox`);
        if (selectAllCheckbox && !selectAllCheckbox.dataset.handlerSet) {
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
            selectAllCheckbox.dataset.handlerSet = 'true';
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

        const currentPage = pagination[section].page;
        const total = pagination[section].total || 0;
        const totalPages = Math.max(1, Math.ceil(total / pagination[section].limit));

        if (pageInfo) {
            pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
        }

        // Clone buttons to remove all old event listeners (prevents leak)
        if (prevBtn) {
            const newPrev = prevBtn.cloneNode(true);
            prevBtn.replaceWith(newPrev);
            newPrev.disabled = currentPage <= 1;
            newPrev.addEventListener('click', () => {
                if (pagination[section].page > 1) {
                    pagination[section].page--;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            });
        }

        if (nextBtn) {
            const newNext = nextBtn.cloneNode(true);
            nextBtn.replaceWith(newNext);
            newNext.disabled = currentPage >= totalPages;
            newNext.addEventListener('click', () => {
                const tp = Math.max(1, Math.ceil((pagination[section].total || 0) / pagination[section].limit));
                if (pagination[section].page < tp) {
                    pagination[section].page++;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            });
        }
    }

    // ===============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ===============================================

    // Delegated click handler for expand buttons — registered ONCE
    document.getElementById('buildings-table').addEventListener('click', (e) => {
        const expandBtn = e.target.closest('.btn-expand');
        if (!expandBtn) return;

        const mainRow = expandBtn.closest('tr');
        const buildingId = mainRow.dataset.buildingId;
        const detailRow = document.querySelector('tr[data-detail-for="' + buildingId + '"]');

        if (detailRow) {
            const isVisible = detailRow.style.display !== 'none';
            detailRow.style.display = isVisible ? 'none' : 'table-row';
            expandBtn.textContent = isVisible ? '\u25B6' : '\u25BC';
        }
    });

    // Загружаем данные для активной секции при старте
    // Ждём готовности auth — иначе запрос уйдёт без JWT и вернёт 401
    if (window.adminAuth && window.adminAuth.isAuthenticated) {
        loadEntityCache().then(() => loadSectionData('buildings'));
    } else {
        window.addEventListener('admin-auth-ready', async () => {
            await loadEntityCache();
            loadSectionData('buildings');
        }, { once: true });
    }

    // Показываем таблицы после загрузки
    document.querySelectorAll('.table-container').forEach(container => {
        container.style.opacity = '1';
    });

    // Глобальные функции для кнопок (будут доступны из HTML)
    window.editBuilding = async function(id) {
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
            openModal('edit-building-modal');

        } catch (error) {
            console.error('Error loading building:', error);
            showToast('Ошибка загрузки данных здания', 'error');
        }
    };

    window.deleteBuilding = async function(id) {
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
                        await deleteBuildingCascade(id);
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

    // Каскадное удаление здания с контроллерами (один запрос к серверу)
    async function deleteBuildingCascade(buildingId) {
        try {
            const response = await fetch(`/api/buildings/${buildingId}?cascade=true`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message || 'Ошибка каскадного удаления здания');
            }

            showToast('Здание и все связанные данные успешно удалены', 'success');

            // Обновляем список зданий
            dataLoaded.buildings = false;
            loadBuildings();

        } catch (error) {
            console.error('Error in cascade delete:', error);
            showToast(error.message || 'Ошибка каскадного удаления', 'error');
        }
    }

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
                        { value: 'online', text: 'В сети' },
                        { value: 'offline', text: 'Не в сети' },
                        { value: 'maintenance', text: 'На обслуживании' }
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
                    loadEntityCache();
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
            openModal('edit-transformer-modal');
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
            openModal('edit-water-source-modal');
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
            openModal('edit-heat-source-modal');
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
            loadEntityCache();
            closeModal('edit-transformer-modal');
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
            closeModal('edit-line-modal');
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
            closeModal('edit-water-source-modal');
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
            closeModal('edit-heat-source-modal');
            dataLoaded.heatSources = false;
            loadHeatSources();
        } catch (error) {
            console.error('Error updating heat source:', error);
            showToast('Ошибка обновления источника тепла', 'error');
        }
    });

    // Обработчики кнопок отмены
    document.getElementById('cancel-edit-transformer').addEventListener('click', function() {
        closeModal('edit-transformer-modal');
    });

    document.getElementById('cancel-edit-line').addEventListener('click', function() {
        closeModal('edit-line-modal');
    });

    document.getElementById('cancel-edit-water-source').addEventListener('click', function() {
        closeModal('edit-water-source-modal');
    });

    document.getElementById('cancel-edit-heat-source').addEventListener('click', function() {
        closeModal('edit-heat-source-modal');
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
            const coldSuppliers = Array.isArray(waterSuppliersData) ?
                waterSuppliersData.filter(s => s.type === 'cold_water') : [];
            const hotSuppliers = Array.isArray(waterSuppliersData) ?
                waterSuppliersData.filter(s => s.type === 'hot_water') : [];

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
        // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
        dropdown.textContent = '';
        if (firstOption) {
            dropdown.appendChild(firstOption);
        }

        // Добавляем данные
        data.forEach((item, index) => {
            if (item && item[valueField] !== undefined && item[textField]) {
                const option = document.createElement('option');
                option.value = item[valueField];
                option.textContent = item[textField];
                dropdown.appendChild(option);
            } else {
                console.warn(`Skipped item ${index} for ${elementId}:`, item, `valueField: ${valueField}, textField: ${textField}`);
            }
        });

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
            // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
            selectElement.textContent = '';
            const option = document.createElement('option');
            option.value = '';
            option.textContent = `Сначала выберите линию ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'}`;
            selectElement.appendChild(option);
            return;
        }

        try {
            // Активируем поле
            selectElement.disabled = false;
            // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
            selectElement.textContent = '';
            const loadingOption = document.createElement('option');
            loadingOption.value = '';
            loadingOption.textContent = 'Загрузка поставщика...';
            selectElement.appendChild(loadingOption);

            // Получаем поставщика для конкретной линии
            const response = await fetch(`/api/water-lines/${lineId}/supplier`);
            if (response.ok) {
                const result = await response.json();

                if (result.supplier) {
                    // Есть привязанный поставщик - выбираем его автоматически
                    // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
                    selectElement.textContent = '';
                    const placeholderOption = document.createElement('option');
                    placeholderOption.value = '';
                    placeholderOption.textContent = 'Выберите поставщика';
                    selectElement.appendChild(placeholderOption);

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

                        // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
                        selectElement.textContent = '';
                        const placeholderOption2 = document.createElement('option');
                        placeholderOption2.value = '';
                        placeholderOption2.textContent = 'Выберите поставщика';
                        selectElement.appendChild(placeholderOption2);

                        if (Array.isArray(suppliersData) && suppliersData.length > 0) {
                            suppliersData.forEach(supplier => {
                                const option = document.createElement('option');
                                option.value = supplier.supplier_id;
                                option.textContent = `${supplier.name} (${supplier.tariff_per_m3} руб/м³)`;
                                selectElement.appendChild(option);
                            });
                            showToast(`📋 К линии не привязан поставщик. Загружено ${suppliersData.length} поставщиков ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'}`, 'info');
                        } else {
                            // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
                            selectElement.textContent = '';
                            const notFoundOption = document.createElement('option');
                            notFoundOption.value = '';
                            notFoundOption.textContent = 'Поставщики не найдены';
                            selectElement.appendChild(notFoundOption);
                            showToast(`⚠️ Поставщики ${supplierType === 'cold_water' ? 'ХВС' : 'ГВС'} не найдены`, 'warning');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка получения поставщика для линии:', error);
            selectElement.disabled = true;
            // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML
            selectElement.textContent = '';
            const errorOption = document.createElement('option');
            errorOption.value = '';
            errorOption.textContent = 'Ошибка загрузки';
            selectElement.appendChild(errorOption);
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
                // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
                select.textContent = '';
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
            loadEntityCache();

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
            loadEntityCache();

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
            loadEntityCache();

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
        const modal = document.getElementById('universal-modal');
        const title = document.getElementById('universal-modal-title');
        const formFields = document.getElementById('universal-form-fields');
        const form = document.getElementById('universal-form');

        // Устанавливаем заголовок
        title.textContent = config.title;

        // Очищаем поля формы
        // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
        formFields.textContent = '';

        // Генерируем поля формы
        config.fields.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'form-field';
            const value = data[field.name] || '';

            // ИСПРАВЛЕНИЕ XSS: Используем DOM API вместо innerHTML для безопасности
            if (field.type === 'select') {
                const label = document.createElement('label');
                label.setAttribute('for', field.name);
                label.textContent = field.label + ':';

                const select = document.createElement('select');
                select.id = field.name;
                select.name = field.name;
                if (field.required) select.required = true;

                field.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.text;
                    if (value === opt.value) option.selected = true;
                    select.appendChild(option);
                });

                fieldDiv.appendChild(label);
                fieldDiv.appendChild(select);
            } else if (field.type === 'textarea') {
                const label = document.createElement('label');
                label.setAttribute('for', field.name);
                label.textContent = field.label + ':';

                const textarea = document.createElement('textarea');
                textarea.id = field.name;
                textarea.name = field.name;
                if (field.required) textarea.required = true;
                textarea.value = value;

                fieldDiv.appendChild(label);
                fieldDiv.appendChild(textarea);
            } else if (field.type === 'checkbox') {
                const label = document.createElement('label');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = field.name;
                checkbox.name = field.name;
                if (value) checkbox.checked = true;

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(' ' + field.label));
                fieldDiv.appendChild(label);
            } else {
                const label = document.createElement('label');
                label.setAttribute('for', field.name);
                label.textContent = field.label + ':';

                const input = document.createElement('input');
                input.type = field.type;
                input.id = field.name;
                input.name = field.name;
                input.value = value;
                if (field.required) input.required = true;
                if (field.step) input.step = field.step;

                fieldDiv.appendChild(label);
                fieldDiv.appendChild(input);
            }

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
        // ИСПРАВЛЕНИЕ XSS: Замена onclick на addEventListener для CSP compliance
        document.getElementById('universal-cancel').addEventListener('click', closeUniversalModal);

        // Показываем модальное окно
        openModal('universal-modal');
    }

    function closeUniversalModal() {
        closeModal('universal-modal');
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
            loadEntityCache();
            closeModal('edit-building-modal');
            dataLoaded.buildings = false;
            loadBuildings();

        } catch (error) {
            console.error('Error updating building:', error);
            showToast('Ошибка обновления здания: ' + error.message, 'error');
        }
    });

    // Обработчик кнопки отмены редактирования здания
    document.getElementById('cancel-edit-building').addEventListener('click', () => {
        closeModal('edit-building-modal');
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

    // === CSP-compliant onclick replacements (moved from inline onclick in admin.html) ===

    // Add-transformer "Указать на карте" (was inline onclick in admin.html)
    document.getElementById('btn-transformer-coord-picker')?.addEventListener('click', function() {
        const currentLat = parseFloat(document.getElementById('transformer-latitude').value) || null;
        const currentLng = parseFloat(document.getElementById('transformer-longitude').value) || null;
        openCoordinateEditor('transformer', null, currentLat, currentLng, null, (lat, lng) => {
            document.getElementById('transformer-latitude').value = lat;
            document.getElementById('transformer-longitude').value = lng;
        });
    });

    // Metrics form "Сброс" (was inline onclick in admin.html)
    document.getElementById('btn-metrics-reset')?.addEventListener('click', function() {
        resetMetricsForm();
    });

    // Edit-transformer "Указать на карте" (was inline onclick in admin.html)
    document.getElementById('btn-edit-transformer-coord-picker')?.addEventListener('click', function() {
        const currentLat = parseFloat(document.getElementById('edit-transformer-latitude').value) || null;
        const currentLng = parseFloat(document.getElementById('edit-transformer-longitude').value) || null;
        openCoordinateEditor('transformer', document.getElementById('edit-transformer-id').value, currentLat, currentLng, null, (lat, lng) => {
            document.getElementById('edit-transformer-latitude').value = lat;
            document.getElementById('edit-transformer-longitude').value = lng;
        });
    });

    // ============================================================
    // ИНТЕГРАЦИЯ УК (UK Integration)
    // ============================================================

    async function loadIntegrationConfig() {
        try {
            const response = await fetch(`${backendURL}/integration/config`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();
            if (data.success) {
                integrationState.config = data.data;
                renderIntegrationConfig();
            }
        } catch (error) {
            console.error('Failed to load integration config:', error);
        }
    }

    function renderIntegrationConfig() {
        const config = integrationState.config;
        const toggle = document.getElementById('integration-enabled');
        const apiUrl = document.getElementById('uk-api-url');
        const frontendUrl = document.getElementById('uk-frontend-url');

        if (toggle) toggle.checked = config.uk_integration_enabled === 'true';
        if (apiUrl) apiUrl.value = config.uk_api_url || '';
        if (frontendUrl) frontendUrl.value = config.uk_frontend_url || '';
    }

    async function saveIntegrationConfig() {
        try {
            const toggle = document.getElementById('integration-enabled');
            const apiUrl = document.getElementById('uk-api-url');
            const frontendUrl = document.getElementById('uk-frontend-url');

            const body = {
                uk_integration_enabled: toggle.checked ? 'true' : 'false',
                uk_api_url: apiUrl.value.trim(),
                uk_frontend_url: frontendUrl.value.trim()
            };

            const response = await fetch(`${backendURL}/integration/config`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.success) {
                integrationState.config = data.data;
                renderIntegrationConfig();
                showToast('Настройки интеграции сохранены', 'success');
            } else {
                showToast('Ошибка: ' + (data.message || 'Неизвестная ошибка'), 'error');
            }
        } catch (error) {
            console.error('Failed to save integration config:', error);
            showToast('Ошибка сохранения настроек', 'error');
        }
    }

    async function loadIntegrationRules() {
        try {
            const response = await fetch(`${backendURL}/integration/rules`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();
            if (data.success) {
                integrationState.rules = data.data;
                renderIntegrationRules();
            }
        } catch (error) {
            console.error('Failed to load integration rules:', error);
        }
    }

    function renderIntegrationRules() {
        const tbody = document.querySelector('#integration-rules-table tbody');
        if (!tbody) return;

        tbody.textContent = '';
        integrationState.rules.forEach(rule => {
            const tr = document.createElement('tr');
            const cells = [
                rule.alert_type,
                rule.severity,
                rule.uk_category,
                rule.uk_urgency,
                rule.enabled ? '✓' : '✗'
            ];
            cells.forEach(text => {
                const td = document.createElement('td');
                td.textContent = text;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    async function loadIntegrationLogs() {
        try {
            const f = integrationState.logFilters;
            const params = new URLSearchParams();
            params.set('page', f.page);
            params.set('limit', f.limit);
            if (f.direction) params.set('direction', f.direction);
            if (f.status) params.set('status', f.status);

            const response = await fetch(`${backendURL}/integration/logs?${params}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();
            if (data.success) {
                integrationState.logs = data.data;
                renderIntegrationLogs();
            }
        } catch (error) {
            console.error('Failed to load integration logs:', error);
        }
    }

    function renderIntegrationLogs() {
        const tbody = document.querySelector('#integration-log-table tbody');
        if (!tbody) return;

        const { logs, total } = integrationState.logs;
        const directionMap = { to_uk: '→ УК', from_uk: '← УК' };
        const statusMap = { success: 'Успех', error: 'Ошибка', failed: 'Провал', pending: 'Ожидание' };

        tbody.textContent = '';
        if (!logs || logs.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 7;
            td.style.textAlign = 'center';
            td.textContent = 'Нет данных';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');

            const idCell = document.createElement('td');
            idCell.textContent = log.id;
            tr.appendChild(idCell);

            const dirCell = document.createElement('td');
            dirCell.textContent = directionMap[log.direction] || log.direction;
            tr.appendChild(dirCell);

            const typeCell = document.createElement('td');
            typeCell.textContent = log.entity_type;
            tr.appendChild(typeCell);

            const actionCell = document.createElement('td');
            actionCell.textContent = log.action;
            tr.appendChild(actionCell);

            const statusCell = document.createElement('td');
            statusCell.textContent = statusMap[log.status] || log.status;
            tr.appendChild(statusCell);

            const timeCell = document.createElement('td');
            timeCell.textContent = new Date(log.created_at).toLocaleString('ru-RU');
            tr.appendChild(timeCell);

            const actionsCell = document.createElement('td');
            if (log.status === 'error' || log.status === 'failed') {
                const retryBtn = document.createElement('button');
                retryBtn.textContent = '↻ Повторить';
                retryBtn.className = 'btn btn-small';
                retryBtn.dataset.logId = log.id;
                retryBtn.addEventListener('click', () => retryIntegrationLog(log.id));
                actionsCell.appendChild(retryBtn);
            }
            tr.appendChild(actionsCell);

            tbody.appendChild(tr);
        });

        // Pagination
        const paginationEl = document.getElementById('integration-log-pagination');
        if (paginationEl) {
            const f = integrationState.logFilters;
            const totalPages = Math.ceil(total / f.limit) || 1;
            paginationEl.textContent = '';

            const info = document.createElement('span');
            info.textContent = `Стр. ${f.page} / ${totalPages} (всего: ${total})`;
            paginationEl.appendChild(info);

            if (f.page > 1) {
                const prevBtn = document.createElement('button');
                prevBtn.textContent = '← Пред';
                prevBtn.className = 'btn btn-small';
                prevBtn.addEventListener('click', () => {
                    integrationState.logFilters.page--;
                    loadIntegrationLogs();
                });
                paginationEl.appendChild(prevBtn);
            }
            if (f.page < totalPages) {
                const nextBtn = document.createElement('button');
                nextBtn.textContent = 'След →';
                nextBtn.className = 'btn btn-small';
                nextBtn.addEventListener('click', () => {
                    integrationState.logFilters.page++;
                    loadIntegrationLogs();
                });
                paginationEl.appendChild(nextBtn);
            }
        }
    }

    async function retryIntegrationLog(logId) {
        try {
            const response = await fetch(`${backendURL}/integration/logs/retry/${logId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await response.json();
            if (data.success) {
                showToast('Повтор запущен', 'success');
                loadIntegrationLogs();
            } else {
                showToast('Ошибка повтора: ' + (data.message || 'Неизвестная ошибка'), 'error');
            }
        } catch (error) {
            console.error('Failed to retry log:', error);
        }
    }

    function initIntegrationTab() {
        const saveBtn = document.getElementById('integration-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', saveIntegrationConfig);

        const logStatusFilter = document.getElementById('integration-log-status');
        const logDirectionFilter = document.getElementById('integration-log-direction');
        const refreshBtn = document.getElementById('integration-log-refresh');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                integrationState.logFilters.status = logStatusFilter ? logStatusFilter.value : '';
                integrationState.logFilters.direction = logDirectionFilter ? logDirectionFilter.value : '';
                integrationState.logFilters.page = 1;
                loadIntegrationLogs();
            });
        }
    }

    initIntegrationTab();

    // Загружаем данные для форм после инициализации всех функций
    loadFormData();
});