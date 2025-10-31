/**
 * Компонент для создания и редактирования линий инфраструктуры
 * с поддержкой нескольких изломов и ответвлений
 * 
 * Функции:
 * - Создание основного пути (main_path) с несколькими точками
 * - Добавление ответвлений (branches)
 * - Визуализация на Leaflet мини-карте
 * - Валидация координат
 * - Сохранение через API
 * 
 * @version 1.0.0
 */

class InfrastructureLineEditor {
    /**
     * Конструктор редактора линий инфраструктуры
     * 
     * @param {Object} options - Параметры инициализации
     * @param {string} options.lineType - Тип линии (cold_water, hot_water, electricity)
     * @param {number} options.lineId - ID линии (null для новой)
     * @param {Object} options.existingData - Существующие данные линии (для редактирования)
     * @param {Function} options.onSave - Callback после успешного сохранения
     * @param {string} options.apiEndpoint - Кастомный API endpoint (default: '/api/infrastructure-lines')
     * @param {Object} options.additionalFields - Дополнительные поля для отображения в форме
     */
    constructor(options) {
        this.lineType = options.lineType;
        this.lineId = options.lineId || null;
        this.existingData = options.existingData || null;
        this.onSave = options.onSave;
        this.apiEndpoint = options.apiEndpoint || '/api/infrastructure-lines';
        this.additionalFields = options.additionalFields || {};
        
        // Точки основного пути (парсим если строка JSON)
        let mainPath = this.existingData?.main_path || [];
        if (typeof mainPath === 'string') {
            try {
                mainPath = JSON.parse(mainPath);
            } catch (e) {
                console.error('Ошибка парсинга main_path:', e);
                mainPath = [];
            }
        }
        this.mainPath = Array.isArray(mainPath) ? mainPath : [];
        
        // Ответвления (парсим если строка JSON)
        let branches = this.existingData?.branches || [];
        if (typeof branches === 'string') {
            try {
                branches = JSON.parse(branches);
            } catch (e) {
                console.error('Ошибка парсинга branches:', e);
                branches = [];
            }
        }
        this.branches = Array.isArray(branches) ? branches : [];
        
        console.log('🚀 InfrastructureLineEditor инициализирован:', {
            lineId: this.lineId,
            mainPathPoints: this.mainPath.length,
            branchesCount: this.branches.length
        });
        
        // Leaflet объекты
        this.map = null;
        this.mainPathPolyline = null;
        this.branchPolylines = [];
        this.markers = [];
        
        // Режим редактирования
        this.currentMode = 'main'; // 'main' или 'branch'
        this.currentBranchIndex = null;
    }

    /**
     * Показать modal окно редактора
     */
    show() {
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем наличие DOMPurify перед использованием
        if (typeof DOMPurify === 'undefined') {
            console.error('❌ DOMPurify не загружен! Безопасность не гарантирована.');
            
            // Показываем ошибку пользователю
            if (typeof showToast === 'function') {
                showToast('Ошибка загрузки системы безопасности. Перезагрузите страницу.', 'error');
            } else {
                alert('Ошибка загрузки системы безопасности. Перезагрузите страницу.');
            }
            
            return; // НЕ продолжаем выполнение без DOMPurify
        }
        
        // ИСПРАВЛЕНИЕ: Удаляем все существующие модальные окна перед созданием нового
        // чтобы избежать дублирования элементов с одинаковыми ID
        const existingModals = document.querySelectorAll('#infrastructure-line-editor-modal');
        existingModals.forEach(modal => {
            console.log('⚠️ Удаляем существующее модальное окно редактора линий');
            modal.remove();
        });
        
        // ИСПРАВЛЕНИЕ XSS: Используем ТОЛЬКО DOMPurify для безопасной вставки HTML
        const modalHTML = this.createModalHTML();

        const modalContainer = document.createElement('div');
        modalContainer.id = 'infrastructure-line-editor-modal';

        // Используем ТОЛЬКО DOMPurify, без небезопасного fallback
        modalContainer.innerHTML = DOMPurify.sanitize(modalHTML, {
            ALLOWED_TAGS: ['div', 'span', 'h3', 'button', 'form', 'input', 'textarea', 'select', 'option', 'label', 'strong', 'p', 'br'],
            ALLOWED_ATTR: ['class', 'id', 'type', 'value', 'placeholder', 'required', 'rows', 'min', 'max', 'step', 'style', 'selected'],
            ALLOW_DATA_ATTR: false
        });

        document.body.appendChild(modalContainer);

        // Инициализируем обработчики после добавления в DOM
        setTimeout(() => {
            this.attachEventHandlers();
            this.initializeMap();
            this.renderExistingLine();
        }, 100);
    }

    /**
     * Создание HTML для modal окна
     */
    createModalHTML() {
        const lineTypeNames = {
            'ХВС': 'ХВС (холодное водоснабжение)',
            'ГВС': 'ГВС (горячее водоснабжение)',
            'electricity': 'Электроснабжение',
            'cold_water': 'ХВС (холодное водоснабжение)',
            'hot_water': 'ГВС (горячее водоснабжение)'
        };

        const lineColors = {
            'ХВС': '#0066FF',
            'ГВС': '#FF0000',
            'electricity': '#FFA500',
            'cold_water': '#0066FF',
            'hot_water': '#FF0000'
        };

        return `
            <div class="modal-overlay" id="line-editor-overlay">
                <div class="modal-content line-editor-modal">
                    <div class="modal-header">
                        <h3>🗺️ ${this.lineId ? 'Редактирование' : 'Создание'} линии инфраструктуры</h3>
                        <button class="close-btn" id="close-line-editor">✕</button>
                    </div>
                    
                    <div class="modal-body">
                        <!-- Информация о типе линии -->
                        <div class="info-section">
                            <strong>Тип линии:</strong> 
                            <span style="color: ${lineColors[this.lineType]}">
                                ${lineTypeNames[this.lineType]}
                            </span>
                        </div>
                        
                        <!-- Форма основных параметров -->
                        <form id="line-info-form">
                            <div class="form-group">
                                <label for="line-name">Название линии *</label>
                                <input type="text" 
                                       id="line-name" 
                                       value="${this.existingData?.name || ''}"
                                       placeholder="Например: Линия ХВС Центральная"
                                       required>
                            </div>
                            
                            <div class="form-group">
                                <label for="line-description">Описание</label>
                                <textarea id="line-description" 
                                          rows="2"
                                          placeholder="Описание линии">${this.existingData?.description || ''}</textarea>
                            </div>

                            ${this.lineType === 'electricity' ? `
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="line-voltage">Напряжение (кВ) *</label>
                                        <input type="number" 
                                               id="line-voltage" 
                                               value="${this.existingData?.voltage_kv || ''}"
                                               step="0.1"
                                               placeholder="10"
                                               required>
                                    </div>
                                    <div class="form-group">
                                        <label for="line-transformer">ID Трансформатора</label>
                                        <input type="number" 
                                               id="line-transformer" 
                                               value="${this.existingData?.transformer_id || ''}"
                                               placeholder="Опционально">
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="line-cable-type">Тип кабеля</label>
                                        <input type="text" 
                                               id="line-cable-type" 
                                               value="${this.existingData?.cable_type || ''}"
                                               placeholder="Например: АС-150">
                                    </div>
                                    <div class="form-group">
                                        <label for="line-commissioning-year">Год ввода в эксплуатацию</label>
                                        <input type="number" 
                                               id="line-commissioning-year" 
                                               value="${this.existingData?.commissioning_year || ''}"
                                               min="1900" 
                                               max="2100"
                                               placeholder="2020">
                                    </div>
                                </div>
                            ` : ''}
                            
                            ${(this.lineType === 'ХВС' || this.lineType === 'ГВС') ? `
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="line-diameter">Диаметр (мм) *</label>
                                        <input type="number" 
                                               id="line-diameter" 
                                               value="${this.existingData?.diameter_mm || ''}"
                                               placeholder="100"
                                               required>
                                    </div>
                                    <div class="form-group">
                                        <label for="line-material">Материал *</label>
                                        <select id="line-material" required>
                                            <option value="">Выберите материал</option>
                                            <option value="Сталь" ${this.existingData?.material === 'Сталь' ? 'selected' : ''}>Сталь</option>
                                            <option value="Полиэтилен" ${this.existingData?.material === 'Полиэтилен' ? 'selected' : ''}>Полиэтилен</option>
                                            <option value="Чугун" ${this.existingData?.material === 'Чугун' ? 'selected' : ''}>Чугун</option>
                                            <option value="Медь" ${this.existingData?.material === 'Медь' ? 'selected' : ''}>Медь</option>
                                            <option value="ПВХ" ${this.existingData?.material === 'ПВХ' ? 'selected' : ''}>ПВХ</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="line-pressure">Рабочее давление (бар) *</label>
                                        <input type="number" 
                                               id="line-pressure" 
                                               value="${this.existingData?.pressure_rating || ''}"
                                               step="0.1"
                                               placeholder="6.0"
                                               required>
                                    </div>
                                    <div class="form-group">
                                        <label for="line-status">Статус</label>
                                        <select id="line-status">
                                            <option value="active" ${this.existingData?.status === 'active' ? 'selected' : ''}>Активная</option>
                                            <option value="maintenance" ${this.existingData?.status === 'maintenance' ? 'selected' : ''}>На обслуживании</option>
                                            <option value="inactive" ${this.existingData?.status === 'inactive' ? 'selected' : ''}>Неактивная</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="line-installation-date">Дата установки</label>
                                        <input type="date" 
                                               id="line-installation-date" 
                                               value="${this.existingData?.installation_date ? this.existingData.installation_date.split('T')[0] : ''}">
                                    </div>
                                    <div class="form-group">
                                        <label for="line-maintenance-contact">Контакт для обслуживания</label>
                                        <input type="text" 
                                               id="line-maintenance-contact" 
                                               value="${this.existingData?.maintenance_contact || ''}"
                                               placeholder="Имя контактного лица">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="line-notes">Примечания</label>
                                    <textarea id="line-notes" 
                                              rows="2"
                                              placeholder="Дополнительные примечания">${this.existingData?.notes || ''}</textarea>
                                </div>
                            ` : ''}
                        </form>
                        
                        <!-- Режим редактирования -->
                        <div class="editing-mode">
                            <strong>Режим:</strong>
                            <div class="mode-buttons">
                                <button type="button" id="mode-main" class="mode-btn active">
                                    📍 Основной путь (<span id="main-path-count">0</span> точек)
                                </button>
                                <button type="button" id="mode-branch" class="mode-btn">
                                    🔀 Ответвления (<span id="branches-count">0</span>)
                                </button>
                            </div>
                        </div>
                        
                        <!-- Инструкции -->
                        <div class="instructions">
                            <div id="main-instructions" class="instruction-box">
                                💡 <strong>Основной путь:</strong> Кликайте на карте для добавления точек. 
                                Минимум 2 точки для линии.
                            </div>
                            <div id="branch-instructions" class="instruction-box" style="display: none;">
                                💡 <strong>Ответвления:</strong> Выберите точку на основном пути, 
                                затем кликайте для создания ответвления (минимум 2 точки).
                            </div>
                        </div>
                        
                        <!-- Мини-карта Leaflet -->
                        <div id="line-editor-map" style="height: 400px; margin: 15px 0; border-radius: 4px;"></div>
                        
                        <!-- Управление точками -->
                        <div class="points-management">
                            <button type="button" id="clear-last-point" class="btn-warning">
                                ↶ Удалить последнюю точку
                            </button>
                            <button type="button" id="clear-all-points" class="btn-danger">
                                🗑️ Очистить все
                            </button>
                        </div>
                        
                        <!-- Список ответвлений -->
                        <div id="branches-list" style="display: none; margin-top: 15px;">
                            <h4>Созданные ответвления:</h4>
                            <ul id="branches-items"></ul>
                        </div>
                        
                        <!-- Кнопки действий -->
                        <div class="form-actions">
                            <button type="button" id="save-line" class="btn-save">
                                💾 Сохранить линию
                            </button>
                            <button type="button" id="cancel-line-edit" class="btn-cancel">
                                ✕ Отмена
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Инициализация Leaflet карты
     */
    initializeMap() {
        const mapElement = document.getElementById('line-editor-map');
        if (!mapElement) {
            console.error('Map container not found');
            return;
        }

        // Центр карты - Ташкент
        const defaultCenter = [41.311, 69.240];
        
        // Создаем карту
        this.map = L.map('line-editor-map').setView(defaultCenter, 13);

        // Добавляем tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Обработчик кликов по карте
        this.map.on('click', (e) => this.handleMapClick(e));
    }

    /**
     * Обработчик клика по карте
     */
    handleMapClick(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        if (this.currentMode === 'main') {
            // Добавляем точку к основному пути
            this.addMainPathPoint(lat, lng);
        } else if (this.currentMode === 'branch') {
            // Добавляем точку к текущему ответвлению
            this.addBranchPoint(lat, lng);
        }
    }

    /**
     * Добавление точки к основному пути
     */
    addMainPathPoint(lat, lng) {
        // Добавляем точку в массив
        this.mainPath.push({ lat, lng });

        // Создаем маркер
        const marker = L.marker([lat, lng], {
            draggable: true,
            icon: L.divIcon({
                html: `<div style="background: #4CAF50; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${this.mainPath.length}</div>`,
                className: 'custom-marker',
                iconSize: [24, 24]
            })
        }).addTo(this.map);

        // Обработчик перетаскивания маркера
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            const index = this.markers.indexOf(marker);
            if (index !== -1 && this.mainPath[index]) {
                this.mainPath[index] = { lat: newPos.lat, lng: newPos.lng };
                this.redrawMainPath();
            }
        });

        this.markers.push(marker);

        // Перерисовываем линию
        this.redrawMainPath();

        // Обновляем счетчик
        document.getElementById('main-path-count').textContent = this.mainPath.length;
    }

    /**
     * Добавление точки к ответвлению
     */
    addBranchPoint(lat, lng) {
        if (this.currentBranchIndex === null) {
            // Создаем новое ответвление
            this.currentBranchIndex = this.branches.length;
            this.branches.push([{ lat, lng }]);
        } else {
            // Добавляем точку к существующему ответвлению
            this.branches[this.currentBranchIndex].push({ lat, lng });
        }

        // Перерисовываем ответвление
        this.redrawBranches();

        // Обновляем счетчик
        document.getElementById('branches-count').textContent = this.branches.length;
    }

    /**
     * Перерисовка основного пути
     */
    redrawMainPath() {
        // Удаляем старую polyline если есть
        if (this.mainPathPolyline) {
            this.map.removeLayer(this.mainPathPolyline);
        }

        // Если точек меньше 2, не рисуем линию
        if (this.mainPath.length < 2) {
            return;
        }

        // Создаем новую polyline
        const latlngs = this.mainPath.map(p => [p.lat, p.lng]);
        const color = this.getLineColor();

        this.mainPathPolyline = L.polyline(latlngs, {
            color: color,
            weight: 5,
            opacity: 0.8
        }).addTo(this.map);

        // Центрируем карту на линии
        const bounds = this.mainPathPolyline.getBounds();
        this.map.fitBounds(bounds, { padding: [50, 50] });
    }

    /**
     * Перерисовка всех ответвлений
     */
    redrawBranches() {
        // Удаляем старые ответвления
        this.branchPolylines.forEach(poly => {
            this.map.removeLayer(poly);
        });
        this.branchPolylines = [];

        // Рисуем каждое ответвление
        this.branches.forEach((branch, index) => {
            if (branch.length >= 2) {
                const latlngs = branch.map(p => [p.lat, p.lng]);
                const color = this.getLineColor();

                const branchLine = L.polyline(latlngs, {
                    color: color,
                    weight: 3,
                    opacity: 0.6,
                    dashArray: '5, 10' // Пунктирная линия для ответвлений
                }).addTo(this.map);

                this.branchPolylines.push(branchLine);
            }
        });
    }

    /**
     * Отрисовка существующей линии (при редактировании)
     */
    renderExistingLine() {
        if (!this.existingData) return;

        // ИСПРАВЛЕНИЕ: Отрисовываем основной путь без добавления точек заново
        // (точки уже загружены в this.mainPath при инициализации)
        if (this.mainPath.length > 0) {
            // Создаем маркеры для каждой точки
            this.mainPath.forEach((point, index) => {
                const marker = L.marker([point.lat, point.lng], {
                    draggable: true,
                    icon: L.divIcon({
                        html: `<div style="background: #4CAF50; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${index + 1}</div>`,
                        className: 'custom-marker',
                        iconSize: [24, 24]
                    })
                }).addTo(this.map);

                // Обработчик перетаскивания маркера
                marker.on('dragend', (e) => {
                    const newPos = e.target.getLatLng();
                    const markerIndex = this.markers.indexOf(marker);
                    if (markerIndex !== -1 && this.mainPath[markerIndex]) {
                        this.mainPath[markerIndex] = { lat: newPos.lat, lng: newPos.lng };
                        this.redrawMainPath();
                    }
                });

                this.markers.push(marker);
            });
            
            // Рисуем линию
            this.redrawMainPath();
            
            // Обновляем счетчик
            document.getElementById('main-path-count').textContent = this.mainPath.length;
        }

        // Отрисовываем ответвления
        if (this.branches.length > 0) {
            this.redrawBranches();
            document.getElementById('branches-count').textContent = this.branches.length;
        }
    }

    /**
     * Получение цвета линии в зависимости от типа
     */
    getLineColor() {
        const colors = {
            'ХВС': '#0066FF',
            'ГВС': '#FF0000',
            'electricity': '#FFA500',
            'cold_water': '#0066FF',
            'hot_water': '#FF0000'
        };
        return colors[this.lineType] || '#999999';
    }

    /**
     * Прикрепление обработчиков событий
     */
    attachEventHandlers() {
        // Закрытие модального окна
        document.getElementById('close-line-editor').addEventListener('click', () => {
            this.close();
        });

        document.getElementById('cancel-line-edit').addEventListener('click', () => {
            this.close();
        });

        // Переключение режима
        document.getElementById('mode-main').addEventListener('click', () => {
            this.setMode('main');
        });

        document.getElementById('mode-branch').addEventListener('click', () => {
            this.setMode('branch');
        });

        // Управление точками
        document.getElementById('clear-last-point').addEventListener('click', () => {
            this.removeLastPoint();
        });

        document.getElementById('clear-all-points').addEventListener('click', () => {
            if (confirm('Удалить все точки и начать заново?')) {
                this.clearAll();
            }
        });

        // Сохранение
        document.getElementById('save-line').addEventListener('click', () => {
            this.saveLine();
        });

        // Закрытие по клику вне модального окна
        document.getElementById('line-editor-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'line-editor-overlay') {
                this.close();
            }
        });
    }

    /**
     * Установка режима редактирования
     */
    setMode(mode) {
        this.currentMode = mode;

        // Обновляем кнопки режима
        document.getElementById('mode-main').classList.toggle('active', mode === 'main');
        document.getElementById('mode-branch').classList.toggle('active', mode === 'branch');

        // Показываем соответствующие инструкции
        document.getElementById('main-instructions').style.display = mode === 'main' ? 'block' : 'none';
        document.getElementById('branch-instructions').style.display = mode === 'branch' ? 'block' : 'none';

        // Если переключаемся на режим ответвления, создаем новое ответвление
        if (mode === 'branch') {
            this.currentBranchIndex = this.branches.length;
            this.branches.push([]);
        } else {
            this.currentBranchIndex = null;
        }
    }

    /**
     * Удаление последней добавленной точки
     */
    removeLastPoint() {
        if (this.currentMode === 'main' && this.mainPath.length > 0) {
            // Удаляем последнюю точку основного пути
            this.mainPath.pop();
            
            // Удаляем последний маркер
            const lastMarker = this.markers.pop();
            if (lastMarker) {
                this.map.removeLayer(lastMarker);
            }
            
            // Перерисовываем линию
            this.redrawMainPath();
            document.getElementById('main-path-count').textContent = this.mainPath.length;
            
        } else if (this.currentMode === 'branch' && this.currentBranchIndex !== null) {
            // Удаляем последнюю точку текущего ответвления
            const branch = this.branches[this.currentBranchIndex];
            if (branch && branch.length > 0) {
                branch.pop();
                this.redrawBranches();
            }
        }
    }

    /**
     * Очистка всех точек
     */
    clearAll() {
        // Очищаем основной путь
        this.mainPath = [];
        
        // Очищаем ответвления
        this.branches = [];
        this.currentBranchIndex = null;
        
        // Удаляем все маркеры
        this.markers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.markers = [];
        
        // Удаляем polylines
        if (this.mainPathPolyline) {
            this.map.removeLayer(this.mainPathPolyline);
            this.mainPathPolyline = null;
        }
        
        this.branchPolylines.forEach(poly => {
            this.map.removeLayer(poly);
        });
        this.branchPolylines = [];
        
        // Обновляем счетчики
        document.getElementById('main-path-count').textContent = '0';
        document.getElementById('branches-count').textContent = '0';
        
        // Возвращаемся в режим основного пути
        this.setMode('main');
    }

    /**
     * Валидация данных линии
     */
    validateLine() {
        const errors = [];

        // ИСПРАВЛЕНИЕ: Ищем элементы только внутри текущего модального окна
        // чтобы избежать конфликта с другими модальными окнами
        const modal = document.getElementById('infrastructure-line-editor-modal');
        if (!modal) {
            console.error('❌ Модальное окно редактора линий не найдено в DOM');
            errors.push('Ошибка: модальное окно не найдено');
            return errors;
        }

        // Проверка названия - ищем внутри модального окна
        const nameElement = modal.querySelector('#line-name');
        if (!nameElement) {
            console.error('❌ Элемент line-name не найден внутри модального окна');
            errors.push('Ошибка: элемент названия линии не найден');
            return errors;
        }
        
        const name = nameElement.value.trim();
        console.log('🔍 Валидация названия линии:', { 
            value: nameElement.value, 
            trimmed: name, 
            isEmpty: !name,
            modalId: modal.id
        });
        
        if (!name) {
            errors.push('Название линии обязательно');
        }

        // Проверка основного пути
        if (this.mainPath.length < 2) {
            errors.push('Основной путь должен содержать минимум 2 точки');
        }

        // Проверка ответвлений
        const invalidBranches = this.branches.filter(b => b.length > 0 && b.length < 2);
        if (invalidBranches.length > 0) {
            errors.push('Каждое ответвление должно содержать минимум 2 точки');
        }

        return errors;
    }

    /**
     * Сохранение линии через API
     */
    async saveLine() {
        // Валидация
        const errors = this.validateLine();
        if (errors.length > 0) {
            alert('Ошибки валидации:\n' + errors.join('\n'));
            return;
        }

        // ИСПРАВЛЕНИЕ: Получаем все элементы из модального окна, а не из всего документа
        const modal = document.getElementById('infrastructure-line-editor-modal');
        if (!modal) {
            alert('Ошибка: модальное окно не найдено');
            return;
        }

        // Собираем данные - ищем элементы внутри модального окна
        const lineData = {
            line_type: this.lineType,
            name: modal.querySelector('#line-name').value.trim(),
            description: modal.querySelector('#line-description').value.trim(),
            main_path: this.mainPath,
            branches: this.branches.filter(b => b.length >= 2), // Только валидные ответвления
            status: 'active'
        };

        // Добавляем специфичные поля для электричества
        if (this.lineType === 'electricity') {
            const voltageEl = modal.querySelector('#line-voltage');
            const transformerEl = modal.querySelector('#line-transformer');
            const cableTypeEl = modal.querySelector('#line-cable-type');
            const commYearEl = modal.querySelector('#line-commissioning-year');
            
            if (voltageEl && voltageEl.value) lineData.voltage_kv = parseFloat(voltageEl.value);
            if (transformerEl && transformerEl.value) lineData.transformer_id = parseInt(transformerEl.value);
            if (cableTypeEl && cableTypeEl.value) lineData.cable_type = cableTypeEl.value.trim();
            if (commYearEl && commYearEl.value) lineData.commissioning_year = parseInt(commYearEl.value);
        }

        // Добавляем специфичные поля для водоснабжения
        if (this.lineType === 'ХВС' || this.lineType === 'ГВС') {
            const diameterEl = modal.querySelector('#line-diameter');
            const materialEl = modal.querySelector('#line-material');
            const pressureEl = modal.querySelector('#line-pressure');
            const installDateEl = modal.querySelector('#line-installation-date');
            const statusEl = modal.querySelector('#line-status');
            const contactEl = modal.querySelector('#line-maintenance-contact');
            const notesEl = modal.querySelector('#line-notes');
            
            if (diameterEl && diameterEl.value) lineData.diameter_mm = parseInt(diameterEl.value);
            if (materialEl && materialEl.value) lineData.material = materialEl.value;
            if (pressureEl && pressureEl.value) lineData.pressure_rating = parseFloat(pressureEl.value);
            if (installDateEl && installDateEl.value) lineData.installation_date = installDateEl.value;
            if (statusEl && statusEl.value) lineData.status = statusEl.value;
            if (contactEl && contactEl.value) lineData.maintenance_contact = contactEl.value.trim();
            if (notesEl && notesEl.value) lineData.notes = notesEl.value.trim();
        }

        // Добавляем дополнительные поля (если указаны)
        Object.keys(this.additionalFields).forEach(key => {
            if (this.additionalFields[key] !== undefined) {
                lineData[key] = this.additionalFields[key];
            }
        });

        try {
            const url = this.lineId 
                ? `${this.apiEndpoint}/${this.lineId}` 
                : this.apiEndpoint;
            
            const method = this.lineId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify(lineData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка сохранения линии');
            }

            const result = await response.json();
            
            // Показываем уведомление
            this.showToast(
                this.lineId ? 'Линия успешно обновлена' : 'Линия успешно создана', 
                'success'
            );

            // Вызываем callback
            if (this.onSave) {
                this.onSave(result);
            }

            // Закрываем модальное окно
            this.close();

        } catch (error) {
            console.error('Error saving line:', error);
            this.showToast('Ошибка сохранения: ' + error.message, 'error');
        }
    }

    /**
     * Показать toast уведомление
     */
    showToast(message, type = 'info') {
        // Используем глобальную функцию showToast если доступна
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Fallback: простое alert
        alert(message);
    }

    /**
     * Закрытие модального окна
     */
    close() {
        // Удаляем модальное окно (используем querySelectorAll на случай дубликатов)
        const modals = document.querySelectorAll('#infrastructure-line-editor-modal');
        modals.forEach(modal => {
            modal.remove();
        });
        
        // Очищаем карту
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        
        // Очищаем маркеры и polylines
        this.markers = [];
        this.mainPathPolyline = null;
        this.branchPolylines = [];
    }
}

// ===============================================
// ГЛОБАЛЬНАЯ ФУНКЦИЯ ДЛЯ ОТКРЫТИЯ РЕДАКТОРА
// ===============================================

/**
 * Открыть редактор линий инфраструктуры
 * 
 * @param {string} lineType - Тип линии (cold_water, hot_water, electricity)
 * @param {number} lineId - ID линии (null для создания новой)
 * @param {Object} existingData - Существующие данные (для редактирования)
 * @param {Function} onSave - Callback после сохранения
 */
function openInfrastructureLineEditor(lineType, lineId = null, existingData = null, onSave = null) {
    const editor = new InfrastructureLineEditor({
        lineType: lineType,
        lineId: lineId,
        existingData: existingData,
        onSave: onSave
    });
    
    editor.show();
}

// ===============================================
// CSS СТИЛИ
// ===============================================

if (!document.getElementById('infrastructure-line-editor-styles')) {
    const style = document.createElement('style');
    style.id = 'infrastructure-line-editor-styles';
    style.textContent = `
        .line-editor-modal {
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 900px;
            width: 95%;
            max-height: 90vh;
            overflow-y: auto;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }

        .editing-mode {
            margin: 20px 0;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 4px;
        }

        .mode-buttons {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .mode-btn {
            flex: 1;
            padding: 10px 15px;
            background: #e0e0e0;
            border: 2px solid transparent;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }

        .mode-btn.active {
            background: #4CAF50;
            color: white;
            border-color: #45a049;
            font-weight: bold;
        }

        .mode-btn:hover:not(.active) {
            background: #d0d0d0;
        }

        .instruction-box {
            background: #e3f2fd;
            padding: 10px;
            border-radius: 4px;
            border-left: 4px solid #2196F3;
            margin: 15px 0;
            font-size: 14px;
        }

        .points-management {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .btn-warning {
            background: #ff9800;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            flex: 1;
        }

        .btn-warning:hover {
            background: #f57c00;
        }

        .btn-danger {
            background: #f44336;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
        }

        .btn-danger:hover {
            background: #da190b;
        }

        #branches-list {
            background: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
        }

        #branches-list h4 {
            margin: 0 0 10px 0;
            color: #333;
        }

        #branches-items {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        #branches-items li {
            padding: 8px;
            background: white;
            margin: 5px 0;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        #line-editor-map {
            border: 2px solid #ddd;
        }

        /* Leaflet маркеры */
        .custom-marker {
            background: transparent !important;
            border: none !important;
        }
    `;
    document.head.appendChild(style);
}

