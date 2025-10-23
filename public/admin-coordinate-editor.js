/**
 * Универсальный компонент для редактирования координат объектов инфраструктуры
 * 
 * Поддерживает:
 * - Ручной ввод координат
 * - Выбор на карте кликом
 * - Валидацию координат
 * - Обновление через API
 * 
 * @version 1.0.0
 */

class CoordinateEditor {
    /**
     * Конструктор редактора координат
     * 
     * @param {Object} options - Параметры инициализации
     * @param {string} options.objectType - Тип объекта (transformers, water-sources, heat-sources)
     * @param {number} options.objectId - ID объекта
     * @param {number} options.latitude - Текущая широта
     * @param {number} options.longitude - Текущая долгота
     * @param {string} options.objectName - Название объекта (для отображения)
     * @param {Function} options.onSave - Callback после успешного сохранения
     */
    constructor(options) {
        this.objectType = options.objectType;
        this.objectId = options.objectId;
        this.currentLat = options.latitude;
        this.currentLng = options.longitude;
        this.objectName = options.objectName;
        this.onSave = options.onSave;
        this.map = null;
        this.marker = null;
    }

    /**
     * Показать modal окно редактирования
     */
    show() {
        // Создаем modal HTML
        const modalHTML = this.createModalHTML();
        
        // Добавляем в DOM
        const modalContainer = document.createElement('div');
        modalContainer.id = 'coordinate-editor-modal';
        modalContainer.innerHTML = modalHTML;
        document.body.appendChild(modalContainer);

        // Устанавливаем текущие значения
        document.getElementById('edit-latitude').value = this.currentLat || '';
        document.getElementById('edit-longitude').value = this.currentLng || '';

        // Добавляем обработчики событий
        this.attachEventHandlers();
    }

    /**
     * Создание HTML для modal окна
     */
    createModalHTML() {
        return `
            <div class="modal-overlay" id="coord-modal-overlay">
                <div class="modal-content coord-modal">
                    <div class="modal-header">
                        <h3>📍 Редактирование координат</h3>
                        <button class="close-btn" id="close-coord-modal">✕</button>
                    </div>
                    
                    <div class="modal-body">
                        <!-- Информация об объекте -->
                        <div class="info-section">
                            <strong>Объект:</strong> ${this.objectName || 'N/A'}
                        </div>
                        
                        <!-- Форма ввода координат -->
                        <form id="coordinate-edit-form">
                            <div class="form-group">
                                <label for="edit-latitude">Широта (Latitude):</label>
                                <input type="number" 
                                       id="edit-latitude" 
                                       step="0.000001" 
                                       min="-90" 
                                       max="90" 
                                       placeholder="Например: 55.751244"
                                       required>
                                <small>Диапазон: от -90 до 90</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="edit-longitude">Долгота (Longitude):</label>
                                <input type="number" 
                                       id="edit-longitude" 
                                       step="0.000001" 
                                       min="-180" 
                                       max="180" 
                                       placeholder="Например: 37.618423"
                                       required>
                                <small>Диапазон: от -180 до 180</small>
                            </div>
                            
                            <!-- Кнопка показа карты -->
                            <div class="map-toggle">
                                <button type="button" id="toggle-map-picker" class="btn-secondary">
                                    📍 Выбрать на карте
                                </button>
                            </div>
                            
                            <!-- Мини-карта (скрыта по умолчанию) -->
                            <div id="mini-map-container" style="display: none;">
                                <div id="coordinate-mini-map" style="height: 300px; margin: 15px 0; border-radius: 4px;"></div>
                                <small style="color: #666;">
                                    💡 Кликните на карте или перетащите маркер для выбора координат
                                </small>
                            </div>
                            
                            <!-- Кнопки действий -->
                            <div class="form-actions">
                                <button type="submit" class="btn-save">💾 Сохранить</button>
                                <button type="button" class="btn-cancel" id="cancel-coord-edit">✕ Отмена</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Подключение обработчиков событий
     */
    attachEventHandlers() {
        // Закрытие modal
        document.getElementById('close-coord-modal').addEventListener('click', () => this.close());
        document.getElementById('cancel-coord-edit').addEventListener('click', () => this.close());
        document.getElementById('coord-modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'coord-modal-overlay') {
                this.close();
            }
        });

        // Показ/скрытие карты
        document.getElementById('toggle-map-picker').addEventListener('click', () => this.toggleMap());

        // Сохранение
        document.getElementById('coordinate-edit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.save();
        });

        // Синхронизация ввода с картой
        document.getElementById('edit-latitude').addEventListener('input', (e) => {
            if (this.map && this.marker) {
                const lat = parseFloat(e.target.value);
                const lng = parseFloat(document.getElementById('edit-longitude').value);
                if (!isNaN(lat) && !isNaN(lng)) {
                    this.marker.setLatLng([lat, lng]);
                    this.map.setView([lat, lng]);
                }
            }
        });

        document.getElementById('edit-longitude').addEventListener('input', (e) => {
            if (this.map && this.marker) {
                const lat = parseFloat(document.getElementById('edit-latitude').value);
                const lng = parseFloat(e.target.value);
                if (!isNaN(lat) && !isNaN(lng)) {
                    this.marker.setLatLng([lat, lng]);
                    this.map.setView([lat, lng]);
                }
            }
        });
    }

    /**
     * Показать/скрыть мини-карту
     */
    toggleMap() {
        const container = document.getElementById('mini-map-container');
        const button = document.getElementById('toggle-map-picker');
        
        if (container.style.display === 'none') {
            container.style.display = 'block';
            button.textContent = '📍 Скрыть карту';
            
            // Инициализируем карту при первом показе
            if (!this.map) {
                this.initMiniMap();
            }
        } else {
            container.style.display = 'none';
            button.textContent = '📍 Выбрать на карте';
        }
    }

    /**
     * Инициализация Leaflet мини-карты
     */
    initMiniMap() {
        // Получаем текущие координаты из полей ввода или используем переданные
        const currentLat = parseFloat(document.getElementById('edit-latitude').value) || this.currentLat || 55.751244;
        const currentLng = parseFloat(document.getElementById('edit-longitude').value) || this.currentLng || 37.618423;
        
        // Создаем карту с правильными координатами
        this.map = L.map('coordinate-mini-map').setView(
            [currentLat, currentLng],
            13
        );

        // Добавляем базовый слой
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Создаем кастомную иконку для маркера трансформатора
        const transformerIcon = L.divIcon({
            className: 'transformer-marker-icon',
            html: '<div class="transformer-marker"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        });

        // Создаем draggable маркер с правильными координатами и кастомной иконкой
        this.marker = L.marker(
            [currentLat, currentLng],
            { 
                draggable: true,
                icon: transformerIcon
            }
        ).addTo(this.map);

        // Обработчик перетаскивания маркера
        this.marker.on('dragend', (e) => {
            const latlng = e.target.getLatLng();
            this.updateCoordinateInputs(latlng.lat, latlng.lng);
        });

        // Обработчик клика на карте
        this.map.on('click', (e) => {
            const latlng = e.latlng;
            this.marker.setLatLng(latlng);
            this.updateCoordinateInputs(latlng.lat, latlng.lng);
        });
    }

    /**
     * Обновление полей ввода координат
     */
    updateCoordinateInputs(lat, lng) {
        document.getElementById('edit-latitude').value = lat.toFixed(6);
        document.getElementById('edit-longitude').value = lng.toFixed(6);
    }

    /**
     * Валидация координат
     */
    validateCoordinates(lat, lng) {
        // Проверка что это числа
        if (isNaN(lat) || isNaN(lng)) {
            return { valid: false, error: 'Координаты должны быть числами' };
        }

        // Проверка диапазона широты
        if (lat < -90 || lat > 90) {
            return { valid: false, error: 'Широта должна быть в диапазоне [-90, 90]' };
        }

        // Проверка диапазона долготы
        if (lng < -180 || lng > 180) {
            return { valid: false, error: 'Долгота должна быть в диапазоне [-180, 180]' };
        }

        return { valid: true };
    }

    /**
     * Сохранение координат
     */
    async save() {
        try {
            // Получаем значения из полей
            const lat = parseFloat(document.getElementById('edit-latitude').value);
            const lng = parseFloat(document.getElementById('edit-longitude').value);

            // Валидация
            const validation = this.validateCoordinates(lat, lng);
            if (!validation.valid) {
                showToast(validation.error, 'error');
                return;
            }

            // Определяем API endpoint
            const apiEndpoint = this.getAPIEndpoint();

            // Формируем данные для отправки
            const updateData = {
                latitude: lat,
                longitude: lng
            };

            // Отправляем запрос
            const response = await fetch(`${apiEndpoint}/${this.objectId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(updateData)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || result.message || 'Ошибка при обновлении');
            }

            // Показываем успех
            showToast('✅ Координаты успешно обновлены!', 'success');

            // Закрываем modal
            this.close();

            // Вызываем callback
            if (this.onSave) {
                this.onSave(result.data);
            }

        } catch (error) {
            console.error('Ошибка при сохранении координат:', error);
            showToast(`Ошибка: ${error.message}`, 'error');
        }
    }

    /**
     * Получение API endpoint по типу объекта
     */
    getAPIEndpoint() {
        const endpoints = {
            'transformers': '/api/transformers',
            'water-sources': '/api/cold-water-sources',
            'heat-sources': '/api/heat-sources',
            'infrastructure-lines': '/api/infrastructure-lines'
        };

        return endpoints[this.objectType] || '/api/' + this.objectType;
    }

    /**
     * Закрытие modal
     */
    close() {
        const modal = document.getElementById('coordinate-editor-modal');
        if (modal) {
            modal.remove();
        }

        // Очистка карты
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }
}

// ===============================================
// ФУНКЦИЯ ДЛЯ БЫСТРОГО ОТКРЫТИЯ РЕДАКТОРА
// ===============================================

/**
 * Открыть редактор координат для объекта
 * 
 * Поддерживает два варианта вызова:
 * 1. openCoordinateEditor(objectType, objectId, callback) - для форм с inline callback
 * 2. openCoordinateEditor(objectType, objectId, latitude, longitude, objectName, onSave) - полный вызов
 * 
 * @param {string} objectType - Тип объекта
 * @param {number} objectId - ID объекта
 * @param {number|Function} latitudeOrCallback - Текущая широта ИЛИ callback функция
 * @param {number} longitude - Текущая долгота (опционально)
 * @param {string} objectName - Название объекта (опционально)
 * @param {Function} onSave - Callback после сохранения (опционально)
 */
function openCoordinateEditor(objectType, objectId, latitudeOrCallback, longitude, objectName, onSave) {
    // Определяем, какой вариант вызова используется
    let actualLatitude, actualLongitude, actualObjectName, actualOnSave;
    
    if (typeof latitudeOrCallback === 'function') {
        // Вариант 1: openCoordinateEditor(objectType, objectId, callback)
        // Используется в формах добавления/редактирования в admin.html
        // Пытаемся получить координаты из полей формы
        const latField = document.getElementById(`${objectType}-latitude`);
        const lngField = document.getElementById(`${objectType}-longitude`);
        
        actualLatitude = latField ? parseFloat(latField.value) || null : null;
        actualLongitude = lngField ? parseFloat(lngField.value) || null : null;
        actualObjectName = null;
        actualOnSave = latitudeOrCallback; // Callback передан как 3й параметр
    } else {
        // Вариант 2: openCoordinateEditor(objectType, objectId, latitude, longitude, objectName, onSave)
        // Полный вызов со всеми параметрами
        actualLatitude = latitudeOrCallback;
        actualLongitude = longitude;
        actualObjectName = objectName;
        actualOnSave = onSave;
    }
    
    const editor = new CoordinateEditor({
        objectType,
        objectId,
        latitude: actualLatitude,
        longitude: actualLongitude,
        objectName: actualObjectName,
        onSave: actualOnSave
    });
    
    editor.show();
}

// ===============================================
// CSS СТИЛИ ДЛЯ MODAL
// ===============================================

// Добавляем стили в head, если их еще нет
if (!document.getElementById('coordinate-editor-styles')) {
    const style = document.createElement('style');
    style.id = 'coordinate-editor-styles';
    style.textContent = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }

        .coord-modal {
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            border-bottom: 1px solid #ddd;
        }

        .modal-header h3 {
            margin: 0;
            color: #333;
        }

        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #999;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .close-btn:hover {
            color: #333;
        }

        .modal-body {
            padding: 20px;
        }

        .info-section {
            background: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #333;
        }

        .form-group input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
        }

        .form-group input:focus {
            outline: none;
            border-color: #4CAF50;
            box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
        }

        .form-group small {
            display: block;
            margin-top: 3px;
            color: #666;
            font-size: 12px;
        }

        .map-toggle {
            margin: 15px 0;
            text-align: center;
        }

        .btn-secondary {
            background: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }

        .btn-secondary:hover {
            background: #1976D2;
        }

        .form-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
        }

        .btn-save {
            flex: 1;
            background: #4CAF50;
            color: white;
            border: none;
            padding: 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
        }

        .btn-save:hover {
            background: #45a049;
        }

        .btn-cancel {
            background: #f44336;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }

        .btn-cancel:hover {
            background: #da190b;
        }

        #coordinate-mini-map {
            border: 1px solid #ddd;
        }

        /* Leaflet popup fix */
        .leaflet-container {
            font-family: Arial, sans-serif;
        }
    `;
    document.head.appendChild(style);
}

