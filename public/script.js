document.addEventListener('DOMContentLoaded', async function () {
    // Define backend API URL (can be modified externally)
    const backendURL = window.BACKEND_URL || "https://172.17.0.1/api/metrics"; 
 //   const backendURL = window.BACKEND_URL || "http://localhost:3000/api/metrics"; 
    // Initialize the map
    const map = L.map('map').setView([52.52, 13.405], 10); // Default: Berlin

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Create a group to hold markers
    const markers = L.featureGroup();

    try {
        // Fetch data from the backend
        const response = await fetch(backendURL);
        const data = await response.json();

        data.forEach((item) => {
            if (!item.latitude || !item.longitude) {
                console.warn("Skipping invalid data:", item);
                return;
            }

        
            // Determine electricity status

            //Determine phase 1 status
            const isPhase1Ok = item.electricity_ph1 > 210 && item.electricity_ph1 < 230;
            const electricityImage1 = isPhase1Ok
                ? 'data/images/Electricity_Green.png'
                : 'data/images/Electricity_Red.png';
            
            //Determine phase 2 status
            const isPhase2Ok = item.electricity_ph2 > 210 && item.electricity_ph2 < 230;
            const electricityImage2 = isPhase2Ok
                ? 'data/images/Electricity_Green.png'
                : 'data/images/Electricity_Red.png';
            
            //Determine phase 3 status
            const isPhase3Ok = item.electricity_ph3 > 210 && item.electricity_ph3 < 230;
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

            const isHotWaterOK = item.hot_water_in_pressure > 1 &&item.hot_water_out_pressure > 1;
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
                fillColor: status === 'ok' ? 'green' : status === 'warning' ? 'orange' :status === 'critical' ? 'red': 'gray',
                fillOpacity: 1,
            };
        

            // Create a Leaflet marker
            const marker = L.circleMarker([item.latitude, item.longitude], circleOptions);
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
        </table>
    </div>
`;
            };

//----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------



//----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

            marker.bindPopup(popupContent).addTo(markers);
            markers.addLayer(marker);

            // Update the sidebar with building information
            const sidebarGroup = document.querySelector(`#${status}-group .status-items`);
            if (!sidebarGroup) {
                console.warn("Sidebar group not found for status:", status);
                return;
            }
            if (sidebarGroup) {
                console.log("Sidebar group found:", sidebarGroup);
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
                console.log("Appending to sidebar:", sidebarItem.innerHTML);

                sidebarItem.addEventListener("click", function () {
                    map.setView([item.latitude, item.longitude], 14);
                    marker.openPopup();
                });
                console.log("Adding to sidebar:", item.building_name, "Status:", status);
                sidebarGroup.appendChild(sidebarItem);
            } else {
                console.warn("Sidebar group not found for status:", status);
            }
            
        });

        // Add markers to the map
        markers.addTo(map);
        map.fitBounds(markers.getBounds());

    } catch (err) {
        console.error("Error loading data:", err);
        
        // Создаем сообщение об ошибке вместо перезагрузки страницы
        const errorDiv = document.createElement('div');
        errorDiv.style.position = 'absolute';
        errorDiv.style.top = '50%';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translate(-50%, -50%)';
        errorDiv.style.backgroundColor = 'white';
        errorDiv.style.padding = '20px';
        errorDiv.style.border = '1px solid red';
        errorDiv.style.borderRadius = '5px';
        errorDiv.style.zIndex = '1000';
        errorDiv.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
        
        errorDiv.innerHTML = `
            <h3 style="color: red; margin-top: 0;">Ошибка загрузки данных</h3>
            <p>${err.message}</p>
            <p>Пожалуйста, проверьте соединение с сервером и обновите страницу.</p>
            <button id="retry-button" style="padding: 8px 15px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 10px;">Повторить загрузку</button>
        `;
        
        document.body.appendChild(errorDiv);
        
        // Добавляем обработчик для кнопки повторной загрузки
        document.getElementById('retry-button').addEventListener('click', function() {
            // Удаляем сообщение об ошибке
            errorDiv.remove();
            
            // Повторяем загрузку данных без перезагрузки страницы
            fetch(backendURL)
                .then(response => response.json())
                .then(data => {
                    // Если данные успешно загружены, обновляем страницу
                    window.location.reload();
                })
                .catch(error => {
                    // Если ошибка повторяется, показываем сообщение снова
                    console.error("Error reloading data:", error);
                    document.body.appendChild(errorDiv);
                });
        });
    }
});
