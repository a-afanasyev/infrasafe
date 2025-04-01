document.addEventListener('DOMContentLoaded', async function () {
    // Define backend API URL (can be modified externally)
    const backendURL = window.BACKEND_URL || "https://infrasafe.aisolutions.uz/api/metrics"; 

    // Добавляем необходимые CSS-стили для сворачиваемости сайдбара
    const sidebarStyles = document.createElement('style');
    sidebarStyles.textContent = `
        #sidebar h3 {
            cursor: pointer;
            position: relative;
            padding-right: 20px;
            user-select: none;
        }
        
        #sidebar h3:after {
            content: "▼";
            position: absolute;
            right: 5px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.8em;
            transition: transform 0.3s;
        }
        
        #sidebar h3.collapsed:after {
            transform: translateY(-50%) rotate(-90deg);
        }
        
        #sidebar .status-items.collapsed {
            display: none !important;
        }
        
        .blinking-leak-header {
            animation: blink-animation 1s infinite;
            color: #1976d2;
        }
        
        @keyframes blink-animation {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        /* Стили для кластеров маркеров */
        .marker-cluster-custom {
            text-align: center;
            border-radius: 50%;
            font-weight: bold;
        }
        
        .marker-cluster-custom div {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .marker-cluster-leak div {
            animation: cluster-blink-animation 1.5s infinite;
        }
        
        @keyframes cluster-blink-animation {
            0% { opacity: 1; }
            50% { opacity: 0.6; }
            100% { opacity: 1; }
        }
        
        /* Стили для кнопки обновления */
        .update-control {
            transition: all 0.3s ease;
        }
        
        .update-toggle-button {
            border-radius: 3px;
            transition: all 0.2s ease;
            user-select: none;
        }
        
        .update-toggle-button:hover {
            background-color: #f0f0f0;
        }
        
        .update-content {
            overflow: hidden;
            transition: height 0.3s ease;
        }
        
        .update-button {
            background-color: #1976D2;
            color: white;
            border: none;
            border-radius: 3px;
            transition: background-color 0.2s;
        }
        
        .update-button:hover {
            background-color: #1565C0;
        }
    `;
    document.head.appendChild(sidebarStyles);

    // Создаём элемент для индикатора загрузки
    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loading-indicator';
    loadingIndicator.innerHTML = 'Загрузка карты...';
    loadingIndicator.style.position = 'absolute';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.background = 'rgba(255, 255, 255, 0.8)';
    loadingIndicator.style.padding = '10px 20px';
    loadingIndicator.style.borderRadius = '5px';
    loadingIndicator.style.zIndex = '1000';
    loadingIndicator.style.boxShadow = '0 0 10px rgba(0,0,0,0.2)';
    document.body.appendChild(loadingIndicator);

    // Инициализация карты
    const map = L.map('map').setView([41.32, 69.25], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: ''
    }).addTo(map);

    // Добавляем собственный контрол атрибуции только с OpenStreetMap
    L.control.attribution({
        prefix: false  // Это убирает "Leaflet"
    }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors').addTo(map);

    // Инициализация сворачиваемых групп в сайдбаре
    initCollapsibleGroups();
    
    // Инициализация заголовков с количеством элементов
    updateGroupHeaders();
    
    // Функция для инициализации сворачиваемых групп в сайдбаре
    function initCollapsibleGroups() {
        const groupHeaders = document.querySelectorAll('.group-header');
        
        groupHeaders.forEach(header => {
            // Добавляем текстовую подсказку
            header.title = 'Нажмите, чтобы свернуть/развернуть';
            
            // Добавляем обработчик клика на заголовок
            header.onclick = function(event) {
                event.stopPropagation(); // Предотвращаем всплытие события
                
                // Проверяем, не свернут ли сайдбар
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('collapsed')) {
                    return; // Если сайдбар свернут, не обрабатываем клик
                }
                
                // Переключаем класс для заголовка
                this.classList.toggle('collapsed');
                
                // Получаем контейнер элементов
                const itemsContainer = this.nextElementSibling;
                if (itemsContainer && itemsContainer.classList.contains('status-items')) {
                    itemsContainer.classList.toggle('collapsed');
                }
            };
        });
    }
    
    // Функция для обновления заголовков с количеством элементов
    function updateGroupHeaders() {
        const sidebarGroups = ['ok-group', 'warning-group', 'critical-group', 'no-group', 'leak-group'];
        
        sidebarGroups.forEach(groupId => {
            const header = document.querySelector(`#${groupId} h3`);
            const itemsContainer = header?.nextElementSibling;
            
            if (header && itemsContainer) {
                const count = itemsContainer.children.length;
                
                // Определяем текст в зависимости от группы
                let text;
                switch(groupId) {
                    case 'ok-group':
                        text = `Нормальное (${count})`;
                        header.innerHTML = `<div class="icon normal-icon"></div><span>${text}</span>`;
                        break;
                    case 'warning-group':
                        text = `Предупреждение (${count})`;
                        header.innerHTML = `<div class="icon warning-icon"></div><span>${text}</span>`;
                        break;
                    case 'critical-group':
                        text = `Критическое (${count})`;
                        header.innerHTML = `<div class="icon critical-icon"></div><span>${text}</span>`;
                        break;
                    case 'no-group':
                        text = `Нет контроллеров (${count})`;
                        header.innerHTML = `<div class="icon no-controller-icon"></div><span>${text}</span>`;
                        break;
                    case 'leak-group':
                        text = `Протечка (${count})`;
                        header.innerHTML = `<div class="icon leak-icon"></div><span>${text}</span>`;
                        if (count > 0) {
                            header.classList.add('blinking-leak-header');
                        } else {
                            header.classList.remove('blinking-leak-header');
                        }
                        break;
                }
            }
        });
    }
    
    // Create a group to hold markers
    // Заменяем обычную группу маркеров на кластеризованную группу
    let markers = L.markerClusterGroup({
        maxClusterRadius: 50,       // Расстояние в пикселях, на котором маркеры будут объединяться в кластер
        spiderfyOnMaxZoom: true,    // Раскрывать кластер при максимальном зуме
        showCoverageOnHover: false, // Не показывать границы кластера при наведении
        zoomToBoundsOnClick: true,  // Приближать к границам кластера при клике
        disableClusteringAtZoom: 15, // Отключать кластеризацию при большом зуме
        // Настраиваем внешний вид кластера
        iconCreateFunction: function(cluster) {
            // Получаем все маркеры в кластере
            const markers = cluster.getAllChildMarkers();
            
            // Определяем статус кластера на основе статусов маркеров
            let hasLeak = false;
            let hasCritical = false;
            let hasWarning = false;
            
            for (let marker of markers) {
                const status = marker.options.status;
                if (status === 'leak') hasLeak = true;
                if (status === 'critical') hasCritical = true;
                if (status === 'warning') hasWarning = true;
            }
            
            // Задаем цвет кластера в зависимости от приоритета статусов
            let className = 'marker-cluster-custom';
            let style = '';
            
            if (hasLeak) {
                className += ' marker-cluster-leak';
                style = 'background-color: rgba(33, 150, 243, 0.8); color: white;';
            } else if (hasCritical) {
                className += ' marker-cluster-critical';
                style = 'background-color: rgba(255, 0, 0, 0.8); color: white;';
            } else if (hasWarning) {
                className += ' marker-cluster-warning';
                style = 'background-color: rgba(255, 165, 0, 0.8); color: white;';
            } else {
                className += ' marker-cluster-ok';
                style = 'background-color: rgba(0, 128, 0, 0.8); color: white;';
            }
            
            return L.divIcon({ 
                html: `<div style="${style}"><span>${cluster.getChildCount()}</span></div>`,
                className: className,
                iconSize: L.point(40, 40)
            });
        }
    }).addTo(map);
    
    // Создаем переменные для хранения настроек обновления
    let updateInterval = 60; // секунды
    let autoUpdateEnabled = false;
    let updateTimer = null;
    let lastUpdateTime = new Date();

    // Создаем элемент управления обновлением
    const updateControl = L.control({ position: 'topright' });
    updateControl.onAdd = function(map) {
        const container = L.DomUtil.create('div', 'update-control');
        
        // Создаем кнопку-заголовок с информацией об обновлении
        const toggleButton = L.DomUtil.create('button', 'update-toggle-button', container);
        toggleButton.innerHTML = `
            <span class="toggle-icon">+</span>
            <div class="update-time-display">
                <span>ОБНОВЛЕНО</span>
                <span class="update-time">2 минуты назад</span>
            </div>
        `;
        
        // Создаем контейнер для содержимого
        const contentContainer = L.DomUtil.create('div', 'update-content', container);
        
        // Кнопка обновления
        const updateButton = L.DomUtil.create('button', 'update-now', contentContainer);
        updateButton.innerHTML = 'Обновить сейчас';
        
        // Автообновление
        const autoUpdateLabel = L.DomUtil.create('label', 'auto-update-label', contentContainer);
        const autoUpdateCheckbox = L.DomUtil.create('input', '', autoUpdateLabel);
        autoUpdateCheckbox.type = 'checkbox';
        autoUpdateCheckbox.id = 'auto-update';
        autoUpdateLabel.appendChild(document.createTextNode('Автообновление'));
        
        // Селектор интервала
        const intervalLabel = L.DomUtil.create('div', 'interval-label', contentContainer);
        intervalLabel.innerHTML = 'Интервал обновления:';
        const intervalSelect = L.DomUtil.create('select', '', contentContainer);
        intervalSelect.id = 'update-interval';
        
        // Добавляем опции для интервала
        const intervals = [
            { value: 30, text: '30 секунд' },
            { value: 60, text: '1 минута' },
            { value: 300, text: '5 минут' },
            { value: 600, text: '10 минут' }
        ];
        
        intervals.forEach(interval => {
            const option = document.createElement('option');
            option.value = interval.value;
            option.text = interval.text;
            if (interval.value === 60) option.selected = true;
            intervalSelect.appendChild(option);
        });
        
        // Обработчик для кнопки переключения
        L.DomEvent.on(toggleButton, 'click', function(e) {
            L.DomEvent.stop(e);
            this.classList.toggle('expanded');
            contentContainer.classList.toggle('expanded');
        });
        
        // Обработчик для кнопки обновления
        L.DomEvent.on(updateButton, 'click', function(e) {
            L.DomEvent.stop(e);
            loadData();
        });
        
        // Обработчики для автообновления
        L.DomEvent.on(autoUpdateCheckbox, 'change', function() {
            autoUpdateEnabled = this.checked;
            if (autoUpdateEnabled) {
                startAutoUpdate();
            } else {
                stopAutoUpdate();
            }
        });
        
        L.DomEvent.on(intervalSelect, 'change', function() {
            updateInterval = parseInt(this.value);
            if (autoUpdateEnabled) {
                stopAutoUpdate();
                startAutoUpdate();
            }
        });
        
        // Предотвращаем распространение событий карты
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        
        return container;
    };
    updateControl.addTo(map);
    
    // Функция для запуска автообновления
    function startAutoUpdate() {
        if (updateTimer) {
            clearInterval(updateTimer);
        }
        updateTimer = setInterval(loadData, updateInterval * 1000);
    }
    
    // Функция для остановки автообновления
    function stopAutoUpdate() {
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    }
    
    // Функция для обновления времени последнего обновления
    function updateLastUpdateTime() {
        const now = new Date();
        const diff = Math.floor((now - lastUpdateTime) / 1000); // разница в секундах
        
        let timeText;
        if (diff < 60) {
            timeText = 'только что';
        } else if (diff < 3600) {
            const minutes = Math.floor(diff / 60);
            timeText = `${minutes} ${declOfNum(minutes, ['минуту', 'минуты', 'минут'])} назад`;
        } else {
            const hours = Math.floor(diff / 3600);
            timeText = `${hours} ${declOfNum(hours, ['час', 'часа', 'часов'])} назад`;
        }
        
        const timeElements = document.getElementsByClassName('update-time');
        Array.from(timeElements).forEach(el => {
            el.textContent = timeText;
        });
    }

    // Вспомогательная функция для склонения числительных
    function declOfNum(number, titles) {
        const cases = [2, 0, 1, 1, 1, 2];
        return titles[(number % 100 > 4 && number % 100 < 20) ? 2 : cases[(number % 10 < 5) ? number % 10 : 5]];
    }

    // Обновляем время каждую минуту
    setInterval(updateLastUpdateTime, 60000);

    // Функция загрузки данных с сервера
    async function loadData() {
        try {
            // Очищаем старые маркеры и боковую панель
            markers.clearLayers();
            document.querySelectorAll('#ok-group .status-items, #warning-group .status-items, #critical-group .status-items, #no-group .status-items, #leak-group .status-items').forEach(group => {
                group.innerHTML = '';
            });
            
            // Fetch data from the backend
            const response = await fetch(backendURL);
            const data = await response.json();

            // Счетчик зданий с протечкой
            let leakBuildingsCount = 0;

            data.forEach((item) => {
                if (!item.latitude || !item.longitude) {
                    console.warn("Skipping invalid data:", item);
                    return;
                }

                // Determine electricity status

                //Determine phase 1 status
                const isPhase1Ok = item.electricity_ph1 > 200 && item.electricity_ph1 < 240;
                const electricityImage1 = isPhase1Ok
                    ? 'data/images/Electricity_Green.png'
                    : 'data/images/Electricity_Red.png';
                
                //Determine phase 2 status
                const isPhase2Ok = item.electricity_ph2 > 200 && item.electricity_ph2 < 240;
                const electricityImage2 = isPhase2Ok
                    ? 'data/images/Electricity_Green.png'
                    : 'data/images/Electricity_Red.png';
                
                //Determine phase 3 status
                const isPhase3Ok = item.electricity_ph3 > 200 && item.electricity_ph3 < 240;
                const electricityImage3 = isPhase3Ok
                    ? 'data/images/Electricity_Green.png'
                    : 'data/images/Electricity_Red.png';

                const isElectricityOK = isPhase1Ok && isPhase2Ok && isPhase3Ok;
                const electricityImage = isElectricityOK
                    ? 'data/images/Electricity_Green.png'
                    : 'data/images/Electricity_Red.png';

                // Determine cold water status
                const isColdWaterOK = item.cold_water_pressure > 1;
                const coldWaterImage = isColdWaterOK
                    ? 'data/images/Water_Blue.png'
                    : 'data/images/Water_No_Blue.png';

                // Determine hot water status 
                //need to update procedure for hot water to show houses withoit hot water and check the difference betwee in and out pressure and temperature

                const isHotWaterOK = item.hot_water_in_pressure >= 1 &&item.hot_water_out_pressure >= 1;
                const hotWaterImage = isHotWaterOK
                    ? 'data/images/Water_Red.png'
                    : 'data/images/Water_No_Red.png';

                // Определяем статус датчика протечки
                const hasLeak = item.leak_sensor === true;
                const leakSensorImage = hasLeak 
                    ? 'data/images/leak1.png' 
                    : 'data/images/Leak_Green.png';

                // Увеличиваем счетчик зданий с протечкой
                if (hasLeak) {
                    leakBuildingsCount++;
                }

                // Determine marker color based on status
                let status;
                if (hasLeak) {
                    status = 'leak'; // Новый статус для зданий с протечкой
                } else if (isElectricityOK && isColdWaterOK && isHotWaterOK) {
                    status = 'ok';
                } else if (isElectricityOK || isColdWaterOK) {
                    status = 'warning';
                } else if (item.controller_id) {
                    status = 'critical';
                } else {
                    status = 'no';
                }
                
                const circleOptions = {
                    radius: status === 'leak' ? 10 : 8, // Более крупный размер для маркеров с протечкой
                    weight: status === 'leak' ? 2 : 1, // Более толстая рамка для маркеров с протечкой
                    color: status === 'leak' ? '#1e88e5' : 'white', // Ярко-синяя рамка для маркеров с протечкой
                    fillColor: status === 'ok' ? 'green' : 
                                status === 'warning' ? 'orange' : 
                                status === 'leak' ? '#2196f3' : // Более яркий синий цвет для маркеров протечки
                                status === 'critical' ? 'red' : 'gray',
                    fillOpacity: status === 'leak' ? 0.8 : 1, // Немного прозрачнее для эффекта мигания
                };
            

                // Create a Leaflet marker
                const marker = L.circleMarker([item.latitude, item.longitude], {
                    ...circleOptions,
                    status: status, // Сохраняем статус маркера для использования в кластерах
                    building_id: item.building_id || item.controller_id || item.building_name // Уникальный идентификатор для здания
                });
                
                // Делаем маркер с протечкой мигающим
                if (status === 'leak') {
                    // После добавления маркера на карту, находим его DOM-элемент и добавляем класс для мигания
                    marker.on('add', function(event) {
                        const markerElement = event.target._path;
                        if (markerElement) {
                            markerElement.classList.add('blinking-marker');
                        }
                    });
                }

                let popupContent;
                // Create a popup with building details
                if(status === 'no'){
                    popupContent = `
                    <div>
                        <strong>${item.building_name}</strong><br></br>
                        no controller data
                    </div>`;
                }
                else
                {

                    // Create popup content for building with electricity and cold water data
                    popupContent = `
            <div>
                <strong>${item.building_name}</strong><br>
                <table>
                    <!-- Electricity Data -->
                    <tr>
                        <td><img src="${electricityImage}" alt="Electricity_Status" style="width: 20px;" /></td>
                        <td ${!isPhase1Ok ? "class='blinking-cell-orange'" : ''} >${item.electricity_ph1 ? item.electricity_ph1 + "V" : "N/A"}</td>
                        <td ${!isPhase2Ok ? "class='blinking-cell-orange'" : ''}>${item.electricity_ph2 ? item.electricity_ph2 + "V" : "N/A"}</td>
                        <td ${!isPhase3Ok ? "class='blinking-cell-orange'" : ''}>${item.electricity_ph3 ? item.electricity_ph3 + "V" : "N/A"}</td>
                    </tr>

                    <!-- Cold Water Data -->
                    <tr>
                        <td><img src="${coldWaterImage}" alt="Cold_Water" style="width: 20px;" /></td>
                        <td colspan="3" ${!isColdWaterOK ? "class='blinking-cell-orange'" : ''}><strong>ХВС:</strong> ${item.cold_water_pressure ? item.cold_water_pressure + " Bar" : "NoPres"}, 
                        ${item.cold_water_temp ? item.cold_water_temp + "°C" : "NoTemp"}</td>
                    </tr>

                    <!-- Hot Water Data (Temperature + Inflow & Outflow Pressure) -->
                    ${item.hot_water_in_temp && item.hot_water_out_temp && item.hot_water_in_pressure && item.hot_water_out_pressure ? `
                    <tr>
                        <td><img src="data/images/Water_Red.png" alt="Hot_Water" style="width: 20px;" /></td>
                        <td colspan="3" ${!isHotWaterOK ? "class='blinking-cell-orange'" : ''}><strong>ГВС Подача:</strong> ${item.hot_water_in_temp}°C, ${item.hot_water_in_pressure} Bar
                        </td>
                    </tr>
                    <tr>
                        <td></td>   
                        <td colspan="3"><strong>ГВС Обратка:</strong> ${item.hot_water_out_temp}°C, ${item.hot_water_out_pressure} Bar</td>
                    </tr>` : `
                    <tr>
                        <td><img src="data/images/Water_Red.png" alt="Hot_Water" style="width: 20px;" /></td>
                        <td colspan="3"><strong>ГВС:</strong> Not connected</td>
                    </tr>`}

                    <!-- Leak Sensor Data -->
                    <tr>
                        <td><img src="${leakSensorImage}" alt="Leak_Sensor_Status" style="width: 20px;" /></td>
                        <td colspan="3" ${hasLeak ? "class='blinking-cell-orange'" : ''}><strong>Датчик протечки:</strong> ${hasLeak ? 'Протечка!' : 'OK'}</td>
                    </tr>
                </table>
            </div>
        `;
                };

                marker.bindPopup(popupContent).addTo(markers);
                markers.addLayer(marker);

                // Сохраняем содержимое попапа глобально для этого маркера
                marker._popupContent = popupContent;

                // Update the sidebar with building information
                const sidebarGroup = document.querySelector(`#${status}-group .status-items`);
                if (sidebarGroup) {
                    const sidebarItem = document.createElement("div");
                    sidebarItem.classList.add("sidebar-item");
                    sidebarItem.innerHTML = item.controller_id ? `
                        <img src="${electricityImage}" alt="Electricity_Status" style="width: 15px;">
                        ${isColdWaterOK ? `<img src="${coldWaterImage}" alt="Cold_Water_Status" style="width: 15px;">` : ''}
                        ${isHotWaterOK ? `<img src="${hotWaterImage}" alt="Hot_Water_Status" style="width: 15px;">` : ''}
                        <img src="${leakSensorImage}" alt="Leak_Sensor_Status" style="width: 15px;">
                        ${item.building_name}
                    ` : `
                        <img src="data/images/no_controller.png" alt="No_Controller" style="width: 15px;">
                        ${item.building_name}
                    `;

                    sidebarItem.addEventListener("click", function () {
                        // Сохраняем координаты и уникальный ID маркера для надежности
                        const markerLat = item.latitude;
                        const markerLng = item.longitude;
                        const markerId = item.building_id || item.controller_id || item.building_name;
                        
                        // Создаем попап мгновенно - не ждем анимацию карты
                        const popup = L.popup()
                            .setLatLng([markerLat, markerLng])
                            .setContent(popupContent)
                            .openOn(map);
                        
                        // Быстро перемещаемся к маркеру с минимальной анимацией
                        map.flyTo([markerLat, markerLng], 16, {
                            duration: 0.5 // Уменьшаем время анимации до 0.5 секунды
                        });
                        
                        // Расформируем кластеры при необходимости
                        markers.unspiderfy();
                    });
                    sidebarGroup.appendChild(sidebarItem);
                } else {
                    console.warn("Sidebar group not found for status:", status);
                }
            });

            // Обновляем информацию на карте
            map.fitBounds(markers.getBounds(), { padding: [50, 50] });
            
            // Обновляем счетчики элементов в заголовках и заголовок группы протечек
            updateGroupHeaders();
            
            // Скрываем индикатор загрузки
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            
            // Обновляем время последнего обновления
            updateLastUpdateTime();
            
            // Убедимся, что состояние свернутых групп соответствует нашим правилам
            updateGroupsCollapsedState();
            
            // После обновления данных обновляем счетчики
            updateGroupCounters();
            
            // Возвращаем успешный результат
            return true;
        } catch (error) {
            console.error("Error loading data:", error);
            // Показываем ошибку в индикаторе загрузки
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.innerHTML = 'Ошибка загрузки данных';
                loadingIndicator.style.background = 'rgba(255, 200, 200, 0.9)';
            }
            return false;
        }
    }
    
    // Функция для обновления состояния свернутых групп
    function updateGroupsCollapsedState() {
        const sidebarGroups = ['ok-group', 'warning-group', 'critical-group', 'no-group', 'leak-group'];
        
        sidebarGroups.forEach(groupId => {
            const group = document.querySelector(`#${groupId}`);
            const statusItems = group?.querySelector('.status-items');
            const groupHeader = group?.querySelector('.group-header');
            
            if (statusItems && groupHeader) {
                // Сворачиваем все группы по умолчанию
                statusItems.classList.add('collapsed');
                groupHeader.classList.add('collapsed');
            }
        });
    }

    // Функция для исправления возможных проблем с сайдбаром
    function fixSidebarCollapsible() {
        // Убедимся, что у всех заголовков есть обработчики событий и правильные стили
        const sidebarHeaders = document.querySelectorAll('#sidebar h3');
        
        sidebarHeaders.forEach(header => {
            // Добавляем стиль курсора
            header.style.cursor = 'pointer';
            
            // Убедимся, что заголовок является кликабельным
            if (!header.onclick) {
                header.onclick = function(event) {
                    event.stopPropagation();
                    this.classList.toggle('collapsed');
                    
                    const itemsContainer = this.nextElementSibling;
                    if (itemsContainer) {
                        if (itemsContainer.classList.contains('collapsed')) {
                            itemsContainer.classList.remove('collapsed');
                            itemsContainer.style.display = 'block';
                        } else {
                            itemsContainer.classList.add('collapsed');
                            itemsContainer.style.display = 'none';
                        }
                    }
                };
            }
            
            // Применяем правильные стили к содержимому
            const itemsContainer = header.nextElementSibling;
            if (itemsContainer) {
                if (header.classList.contains('collapsed')) {
                    itemsContainer.classList.add('collapsed');
                    itemsContainer.style.display = 'none';
                } else {
                    itemsContainer.classList.remove('collapsed');
                    itemsContainer.style.display = 'block';
                }
            }
        });
    }

    // Инициализация сайдбара
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    
    if (sidebar && sidebarToggle) {
        // Добавляем обработчик клика на кнопку переключения
        sidebarToggle.onclick = function(e) {
            e.stopPropagation();
            sidebar.classList.toggle('collapsed');
            
            // Обновляем состояние групп при сворачивании/разворачивании
            const statusGroups = document.querySelectorAll('.status-group');
            statusGroups.forEach(group => {
                const statusItems = group.querySelector('.status-items');
                if (statusItems) {
                    if (sidebar.classList.contains('collapsed')) {
                        statusItems.classList.add('collapsed');
                    } else {
                        // При разворачивании сайдбара восстанавливаем предыдущее состояние групп
                        const groupHeader = group.querySelector('.group-header');
                        if (groupHeader && !groupHeader.classList.contains('collapsed')) {
                            statusItems.classList.remove('collapsed');
                        }
                    }
                }
            });
        };
        
        // Добавляем обработчики для заголовков групп
        const groupHeaders = document.querySelectorAll('.group-header');
        groupHeaders.forEach(header => {
            header.onclick = function(e) {
                e.stopPropagation();
                const statusItems = this.nextElementSibling;
                if (statusItems && statusItems.classList.contains('status-items')) {
                    if (!sidebar.classList.contains('collapsed')) {
                        statusItems.classList.toggle('collapsed');
                        this.classList.toggle('collapsed');
                    }
                }
            };
        });
    }
    
    // Функция для показа подсказки при клике на группу в свернутом состоянии
    function showGroupTooltip(title) {
        // Удаляем существующую подсказку, если она есть
        const existingTooltip = document.querySelector('.group-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
        
        // Создаем новую подсказку
        const tooltip = document.createElement('div');
        tooltip.className = 'group-tooltip';
        tooltip.textContent = title;
        
        // Добавляем стили для подсказки
        tooltip.style.position = 'fixed';
        tooltip.style.background = 'rgba(0, 0, 0, 0.8)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '8px 12px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '14px';
        tooltip.style.zIndex = '1001';
        tooltip.style.pointerEvents = 'none';
        
        // Позиционируем подсказку
        const sidebar = document.getElementById('sidebar');
        const rect = sidebar.getBoundingClientRect();
        tooltip.style.left = `${rect.right + 10}px`;
        tooltip.style.top = `${rect.top + 10}px`;
        
        // Добавляем подсказку на страницу
        document.body.appendChild(tooltip);
        
        // Удаляем подсказку через 2 секунды
        setTimeout(() => {
            tooltip.remove();
        }, 2000);
    }
    
    // Инициализируем сайдбар при загрузке страницы
    document.addEventListener('DOMContentLoaded', () => {
        initializeSidebar();
    });

    // Загрузка данных при инициализации
    await loadData();

    // Функция для обновления счетчиков в группах
    function updateGroupCounters() {
        const groups = ['ok', 'warning', 'leak', 'critical', 'no'];
        
        groups.forEach(group => {
            const groupElement = document.getElementById(`${group}-group`);
            const itemsContainer = groupElement.querySelector('.status-items');
            const counterElement = groupElement.querySelector('.group-counter');
            
            // Подсчитываем количество элементов в группе
            const itemCount = itemsContainer.children.length;
            
            // Обновляем счетчик
            counterElement.textContent = itemCount;
            
            // Скрываем счетчик, если элементов нет
            counterElement.style.display = itemCount > 0 ? 'flex' : 'none';
        });
    }

    // Добавляем обновление счетчиков при инициализации
    document.addEventListener('DOMContentLoaded', async function () {
        // ... existing code ...
        
        // Инициализация счетчиков
        updateGroupCounters();
        
        // Наблюдаем за изменениями в группах
        const observer = new MutationObserver(updateGroupCounters);
        
        // Наблюдаем за изменениями во всех группах
        ['ok', 'warning', 'leak', 'critical', 'no'].forEach(group => {
            const groupElement = document.getElementById(`${group}-group`);
            const itemsContainer = groupElement.querySelector('.status-items');
            observer.observe(itemsContainer, { childList: true, subtree: true });
        });
    });
});
   