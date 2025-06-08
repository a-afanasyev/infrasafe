document.addEventListener("DOMContentLoaded", function () {
    const backendURL = "/api";

    // Переменные для пагинации всех сущностей
    const pagination = {
        buildings: { page: 1, limit: 10, total: 0 },
        controllers: { page: 1, limit: 10, total: 0 },
        transformers: { page: 1, limit: 10, total: 0 },
        lines: { page: 1, limit: 10, total: 0 },
        metrics: { page: 1, limit: 10, total: 0 }
    };

    // Флаги для отслеживания загрузки данных
    const dataLoaded = {
        buildings: false,
        controllers: false,
        transformers: false,
        lines: false,
        metrics: false
    };

    // Состояние фильтров
    const filters = {
        buildings: {},
        controllers: {},
        transformers: {},
        lines: {},
        metrics: {}
    };

    // Состояние сортировки
    const sorting = {
        buildings: { column: 'building_id', direction: 'asc' },
        controllers: { column: 'controller_id', direction: 'asc' },
        transformers: { column: 'transformer_id', direction: 'asc' },
        lines: { column: 'line_id', direction: 'asc' },
        metrics: { column: 'metric_id', direction: 'desc' }
    };

    // Выбранные элементы для batch операций
    const selectedItems = {
        buildings: new Set(),
        controllers: new Set(),
        transformers: new Set(),
        lines: new Set(),
        metrics: new Set()
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
        switch(sectionName) {
            case 'buildings':
                if (!dataLoaded.buildings) loadBuildings();
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
            case 'metrics':
                if (!dataLoaded.metrics) loadMetrics();
                break;
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
            
            const url = `${backendURL}${endpoint}?${params.toString()}`;
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
            const data = await loadData('/buildings', 'buildings');
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
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${building.building_id}"></td>
                    <td>${safeValue(building.building_id)}</td>
                    <td>${safeValue(building.name)}</td>
                    <td>${safeValue(building.address)}</td>
                    <td>${safeValue(building.town)}</td>
                    <td>${safeValue(building.region)}</td>
                    <td>${formatNumber(building.latitude, 6)}</td>
                    <td>${formatNumber(building.longitude, 6)}</td>
                    <td>${safeValue(building.management_company)}</td>
                    <td>${building.hot_water ? "Да" : "Нет"}</td>
                    <td>
                        <button onclick="editBuilding(${building.building_id})" class="btn-sm">Изменить</button>
                        <button onclick="deleteBuilding(${building.building_id})" class="btn-sm btn-danger">Удалить</button>
                    </td>
                `;
                newTableBody.appendChild(row);
            });
        } else {
            newTableBody.innerHTML = `<tr><td colspan="11" style="text-align: center;">Нет данных</td></tr>`;
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
            const data = await loadData('/transformers', 'transformers');
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
                row.innerHTML = `
                    <td><input type="checkbox" class="item-checkbox" data-id="${transformer.transformer_id}"></td>
                    <td>${safeValue(transformer.transformer_id)}</td>
                    <td>${safeValue(transformer.name)}</td>
                    <td>${formatNumber(transformer.power_kva, 1)}</td>
                    <td>${formatNumber(transformer.voltage_kv, 1)}</td>
                    <td>${safeValue(transformer.building_id)}</td>
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
            const data = await loadData('/lines', 'lines');
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
    window.editTransformer = function(id) { /* реализация */ };
    window.deleteTransformer = function(id) { /* реализация */ };
    window.editLine = function(id) { /* реализация */ };
    window.deleteLine = function(id) { /* реализация */ };
}); 