document.addEventListener("DOMContentLoaded", function () {
    const backendURL = "http://localhost:3000/api"; // Полный URL к API

    // Переменные для пагинации
    const pagination = {
        buildings: { page: 1, limit: 10, total: 0 },
        controllers: { page: 1, limit: 10, total: 0 },
        metrics: { page: 1, limit: 10, total: 0 }
    };

    // Флаги для отслеживания загрузки данных
    const dataLoaded = {
        buildings: false,
        controllers: false,
        metrics: false
    };

    // Скрываем таблицы до загрузки данных
    document.querySelectorAll('.table-container').forEach(container => {
        container.style.opacity = '0';
    });

    // Функция для загрузки данных
    async function loadData(endpoint) {
        try {
            // Определяем, какой раздел данных загружаем
            const section = endpoint.split('/')[1]; // buildings, controllers или metrics
            
            // Добавляем параметры пагинации, если они есть
            let url = `${backendURL}${endpoint}`;
            if (pagination[section]) {
                url += `?page=${pagination[section].page}&limit=${pagination[section].limit}`;
            }
            
            console.log(`Загрузка данных с ${url}`);
            
            // Устанавливаем таймаут для запроса
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId); // Очищаем таймаут, если запрос успешно выполнен
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const responseData = await response.json();
            
            // Проверяем, есть ли данные в ответе
            if (responseData && responseData.data) {
                // Обновляем информацию о пагинации, если она есть
                if (responseData.pagination) {
                    if (pagination[section]) {
                        pagination[section].total = responseData.pagination.total || 0;
                        pagination[section].page = responseData.pagination.page || 1;
                        pagination[section].limit = responseData.pagination.limit || 10;
                    }
                }
                return responseData.data;
            }
            
            return responseData;
        } catch (error) {
            console.error(`Error loading data from ${endpoint}:`, error);
            
            // Проверяем, была ли ошибка вызвана таймаутом
            if (error.name === 'AbortError') {
                console.warn('Запрос был прерван из-за таймаута. Не перезагружаем страницу.');
                // Возвращаем пустой массив вместо выбрасывания ошибки
                return [];
            }
            
            // Предотвращаем циклическую перезагрузку, возвращая пустой массив вместо выбрасывания ошибки
            console.warn('Произошла ошибка при загрузке данных. Не перезагружаем страницу.');
            return [];
        }
    }

    // Fetch and display buildings
    async function loadBuildings() {
        // Предотвращаем повторную загрузку
        if (dataLoaded.buildings) return;
        
        // Показываем индикатор загрузки
        const tableBody = document.querySelector("#buildings-table tbody");
        if (!tableBody.querySelector('.loading-row')) {
            tableBody.innerHTML = `<tr class="loading-row"><td colspan="10">Загрузка данных...</td></tr>`;
        }
        
        try {
            // Сохраняем текущую прокрутку страницы
            const scrollPosition = window.scrollY;
            
            const data = await loadData('/buildings');
            
            // Создаем новую таблицу вместо обновления существующей
            const newTableBody = document.createElement('tbody');
            
            // Проверяем, есть ли данные
            if (data && data.length > 0) {
                data.forEach((building) => {
                    const row = document.createElement("tr");
                    
                    // Безопасное получение значений
                    const safeValue = (value, defaultValue = "N/A") => {
                        return value !== null && value !== undefined ? value : defaultValue;
                    };
                    
                    row.innerHTML = `
                        <td>${safeValue(building.building_id)}</td>
                        <td>${safeValue(building.name)}</td>
                        <td>${safeValue(building.address)}</td>
                        <td>${safeValue(building.town)}</td>
                        <td>${safeValue(building.region)}</td>
                        <td>${safeValue(building.latitude)}</td>
                        <td>${safeValue(building.longitude)}</td>
                        <td>${safeValue(building.management_company)}</td>
                        <td>${building.hot_water ? "Да" : "Нет"}</td>
                        <td>
                            <button onclick="editBuilding(${building.building_id})">Изменить</button>
                            <button onclick="deleteBuilding(${building.building_id})">Удалить</button>
                        </td>
                    `;
                    newTableBody.appendChild(row);
                });
            } else {
                newTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center;">Нет данных</td></tr>`;
            }
            
            // Заменяем старую таблицу на новую
            const table = document.querySelector("#buildings-table");
            table.replaceChild(newTableBody, tableBody);
            
            // Обновляем информацию о пагинации
            const totalPages = Math.ceil(pagination.buildings.total / pagination.buildings.limit) || 1;
            document.getElementById("buildings-page-info").textContent = `Страница ${pagination.buildings.page} из ${totalPages}`;
            
            // Отключаем кнопку "Предыдущая", если мы на первой странице
            document.getElementById("buildings-prev-page").disabled = pagination.buildings.page <= 1;
            
            // Отключаем кнопку "Следующая", если мы на последней странице
            document.getElementById("buildings-next-page").disabled = pagination.buildings.page >= totalPages;
            
            // Отмечаем, что данные загружены
            dataLoaded.buildings = true;
            
            // Восстанавливаем позицию прокрутки
            window.scrollTo({
                top: scrollPosition,
                behavior: 'auto'
            });
        } catch (error) {
            console.error("Error loading buildings:", error);
            const newTableBody = document.createElement('tbody');
            newTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: red;">Ошибка загрузки данных: ${error.message}</td></tr>`;
            
            // Заменяем старую таблицу на новую с сообщением об ошибке
            const table = document.querySelector("#buildings-table");
            table.replaceChild(newTableBody, tableBody);
        }
    }

    // Fetch and display controllers
    async function loadControllers() {
        // Предотвращаем повторную загрузку
        if (dataLoaded.controllers) return;
        
        // Показываем индикатор загрузки
        const tableBody = document.querySelector("#controllers-table tbody");
        if (!tableBody.querySelector('.loading-row')) {
            tableBody.innerHTML = `<tr class="loading-row"><td colspan="7">Загрузка данных...</td></tr>`;
        }
        
        try {
            // Сохраняем текущую прокрутку страницы
            const scrollPosition = window.scrollY;
            
            const data = await loadData('/controllers');
            
            // Создаем новую таблицу вместо обновления существующей
            const newTableBody = document.createElement('tbody');
            
            // Проверяем, есть ли данные
            if (data && data.length > 0) {
                data.forEach((controller) => {
                    const row = document.createElement("tr");
                    
                    // Безопасное получение значений
                    const safeValue = (value, defaultValue = "N/A") => {
                        return value !== null && value !== undefined ? value : defaultValue;
                    };
                    
                    row.innerHTML = `
                        <td>${safeValue(controller.controller_id)}</td>
                        <td>${safeValue(controller.serial_number)}</td>
                        <td>${safeValue(controller.vendor)}</td>
                        <td>${safeValue(controller.model)}</td>
                        <td>${safeValue(controller.building_id)}</td>
                        <td>${safeValue(controller.status)}</td>
                        <td>
                            <button onclick="editController(${controller.controller_id})">Изменить</button>
                            <button onclick="deleteController(${controller.controller_id})">Удалить</button>
                        </td>
                    `;
                    newTableBody.appendChild(row);
                });
            } else {
                newTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Нет данных</td></tr>`;
            }
            
            // Заменяем старую таблицу на новую
            const table = document.querySelector("#controllers-table");
            table.replaceChild(newTableBody, tableBody);
            
            // Обновляем информацию о пагинации
            const totalPages = Math.ceil(pagination.controllers.total / pagination.controllers.limit) || 1;
            document.getElementById("controllers-page-info").textContent = `Страница ${pagination.controllers.page} из ${totalPages}`;
            
            // Отключаем кнопку "Предыдущая", если мы на первой странице
            document.getElementById("controllers-prev-page").disabled = pagination.controllers.page <= 1;
            
            // Отключаем кнопку "Следующая", если мы на последней странице
            document.getElementById("controllers-next-page").disabled = pagination.controllers.page >= totalPages;
            
            // Отмечаем, что данные загружены
            dataLoaded.controllers = true;
            
            // Восстанавливаем позицию прокрутки
            window.scrollTo({
                top: scrollPosition,
                behavior: 'auto'
            });
        } catch (error) {
            console.error("Error loading controllers:", error);
            const newTableBody = document.createElement('tbody');
            newTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных: ${error.message}</td></tr>`;
            
            // Заменяем старую таблицу на новую с сообщением об ошибке
            const table = document.querySelector("#controllers-table");
            table.replaceChild(newTableBody, tableBody);
        }
    }

    // Fetch and display metrics
    async function loadMetrics() {
        // Предотвращаем повторную загрузку
        if (dataLoaded.metrics) return;
        
        // Показываем индикатор загрузки
        const tableBody = document.querySelector("#metrics-table tbody");
        if (!tableBody.querySelector('.loading-row')) {
            tableBody.innerHTML = `<tr class="loading-row"><td colspan="12">Загрузка данных...</td></tr>`;
        }
        
        try {
            // Сохраняем текущую прокрутку страницы
            const scrollPosition = window.scrollY;
            
            const data = await loadData('/metrics');
            
            // Создаем новую таблицу вместо обновления существующей
            const newTableBody = document.createElement('tbody');
            
            // Проверяем, есть ли данные
            if (data && data.length > 0) {
                data.forEach((metric) => {
                    const row = document.createElement("tr");
                    
                    // Безопасное форматирование числовых значений
                    const formatNumber = (value) => {
                        if (value === null || value === undefined) return "N/A";
                        const num = parseFloat(value);
                        return isNaN(num) ? value : num.toFixed(1);
                    };
                    
                    // Безопасное форматирование даты
                    const formatDate = (dateStr) => {
                        try {
                            return new Date(dateStr).toLocaleString();
                        } catch (e) {
                            return dateStr || "N/A";
                        }
                    };
                    
                    // Безопасное получение значений
                    const safeValue = (value, defaultValue = "N/A") => {
                        return value !== null && value !== undefined ? value : defaultValue;
                    };
                    
                    const timestamp = formatDate(metric.timestamp);
                    
                    row.innerHTML = `
                        <td>${safeValue(metric.metric_id)}</td>
                        <td>${safeValue(metric.controller_id)}</td>
                        <td>${timestamp}</td>
                        <td>${formatNumber(metric.electricity_ph1)}</td>
                        <td>${formatNumber(metric.electricity_ph2)}</td>
                        <td>${formatNumber(metric.electricity_ph3)}</td>
                        <td>${formatNumber(metric.cold_water_pressure)}</td>
                        <td>${formatNumber(metric.hot_water_in_temp)}</td>
                        <td>${formatNumber(metric.air_temp)}</td>
                        <td>${formatNumber(metric.humidity)}</td>
                        <td>${metric.leak_sensor ? "Да" : "Нет"}</td>
                        <td>
                            <button onclick="deleteMetric(${metric.metric_id})">Удалить</button>
                        </td>
                    `;
                    newTableBody.appendChild(row);
                });
            } else {
                newTableBody.innerHTML = `<tr><td colspan="12" style="text-align: center;">Нет данных</td></tr>`;
            }
            
            // Заменяем старую таблицу на новую
            const table = document.querySelector("#metrics-table");
            table.replaceChild(newTableBody, tableBody);
            
            // Обновляем информацию о пагинации
            const totalPages = Math.ceil(pagination.metrics.total / pagination.metrics.limit) || 1;
            document.getElementById("metrics-page-info").textContent = `Страница ${pagination.metrics.page} из ${totalPages}`;
            
            // Отключаем кнопку "Предыдущая", если мы на первой странице
            document.getElementById("metrics-prev-page").disabled = pagination.metrics.page <= 1;
            
            // Отключаем кнопку "Следующая", если мы на последней странице
            document.getElementById("metrics-next-page").disabled = pagination.metrics.page >= totalPages;
            
            // Отмечаем, что данные загружены
            dataLoaded.metrics = true;
            
            // Восстанавливаем позицию прокрутки
            window.scrollTo({
                top: scrollPosition,
                behavior: 'auto'
            });
        } catch (error) {
            console.error("Error loading metrics:", error);
            const newTableBody = document.createElement('tbody');
            newTableBody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: red;">Ошибка загрузки данных: ${error.message}</td></tr>`;
            
            // Заменяем старую таблицу на новую с сообщением об ошибке
            const table = document.querySelector("#metrics-table");
            table.replaceChild(newTableBody, tableBody);
        }
    }

    // Function to send POST requests
    async function postData(url, data) {
        try {
            // Устанавливаем таймаут для запроса
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
            
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId); // Очищаем таймаут, если запрос успешно выполнен

            if (!response.ok) {
                let errorText = "Failed to submit data";
                try {
                    errorText = await response.text();
                } catch (e) {
                    console.error("Error reading response text:", e);
                }
                throw new Error(errorText || "Failed to submit data");
            }

            alert("Успешно добавлено");
            return true;
        } catch (err) {
            console.error("Error:", err);
            
            // Проверяем, была ли ошибка вызвана таймаутом
            if (err.name === 'AbortError') {
                alert("Запрос был прерван из-за таймаута. Пожалуйста, попробуйте еще раз.");
            } else {
                alert(`Ошибка: ${err.message}`);
            }
            
            return false;
        }
    }

    // Function to send PUT requests
    async function putData(url, data) {
        try {
            // Устанавливаем таймаут для запроса
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
            
            const response = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId); // Очищаем таймаут, если запрос успешно выполнен

            if (!response.ok) {
                let errorText = "Failed to update data";
                try {
                    errorText = await response.text();
                } catch (e) {
                    console.error("Error reading response text:", e);
                }
                throw new Error(errorText || "Failed to update data");
            }

            alert("Успешно обновлено");
            return true;
        } catch (err) {
            console.error("Error:", err);
            
            // Проверяем, была ли ошибка вызвана таймаутом
            if (err.name === 'AbortError') {
                alert("Запрос был прерван из-за таймаута. Пожалуйста, попробуйте еще раз.");
            } else {
                alert(`Ошибка: ${err.message}`);
            }
            
            return false;
        }
    }

    // Handle Building Form Submission
    document.getElementById("add-building-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        const buildingData = {
            name: document.getElementById("building-name").value,
            address: document.getElementById("building-address").value,
            town: document.getElementById("building-town").value,
            region: document.getElementById("building-region").value,
            latitude: parseFloat(document.getElementById("building-latitude").value),
            longitude: parseFloat(document.getElementById("building-longitude").value),
            management_company: document.getElementById("building-management").value,
            hot_water: document.getElementById("building-hot-water").checked
        };
        
        if (await postData(`${backendURL}/buildings`, buildingData)) {
            // Очищаем форму
            this.reset();
            // Сбрасываем флаг загрузки данных
            dataLoaded.buildings = false;
            // Перезагружаем данные
            loadBuildings();
        }
    });

    // Handle Controller Form Submission
    document.getElementById("add-controller-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        const controllerData = {
            serial_number: document.getElementById("controller-serial").value,
            vendor: document.getElementById("controller-vendor").value,
            model: document.getElementById("controller-model").value,
            building_id: parseInt(document.getElementById("controller-building-id").value),
            status: document.getElementById("controller-status").value
        };
        
        if (await postData(`${backendURL}/controllers`, controllerData)) {
            // Очищаем форму
            this.reset();
            // Сбрасываем флаг загрузки данных
            dataLoaded.controllers = false;
            // Перезагружаем данные
            loadControllers();
        }
    });

    // Handle Metric Form Submission
    document.getElementById("add-metric-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        
        try {
            // Безопасное преобразование значений в числа
            const safeParseFloat = (value) => {
                const num = parseFloat(value);
                return isNaN(num) ? null : num;
            };
            
            const metricData = {
                controller_id: parseInt(document.getElementById("metric-controller-id").value) || null,
                timestamp: new Date().toISOString(),
                electricity_ph1: safeParseFloat(document.getElementById("metric-electricity-ph1").value),
                electricity_ph2: safeParseFloat(document.getElementById("metric-electricity-ph2").value),
                electricity_ph3: safeParseFloat(document.getElementById("metric-electricity-ph3").value),
                cold_water_pressure: safeParseFloat(document.getElementById("metric-cold-water-pressure").value),
                hot_water_in_temp: safeParseFloat(document.getElementById("metric-hot-water-in-temp").value),
                air_temp: safeParseFloat(document.getElementById("metric-air-temp").value),
                humidity: safeParseFloat(document.getElementById("metric-humidity").value),
                leak_sensor: document.getElementById("metric-leak-sensor").checked
            };
            
            if (await postData(`${backendURL}/metrics`, metricData)) {
                // Очищаем только поле controller_id, остальные оставляем для удобства тестирования
                document.getElementById("metric-controller-id").value = "";
                // Сбрасываем флаг загрузки данных
                dataLoaded.metrics = false;
                // Перезагружаем данные
                loadMetrics();
            }
        } catch (error) {
            console.error("Error adding metric:", error);
            alert(`Ошибка при добавлении метрики: ${error.message}`);
        }
    });

    // Delete Building
    window.deleteBuilding = async function(buildingId) {
        if (!confirm("Вы уверены, что хотите удалить это здание?")) return;
    
        try {
            const response = await fetch(`${backendURL}/buildings/${buildingId}`, { method: "DELETE" });
            if (response.ok) {
                alert("Здание успешно удалено");
                // Сбрасываем флаг загрузки данных
                dataLoaded.buildings = false;
                loadBuildings();
            } else {
                const errorText = await response.text();
                throw new Error(errorText || "Ошибка удаления здания");
            }
        } catch (error) {
            console.error("Error deleting building:", error);
            alert(`Ошибка: ${error.message}`);
        }
    };

    // Delete Controller
    window.deleteController = async function(controllerId) {
        if (!confirm("Вы уверены, что хотите удалить этот контроллер?")) return;
    
        try {
            const response = await fetch(`${backendURL}/controllers/${controllerId}`, { method: "DELETE" });
            if (response.ok) {
                alert("Контроллер успешно удален");
                // Сбрасываем флаг загрузки данных
                dataLoaded.controllers = false;
                loadControllers();
            } else {
                const errorText = await response.text();
                throw new Error(errorText || "Ошибка удаления контроллера");
            }
        } catch (error) {
            console.error("Error deleting controller:", error);
            alert(`Ошибка: ${error.message}`);
        }
    };

    // Delete Metric
    window.deleteMetric = async function(metricId) {
        if (!confirm("Вы уверены, что хотите удалить эту метрику?")) return;
    
        try {
            const response = await fetch(`${backendURL}/metrics/${metricId}`, { method: "DELETE" });
            if (response.ok) {
                alert("Метрика успешно удалена");
                // Сбрасываем флаг загрузки данных
                dataLoaded.metrics = false;
                loadMetrics();
            } else {
                const errorText = await response.text();
                throw new Error(errorText || "Ошибка удаления метрики");
            }
        } catch (error) {
            console.error("Error deleting metric:", error);
            alert(`Ошибка: ${error.message}`);
        }
    };

    // Edit Building
    window.editBuilding = async function(buildingId) {
        try {
            // Показываем индикатор загрузки
            document.body.style.cursor = 'wait';
            
            const response = await fetch(`${backendURL}/buildings/${buildingId}`);
            if (!response.ok) {
                throw new Error("Не удалось получить данные здания");
            }
            
            const building = await response.json();
            
            // Заполняем форму данными
            document.getElementById("edit-building-id").value = buildingId;
            document.getElementById("edit-building-name").value = building.name || '';
            document.getElementById("edit-building-address").value = building.address || '';
            document.getElementById("edit-building-town").value = building.town || '';
            document.getElementById("edit-building-region").value = building.region || '';
            document.getElementById("edit-building-latitude").value = building.latitude || '';
            document.getElementById("edit-building-longitude").value = building.longitude || '';
            document.getElementById("edit-building-management").value = building.management_company || '';
            document.getElementById("edit-building-hot-water").checked = building.hot_water || false;
            
            // Показываем модальное окно
            document.getElementById("edit-building-modal").style.display = 'flex';
            
            // Возвращаем курсор в нормальное состояние
            document.body.style.cursor = 'default';
            
        } catch (error) {
            console.error("Error editing building:", error);
            alert(`Ошибка: ${error.message}`);
            document.body.style.cursor = 'default';
        }
    };
    
    // Обработчик отмены редактирования здания
    document.getElementById("cancel-edit-building").addEventListener("click", function() {
        document.getElementById("edit-building-modal").style.display = 'none';
    });
    
    // Обработчик сохранения здания
    document.getElementById("edit-building-form").addEventListener("submit", async function(event) {
        event.preventDefault();
        
        const buildingId = document.getElementById("edit-building-id").value;
        
        const updatedData = {
            name: document.getElementById("edit-building-name").value,
            address: document.getElementById("edit-building-address").value,
            town: document.getElementById("edit-building-town").value,
            region: document.getElementById("edit-building-region").value,
            latitude: parseFloat(document.getElementById("edit-building-latitude").value),
            longitude: parseFloat(document.getElementById("edit-building-longitude").value),
            management_company: document.getElementById("edit-building-management").value,
            hot_water: document.getElementById("edit-building-hot-water").checked
        };
        
        if (await putData(`${backendURL}/buildings/${buildingId}`, updatedData)) {
            // Скрываем модальное окно
            document.getElementById("edit-building-modal").style.display = 'none';
            
            // Сбрасываем флаг загрузки данных
            dataLoaded.buildings = false;
            
            // Перезагружаем данные
            loadBuildings();
        }
    });

    // Edit Controller
    window.editController = async function(controllerId) {
        try {
            // Показываем индикатор загрузки
            document.body.style.cursor = 'wait';
            
            const response = await fetch(`${backendURL}/controllers/${controllerId}`);
            if (!response.ok) {
                throw new Error("Не удалось получить данные контроллера");
            }
            
            const controller = await response.json();
            
            // Заполняем форму данными
            document.getElementById("edit-controller-id").value = controllerId;
            document.getElementById("edit-controller-serial").value = controller.serial_number || '';
            document.getElementById("edit-controller-vendor").value = controller.vendor || '';
            document.getElementById("edit-controller-model").value = controller.model || '';
            document.getElementById("edit-controller-building-id").value = controller.building_id || '';
            document.getElementById("edit-controller-status").value = controller.status || 'online';
            
            // Показываем модальное окно
            document.getElementById("edit-controller-modal").style.display = 'flex';
            
            // Возвращаем курсор в нормальное состояние
            document.body.style.cursor = 'default';
            
        } catch (error) {
            console.error("Error editing controller:", error);
            alert(`Ошибка: ${error.message}`);
            document.body.style.cursor = 'default';
        }
    };
    
    // Обработчик отмены редактирования контроллера
    document.getElementById("cancel-edit-controller").addEventListener("click", function() {
        document.getElementById("edit-controller-modal").style.display = 'none';
    });
    
    // Обработчик сохранения контроллера
    document.getElementById("edit-controller-form").addEventListener("submit", async function(event) {
        event.preventDefault();
        
        const controllerId = document.getElementById("edit-controller-id").value;
        
        const updatedData = {
            serial_number: document.getElementById("edit-controller-serial").value,
            vendor: document.getElementById("edit-controller-vendor").value,
            model: document.getElementById("edit-controller-model").value,
            building_id: parseInt(document.getElementById("edit-controller-building-id").value),
            status: document.getElementById("edit-controller-status").value
        };
        
        if (await putData(`${backendURL}/controllers/${controllerId}`, updatedData)) {
            // Скрываем модальное окно
            document.getElementById("edit-controller-modal").style.display = 'none';
            
            // Сбрасываем флаг загрузки данных
            dataLoaded.controllers = false;
            
            // Перезагружаем данные
            loadControllers();
        }
    });

    // Обработчики пагинации для зданий
    document.getElementById("buildings-prev-page").addEventListener("click", function() {
        if (pagination.buildings.page > 1) {
            pagination.buildings.page--;
            // Сбрасываем флаг загрузки данных
            dataLoaded.buildings = false;
            loadBuildings();
        }
    });
    
    document.getElementById("buildings-next-page").addEventListener("click", function() {
        pagination.buildings.page++;
        // Сбрасываем флаг загрузки данных
        dataLoaded.buildings = false;
        loadBuildings();
    });
    
    // Обработчики пагинации для контроллеров
    document.getElementById("controllers-prev-page").addEventListener("click", function() {
        if (pagination.controllers.page > 1) {
            pagination.controllers.page--;
            // Сбрасываем флаг загрузки данных
            dataLoaded.controllers = false;
            loadControllers();
        }
    });
    
    document.getElementById("controllers-next-page").addEventListener("click", function() {
        pagination.controllers.page++;
        // Сбрасываем флаг загрузки данных
        dataLoaded.controllers = false;
        loadControllers();
    });
    
    // Обработчики пагинации для метрик
    document.getElementById("metrics-prev-page").addEventListener("click", function() {
        if (pagination.metrics.page > 1) {
            pagination.metrics.page--;
            // Сбрасываем флаг загрузки данных
            dataLoaded.metrics = false;
            loadMetrics();
        }
    });
    
    document.getElementById("metrics-next-page").addEventListener("click", function() {
        pagination.metrics.page++;
        // Сбрасываем флаг загрузки данных
        dataLoaded.metrics = false;
        loadMetrics();
    });

    // Load data initially
    async function initialLoad() {
        try {
            // Устанавливаем минимальное время загрузки, чтобы избежать мерцания
            const minLoadTime = 500; // миллисекунды
            const startTime = Date.now();
            
            // Загружаем данные параллельно с обработкой ошибок для каждого запроса
            await Promise.allSettled([
                loadBuildings().catch(err => {
                    console.error("Ошибка при загрузке зданий:", err);
                    // Показываем сообщение об ошибке в таблице зданий
                    const tableBody = document.querySelector("#buildings-table tbody");
                    tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: red;">Ошибка загрузки данных: ${err.message}</td></tr>`;
                }),
                loadControllers().catch(err => {
                    console.error("Ошибка при загрузке контроллеров:", err);
                    // Показываем сообщение об ошибке в таблице контроллеров
                    const tableBody = document.querySelector("#controllers-table tbody");
                    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Ошибка загрузки данных: ${err.message}</td></tr>`;
                }),
                loadMetrics().catch(err => {
                    console.error("Ошибка при загрузке метрик:", err);
                    // Показываем сообщение об ошибке в таблице метрик
                    const tableBody = document.querySelector("#metrics-table tbody");
                    tableBody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: red;">Ошибка загрузки данных: ${err.message}</td></tr>`;
                })
            ]);
            
            // Проверяем, прошло ли минимальное время загрузки
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime < minLoadTime) {
                // Если загрузка была слишком быстрой, добавляем задержку
                await new Promise(resolve => setTimeout(resolve, minLoadTime - elapsedTime));
            }
            
            // Используем requestAnimationFrame для более плавного отображения
            requestAnimationFrame(() => {
                // Показываем таблицы после загрузки данных
                document.querySelectorAll('.table-container').forEach(container => {
                    // Используем CSS-переход для плавного появления
                    container.style.opacity = '1';
                });
            });
        } catch (error) {
            console.error("Error during initial load:", error);
            
            // Показываем таблицы даже в случае ошибки
            requestAnimationFrame(() => {
                document.querySelectorAll('.table-container').forEach(container => {
                    container.style.opacity = '1';
                });
                
                // Добавляем общее сообщение об ошибке
                const errorMessage = document.createElement('div');
                errorMessage.className = 'error-message';
                errorMessage.textContent = `Произошла ошибка при загрузке данных: ${error.message}. Перезагрузка страницы не требуется.`;
                document.body.insertBefore(errorMessage, document.body.firstChild);
            });
        }
    }
    
    // Запускаем загрузку данных
    initialLoad();
}); 