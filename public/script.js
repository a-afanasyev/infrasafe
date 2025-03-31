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

    // Initialize the map без указания начальной точки и масштаба
    const map = L.map('map', {
        attributionControl: false,  // Отключаем стандартный контрол атрибуции
        zoomControl: true,          // Включаем контроль зума
        minZoom: 2                  // Минимальный зум для предотвращения потери ориентации
    });

    // Добавляем собственный контрол атрибуции только с OpenStreetMap
    L.control.attribution({
        prefix: false  // Это убирает "Leaflet"
    }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors').addTo(map);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',  // Пустая атрибуция для слоя, так как мы уже добавили её вручную выше
    }).addTo(map);

    // Инициализация сворачиваемых групп в сайдбаре
    initCollapsibleGroups();
    
    // Функция для инициализации сворачиваемых групп в сайдбаре
    function initCollapsibleGroups() {
        const sidebarHeaders = document.querySelectorAll('#sidebar h3');
        
        sidebarHeaders.forEach(header => {
            // Получаем контейнер элементов группы
            const itemsContainer = header.nextElementSibling;
            
            // Убеждаемся, что у заголовка есть стиль курсора, указывающий, что он кликабельный
            header.style.cursor = 'pointer';
            
            // Добавляем текстовую подсказку
            header.title = 'Нажмите, чтобы свернуть/развернуть';
            
            // Очищаем все предыдущие обработчики (на случай повторной инициализации)
            const newHeader = header.cloneNode(true);
            if (header.parentNode) {
                header.parentNode.replaceChild(newHeader, header);
            }
            
            // Добавляем обработчик клика на заголовок с явным захватом события
            newHeader.addEventListener('click', function(event) {
                event.stopPropagation(); // Предотвращаем всплытие события
                
                // Переключаем класс для заголовка
                this.classList.toggle('collapsed');
                
                // Получаем контейнер снова, так как мы заменили элемент
                const items = this.nextElementSibling;
                
                // Переключаем видимость контейнера напрямую через стили, если класс не работает
                if (items) {
                    if (items.classList.contains('collapsed')) {
                        items.classList.remove('collapsed');
                        items.style.display = 'block';
                    } else {
                        items.classList.add('collapsed');
                        items.style.display = 'none';
                    }
                }
            }, true); // Используем третий параметр true для захвата события
            
            // По умолчанию не сворачиваем группу "Протечка"
            // и сворачиваем остальные группы, если в них нет элементов
            if (newHeader.parentElement.id !== 'leak-group') {
                const isEmpty = itemsContainer ? itemsContainer.children.length === 0 : true;
                if (isEmpty) {
                    newHeader.classList.add('collapsed');
                    if (itemsContainer) {
                        itemsContainer.classList.add('collapsed');
                        itemsContainer.style.display = 'none';
                    }
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
        container.style.backgroundColor = 'white';
        container.style.padding = '6px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        
        // Добавляем кнопку плюсика для сворачивания/разворачивания
        const toggleButton = L.DomUtil.create('div', 'update-toggle-button', container);
        toggleButton.innerHTML = '+';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.fontWeight = 'bold';
        toggleButton.style.fontSize = '18px';
        toggleButton.style.width = '24px';
        toggleButton.style.height = '24px';
        toggleButton.style.textAlign = 'center';
        toggleButton.style.lineHeight = '22px';
        toggleButton.style.borderRadius = '3px';
        toggleButton.style.border = '1px solid #ccc';
        toggleButton.style.backgroundColor = '#fff';
        toggleButton.style.transition = 'all 0.2s ease';
        toggleButton.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
        toggleButton.title = 'Открыть панель обновления';
        
        // Стили при наведении
        toggleButton.onmouseover = function() {
            this.style.backgroundColor = '#f4f4f4';
        };
        toggleButton.onmouseout = function() {
            this.style.backgroundColor = '#fff';
        };
        
        // Стили при активации
        toggleButton.onmousedown = function() {
            this.style.boxShadow = '0 0 1px rgba(0,0,0,0.2)';
            this.style.transform = 'translateY(1px)';
        };
        toggleButton.onmouseup = function() {
            this.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
            this.style.transform = 'translateY(0)';
        };
        
        // Создаем контейнер для содержимого, который будет сворачиваться
        const contentContainer = L.DomUtil.create('div', 'update-content', container);
        contentContainer.style.display = 'none'; // По умолчанию свернут
        contentContainer.style.marginTop = '6px';
        
        // Последнее обновление
        const lastUpdateEl = L.DomUtil.create('div', 'last-update', contentContainer);
        lastUpdateEl.innerHTML = `<small>Последнее обновление: <span id="last-update-time">Только что</span></small>`;
        
        // Кнопка обновления
        const updateButton = L.DomUtil.create('button', 'update-button', contentContainer);
        updateButton.innerHTML = 'Обновить сейчас';
        updateButton.style.padding = '4px 8px';
        updateButton.style.margin = '5px 0';
        updateButton.style.cursor = 'pointer';
        
        // Автообновление
        const autoUpdateLabel = L.DomUtil.create('label', 'auto-update-label', contentContainer);
        const autoUpdateCheckbox = L.DomUtil.create('input', 'auto-update-checkbox', autoUpdateLabel);
        autoUpdateCheckbox.type = 'checkbox';
        autoUpdateCheckbox.id = 'auto-update';
        autoUpdateLabel.appendChild(document.createTextNode(' Автообновление'));
        
        // Селектор интервала
        const intervalLabel = L.DomUtil.create('div', 'interval-label', contentContainer);
        intervalLabel.innerHTML = '<small>Интервал обновления:</small>';
        const intervalSelect = L.DomUtil.create('select', 'interval-select', contentContainer);
        intervalSelect.id = 'update-interval';
        
        const intervals = [
            { value: 30, label: '30 секунд' },
            { value: 60, label: '1 минута' },
            { value: 300, label: '5 минут' },
            { value: 600, label: '10 минут' }
        ];
        
        intervals.forEach(interval => {
            const option = document.createElement('option');
            option.value = interval.value;
            option.text = interval.label;
            if (interval.value === updateInterval) {
                option.selected = true;
            }
            intervalSelect.appendChild(option);
        });
        
        // Обработчик для переключения видимости содержимого
        L.DomEvent.on(toggleButton, 'click', function() {
            if (contentContainer.style.display === 'none') {
                // Разворачиваем
                contentContainer.style.display = 'block';
                toggleButton.innerHTML = '−'; // Меняем плюс на минус
                toggleButton.title = 'Закрыть панель обновления';
                // Анимация открытия
                container.style.minWidth = '180px';
            } else {
                // Сворачиваем
                contentContainer.style.display = 'none';
                toggleButton.innerHTML = '+'; // Меняем минус на плюс
                toggleButton.title = 'Открыть панель обновления';
                // Анимация закрытия
                container.style.minWidth = '24px';
            }
        });
        
        // Обработчики событий для элементов управления
        L.DomEvent.on(updateButton, 'click', function() {
            loadData();
        });
        
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
        
        // Предотвращение распространения событий карты при взаимодействии с элементами управления
        L.DomEvent.disableClickPropagation(container);
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
        lastUpdateTime = new Date();
        const timeElement = document.getElementById('last-update-time');
        if (timeElement) {
            timeElement.textContent = lastUpdateTime.toLocaleTimeString();
        }
    }

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

            // Update last update time
            updateLastUpdateTime();
            
            // Активируем мигающий эффект для заголовка группы протечек, если есть здания с протечкой
            const leakGroupHeader = document.querySelector('#leak-group h3');
            if (leakGroupHeader) {
                if (leakBuildingsCount > 0) {
                    leakGroupHeader.classList.add('blinking-leak-header');
                    leakGroupHeader.textContent = `Протечка (${leakBuildingsCount})`;
                    
                    // Разворачиваем группу протечек, если в ней появились здания
                    leakGroupHeader.classList.remove('collapsed');
                    const leakItems = leakGroupHeader.nextElementSibling;
                    if (leakItems) {
                        leakItems.classList.remove('collapsed');
                    }
                } else {
                    leakGroupHeader.classList.remove('blinking-leak-header');
                    leakGroupHeader.textContent = 'Протечка';
                }
            }
            
            // Обновляем состояние всех групп - сворачиваем пустые группы
            updateGroupsCollapsedState();
            
            // Всегда масштабируем карту, чтобы показать все маркеры
            if (markers.getLayers().length > 0) {
                map.fitBounds(markers.getBounds(), {
                    padding: [50, 50] // Добавляем отступы по краям для лучшей видимости
                });
            }

            // Скрываем индикатор загрузки
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            
            // Вызываем функцию для исправления возможных проблем с сайдбаром
            fixSidebarCollapsible();
        } catch (error) {
            console.error("Error loading data:", error);
            // Показываем ошибку в индикаторе загрузки
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.innerHTML = 'Ошибка загрузки данных';
                loadingIndicator.style.background = 'rgba(255, 200, 200, 0.9)';
            }
        }
    }
    
    // Функция для обновления состояния свернутых групп
    function updateGroupsCollapsedState() {
        const sidebarGroups = ['ok-group', 'warning-group', 'critical-group', 'no-group', 'leak-group'];
        
        sidebarGroups.forEach(groupId => {
            const header = document.querySelector(`#${groupId} h3`);
            const itemsContainer = header?.nextElementSibling;
            
            if (header && itemsContainer) {
                const isEmpty = itemsContainer.children.length === 0;
                
                if (isEmpty && groupId !== 'leak-group') {
                    // Для пустых групп (кроме группы протечек)
                    header.classList.add('collapsed');
                    itemsContainer.classList.add('collapsed');
                    itemsContainer.style.display = 'none';
                } else if (!isEmpty) {
                    // Если в группе есть элементы, разворачиваем её
                    header.classList.remove('collapsed');
                    itemsContainer.classList.remove('collapsed');
                    itemsContainer.style.display = 'block';
                }
                
                // Особая обработка для группы протечек
                if (groupId === 'leak-group') {
                    // Группа протечек всегда видима, даже если пуста
                    header.classList.remove('collapsed');
                    itemsContainer.classList.remove('collapsed');
                    itemsContainer.style.display = 'block';
                }
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

    // Загрузка данных при инициализации
    await loadData();
});
   