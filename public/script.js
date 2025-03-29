document.addEventListener('DOMContentLoaded', async function () {
    // Define backend API URL
    const backendURL = window.BACKEND_URL || "/api/metrics"; 
    // Получаем базовый URL для подключения веб-сокетов
    const socketURL = window.location.origin;
    
    // Инициализируем подключение к веб-сокетам
    const socket = io(socketURL);
    
    // Индикатор состояния соединения
    const connectionIndicator = document.createElement('div');
    connectionIndicator.id = 'connection-indicator';
    connectionIndicator.classList.add('connection-indicator');
    connectionIndicator.innerHTML = '<span>⚪</span> Соединение...';
    document.body.appendChild(connectionIndicator);

    // Initialize the map
    const map = L.map('map', {
        attributionControl: false  // Отключаем стандартный контрол атрибуции
    }).setView([41.347560, 69.201332], 10); // Default: Berlin

    // Добавляем собственный контрол атрибуции только с OpenStreetMap
    L.control.attribution({
        prefix: false  // Это убирает "Leaflet"
    }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors').addTo(map);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',  // Пустая атрибуция для слоя, так как мы уже добавили её вручную выше
    }).addTo(map);

    // Create a group to hold markers
    const markers = L.featureGroup();
    const markersById = {}; // Объект для хранения маркеров по ID здания

    // Обработчик обновления данных
    function updateMapData(data) {
        // Очищаем существующие группы статусов в боковой панели
        document.querySelector('#ok-group .status-items').innerHTML = '';
        document.querySelector('#warning-group .status-items').innerHTML = '';
        document.querySelector('#critical-group .status-items').innerHTML = '';
        document.querySelector('#no-group .status-items').innerHTML = '';
        
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
            const isHotWaterOK = item.hot_water_in_pressure >= 1 &&item.hot_water_out_pressure >= 1;
            const hotWaterImage = isHotWaterOK
                ? 'data/images/Water_Red.png'
                : 'data/images/Water_No_Red.png';

            // Determine marker color based on status
            const status = (isElectricityOK && isColdWaterOK && isHotWaterOK) ? 'ok' :
                           (isElectricityOK || isColdWaterOK) ? 'warning' : item.controller_id ? 'critical' : 'no';
            const circleOptions = {
                radius: 8,
                weight: 1,
                color: 'white',
                fillColor: status === 'ok' ? 'green' : status === 'warning' ? 'orange' : status === 'critical' ? 'red': 'gray',
                fillOpacity: 1,
            };
        
            let popupContent;
            // Create a popup with building details
            if(status === 'no'){
                popupContent = `
                <div>
                    <strong>${item.building_name}</strong><br></br>
                    no controller data
                </div>`;
            } else {
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
                    </table>
                </div>
                `;
            }

            // Проверяем, существует ли маркер для этого здания
            if (markersById[item.building_id]) {
                // Обновляем существующий маркер
                const existingMarker = markersById[item.building_id];
                existingMarker.setStyle(circleOptions);
                existingMarker.getPopup().setContent(popupContent);
            } else {
                // Создаем новый маркер
                const marker = L.circleMarker([item.latitude, item.longitude], circleOptions);
                marker.bindPopup(popupContent);
                markers.addLayer(marker);
                markersById[item.building_id] = marker;
            }

            // Update the sidebar with building information
            const sidebarGroup = document.querySelector(`#${status}-group .status-items`);
            if (!sidebarGroup) {
                console.warn("Sidebar group not found for status:", status);
                return;
            }
            
            const sidebarItem = document.createElement("div");
            sidebarItem.classList.add("sidebar-item");
            sidebarItem.innerHTML = item.controller_id ? `
                <img src="${electricityImage}" alt="Electricity_Status" style="width: 15px;">
                ${isColdWaterOK ? `<img src="${coldWaterImage}" alt="Cold_Water_Status" style="width: 15px;">` : ''}
                ${isHotWaterOK ? `<img src="${hotWaterImage}" alt="Hot_Water_Status" style="width: 15px;">` : ''}
                ${item.building_name}
            ` : `
                <img src="data/images/no_controller.png" alt="No_Controller" style="width: 15px;">
                ${item.building_name}
            `;

            sidebarItem.addEventListener("click", function () {
                map.setView([item.latitude, item.longitude], 14);
                markersById[item.building_id].openPopup();
            });
            
            sidebarGroup.appendChild(sidebarItem);
        });

        // Add markers to the map if not already added
        if (!map.hasLayer(markers)) {
            markers.addTo(map);
            // Масштабирование карты, чтобы все маркеры были видны (только при первой загрузке)
            if (markers.getBounds().isValid()) {
                map.fitBounds(markers.getBounds());
            }
        }
    }

    // Обработчики событий веб-сокетов
    socket.on('connect', function() {
        console.log('Подключено к серверу через Socket.IO');
        connectionIndicator.innerHTML = '<span style="color: green;">⚫</span> Соединение установлено';
        connectionIndicator.classList.add('connected');
        
        // Через 3 секунды скрываем индикатор
        setTimeout(() => {
            connectionIndicator.style.opacity = '0';
        }, 3000);
    });

    socket.on('disconnect', function() {
        console.log('Отключен от сервера');
        connectionIndicator.innerHTML = '<span style="color: red;">⚫</span> Соединение потеряно';
        connectionIndicator.style.opacity = '1';
        connectionIndicator.classList.remove('connected');
    });

    // Обработчик статуса соединения с базой данных
    socket.on('connectionStatus', function(statusData) {
        console.log('Получен статус соединения:', statusData);
        
        switch(statusData.status) {
            case 'online':
                connectionIndicator.innerHTML = '<span style="color: green;">⚫</span> ' + statusData.message;
                connectionIndicator.classList.add('connected');
                
                // Через 3 секунды скрываем индикатор для онлайн-статуса
                setTimeout(() => {
                    connectionIndicator.style.opacity = '0';
                }, 3000);
                break;
                
            case 'database_offline':
                connectionIndicator.innerHTML = '<span style="color: orange;">⚫</span> ' + statusData.message;
                connectionIndicator.style.opacity = '1';
                connectionIndicator.classList.remove('connected');
                connectionIndicator.classList.add('warning');
                break;
                
            case 'error':
                connectionIndicator.innerHTML = '<span style="color: red;">⚫</span> ' + statusData.message;
                connectionIndicator.style.opacity = '1';
                connectionIndicator.classList.remove('connected');
                connectionIndicator.classList.add('error');
                break;
        }
    });

    socket.on('initialData', function(data) {
        console.log('Получены начальные данные');
        updateMapData(data);
    });

    socket.on('metricsUpdate', function(data) {
        console.log('Получено обновление метрик');
        updateMapData(data);
    });

    // Резервный вариант: если веб-сокеты не работают, загружаем данные через REST API
    socket.on('connect_error', async function() {
        console.log('Ошибка подключения к Socket.IO, используем REST API');
        connectionIndicator.innerHTML = '<span style="color: orange;">⚫</span> Используем резервный режим';
        connectionIndicator.style.opacity = '1';
        
        try {
            const response = await fetch(backendURL);
            const data = await response.json();
            updateMapData(data);
            
            // Настраиваем периодическое обновление через REST API
            setInterval(async () => {
                try {
                    const response = await fetch(backendURL);
                    const data = await response.json();
                    updateMapData(data);
                } catch (error) {
                    console.error("Ошибка при получении данных через REST API:", error);
                }
            }, 30000); // Обновление каждые 30 секунд
        } catch (error) {
            console.error("Ошибка загрузки данных через REST API:", error);
            connectionIndicator.innerHTML = '<span style="color: red;">⚫</span> Ошибка загрузки данных';
        }
    });
});
   