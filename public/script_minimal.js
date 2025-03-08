// Абсолютно минимальный статичный скрипт
document.addEventListener('DOMContentLoaded', function() {
    console.log('Минимальный статичный скрипт загружен:', new Date().toISOString());
    
    try {
        // Инициализация карты
        const map = L.map('map').setView([55.75, 37.61], 10); // Москва
        
        // Добавляем слой OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        
        // Статичные тестовые данные (никаких запросов к серверу)
        const testBuildings = [
            { id: 1, name: "Бизнес-центр Alpha", lat: 55.75, lng: 37.61, status: 'ok' },
            { id: 2, name: "Жилой комплекс Beta", lat: 55.73, lng: 37.65, status: 'warning' },
            { id: 3, name: "Торговый центр Gamma", lat: 55.78, lng: 37.58, status: 'critical' },
            { id: 4, name: "Офисный центр Delta", lat: 55.76, lng: 37.55, status: 'no' }
        ];
        
        // Добавляем тестовые маркеры
        testBuildings.forEach(building => {
            // Цвет маркера
            const markerColor = building.status === 'ok' ? 'green' : 
                              building.status === 'warning' ? 'orange' : 
                              building.status === 'critical' ? 'red' : 'gray';
            
            // Создаем маркер
            const marker = L.circleMarker([building.lat, building.lng], {
                radius: 8,
                weight: 1,
                color: 'white',
                fillColor: markerColor,
                fillOpacity: 1
            });
            
            // Привязываем всплывающее окно к маркеру
            marker.bindPopup(`<strong>${building.name}</strong><br>Статус: ${building.status}`)
                .addTo(map);
            
            // Добавляем информацию в боковую панель
            const sidebarGroup = document.querySelector(`#${building.status}-group .status-items`);
            if (sidebarGroup) {
                const sidebarItem = document.createElement("div");
                sidebarItem.classList.add("sidebar-item");
                sidebarItem.textContent = building.name;
                
                // При клике на элемент в боковой панели центрируем карту на маркере
                sidebarItem.addEventListener("click", function () {
                    map.setView([building.lat, building.lng], 14);
                    marker.openPopup();
                });
                
                sidebarGroup.appendChild(sidebarItem);
            }
        });
        
        // Добавляем кнопку возврата на главную страницу
        const homeButton = document.createElement('button');
        homeButton.textContent = 'Вернуться на главную';
        homeButton.style.position = 'absolute';
        homeButton.style.top = '10px';
        homeButton.style.right = '10px';
        homeButton.style.zIndex = '1000';
        homeButton.style.background = 'white';
        homeButton.style.border = '1px solid #ccc';
        homeButton.style.borderRadius = '3px';
        homeButton.style.padding = '5px 10px';
        homeButton.style.cursor = 'pointer';
        
        homeButton.addEventListener('click', function() {
            // Просто перенаправляем на индексную страницу
            window.location.href = '/';
        });
        
        document.querySelector('.content').appendChild(homeButton);
        
        // Добавляем статичный текст времени последнего обновления
        const timestamp = document.createElement('div');
        timestamp.textContent = 'СТАТИЧНЫЕ ДАННЫЕ (НЕТ АВТООБНОВЛЕНИЯ)';
        timestamp.style.position = 'absolute';
        timestamp.style.bottom = '10px';
        timestamp.style.right = '10px';
        timestamp.style.background = 'white';
        timestamp.style.padding = '5px';
        timestamp.style.fontSize = '12px';
        timestamp.style.zIndex = '1000';
        document.querySelector('.content').appendChild(timestamp);
        
    } catch (error) {
        // Отображаем ошибку на странице, если что-то пошло не так
        console.error("Ошибка:", error);
        const errorDiv = document.createElement('div');
        errorDiv.textContent = 'Ошибка: ' + error.message;
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.style.background = 'white';
        errorDiv.style.position = 'absolute';
        errorDiv.style.top = '50%';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translate(-50%, -50%)';
        errorDiv.style.zIndex = '1000';
        document.body.appendChild(errorDiv);
    }
}); 