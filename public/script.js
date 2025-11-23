// ============================================================
// ПЕРЕКЛЮЧЕНИЕ ТЕМЫ (СВЕТЛАЯ/ТЕМНАЯ)
// ============================================================

/**
 * Функция для переключения между светлой и темной темой
 * Сохраняет выбранную тему в localStorage
 */
function initThemeToggle() {
    // Получаем элементы
    const themeToggle = document.getElementById('theme-toggle');
    const themeIconSun = document.getElementById('theme-icon-sun');
    const themeIconMoon = document.getElementById('theme-icon-moon');
    const htmlElement = document.documentElement;
    
    // Проверяем сохраненную тему в localStorage
    const savedTheme = localStorage.getItem('theme') || 'light';
    
    // Применяем сохраненную тему при загрузке страницы
    if (savedTheme === 'dark') {
        htmlElement.classList.add('dark');
        themeIconSun.style.display = 'block';
        themeIconMoon.style.display = 'none';
    } else {
        htmlElement.classList.remove('dark');
        themeIconSun.style.display = 'none';
        themeIconMoon.style.display = 'block';
    }
    
    // Обработчик клика на переключатель темы
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = htmlElement.classList.contains('dark');
            
            if (isDark) {
                // Переключаем на светлую тему
                htmlElement.classList.remove('dark');
                localStorage.setItem('theme', 'light');
                themeIconSun.style.display = 'none';
                themeIconMoon.style.display = 'block';
                console.log('🌞 Theme switched to light');
            } else {
                // Переключаем на темную тему
                htmlElement.classList.add('dark');
                localStorage.setItem('theme', 'dark');
                themeIconSun.style.display = 'block';
                themeIconMoon.style.display = 'none';
                console.log('🌙 Theme switched to dark');
            }
        });
    }
}

// Инициализируем переключение темы при загрузке DOM
document.addEventListener('DOMContentLoaded', function() {
    initThemeToggle();
});

document.addEventListener('DOMContentLoaded', async function () {
    // API Client для работы с JWT токенами
    class APIClient {
        constructor(baseURL) {
            this.baseURL = baseURL;
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем валидацию токена при инициализации
            this.token = window.DOMSecurity && window.DOMSecurity.getValidToken ? window.DOMSecurity.getValidToken() : localStorage.getItem('admin_token');
        }

        // Обновить токен
        setToken(token) {
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Валидируем токен перед сохранением
            if (token && window.DOMSecurity && window.DOMSecurity.validateToken) {
                const validation = window.DOMSecurity.validateToken(token);
                if (!validation.valid) {
                    console.error('Попытка установить невалидный токен:', validation.error);
                    this.token = null;
                    localStorage.removeItem('admin_token');
                    return;
                }
            }
            this.token = token;
            if (token) {
                localStorage.setItem('admin_token', token);
            } else {
                localStorage.removeItem('admin_token');
            }
        }

        // Выполнить fetch запрос с автоматическим добавлением авторизации
        async fetch(url, options = {}) {
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем rate limiter перед запросом
            if (window.apiRateLimiter && !window.apiRateLimiter.canMakeRequest()) {
                const timeUntilNext = window.apiRateLimiter.getTimeUntilNextRequest();
                const remaining = window.apiRateLimiter.getRemainingRequests();
                throw new Error(
                    `Превышен лимит запросов. Попробуйте через ${timeUntilNext} секунд. ` +
                    `Осталось запросов: ${remaining}`
                );
            }

            // Подготавливаем заголовки
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };

            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем и валидируем токен перед использованием
            if (this.token) {
                // Проверяем токен перед каждым запросом
                if (window.DOMSecurity && window.DOMSecurity.validateToken) {
                    const validation = window.DOMSecurity.validateToken(this.token);
                    if (!validation.valid) {
                        console.warn('Токен невалиден, удаляем:', validation.error);
                        this.setToken(null);
                    } else {
                        headers['Authorization'] = `Bearer ${this.token}`;
                    }
                } else {
                    // Fallback если DOMSecurity еще не загружен
                    headers['Authorization'] = `Bearer ${this.token}`;
                }
            }

            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Добавляем CSRF защиту для изменяющих запросов
            const method = (options.method || 'GET').toUpperCase();
            if (window.csrfProtection && window.csrfProtection.isModifyingMethod(method)) {
                const updatedOptions = window.csrfProtection.addToHeaders(options);
                options.headers = updatedOptions.headers;
            }

            // Формируем полный URL
            const fullURL = url.startsWith('http') ? url : `${this.baseURL}${url}`;

            try {
                const response = await fetch(fullURL, {
                    ...options,
                    headers
                });

                // Обрабатываем 401 ошибки (неавторизован)
                if (response.status === 401) {
                    console.warn('Токен недействителен, очищаем локальное хранилище');
                    this.setToken(null);
                    // Показываем уведомление и перенаправляем на логин если нужно
                    this.handleUnauthorized();
                    throw new Error('Требуется авторизация');
                }

                // Обрабатываем другие HTTP ошибки
                if (!response.ok && response.status !== 401) {
                    // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Используем безопасный парсер JSON
                    const errorText = await response.text();
                    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    
                    // Пытаемся безопасно распарсить JSON
                    if (errorText && errorText.length < 10000) { // Ограничиваем размер
                        try {
                            const errorJson = window.safeJsonParser 
                                ? window.safeJsonParser.parseString(errorText)
                                : JSON.parse(errorText);
                            errorMessage = errorJson.message || errorJson.error || errorMessage;
                        } catch (e) {
                            // Если не JSON, используем текст ошибки (ограниченный)
                            if (errorText) {
                                errorMessage = errorText.substring(0, 200);
                            }
                        }
                    }
                    throw new Error(errorMessage);
                }

                return response;
            } catch (error) {
                console.error('Ошибка API запроса:', error);
                
                // Если это ошибка сети
                if (error instanceof TypeError && error.message.includes('fetch')) {
                    throw new Error('Ошибка подключения к серверу. Проверьте соединение с интернетом.');
                }
                
                throw error;
            }
        }

        // Обработка ошибок авторизации
        handleUnauthorized() {
            // Показываем уведомление об ошибке авторизации
            if (typeof showToast === 'function') {
                showToast('Сессия истекла. Необходимо войти заново.', 'warning');
            }
            
            // Если это админская страница, перенаправляем на логин
            if (window.location.pathname.includes('admin.html')) {
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 2000);
            }
        }
        
        // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Безопасный парсинг JSON ответа
        async json(response) {
            if (!window.safeJsonParser) {
                // Fallback если safeJsonParser не загружен
                console.warn('SafeJsonParser не загружен, используется стандартный парсинг');
                return response.json();
            }
            
            try {
                return await window.safeJsonParser.parseResponse(response);
            } catch (error) {
                console.error('Ошибка безопасного парсинга JSON:', error);
                throw error;
            }
        }
    }

    // ============================================================
    // КЛАСС ПРОМЫШЛЕННОЙ ВЫДВИЖНОЙ ПАНЕЛИ УПРАВЛЕНИЯ (T021)
    // ============================================================
    
    /**
     * IndustrialPushPanel - Управление промышленной выдвижной панелью
     * 
     * Этот класс создает единую панель управления с вкладками для:
     * - Слои карты (базовые и overlay)
     * - Статусы зданий (ok, warning, leak, critical, no-controller)
     * 
     * Панель выдвигается слева направо с плавной анимацией
     */
    class IndustrialPushPanel {
        constructor() {
            // Получаем элементы DOM
            this.panel = document.getElementById('push-panel');
            // Кнопка toggle будет найдена после создания Leaflet control
            this.toggleBtn = null;
            this.tabs = document.querySelectorAll('.tab-btn');
            this.contents = document.querySelectorAll('.tab-content');
            
            // Состояние панели
            this.isExpanded = false;
            this.currentTab = 'layers';
            this.initialized = false;
            
            // Инициализация произойдет после создания Leaflet control
            if (!this.panel) {
                console.warn('⚠️ IndustrialPushPanel: панель не найдена в DOM');
            }
        }
        
        /**
         * Инициализация панели
         * Настраивает обработчики событий для toggle кнопки и вкладок
         */
        init() {
            console.log('🔧 Initializing IndustrialPushPanel...');
            
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем наличие панели перед инициализацией
            if (!this.panel) {
                console.error('❌ IndustrialPushPanel: панель не найдена в DOM, инициализация невозможна');
                return;
            }
            
            // Если кнопка еще не найдена, пытаемся найти её
            if (!this.toggleBtn) {
                this.toggleBtn = document.getElementById('push-panel-toggle');
            }
            
            if (!this.toggleBtn) {
                console.warn('⚠️ IndustrialPushPanel: кнопка toggle не найдена');
                return;
            }
            
            // Обработчик для кнопки toggle
            // Убираем дублирование - используем только обработчик из Leaflet control
            // Не добавляем addEventListener здесь, так как обработчик уже есть в Leaflet control
            
            // Обработчик для кнопки закрытия панели
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем this.panel перед использованием
            const closeBtn = this.panel.querySelector('.panel-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Закрываем панель если она открыта
                    if (this.isExpanded) {
                        this.toggle();
                    }
                });
            }
            
            // Обработчики для вкладок
            this.tabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const tabName = e.currentTarget.dataset.tab;
                    this.switchTab(tabName);
                });
            });
            
            // Начальная загрузка контента первой вкладки
            this.loadTabContent(this.currentTab);
            
            this.initialized = true;
            console.log('✅ IndustrialPushPanel initialized successfully');
        }
        
        /**
         * Переключение состояния панели (свернута/развернута)
         * Изменяет классы для анимации и сдвигает карту
         * ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Добавлена проверка на null перед использованием this.panel
         */
        toggle() {
            // ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ: Проверяем наличие панели перед использованием
            if (!this.panel) {
                console.error('❌ IndustrialPushPanel.toggle(): панель не найдена в DOM');
                return;
            }
            
            this.isExpanded = !this.isExpanded;
            
            if (this.isExpanded) {
                this.panel.classList.remove('collapsed');
                this.panel.classList.add('expanded');
                // Принудительно устанавливаем transform для гарантии отображения
                this.panel.style.transform = 'translateX(0)';
                console.log('📂 Panel expanded');
            } else {
                this.panel.classList.remove('expanded');
                this.panel.classList.add('collapsed');
                // Принудительно устанавливаем transform для гарантии скрытия
                this.panel.style.transform = 'translateX(-100%)';
                console.log('📁 Panel collapsed');
            }
        }
        
        /**
         * Переключение между вкладками
         * @param {string} tabName - Имя вкладки (layers, status)
         */
        switchTab(tabName) {
            console.log(`🔀 Switching to tab: ${tabName}`);
            
            // Обновляем активные вкладки
            this.tabs.forEach(tab => {
                const isActive = tab.dataset.tab === tabName;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', isActive);
            });
            
            // Обновляем активное содержимое
            this.contents.forEach(content => {
                const isActive = content.dataset.content === tabName;
                content.classList.toggle('active', isActive);
            });
            
            // Сохраняем текущую вкладку и загружаем контент
            this.currentTab = tabName;
            this.loadTabContent(tabName);
        }
        
        /**
         * Загрузка контента для активной вкладки
         * @param {string} tabName - Имя вкладки
         */
        loadTabContent(tabName) {
            console.log(`📦 Loading content for tab: ${tabName}`);
            
            switch(tabName) {
                case 'layers':
                    this.loadLayersContent();
                    break;
                case 'status':
                    this.loadStatusContent();
                    break;
                default:
                    console.warn(`⚠️ Unknown tab: ${tabName}`);
            }
        }
        
        /**
         * Загрузка контента вкладки СЛОИ
         * Интеграция с существующим MapLayersControl
         */
        loadLayersContent() {
            const layersContent = document.querySelector('.tab-content[data-content="layers"]');
            if (!layersContent) return;
            
            // Очищаем содержимое если оно уже было загружено
            if (layersContent.dataset.loaded) {
                return;
            }
            layersContent.dataset.loaded = 'true';
            
            // Создаем структуру для базовых слоев
            const baseSection = document.createElement('div');
            baseSection.className = 'tab-section';
            const baseTitle = document.createElement('h3');
            baseTitle.textContent = 'Базовые слои';
            baseSection.appendChild(baseTitle);
            
            const baseLayersList = document.createElement('div');
            baseLayersList.className = 'base-layers-list';
            baseSection.appendChild(baseLayersList);
            
            // Создаем структуру для overlay слоев
            const overlaySection = document.createElement('div');
            overlaySection.className = 'tab-section';
            const overlayTitle = document.createElement('h3');
            overlayTitle.textContent = 'Объекты инфраструктуры';
            overlaySection.appendChild(overlayTitle);
            
            const overlayLayersList = document.createElement('div');
            overlayLayersList.className = 'overlay-layers-list';
            overlaySection.appendChild(overlayLayersList);
            
            // Добавляем секции в контент
            layersContent.appendChild(baseSection);
            layersContent.appendChild(overlaySection);
            
            console.log('✅ Layers content structure created');
            
            // Попытка интегрироваться с MapLayersControl если он уже инициализирован
            // Если нет - элементы будут заполнены вручную
            // Используем setTimeout для обеспечения полной инициализации MapLayersControl
            setTimeout(() => {
                const mapLayersControl = this.getMapLayersControl();
                if (mapLayersControl && mapLayersControl.baseLayers && mapLayersControl.overlays) {
                    // Переопределяем populateLayerControls чтобы использовать новые элементы
                    mapLayersControl.populateLayerControls = function() {
                        // Используем наши элементы вместо старых
                        const baseList = document.querySelector('.base-layers-list');
                        const overlayList = document.querySelector('.overlay-layers-list');
                        
                        if (baseList && overlayList) {
                            // Очищаем списки перед заполнением
                            baseList.innerHTML = '';
                            overlayList.innerHTML = '';
                            
                            console.log('🔄 Populating layers with Industrial panel elements');
                            
                            // Базовые слои
                            Object.keys(mapLayersControl.baseLayers).forEach(name => {
                                const item = document.createElement('div');
                                item.className = 'tab-item';
                                
                                const label = document.createElement('label');
                                label.className = 'tab-item-label';
                                
                                const input = document.createElement('input');
                                input.type = 'radio';
                                input.name = 'base-layer';
                                input.value = name;
                                input.checked = name === "🗺️ Карта";
                                
                                label.appendChild(input);
                                label.appendChild(document.createTextNode(name));
                                item.appendChild(label);
                                
                                input.addEventListener('change', () => {
                                    if (input.checked) {
                                        mapLayersControl.switchBaseLayer(name);
                                    }
                                });
                                
                                baseList.appendChild(item);
                            });
                            
                            // Overlay слои
                            Object.keys(mapLayersControl.overlays).forEach(name => {
                                const item = document.createElement('div');
                                item.className = 'tab-item';
                                
                                const label = document.createElement('label');
                                label.className = 'tab-item-label';
                                
                                const input = document.createElement('input');
                                input.type = 'checkbox';
                                input.value = name;
                                // Все слои по умолчанию не выбраны при загрузке
                                input.checked = false;
                                
                                label.appendChild(input);
                                label.appendChild(document.createTextNode(name)); // Полное название с эмодзи
                                
                                const count = document.createElement('span');
                                count.className = 'layer-count'; // Для совместимости с updateLayerCount
                                count.textContent = '(0)';
                                
                                label.appendChild(count); // Добавляем счетчик внутрь label
                                item.appendChild(label);
                                
                                input.addEventListener('change', () => {
                                    mapLayersControl.toggleOverlay(name, input.checked);
                                });
                                
                                overlayList.appendChild(item);
                            });
                            
                            console.log('✅ Layers populated successfully');
                        }
                    };
                    
                    // Вызываем обновленный метод
                    mapLayersControl.populateLayerControls();
                    
                    // Переопределяем updateLayerCount для нашей структуры
                    mapLayersControl.updateLayerCount = function(layerName, count) {
                        // Сохраняем счетчик для последующего обновления
                        if (!this.layerCounts) {
                            this.layerCounts = new Map();
                        }
                        this.layerCounts.set(layerName, count);
                        
                        // Обновляем счетчик в DOM если элементы уже созданы
                        const input = document.querySelector(`input[value="${layerName}"]`);
                        if (input) {
                            const label = input.parentElement;
                            if (label) {
                                const countSpan = label.querySelector('.layer-count');
                                if (countSpan) {
                                    countSpan.textContent = `(${count})`;
                                }
                            }
                        }
                    };
                    
                    // Обновляем счетчики из сохраненных значений после создания DOM
                    // Увеличиваем задержку чтобы дать время загрузиться данным
                    setTimeout(() => {
                        if (mapLayersControl.layerCounts && mapLayersControl.layerCounts.size > 0) {
                            console.log('🔄 Refreshing layer counts from cache:', Array.from(mapLayersControl.layerCounts.entries()));
                            mapLayersControl.refreshLayerCounts();
                        } else {
                            console.log('⚠️ No layer counts in cache yet, waiting for data to load...');
                            // Если счетчики еще не загружены, ждем еще немного и проверяем снова
                            setTimeout(() => {
                                if (mapLayersControl.layerCounts && mapLayersControl.layerCounts.size > 0) {
                                    console.log('🔄 Refreshing layer counts after delay:', Array.from(mapLayersControl.layerCounts.entries()));
                                    mapLayersControl.refreshLayerCounts();
                                }
                            }, 1000);
                        }
                    }, 500);
                } else {
                    console.warn('⚠️ MapLayersControl not ready yet, retrying...');
                    // Повторная попытка через 500мс если MapLayersControl еще не готов
                    setTimeout(() => {
                        const mapLayersControl = this.getMapLayersControl();
                        if (mapLayersControl && mapLayersControl.baseLayers && mapLayersControl.overlays) {
                            mapLayersControl.populateLayerControls();
                        }
                    }, 500);
                }
            }, 100);
        }
        
        /**
         * Загрузка контента вкладки СТАТУСЫ
         * Миграция из существующего sidebar
         */
        loadStatusContent() {
            const statusContent = document.querySelector('.tab-content[data-content="status"]');
            if (!statusContent) return;
            
            // Очищаем содержимое если оно уже было загружено
            if (statusContent.dataset.loaded) {
                return;
            }
            statusContent.dataset.loaded = 'true';
            
            // Создаем секцию для групп статусов
            const statusSection = document.createElement('div');
            statusSection.className = 'tab-section';
            statusSection.id = 'industrial-status-groups';
            
            // Создаем группы статусов
            const statusGroups = [
                { id: 'industrial-ok-group', title: '✓ Нет проблем', icon: '✓', color: '#4caf50' },
                { id: 'industrial-warning-group', title: '⚠ Предупреждение', icon: '⚠', color: '#ff9800' },
                { id: 'industrial-leak-group', title: '💧 Вода в подвале', icon: '💧', color: '#2196f3' },
                { id: 'industrial-critical-group', title: '🔴 Авария', icon: '🔴', color: '#f44336' },
                { id: 'industrial-no-group', title: '⚪ Нет контроллера', icon: '⚪', color: '#9e9e9e' }
            ];
            
            statusGroups.forEach(group => {
                const groupContainer = document.createElement('div');
                groupContainer.id = group.id;
                groupContainer.style.marginBottom = '12px';
                
                const groupHeader = document.createElement('div');
                groupHeader.className = 'status-group-header';
                // Используем CSS переменные и классы вместо инлайн-стилей
                groupHeader.style.borderLeftColor = group.color;
                
                const titleDiv = document.createElement('div');
                titleDiv.className = 'status-title';
                
                const iconSpan = document.createElement('span');
                iconSpan.className = 'status-icon';
                iconSpan.textContent = group.icon;
                
                const titleSpan = document.createElement('span');
                titleSpan.textContent = group.title;
                
                titleDiv.appendChild(iconSpan);
                titleDiv.appendChild(titleSpan);
                
                const counterSpan = document.createElement('span');
                counterSpan.className = 'group-counter';
                counterSpan.textContent = '0';
                counterSpan.style.cssText = `
                    background: ${group.color}; 
                    color: white; 
                    padding: 2px 8px; 
                    border-radius: 10px; 
                    font-size: 11px; 
                    min-width: 30px; 
                    text-align: center;
                `;
                
                groupHeader.appendChild(titleDiv);
                groupHeader.appendChild(counterSpan);
                
                const groupItems = document.createElement('div');
                groupItems.className = 'status-group-items';
                groupItems.style.cssText = `
                    margin-top: 6px;
                    max-height: 300px;
                    overflow-y: auto;
                    display: none;
                `;
                
                groupContainer.appendChild(groupHeader);
                groupContainer.appendChild(groupItems);
                statusSection.appendChild(groupContainer);
                
                // Обработчик клика для сворачивания/разворачивания
                groupHeader.addEventListener('click', () => {
                    const isExpanded = groupItems.classList.contains('show');
                    if (isExpanded) {
                        groupItems.classList.remove('show');
                        groupItems.style.display = 'none';
                    } else {
                        groupItems.classList.add('show');
                        groupItems.style.display = 'block';
                    }
                });
            });
            
            statusContent.appendChild(statusSection);
            console.log('✅ Status content structure created');
            
            // Обновляем статусы после создания структуры
            this.updateStatusGroups();
        }
        
        /**
         * Обновить группы статусов в промышленной панели
         * Вызывается из loadData() для синхронизации со старым sidebar
         */
        updateStatusGroups() {
            const statusGroups = ['ok', 'warning', 'leak', 'critical', 'no'];
            
            statusGroups.forEach(groupId => {
                // Получаем старые элементы из старого sidebar
                const oldGroup = document.querySelector(`#${groupId}-group .status-items`);
                if (!oldGroup) return;
                
                // Получаем новые элементы промышленной панели
                const industrialGroup = document.querySelector(`#industrial-${groupId}-group .status-group-items`);
                const industrialCounter = document.querySelector(`#industrial-${groupId}-group .group-counter`);
                
                if (industrialGroup && industrialCounter) {
                    // Очищаем старые элементы
                    industrialGroup.innerHTML = '';
                    
                    // Клонируем элементы из старого sidebar
                    Array.from(oldGroup.children).forEach(item => {
                        const clone = item.cloneNode(true);
                        // Используем CSS класс вместо инлайн-стилей
                        clone.className = 'status-group-item';
                        
                        // Обновляем размеры всех изображений внутри
                        const images = clone.querySelectorAll('img');
                        images.forEach(img => {
                            img.style.width = '20px';
                            img.style.height = '20px';
                            img.style.objectFit = 'contain';
                        });
                        
                        // Добавляем обработчик клика для центрирования карты и открытия popup
                        clone.addEventListener('click', function() {
                            const buildingId = parseInt(this.dataset.buildingId);
                            const lat = parseFloat(this.dataset.latitude);
                            const lng = parseFloat(this.dataset.longitude);
                            
                            if (lat && lng) {
                                // Находим маркер здания в кластере
                                let targetMarker = null;
                                markers.eachLayer(marker => {
                                    if (marker.building_id === buildingId) {
                                        targetMarker = marker;
                                    }
                                });
                                
                                if (targetMarker) {
                                    // Используем popup маркера напрямую
                                    map.flyTo([lat, lng], 16, {
                                        duration: 0.5
                                    });
                                    
                                    // Открываем popup маркера
                                    setTimeout(() => {
                                        targetMarker.openPopup();
                                        markers.unspiderfy();
                                    }, 300);
                                } else {
                                    // Если маркер не найден, используем сохраненный popup контент
                                    const savedPopupContent = buildingPopupStorage.get(buildingId);
                                    
                                    map.flyTo([lat, lng], 16, {
                                        duration: 0.5
                                    });
                                    
                                    // Создаем popup с полным контентом
                                    if (savedPopupContent) {
                                        L.popup()
                                            .setLatLng([lat, lng])
                                            .setContent(savedPopupContent)
                                            .openOn(map);
                                    }
                                }
                            }
                        });
                        
                        // Добавляем стиль курсора для визуальной обратной связи
                        clone.style.cursor = 'pointer';
                        
                        industrialGroup.appendChild(clone);
                    });
                    
                    // Обновляем счетчик
                    industrialCounter.textContent = oldGroup.children.length;
                    
                    // Показываем группу если есть элементы
                    if (oldGroup.children.length > 0) {
                        industrialGroup.style.display = 'block';
                    } else {
                        industrialGroup.style.display = 'none';
                    }
                }
            });
        }
        
        /**
         * Загрузка контента вкладки ФИЛЬТРЫ
         * Интеграция с существующими фильтрами
         */
        loadFiltersContent() {
            const filtersContent = document.querySelector('.tab-content[data-content="filters"]');
            if (!filtersContent) return;
            
            // Очищаем содержимое если оно уже было загружено
            if (filtersContent.dataset.loaded) {
                return;
            }
            filtersContent.dataset.loaded = 'true';
            
            // Создаем секцию для фильтров
            const filtersSection = document.createElement('div');
            filtersSection.className = 'tab-section';
            
            // Создаем заголовок
            const filtersTitle = document.createElement('h3');
            filtersTitle.textContent = 'Фильтры по объектам';
            filtersSection.appendChild(filtersTitle);
            
            // Фильтр по статусу
            const statusFilterGroup = document.createElement('div');
            statusFilterGroup.style.cssText = 'margin-bottom: 16px;';
            
            const statusLabel = document.createElement('label');
            statusLabel.textContent = 'Статус:';
            statusLabel.style.cssText = 'display: block; margin-bottom: 8px; color: #e0e0e0; font-size: 13px; font-weight: 500;';
            
            const statusSelect = document.createElement('select');
            statusSelect.id = 'industrial-status-filter';
            statusSelect.multiple = true;
            statusSelect.style.cssText = 'width: 100%; padding: 8px; background: #253041; border: 1px solid #3a4a5e; color: #e0e0e0; border-radius: 4px; font-size: 13px;';
            
            ['active', 'maintenance', 'inactive', 'critical'].forEach(value => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = {
                    'active': 'Активный',
                    'maintenance': 'Обслуживание',
                    'inactive': 'Неактивный',
                    'critical': 'Критический'
                }[value];
                statusSelect.appendChild(option);
            });
            
            statusFilterGroup.appendChild(statusLabel);
            statusFilterGroup.appendChild(statusSelect);
            filtersSection.appendChild(statusFilterGroup);
            
            // Фильтр по загрузке трансформаторов
            const loadFilterGroup = document.createElement('div');
            loadFilterGroup.style.cssText = 'margin-bottom: 16px;';
            
            const loadLabel = document.createElement('label');
            loadLabel.textContent = 'Загрузка трансформаторов:';
            loadLabel.style.cssText = 'display: block; margin-bottom: 8px; color: #e0e0e0; font-size: 13px; font-weight: 500;';
            
            const loadInputContainer = document.createElement('div');
            loadInputContainer.style.cssText = 'display: flex; align-items: center; gap: 12px;';
            
            const loadInput = document.createElement('input');
            loadInput.type = 'range';
            loadInput.id = 'industrial-load-filter';
            loadInput.min = '0';
            loadInput.max = '100';
            loadInput.value = '100';
            loadInput.style.cssText = 'flex: 1; height: 6px; background: #3a4a5e; border-radius: 3px; appearance: none;';
            
            // Стили для range input
            loadInput.style.webkitAppearance = 'none';
            loadInput.style.appearance = 'none';
            
            const loadValue = document.createElement('span');
            loadValue.id = 'industrial-load-value';
            loadValue.textContent = '100%';
            loadValue.style.cssText = 'color: #34a236; font-size: 13px; font-weight: 600; min-width: 45px;';
            
            loadInput.addEventListener('input', (e) => {
                loadValue.textContent = e.target.value + '%';
            });
            
            loadInputContainer.appendChild(loadInput);
            loadInputContainer.appendChild(loadValue);
            
            loadFilterGroup.appendChild(loadLabel);
            loadFilterGroup.appendChild(loadInputContainer);
            filtersSection.appendChild(loadFilterGroup);
            
            // Фильтр по типу воды
            const waterFilterGroup = document.createElement('div');
            waterFilterGroup.style.cssText = 'margin-bottom: 20px;';
            
            const waterLabel = document.createElement('label');
            waterLabel.textContent = 'Тип водоснабжения:';
            waterLabel.style.cssText = 'display: block; margin-bottom: 8px; color: #e0e0e0; font-size: 13px; font-weight: 500;';
            
            const waterSelect = document.createElement('select');
            waterSelect.id = 'industrial-water-type-filter';
            waterSelect.style.cssText = 'width: 100%; padding: 8px; background: #253041; border: 1px solid #3a4a5e; color: #e0e0e0; border-radius: 4px; font-size: 13px;';
            
            [['', 'Все'], ['cold_water', 'Холодная вода'], ['hot_water', 'Горячая вода']].forEach(([value, text]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text;
                waterSelect.appendChild(option);
            });
            
            waterFilterGroup.appendChild(waterLabel);
            waterFilterGroup.appendChild(waterSelect);
            filtersSection.appendChild(waterFilterGroup);
            
            // Кнопки управления
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = 'display: flex; gap: 12px; margin-top: 20px;';
            
            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Применить';
            applyBtn.style.cssText = 'flex: 1; padding: 12px; background: #34a236; border: none; border-radius: 4px; color: #1a2332; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 200ms;';
            applyBtn.addEventListener('mouseenter', () => applyBtn.style.background = '#3fa341');
            applyBtn.addEventListener('mouseleave', () => applyBtn.style.background = '#34a236');
            applyBtn.addEventListener('click', () => {
                if (window.mapLayersControl && typeof window.mapLayersControl.applyFilters === 'function') {
                    window.mapLayersControl.applyFilters();
                }
                console.log('🔍 Filters applied');
            });
            
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Сбросить';
            resetBtn.style.cssText = 'flex: 1; padding: 12px; background: #3a4a5e; border: none; border-radius: 4px; color: #e0e0e0; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 200ms;';
            resetBtn.addEventListener('mouseenter', () => resetBtn.style.background = '#4a5a6e');
            resetBtn.addEventListener('mouseleave', () => resetBtn.style.background = '#3a4a5e');
            resetBtn.addEventListener('click', () => {
                if (window.mapLayersControl && typeof window.mapLayersControl.resetFilters === 'function') {
                    window.mapLayersControl.resetFilters();
                }
                statusSelect.selectedIndex = -1;
                loadInput.value = '100';
                loadValue.textContent = '100%';
                waterSelect.value = '';
                console.log('🔁 Filters reset');
            });
            
            buttonsContainer.appendChild(applyBtn);
            buttonsContainer.appendChild(resetBtn);
            filtersSection.appendChild(buttonsContainer);
            
            filtersContent.appendChild(filtersSection);
            console.log('✅ Filters content loaded');
        }
        
        /**
         * Получить ссылку на контроллер слоев карты
         * Используется для интеграции с MapLayersControl
         */
        getMapLayersControl() {
            if (window.mapLayersControl) {
                return window.mapLayersControl;
            }
            console.warn('⚠️ MapLayersControl not found');
            return null;
        }
        
        /**
         * Получить ссылку на карту Leaflet
         */
        getMap() {
            if (window.map) {
                return window.map;
            }
            console.warn('⚠️ Leaflet map not found');
            return null;
        }
    }

    // Define backend API URL (can be modified externally)
    const backendURL = window.BACKEND_URL || "/api";
    
    // Создаем экземпляр API клиента
    const apiClient = new APIClient(backendURL);
    
    // Создаем экземпляр промышленной панели управления
    let industrialPanel;

    // Добавляем необходимые CSS-стили для сворачиваемости сайдбара
    const sidebarStyles = document.createElement('style');
    sidebarStyles.textContent = `
        #sidebar h3 {
            cursor: pointer;
            position: relative;
            padding-right: 20px;
            user-select: none;
        }

        /* Добавляем стили для мигающего текста */
        @keyframes blink-red {
            0% { color: #ff0000; }
            50% { color: #ff6666; }
            100% { color: #ff0000; }
        }

        .blinking-text-red {
            animation: blink-red 1.5s infinite;
            font-weight: bold;
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

        /* Стили для кнопки обновления (перемещены в основной CSS файл) */

        /* Стили для Toast уведомлений */
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 300px;
        }

        .toast {
            margin-bottom: 10px;
            padding: 12px 16px 12px 45px;
            border-radius: 5px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            font-size: 14px;
            font-weight: 500;
            color: white;
            animation: toast-slide-in 0.3s ease-out;
            cursor: pointer;
            transition: opacity 0.3s ease;
            position: relative;
            display: flex;
            align-items: center;
        }

        .toast::before {
            content: '';
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            width: 18px;
            height: 18px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        }

        .toast-info::before {
            content: 'ℹ️';
            font-size: 14px;
        }

        .toast-success::before {
            content: '✅';
            font-size: 16px;
        }

        .toast-warning::before {
            content: '⚠️';
            font-size: 16px;
        }

        .toast-error::before {
            content: '❌';
            font-size: 16px;
        }

        .toast:hover {
            opacity: 0.9;
        }

        .toast-info {
            background-color: #2196F3;
        }

        .toast-success {
            background-color: #4CAF50;
        }

        .toast-warning {
            background-color: #FF9800;
        }

        .toast-error {
            background-color: #F44336;
        }

        @keyframes toast-slide-in {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes toast-slide-out {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }

        .toast.removing {
            animation: toast-slide-out 0.3s ease-in forwards;
        }

        /* Skeleton Loading Styles */
        .skeleton {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: skeleton-loading 1.5s infinite;
        }

        @keyframes skeleton-loading {
            0% {
                background-position: 200% 0;
            }
            100% {
                background-position: -200% 0;
            }
        }

        .skeleton-table {
            width: 100%;
            border-collapse: collapse;
        }

        .skeleton-table td {
            padding: 12px 8px;
            border-bottom: 1px solid #eee;
        }

        .skeleton-row {
            height: 16px;
            border-radius: 4px;
        }

        .skeleton-row.wide {
            width: 80%;
        }

        .skeleton-row.medium {
            width: 60%;
        }

        .skeleton-row.narrow {
            width: 40%;
        }

        .skeleton-map {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: skeleton-loading 1.5s infinite;
            z-index: 999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            color: #666;
        }

        .skeleton-map::before {
            content: '🗺️';
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.7;
        }

        .skeleton-map::after {
            content: 'Загрузка карты...';
            font-weight: 500;
        }

        .skeleton-dots {
            display: inline-block;
            animation: skeleton-dots 1.5s infinite;
        }

        @keyframes skeleton-dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60% { content: '...'; }
            80%, 100% { content: ''; }
        }
    `;
    document.head.appendChild(sidebarStyles);

    // Toast Manager для отображения уведомлений
    class ToastManager {
        constructor() {
            this.container = this.createContainer();
            this.queue = [];
            this.maxVisible = 5; // Максимальное количество видимых уведомлений
        }

        createContainer() {
            let container = document.querySelector('.toast-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'toast-container';
                document.body.appendChild(container);
            }
            return container;
        }

        show(message, type = 'info', duration = 4000) {
            // Проверяем количество видимых уведомлений
            const visibleToasts = this.container.children.length;
            if (visibleToasts >= this.maxVisible) {
                // Добавляем в очередь если превышен лимит
                this.queue.push({ message, type, duration });
                return null;
            }

            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            
            // Создаем контент с иконкой
            const content = document.createElement('span');
            content.textContent = message;
            toast.appendChild(content);

            // Добавляем кнопку закрытия
            const closeBtn = document.createElement('span');
            // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML
            closeBtn.textContent = '×';
            closeBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 10px;
                cursor: pointer;
                font-size: 18px;
                font-weight: bold;
                opacity: 0.7;
                transition: opacity 0.2s;
            `;
            closeBtn.addEventListener('mouseover', () => closeBtn.style.opacity = '1');
            closeBtn.addEventListener('mouseout', () => closeBtn.style.opacity = '0.7');
            toast.appendChild(closeBtn);

            // Добавляем возможность закрыть по клику
            const removeToast = () => {
                this.remove(toast);
                this.processQueue(); // Обрабатываем очередь после удаления
            };

            toast.addEventListener('click', removeToast);
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeToast();
            });

            // Добавляем эффект прогресс-бара для автоматического удаления
            if (duration > 0) {
                const progressBar = document.createElement('div');
                progressBar.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 3px;
                    background: rgba(255, 255, 255, 0.3);
                    width: 100%;
                    animation: toast-progress ${duration}ms linear;
                `;
                toast.appendChild(progressBar);

                // Добавляем CSS для анимации прогресс-бара
                if (!document.querySelector('#toast-progress-style')) {
                    const style = document.createElement('style');
                    style.id = 'toast-progress-style';
                    style.textContent = `
                        @keyframes toast-progress {
                            from { width: 100%; }
                            to { width: 0%; }
                        }
                    `;
                    document.head.appendChild(style);
                }

                setTimeout(removeToast, duration);
            }

            this.container.appendChild(toast);
            return toast;
        }

        processQueue() {
            // Обрабатываем очередь уведомлений
            if (this.queue.length > 0 && this.container.children.length < this.maxVisible) {
                const next = this.queue.shift();
                this.show(next.message, next.type, next.duration);
            }
        }

        remove(toast) {
            if (toast && toast.parentNode) {
                toast.classList.add('removing');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300); // Время анимации исчезновения
            }
        }

        // Удобные методы для разных типов уведомлений
        success(message, duration = 4000) {
            return this.show(message, 'success', duration);
        }

        error(message, duration = 6000) {
            return this.show(message, 'error', duration);
        }

        warning(message, duration = 5000) {
            return this.show(message, 'warning', duration);
        }

        info(message, duration = 4000) {
            return this.show(message, 'info', duration);
        }
    }

    // Создаем глобальный экземпляр Toast Manager
    const toastManager = new ToastManager();
    
    // Глобальная функция для показа Toast уведомлений
    window.showToast = function(message, type = 'info', duration = 4000) {
        return toastManager.show(message, type, duration);
    };

    // Создаём skeleton loader для карты
    function createMapSkeleton() {
        const skeleton = document.createElement('div');
        skeleton.id = 'map-skeleton';
        skeleton.className = 'skeleton-map';
        return skeleton;
    }

    // Создаём skeleton loader для таблиц
    function createTableSkeleton(rows = 5, columns = 4) {
        const table = document.createElement('table');
        table.className = 'skeleton-table';
        
        for (let i = 0; i < rows; i++) {
            const row = document.createElement('tr');
            for (let j = 0; j < columns; j++) {
                const cell = document.createElement('td');
                const skeletonDiv = document.createElement('div');
                skeletonDiv.className = `skeleton skeleton-row ${j === 0 ? 'wide' : j === 1 ? 'medium' : 'narrow'}`;
                cell.appendChild(skeletonDiv);
                row.appendChild(cell);
            }
            table.appendChild(row);
        }
        
        return table;
    }

    // Функции для управления skeleton loaders
    function showMapSkeleton() {
        const mapContainer = document.getElementById('map');
        if (mapContainer && !document.getElementById('map-skeleton')) {
            const skeleton = createMapSkeleton();
            mapContainer.appendChild(skeleton);
        }
    }

    function hideMapSkeleton() {
        const skeleton = document.getElementById('map-skeleton');
        if (skeleton) {
            skeleton.remove();
        }
    }

    function showTableSkeleton(container, rows = 5, columns = 4) {
        if (container && !container.querySelector('.skeleton-table')) {
            const skeleton = createTableSkeleton(rows, columns);
            container.appendChild(skeleton);
        }
    }

    function hideTableSkeleton(container) {
        const skeleton = container?.querySelector('.skeleton-table');
        if (skeleton) {
            skeleton.remove();
        }
    }

    // Добавляем skeleton для карты на начальном этапе
    showMapSkeleton();

    // Инициализация карты
    let map;
    try {
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.error('❌ Map element not found!');
            throw new Error('Map element #map not found');
        }
        
        map = L.map('map', {
            maxZoom: 19,
            minZoom: 3
        }).setView([41.32, 69.25], 13);
        // Делаем map доступной глобально для других частей кода
        window.map = map;
        console.log('✅ Map initialized');
    } catch (error) {
        console.error('❌ Error initializing map:', error);
        showToast('Ошибка инициализации карты: ' + error.message, 'error');
    }

    // Инициализация контрола слоев карты (используется для IndustrialPushPanel)
    // Визуальная панель не создается, только логика слоев
    // MapLayersControl сам добавит базовый слой карты
    if (typeof MapLayersControl !== 'undefined' && map) {
        try {
            window.USE_INDUSTRIAL_PANEL = true; // Флаг для предотвращения создания визуальной панели
            window.mapLayersControl = new MapLayersControl(map);
            console.log('✅ MapLayersControl initialized (for IndustrialPanel)');
        } catch (error) {
            console.error('❌ Error initializing MapLayersControl:', error);
            // Fallback: если MapLayersControl не работает, создаем базовый слой вручную
            if (map) {
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: ''
                }).addTo(map);
            }
        }
    } else {
        // Fallback: если MapLayersControl не загружен, создаем базовый слой вручную
        if (map) {
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: ''
            }).addTo(map);
        }
    }

    // Добавляем собственный контрол атрибуции только с OpenStreetMap
    // ИСПРАВЛЕНИЕ: Удаляем все существующие контролы атрибуции перед созданием нового,
    // чтобы избежать дублирования. Используем setTimeout для гарантии, что все слои загружены.
    if (map) {
        // Используем setTimeout, чтобы убедиться, что все контролы атрибуции уже созданы
        setTimeout(function() {
            // Удаляем все существующие контролы атрибуции
            const attributionControls = document.querySelectorAll('.leaflet-control-attribution');
            attributionControls.forEach(function(control) {
                control.remove();
            });
            
            // Создаем единый контрол атрибуции с OpenStreetMap
            const attributionControl = L.control.attribution({
                prefix: false  // Это убирает "Leaflet"
            });
            attributionControl.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
            attributionControl.addTo(map);
        }, 100);
    }

    // Инициализация промышленной панели управления
    industrialPanel = new IndustrialPushPanel();
    window.industrialPanel = industrialPanel;
    console.log('✅ IndustrialPushPanel initialized');

    // Создаем кнопку переключения панели как Leaflet control внутри карты (сверху слева)
    if (map) {
        const panelToggleControl = L.control({ position: 'topleft' });
        panelToggleControl.onAdd = function(map) {
            const container = L.DomUtil.create('div', 'push-panel-toggle-container');
            const button = L.DomUtil.create('button', 'push-panel-toggle');
            button.id = 'push-panel-toggle';
            button.setAttribute('aria-label', 'Открыть панель управления');
            button.setAttribute('type', 'button');
            
            // Создаем SVG иконку стрелки
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'toggle-icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M9 5l7 7-7 7');
            svg.appendChild(path);
            button.appendChild(svg);
            
            container.appendChild(button);
            
            // Добавляем обработчик клика ПЕРЕД disableClickPropagation
            // Используем обычный addEventListener для надежности
            button.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Toggle button clicked');
                // Вызываем toggle напрямую через промышленную панель
                if (window.industrialPanel && typeof window.industrialPanel.toggle === 'function') {
                    console.log('Calling industrialPanel.toggle()');
                    window.industrialPanel.toggle();
                    // Обновляем иконку в зависимости от состояния панели
                    setTimeout(() => {
                        const panel = document.getElementById('push-panel');
                        if (panel) {
                            const isExpanded = panel.classList.contains('expanded');
                            svg.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
                        }
                    }, 50);
                } else {
                    console.error('❌ IndustrialPanel not available');
                }
            });
            
            // Предотвращаем закрытие карты при клике на кнопку
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            
            // Также добавляем обработчик через L.DomEvent для совместимости с Leaflet
            // Но не добавляем логику здесь, так как она уже есть в addEventListener
            L.DomEvent.on(button, 'click', function(e) {
                L.DomEvent.stopPropagation(e);
            });
            
            return container;
        };
        panelToggleControl.addTo(map);
        
        // Обновляем ссылку на кнопку в IndustrialPanel после создания
        setTimeout(() => {
            const toggleBtn = document.getElementById('push-panel-toggle');
            if (toggleBtn && window.industrialPanel) {
                window.industrialPanel.toggleBtn = toggleBtn;
                // Если панель еще не инициализирована, инициализируем её
                if (!window.industrialPanel.initialized) {
                    window.industrialPanel.init();
                }
            }
        }, 100);
    }

    // Создаем элемент для отображения УК
    const ukControl = L.control({ position: 'topright' });
    ukControl.onAdd = function(map) {
        const container = L.DomUtil.create('div', 'uk-control');
        container.style.background = 'rgba(255, 255, 255, 0.9)';
        container.style.padding = '8px 12px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.1)';
        container.style.fontSize = '14px';
        container.style.fontWeight = '500';
        container.style.color = '#333';
        container.style.backdropFilter = 'blur(8px)';
        container.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        // ИСПРАВЛЕНИЕ XSS: Создаем логотип через DOM API вместо innerHTML
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        
        const img = document.createElement('img');
        img.src = 'public/images/BSK-Logo-transparent.png';
        img.alt = 'BSK Logo';
        img.style.cssText = 'width: 35px; height: 35px; object-fit: contain;';
        
        const span = document.createElement('span');
        span.textContent = 'InfraSafe';
        
        wrapper.appendChild(img);
        wrapper.appendChild(span);
        container.appendChild(wrapper);
        return container;
    };
    ukControl.addTo(map);

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
                        // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                        header.textContent = '';
                        const iconDiv1 = document.createElement('div');
                        iconDiv1.className = 'icon normal-icon';
                        const textSpan1 = document.createElement('span');
                        textSpan1.textContent = text;
                        header.appendChild(iconDiv1);
                        header.appendChild(textSpan1);
                        break;
                    case 'warning-group':
                        text = `Предупреждение (${count})`;
                        // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                        header.textContent = '';
                        const iconDiv2 = document.createElement('div');
                        iconDiv2.className = 'icon warning-icon';
                        const textSpan2 = document.createElement('span');
                        textSpan2.textContent = text;
                        header.appendChild(iconDiv2);
                        header.appendChild(textSpan2);
                        break;
                    case 'critical-group':
                        text = `Критическое (${count})`;
                        // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                        header.textContent = '';
                        const iconDiv3 = document.createElement('div');
                        iconDiv3.className = 'icon critical-icon';
                        const textSpan3 = document.createElement('span');
                        textSpan3.textContent = text;
                        header.appendChild(iconDiv3);
                        header.appendChild(textSpan3);
                        break;
                    case 'no-group':
                        text = `Нет контроллеров (${count})`;
                        // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                        header.textContent = '';
                        const iconDiv4 = document.createElement('div');
                        iconDiv4.className = 'icon no-controller-icon';
                        const textSpan4 = document.createElement('span');
                        textSpan4.textContent = text;
                        header.appendChild(iconDiv4);
                        header.appendChild(textSpan4);
                        break;
                    case 'leak-group':
                        text = `Протечка (${count})`;
                        // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                        header.textContent = '';
                        const iconDiv5 = document.createElement('div');
                        iconDiv5.className = 'icon leak-icon';
                        const textSpan5 = document.createElement('span');
                        textSpan5.textContent = text;
                        header.appendChild(iconDiv5);
                        header.appendChild(textSpan5);
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
            let hasOk = false;
            let hasNoController = false;

            for (let marker of markers) {
                const status = marker.options.status;
                if (status === 'leak') hasLeak = true;
                if (status === 'critical') hasCritical = true;
                if (status === 'warning') hasWarning = true;
                if (status === 'ok') hasOk = true;
                if (status === 'no') hasNoController = true; // Здание без контроллера
            }

            // Задаем цвет кластера в зависимости от приоритета статусов
            let className = 'marker-cluster-custom';
            let style = '';

            if (hasLeak) {
                // Приоритет 1: Протечка (синий, мигающий)
                className += ' marker-cluster-leak';
                style = 'background-color: rgba(33, 150, 243, 0.8); color: white;';
            } else if (hasCritical) {
                // Приоритет 2: Критическая ситуация (красный)
                className += ' marker-cluster-critical';
                style = 'background-color: rgba(255, 0, 0, 0.8); color: white;';
            } else if (hasWarning) {
                // Приоритет 3: Предупреждение (оранжевый)
                className += ' marker-cluster-warning';
                style = 'background-color: rgba(255, 165, 0, 0.8); color: white;';
            } else if (hasOk && !hasNoController) {
                // Приоритет 4: Все здания с контроллерами в норме (зеленый)
                className += ' marker-cluster-ok';
                style = 'background-color: rgba(0, 128, 0, 0.8); color: white;';
            } else if (hasNoController && !hasOk) {
                // Приоритет 5: Все здания БЕЗ контроллеров (серый)
                className += ' marker-cluster-no-controller';
                style = 'background-color: rgba(102, 102, 102, 0.8); color: white;';
            } else {
                // Смешанная группа: есть здания с контроллерами и без (светло-серый)
                className += ' marker-cluster-mixed';
                style = 'background-color: rgba(158, 158, 158, 0.8); color: white;';
            }

            return L.divIcon({
                html: `<div style="${style}"><span>${cluster.getChildCount()}</span></div>`,
                className: className,
                iconSize: L.point(25, 25) // Уменьшено с 40x40 до 25x25 (в 2.56 раза меньше по площади)
            });
        }
    }).addTo(map);

    // Создаем переменные для хранения настроек обновления
    let updateInterval = 60; // секунды
    let autoUpdateEnabled = false;
    let updateTimer = null;
    let lastUpdateTime = null; // Инициализируем как null

    // Создаем элемент управления обновлением (единый модуль справа сверху)
    const updateControl = L.control({ position: 'topright' });
    updateControl.onAdd = function(map) {
        const container = L.DomUtil.create('div', 'update-control');

        // Создаем кнопку-заголовок с информацией об обновлении (всегда видимая)
        const toggleButton = L.DomUtil.create('button', 'update-toggle-button', container);
        
        // Контейнер для времени обновления
        const updateTimeDisplay = document.createElement('div');
        updateTimeDisplay.className = 'update-time-display';

        const updateLabel = document.createElement('span');
        updateLabel.textContent = 'ОБНОВЛЕНО';
        updateTimeDisplay.appendChild(updateLabel);

        const updateTime = document.createElement('span');
        updateTime.className = 'update-time';
        updateTime.textContent = '2 минуты назад';
        updateTimeDisplay.appendChild(updateTime);

        toggleButton.appendChild(updateTimeDisplay);

        // Иконка для раскрытия/сворачивания
        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'toggle-icon';
        toggleIcon.textContent = '+';
        toggleButton.appendChild(toggleIcon);

        // Создаем контейнер для содержимого (раскрывается при клике)
        const contentContainer = L.DomUtil.create('div', 'update-content', container);

        // Кнопка обновления
        const updateButton = L.DomUtil.create('button', 'update-now', contentContainer);
        updateButton.textContent = 'Обновить сейчас';

        // Автообновление
        const autoUpdateLabel = L.DomUtil.create('label', 'auto-update-label', contentContainer);
        const autoUpdateCheckbox = L.DomUtil.create('input', '', autoUpdateLabel);
        autoUpdateCheckbox.type = 'checkbox';
        autoUpdateCheckbox.id = 'auto-update';
        autoUpdateLabel.appendChild(document.createTextNode('Автообновление'));

        // Селектор интервала
        const intervalLabel = L.DomUtil.create('div', 'interval-label', contentContainer);
        intervalLabel.textContent = 'Интервал обновления:';
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
        if (!lastUpdateTime) {
            lastUpdateTime = new Date();
            return;
        }

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

    // Глобальное хранилище для popup контента зданий (для клика из списка статусов)
    const buildingPopupStorage = new Map();

    // Функция загрузки данных с сервера
    async function loadData() {
        try {
            // Очищаем старые маркеры и боковую панель
            markers.clearLayers();
            // Очищаем хранилище popup контента
            buildingPopupStorage.clear();
            // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для очистки
            document.querySelectorAll('#ok-group .status-items, #warning-group .status-items, #critical-group .status-items, #no-group .status-items, #leak-group .status-items').forEach(group => {
                group.textContent = '';
            });

            // Fetch data from the backend using API client
            const response = await apiClient.fetch('/buildings-metrics');
            
            // Проверяем статус ответа
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Парсим JSON ответ
            let result;
            try {
                const text = await response.text();
                if (!text) {
                    throw new Error('Пустой ответ от сервера');
                }
                result = JSON.parse(text);
            } catch (parseError) {
                console.error('Ошибка парсинга JSON:', parseError);
                throw new Error(`Ошибка парсинга ответа: ${parseError.message}`);
            }
            
            // Проверяем формат данных
            const data = Array.isArray(result) ? result : (result.data || result.buildings || []);
            
            if (!Array.isArray(data)) {
                console.warn('⚠️ Данные не в формате массива:', result);
                throw new Error('Некорректный формат данных от сервера');
            }
            
            console.log(`✅ Загружено зданий: ${data.length}`);

            // Обновляем название УК на карте
            if (data.length > 0) {
                // Собираем все уникальные названия УК
                const uniqueCompanies = [...new Set(data
                    .filter(item => item.management_company)
                    .map(item => item.management_company))];

                // Если есть хотя бы одна УК, отображаем её
                if (uniqueCompanies.length > 0) {
                    const ukControl = document.querySelector('.uk-control');
                    if (ukControl) {
                        // ИСПРАВЛЕНИЕ XSS: Используем textContent вместо innerHTML для безопасности
                        const wrapper = ukControl.querySelector('div');
                        if (wrapper) {
                            const span = wrapper.querySelector('span');
                            if (span) {
                                span.textContent = uniqueCompanies[0];
                            }
                        }
                    }
                }
            }

            // Счетчик зданий с протечкой
            let leakBuildingsCount = 0;

            data.forEach((item) => {
                // Проверяем наличие валидных координат
                if (!item.latitude || !item.longitude || isNaN(parseFloat(item.latitude)) || isNaN(parseFloat(item.longitude))) {
                    console.warn("Skipping invalid data - missing or invalid coordinates:", item.building_name || item.building_id);
                    return;
                }

                // Преобразуем координаты в числа для корректной работы Leaflet
                item.latitude = parseFloat(item.latitude);
                item.longitude = parseFloat(item.longitude);

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
                const isColdWaterOK = item.cold_water_pressure && item.cold_water_pressure > 1;
                const coldWaterImage = isColdWaterOK
                    ? 'data/images/Water_Blue.png'
                    : 'data/images/Water_No_Blue.png';

                // Determine hot water status
                // Если здание не подключено к ГВС (hot_water === false или NULL), то это не ошибка
                // Если подключено к ГВС (hot_water === true), то проверяем наличие и корректность данных
                const isHotWaterOK = item.hot_water !== true ||
                                   (item.hot_water === true &&
                                    item.hot_water_in_pressure && item.hot_water_out_pressure &&
                                    item.hot_water_in_pressure >= 1 && item.hot_water_out_pressure >= 1);
                const hotWaterImage = (item.hot_water === false) 
                    ? 'data/images/Water_Red.png'  // Серая иконка для неподключенных зданий
                    : (isHotWaterOK ? 'data/images/Water_Red.png' : 'data/images/Water_No_Red.png');

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
                } else if (item.controller_id && (
                    // Проверяем полное отсутствие основных систем
                    ((!item.electricity_ph1 || item.electricity_ph1 <= 0) &&
                     (!item.electricity_ph2 || item.electricity_ph2 <= 0) &&
                     (!item.electricity_ph3 || item.electricity_ph3 <= 0)) || // Нет электричества
                    (!item.cold_water_pressure || item.cold_water_pressure <= 0) || // Нет холодной воды
                    // Проверяем ГВС только если здание должно иметь ГВС
                    (item.hot_water &&
                     (!item.hot_water_in_pressure || item.hot_water_in_pressure <= 0) &&
                     (!item.hot_water_out_pressure || item.hot_water_out_pressure <= 0)) // Нет горячей воды
                )) {
                    status = 'critical';
                } else if (item.controller_id && (
                    // Проверяем частичное нарушение работы систем
                    (item.electricity_ph1 > 0 || item.electricity_ph2 > 0 || item.electricity_ph3 > 0) && // Есть хотя бы одна фаза
                    (item.cold_water_pressure && item.cold_water_pressure > 0) && // Есть холодная вода
                    // ГВС: либо здание не требует ГВС, либо ГВС есть
                    (!item.hot_water ||
                     (item.hot_water_in_pressure && item.hot_water_in_pressure > 0) ||
                     (item.hot_water_out_pressure && item.hot_water_out_pressure > 0))
                )) {
                    status = 'warning';
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
                // ИСПРАВЛЕНИЕ XSS: Используем безопасные функции для экранирования данных
                const escapeHTML = window.DOMSecurity && window.DOMSecurity.escapeHTML ? window.DOMSecurity.escapeHTML : (text) => {
                    const div = document.createElement('div');
                    div.textContent = text || '';
                    return div.innerHTML;
                };
                const formatValue = window.DOMSecurity && window.DOMSecurity.formatPopupValue ? window.DOMSecurity.formatPopupValue : (value, suffix, defaultValue) => {
                    if (value === null || value === undefined) return escapeHTML(defaultValue);
                    return escapeHTML(String(value) + suffix);
                };
                
                // Create a popup with building details
                if(status === 'no'){
                    popupContent = `
                    <div>
                        <strong>${escapeHTML(item.building_name || '')}</strong><br></br>
                        no controller data
                    </div>`;
                }
                else
                {

                    // Create popup content for building with electricity and cold water data
                    // ИСПРАВЛЕНИЕ XSS: Все пользовательские данные экранируются
                    const buildingName = escapeHTML(item.building_name || '');
                    const ph1Class = !item.electricity_ph1 ? "class='blinking-text-red'" : (!isPhase1Ok ? "class='blinking-cell-orange'" : '');
                    const ph2Class = !item.electricity_ph2 ? "class='blinking-text-red'" : (!isPhase2Ok ? "class='blinking-cell-orange'" : '');
                    const ph3Class = !item.electricity_ph3 ? "class='blinking-text-red'" : (!isPhase3Ok ? "class='blinking-cell-orange'" : '');
                    const ph1Value = formatValue(item.electricity_ph1, 'V', 'Нет данных');
                    const ph2Value = formatValue(item.electricity_ph2, 'V', 'Нет данных');
                    const ph3Value = formatValue(item.electricity_ph3, 'V', 'Нет данных');
                    const coldWaterClass = !item.cold_water_pressure ? "class='blinking-text-red'" : (!isColdWaterOK ? "class='blinking-cell-orange'" : '');
                    const coldWaterPressure = formatValue(item.cold_water_pressure, ' Bar', 'Нет данных');
                    const coldWaterTemp = formatValue(item.cold_water_temp, '°C', 'Нет данных');
                    
                    popupContent = `
            <div>
                <strong>${buildingName}</strong><br>
                <table>
                    <!-- Electricity Data -->
                    <tr>
                        <td><img src="${electricityImage}" alt="Electricity_Status" style="width: 20px;" /></td>
                        <td ${ph1Class}>${ph1Value}</td>
                        <td ${ph2Class}>${ph2Value}</td>
                        <td ${ph3Class}>${ph3Value}</td>
                    </tr>
                    
                    <!-- Power Data - будет загружено динамически -->
                    <tr id="power-row-${item.building_id}" style="display: none;">
                        <td style="font-size: 10px; color: #666;">💡</td>
                        <td id="power-ph1-${item.building_id}" style="font-size: 11px; font-weight: 600; color: #2d3748;"></td>
                        <td id="power-ph2-${item.building_id}" style="font-size: 11px; font-weight: 600; color: #2d3748;"></td>
                        <td id="power-ph3-${item.building_id}" style="font-size: 11px; font-weight: 600; color: #2d3748;"></td>
                    </tr>
                    
                    <!-- Total Power - будет загружено динамически -->
                    <tr id="total-power-row-${item.building_id}" style="display: none;">
                        <td style="font-size: 10px; color: #666;">Σ</td>
                        <td colspan="3" id="total-power-${item.building_id}" style="font-size: 11px; font-weight: 700; color: #1a5490;"></td>
                    </tr>

                    <!-- Cold Water Data -->
                    <tr>
                        <td><img src="${coldWaterImage}" alt="Cold_Water" style="width: 20px;" /></td>
                        <td colspan="3" ${coldWaterClass}>
                            <strong>ХВС:</strong> ${coldWaterPressure},
                            ${coldWaterTemp}
                        </td>
                    </tr>

                    <!-- Hot Water Data -->
                    ${item.hot_water_in_temp && item.hot_water_out_temp && item.hot_water_in_pressure && item.hot_water_out_pressure ? `
                    <tr>
                        <td><img src="data/images/Water_Red.png" alt="Hot_Water" style="width: 20px;" /></td>
                        <td colspan="3" ${!isHotWaterOK ? "class='blinking-cell-orange'" : ''}>
                            <strong>ГВС Подача:</strong> ${formatValue(item.hot_water_in_temp, '°C', '')}, ${formatValue(item.hot_water_in_pressure, ' Bar', '')}
                        </td>
                    </tr>
                    <tr>
                        <td></td>
                        <td colspan="3"><strong>ГВС Обратка:</strong> ${formatValue(item.hot_water_out_temp, '°C', '')}, ${formatValue(item.hot_water_out_pressure, ' Bar', '')}</td>
                    </tr>` : `
                    <tr>
                        <td><img src="data/images/Water_Red.png" alt="Hot_Water" style="width: 20px;" /></td>
                        <td colspan="3" ${item.hot_water !== true ? '' : 'class="blinking-text-red"'}>
                            <strong>ГВС:</strong> ${item.hot_water !== true ? 'Не подключено' : 'Нет данных'}
                        </td>
                    </tr>`}

                    <!-- Leak Sensor Data -->
                    <tr>
                        <td><img src="${leakSensorImage}" alt="Leak_Sensor_Status" style="width: 20px;" /></td>
                        <td colspan="3" ${hasLeak ? "class='blinking-cell-orange'" : ''}>
                            <strong>Датчик протечки:</strong> ${hasLeak ? 'Протечка!' : 'OK'}
                        </td>
                    </tr>
                </table>
            </div>
        `;
                };

                // ИСПРАВЛЕНИЕ XSS: Санитизируем popup контент перед использованием
                if (window.DOMSecurity && window.DOMSecurity.sanitizePopupContent) {
                    popupContent = window.DOMSecurity.sanitizePopupContent(popupContent);
                }
                
                marker.bindPopup(popupContent).addTo(markers);
                markers.addLayer(marker);

                // Сохраняем содержимое попапа глобально для этого маркера (уже санитизированное)
                marker._popupContent = popupContent;
                
                // Сохраняем popup контент в глобальное хранилище для использования при клике из списка
                buildingPopupStorage.set(item.building_id, popupContent);
                
                // При открытии popup загружаем данные мощности
                marker.on('popupopen', async () => {
                    try {
                        const powerResponse = await fetch(`http://localhost:3000/api/power-analytics/buildings/${item.building_id}`);
                        if (powerResponse.ok) {
                            const powerData = await powerResponse.json();
                            
                            if (powerData.success && powerData.data) {
                                const data = powerData.data;
                                
                                // Обновляем ячейки с мощностью по фазам
                                const powerPh1 = document.getElementById(`power-ph1-${item.building_id}`);
                                const powerPh2 = document.getElementById(`power-ph2-${item.building_id}`);
                                const powerPh3 = document.getElementById(`power-ph3-${item.building_id}`);
                                const powerRow = document.getElementById(`power-row-${item.building_id}`);
                                
                                if (powerPh1 && powerPh2 && powerPh3 && powerRow) {
                                    powerPh1.textContent = `${data.power_ph1_kw} кВт`;
                                    powerPh2.textContent = `${data.power_ph2_kw} кВт`;
                                    powerPh3.textContent = `${data.power_ph3_kw} кВт`;
                                    powerRow.style.display = '';
                                }
                                
                                // Обновляем общую мощность
                                const totalPower = document.getElementById(`total-power-${item.building_id}`);
                                const totalPowerRow = document.getElementById(`total-power-row-${item.building_id}`);
                                
                                if (totalPower && totalPowerRow) {
                                    totalPower.innerHTML = `<strong>Общая мощность:</strong> ${data.total_power_kw} кВт`;
                                    totalPowerRow.style.display = '';
                                }
                            }
                        }
                    } catch (error) {
                        console.warn('Не удалось загрузить данные мощности для здания:', error);
                    }
                });

                // Update the sidebar with building information
                const sidebarGroup = document.querySelector(`#${status}-group .status-items`);
                if (sidebarGroup) {
                    const sidebarItem = document.createElement("div");
                    sidebarItem.classList.add("sidebar-item");
                    
                    // Сохраняем данные здания в data-атрибутах для обработчика клика
                    sidebarItem.dataset.buildingId = item.building_id;
                    sidebarItem.dataset.latitude = item.latitude;
                    sidebarItem.dataset.longitude = item.longitude;
                    sidebarItem.dataset.buildingName = item.building_name || '';
                    
                    // ИСПРАВЛЕНИЕ XSS: Замена innerHTML на безопасные DOM методы
                    if (item.controller_id) {
                        // Создаем элементы безопасным способом
                        const elecImg = document.createElement('img');
                        elecImg.src = electricityImage;
                        elecImg.alt = 'Electricity_Status';
                        elecImg.style.width = '20px';
                        elecImg.style.height = '20px';
                        elecImg.style.objectFit = 'contain';
                        sidebarItem.appendChild(elecImg);
                        
                        if (isColdWaterOK) {
                            const coldWaterImg = document.createElement('img');
                            coldWaterImg.src = coldWaterImage;
                            coldWaterImg.alt = 'Cold_Water_Status';
                            coldWaterImg.style.width = '20px';
                            coldWaterImg.style.height = '20px';
                            coldWaterImg.style.objectFit = 'contain';
                            sidebarItem.appendChild(coldWaterImg);
                        }
                        
                        if (item.hot_water !== false) {
                            const hotWaterImg = document.createElement('img');
                            hotWaterImg.src = hotWaterImage;
                            hotWaterImg.alt = 'Hot_Water_Status';
                            hotWaterImg.style.width = '20px';
                            hotWaterImg.style.height = '20px';
                            hotWaterImg.style.objectFit = 'contain';
                            sidebarItem.appendChild(hotWaterImg);
                        }
                        
                        const leakImg = document.createElement('img');
                        leakImg.src = leakSensorImage;
                        leakImg.alt = 'Leak_Sensor_Status';
                        leakImg.style.width = '20px';
                        leakImg.style.height = '20px';
                        leakImg.style.objectFit = 'contain';
                        sidebarItem.appendChild(leakImg);
                        
                        const buildingNameText = document.createTextNode(item.building_name || '');
                        sidebarItem.appendChild(buildingNameText);
                    } else {
                        const noControllerImg = document.createElement('img');
                        noControllerImg.src = 'data/images/no_controller.png';
                        noControllerImg.alt = 'No_Controller';
                        noControllerImg.style.width = '20px';
                        noControllerImg.style.height = '20px';
                        noControllerImg.style.objectFit = 'contain';
                        sidebarItem.appendChild(noControllerImg);
                        
                        const buildingNameText = document.createTextNode(item.building_name || '');
                        sidebarItem.appendChild(buildingNameText);
                    }

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
            if (markers.getLayers().length > 0) {
                map.fitBounds(markers.getBounds(), { padding: [50, 50] });
            }

            // Обновляем счетчики элементов в заголовках и заголовок группы протечек
            updateGroupHeaders();

            // Синхронизируем статусы с промышленной панелью
            if (window.industrialPanel && typeof window.industrialPanel.updateStatusGroups === 'function') {
                window.industrialPanel.updateStatusGroups();
            }

            // Скрываем skeleton loader карты
            hideMapSkeleton();

            // Обновляем время последнего обновления
            lastUpdateTime = new Date(); // Устанавливаем новое время обновления
            updateLastUpdateTime();

            // Убедимся, что состояние свернутых групп соответствует нашим правилам
            updateGroupsCollapsedState();

            // После обновления данных обновляем счетчики
            updateGroupCounters();

            // Возвращаем успешный результат
            return true;
        } catch (error) {
            console.error("Error loading data:", error);
            
            // Показываем Toast уведомление об ошибке
            showToast(`Ошибка загрузки данных: ${error.message || 'Неизвестная ошибка'}`, 'error');
            
            // Скрываем skeleton и показываем ошибку
            hideMapSkeleton();
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

                // Если сайдбар свернут, разворачиваем его и открываем группу
                if (sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                    // Сворачиваем все группы
                    document.querySelectorAll('.status-group').forEach(group => {
                        const items = group.querySelector('.status-items');
                        const header = group.querySelector('.group-header');
                        if (items && header) {
                            items.classList.add('collapsed');
                            header.classList.add('collapsed');
                        }
                    });
                    // Разворачиваем только текущую группу
                    const statusItems = this.nextElementSibling;
                    if (statusItems) {
                        statusItems.classList.remove('collapsed');
                        this.classList.remove('collapsed');
                    }
                } else {
                    // Если сайдбар развернут, просто переключаем состояние группы
                    const statusItems = this.nextElementSibling;
                    if (statusItems && statusItems.classList.contains('status-items')) {
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
