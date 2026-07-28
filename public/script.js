// ============================================================
// ЦВЕТА ИЗ ТОКЕНОВ ТЕМЫ
// ============================================================

/**
 * Значение CSS-переменной темы с запасным литералом.
 *
 * Карта рисуется не только стилями: маркеры, легенда и накладные плашки
 * задаются из кода. Раньше цвета в них были литералами и не менялись вместе
 * с брендом. Запасное значение оставлено литералом намеренно — в окне
 * деплоя возможна пара «новый бандл, старый CSS», и лучше показать
 * небрендовый, но видимый цвет, чем пустую строку.
 *
 * @param {string} name - имя переменной, например '--st-crit'
 * @param {string} fallback
 * @returns {string}
 */
function T(name, fallback) {
    return window.BrandTokens ? window.BrandTokens.token(name, fallback) : fallback;
}

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
            } else {
                // Переключаем на темную тему
                htmlElement.classList.add('dark');
                localStorage.setItem('theme', 'dark');
                themeIconSun.style.display = 'block';
                themeIconMoon.style.display = 'none';
            }
        });
    }
}

// ============================================================
// УПРАВЛЕНИЕ БАННЕРОМ ТЕСТОВЫХ ДАННЫХ
// ============================================================

/**
 * Функция для инициализации баннера с тестовыми данными
 * Позволяет пользователю скрыть баннер, состояние сохраняется в localStorage
 */
function initTestDataBanner() {
    const banner = document.getElementById('test-data-banner');
    const closeButton = document.getElementById('test-data-close');
    
    if (!banner || !closeButton) {
        console.warn('⚠️ Баннер или кнопка закрытия не найдены');
        return; // Баннер не найден, выходим
    }
    
    // Проверяем, было ли баннер скрыт ранее
    const isHidden = localStorage.getItem('testDataBannerHidden') === 'true';
    
    if (isHidden) {
        // Если баннер был скрыт, скрываем его сразу
        banner.classList.add('hidden');
        // Обновляем позиционирование других элементов
        updateLayoutForBanner(false);
    } else {
        // Если баннер виден, обновляем позиционирование
        updateLayoutForBanner(true);
    }
    
    // Удаляем старые обработчики если есть (чтобы избежать дублирования)
    const newCloseButton = closeButton.cloneNode(true);
    closeButton.parentNode.replaceChild(newCloseButton, closeButton);
    
    // Обработчик клика на кнопку закрытия
    newCloseButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const bannerEl = document.getElementById('test-data-banner');
        if (bannerEl) {
            // Скрываем баннер с анимацией
            bannerEl.classList.add('hidden');
            // Сохраняем состояние в localStorage
            localStorage.setItem('testDataBannerHidden', 'true');
            // Обновляем позиционирование других элементов
            updateLayoutForBanner(false);
        }
    });
}

/**
 * Функция для обновления позиционирования элементов при показе/скрытии баннера
 * @param {boolean} bannerVisible - Виден ли баннер
 */
function updateLayoutForBanner(bannerVisible) {
    const mainHeading = document.querySelector('.main-heading');
    const content = document.querySelector('.content');
    const banner = document.getElementById('test-data-banner');
    
    // Вычисляем реальную высоту баннера в rem
    let bannerHeight = 0;
    if (bannerVisible && banner) {
        // Получаем высоту баннера в пикселях
        const bannerHeightPx = banner.offsetHeight;
        // Конвертируем в rem (1rem = 14px по умолчанию)
        const remSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        bannerHeight = bannerHeightPx / remSize;
    }
    
    // Используем requestAnimationFrame для плавного обновления
    requestAnimationFrame(() => {
        if (mainHeading) {
            // Обновляем позицию main-heading: header (4rem) + баннер
            mainHeading.style.top = `${4 + bannerHeight}rem`;
        }
        
        if (content) {
            // Обновляем позицию content: header (4rem) + баннер + main-heading (3rem)
            // Высота main-heading примерно 3rem (0.75rem padding * 2 + высота текста)
            content.style.top = `${4 + bannerHeight + 3}rem`;
        }
    });
}

// Инициализируем переключение темы при загрузке DOM
document.addEventListener('DOMContentLoaded', function() {
    initThemeToggle();
    // Инициализируем баннер с небольшой задержкой, чтобы убедиться, что все элементы загружены
    setTimeout(function() {
        initTestDataBanner();
    }, 100);
});

// Также пытаемся инициализировать баннер при полной загрузке страницы
window.addEventListener('load', function() {
    // Проверяем, был ли баннер уже инициализирован
    const closeButton = document.getElementById('test-data-close');
    if (closeButton && !closeButton.hasAttribute('data-initialized')) {
        closeButton.setAttribute('data-initialized', 'true');
        initTestDataBanner();
    }
});

// Используем делегирование событий как резервный вариант
// Это гарантирует, что обработчик будет работать даже если функция не вызвалась
document.addEventListener('click', function(e) {
    // Проверяем, был ли клик по кнопке закрытия баннера
    if (e.target && (e.target.id === 'test-data-close' || e.target.closest('#test-data-close'))) {
        const banner = document.getElementById('test-data-banner');
        if (banner && !banner.classList.contains('hidden')) {
            e.preventDefault();
            e.stopPropagation();
            banner.classList.add('hidden');
            localStorage.setItem('testDataBannerHidden', 'true');
            updateLayoutForBanner(false);
        }
    }
});

document.addEventListener('DOMContentLoaded', async function () {
    // [1A-FU-C-M1] Phase 2: localStorage cleanup.
    // The HttpOnly access_token cookie set by the server on /auth/login
    // is the only auth credential. APIClient no longer stores or sets
    // a token; `credentials: 'same-origin'` on each fetch makes the
    // browser attach the cookie automatically.
    //
    // The `isAuthenticated` boolean is in-memory UI state only — its
    // purpose is to drive the "Войти / Выйти" button label. Source of
    // truth on initialization is a GET /api/auth/profile probe.
    class APIClient {
        constructor(baseURL) {
            this.baseURL = baseURL;
            this.isAuthenticated = false;
            // One-shot migration hygiene: scrub any leftover legacy entries
            // so an XSS payload reading localStorage finds nothing.
            try {
                localStorage.removeItem('admin_token');
                localStorage.removeItem('refresh_token');
            } catch (_) { /* private mode etc — non-fatal */ }
        }

        // [1A-FU-C-M1] setToken kept as no-op for backward-compat with
        // callers that still invoke `apiClient.setToken(null)` on logout.
        // It now just flips the UI flag.
        setToken(token) {
            this.isAuthenticated = !!token;
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

            // [1A-FU-C-M1] No Authorization header injection — the
            // HttpOnly cookie set by /auth/login carries auth.
            // credentials: 'same-origin' (set below on the fetch call)
            // ensures the cookie is sent.
            // [AUD-013] The client CSRF-token machinery was removed. The server
            // never validated X-CSRF-Token (see src/middleware/csrfOriginGuard.js);
            // the real CSRF defense is SameSite=Strict cookies + the server-side
            // Origin/Referer guard (SEC-23). The old block was also a no-op here:
            // it mutated options.headers AFTER `headers` was snapshotted above,
            // and the fetch call below spreads `...options` then overrides with
            // the stale `headers`, so the token never went out anyway.

            // Формируем полный URL
            const fullURL = url.startsWith('http') ? url : `${this.baseURL}${url}`;

            try {
                const response = await fetch(fullURL, {
                    ...options,
                    credentials: options.credentials || 'same-origin',
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
            // [AUD-044] Removed the dead `pathname.includes('admin.html')` redirect:
            // script.js is loaded only by index.html (the map page), so the admin
            // branch was unreachable. The admin page has its own guard
            // (admin-auth.js) that handles 401 → /login.html.
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
            } else {
                this.panel.classList.remove('expanded');
                this.panel.classList.add('collapsed');
                // Принудительно устанавливаем transform для гарантии скрытия
                this.panel.style.transform = 'translateX(-100%)';
            }
        }
        
        /**
         * Переключение между вкладками
         * @param {string} tabName - Имя вкладки (layers, status)
         */
        switchTab(tabName) {
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
                            mapLayersControl.refreshLayerCounts();
                        } else {
                            // Если счетчики еще не загружены, ждем еще немного и проверяем снова
                            setTimeout(() => {
                                if (mapLayersControl.layerCounts && mapLayersControl.layerCounts.size > 0) {
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
            
            // Легенда обязана показывать РОВНО те цвета, которыми нарисованы
            // маркеры, иначе она вводит в заблуждение. Раньше расходились:
            // легенда #4caf50, маркер — ключевое слово 'green' (#008000).
            // Создаем группы статусов
            const statusGroups = [
                { id: 'industrial-ok-group', title: '✓ Нет проблем', icon: '✓', color: T('--st-ok', '#4caf50') },
                { id: 'industrial-warning-group', title: '⚠ Предупреждение', icon: '⚠', color: T('--st-warn', '#ff9800') },
                { id: 'industrial-leak-group', title: '💧 Вода в подвале', icon: '💧', color: T('--st-info', '#2196f3') },
                { id: 'industrial-critical-group', title: '🔴 Авария', icon: '🔴', color: T('--st-crit', '#f44336') },
                { id: 'industrial-no-group', title: '⚪ Нет контроллера', icon: '⚪', color: T('--st-offline', '#9e9e9e') }
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
            
            // Обновляем статусы после создания структуры
            this.updateStatusGroups();
        }
        
        /**
         * Обновить группы статусов в промышленной панели
         * Работает напрямую с window.buildingsData без DOM-клонирования
         */
        updateStatusGroups() {
            const statusGroups = ['ok', 'warning', 'leak', 'critical', 'no'];
            const buildingsData = window.buildingsData || [];

            statusGroups.forEach(groupId => {
                // Получаем элементы промышленной панели
                const industrialGroup = document.querySelector(`#industrial-${groupId}-group .status-group-items`);
                const industrialCounter = document.querySelector(`#industrial-${groupId}-group .group-counter`);

                if (!industrialGroup || !industrialCounter) return;

                // Очищаем старые элементы
                industrialGroup.innerHTML = '';

                // Фильтруем здания по статусу
                const filteredBuildings = buildingsData.filter(b => b.status === groupId);

                // Создаем элементы для каждого здания
                filteredBuildings.forEach(building => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'status-group-item';
                    itemDiv.style.cursor = 'pointer';

                    // Сохраняем данные в data-атрибутах
                    itemDiv.dataset.buildingId = building.building_id;
                    itemDiv.dataset.latitude = building.latitude;
                    itemDiv.dataset.longitude = building.longitude;

                    // Создаем иконки статусов
                    if (building.controller_id) {
                        // Иконка электричества
                        const elecImg = document.createElement('img');
                        elecImg.src = building.electricityImage;
                        elecImg.alt = 'Electricity';
                        elecImg.style.cssText = 'width: 20px; height: 20px; object-fit: contain;';
                        itemDiv.appendChild(elecImg);

                        // Иконка холодной воды (если есть)
                        if (building.isColdWaterOK) {
                            const coldImg = document.createElement('img');
                            coldImg.src = building.coldWaterImage;
                            coldImg.alt = 'Cold Water';
                            coldImg.style.cssText = 'width: 20px; height: 20px; object-fit: contain;';
                            itemDiv.appendChild(coldImg);
                        }

                        // Иконка горячей воды (если подключено)
                        if (building.hasHotWater) {
                            const hotImg = document.createElement('img');
                            hotImg.src = building.hotWaterImage;
                            hotImg.alt = 'Hot Water';
                            hotImg.style.cssText = 'width: 20px; height: 20px; object-fit: contain;';
                            itemDiv.appendChild(hotImg);
                        }

                        // Иконка датчика протечки
                        const leakImg = document.createElement('img');
                        leakImg.src = building.leakSensorImage;
                        leakImg.alt = 'Leak Sensor';
                        leakImg.style.cssText = 'width: 20px; height: 20px; object-fit: contain;';
                        itemDiv.appendChild(leakImg);
                    } else {
                        // Иконка "нет контроллера"
                        const noCtrlImg = document.createElement('img');
                        noCtrlImg.src = 'data/images/no_controller.png';
                        noCtrlImg.alt = 'No Controller';
                        noCtrlImg.style.cssText = 'width: 20px; height: 20px; object-fit: contain;';
                        itemDiv.appendChild(noCtrlImg);
                    }

                    // Название здания
                    const nameText = document.createTextNode(' ' + building.building_name);
                    itemDiv.appendChild(nameText);

                    // Обработчик клика — центрирование карты и открытие popup
                    itemDiv.addEventListener('click', () => {
                        const lat = building.latitude;
                        const lng = building.longitude;
                        const buildingId = building.building_id;

                        if (lat && lng) {
                            // Находим маркер здания
                            let targetMarker = null;
                            markers.eachLayer(marker => {
                                if (marker.building_id === buildingId) {
                                    targetMarker = marker;
                                }
                            });

                            if (targetMarker) {
                                map.flyTo([lat, lng], 16, { duration: 0.5 });
                                setTimeout(() => {
                                    targetMarker.openPopup();
                                    markers.unspiderfy();
                                }, 300);
                            } else {
                                // Используем сохраненный popup контент
                                const savedPopupContent = buildingPopupStorage.get(buildingId);
                                map.flyTo([lat, lng], 16, { duration: 0.5 });
                                if (savedPopupContent) {
                                    L.popup()
                                        .setLatLng([lat, lng])
                                        .setContent(savedPopupContent)
                                        .openOn(map);
                                }
                            }
                        }
                    });

                    industrialGroup.appendChild(itemDiv);
                });

                // Обновляем счетчик
                industrialCounter.textContent = filteredBuildings.length;

                // Показываем/скрываем группу
                industrialGroup.style.display = filteredBuildings.length > 0 ? 'block' : 'none';
            });
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
    // Создаем кнопку переключения панели как Leaflet control внутри карты (сверху слева)
    if (map) {
        const panelToggleControl = L.control({ position: 'topleft' });
        panelToggleControl.onAdd = function() {
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
                // Вызываем toggle напрямую через промышленную панель
                if (window.industrialPanel && typeof window.industrialPanel.toggle === 'function') {
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
    ukControl.onAdd = function() {
        const container = L.DomUtil.create('div', 'uk-control');
        container.style.background = T('--card', 'rgba(255, 255, 255, 0.9)');
        container.style.padding = '8px 12px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.1)';
        container.style.fontSize = '14px';
        container.style.fontWeight = '500';
        container.style.color = T('--foreground', '#333');
        container.style.backdropFilter = 'blur(8px)';
        container.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        // ИСПРАВЛЕНИЕ XSS: Создаем логотип через DOM API вместо innerHTML
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        
        const img = document.createElement('img');
        // Через /brand/, а не прямой путь: этот знак — часть бренда, и nginx
        // подставляет каталог нужного хоста. Раньше здесь висел BSK-Logo,
        // который оставался прежним даже на брендированной площадке.
        img.src = '/brand/mark-small.svg';
        img.alt = '';
        img.style.cssText = 'width: 35px; height: 35px; object-fit: contain;';
        
        const span = document.createElement('span');
        // Имя берётся из бренда: на profk.uz это «ProFK», на infrasafe.uz —
        // «InfraSafe». Раньше строка была захардкожена, и брендированная
        // площадка подписывала плашку чужим именем.
        span.textContent = window.BrandTokens
            ? window.BrandTokens.text('--brand-name', 'InfraSafe')
            : 'InfraSafe';
        
        wrapper.appendChild(img);
        wrapper.appendChild(span);
        container.appendChild(wrapper);
        return container;
    };
    ukControl.addTo(map);

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
    updateControl.onAdd = function() {
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

    // Глобальное хранилище данных зданий для промышленной панели
    // Используется updateStatusGroups() вместо DOM-клонирования
    window.buildingsData = [];

    // Функция загрузки данных с сервера
    // [R2-28] Guards: prevent overlapping loads; auto-fit only on first render.
    let isLoadingData = false;
    let hasFitBounds = false;
    async function loadData() {
        // [R2-28] Skip if a load is already in flight — the periodic interval can
        // race a manual refresh or the post-login load.
        if (isLoadingData) return false;
        isLoadingData = true;
        try {
            // [R2-28] Fetch FIRST — do NOT clear the map before the request. If the
            // fetch fails or is slow, the current markers stay put instead of the
            // map going blank; we swap in fresh data only after a valid response.
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


            // [R2-28] Response is valid — now safe to swap in fresh markers/storage.
            markers.clearLayers();
            buildingPopupStorage.clear();
            window.buildingsData = [];

            data.forEach((item) => {
                // Проверяем наличие валидных координат
                if (!item.latitude || !item.longitude || isNaN(parseFloat(item.latitude)) || isNaN(parseFloat(item.longitude))) {
                    console.warn("Skipping invalid data - missing or invalid coordinates:", item.building_name || item.building_id);
                    return;
                }

                // Преобразуем координаты в числа для корректной работы Leaflet
                item.latitude = parseFloat(item.latitude);
                item.longitude = parseFloat(item.longitude);

                // Проверяем, есть ли метрики (авторизованный vs анонимный доступ)
                const hasMetrics = item.electricity_ph1 !== undefined && item.electricity_ph1 !== null;

                // Переменные для статуса (инициализируем значениями по умолчанию)
                let isPhase1Ok = false, isPhase2Ok = false, isPhase3Ok = false;
                let isElectricityOK = false, isColdWaterOK = false, isHotWaterOK = true;
                let hasLeak = false;
                let electricityImage = 'data/images/Electricity_Red.png';
                let coldWaterImage = 'data/images/Water_No_Blue.png';
                let hotWaterImage = 'data/images/Water_Red.png';
                let leakSensorImage = 'data/images/Leak_Green.png';
                let status;

                if (hasMetrics) {
                    // Авторизованный пользователь — полные данные
                    // Determine electricity status
                    isPhase1Ok = item.electricity_ph1 > 200 && item.electricity_ph1 < 240;
                    isPhase2Ok = item.electricity_ph2 > 200 && item.electricity_ph2 < 240;
                    isPhase3Ok = item.electricity_ph3 > 200 && item.electricity_ph3 < 240;
                    isElectricityOK = isPhase1Ok && isPhase2Ok && isPhase3Ok;
                    electricityImage = isElectricityOK ? 'data/images/Electricity_Green.png' : 'data/images/Electricity_Red.png';

                    // Determine cold water status
                    isColdWaterOK = item.cold_water_pressure && item.cold_water_pressure > 1;
                    coldWaterImage = isColdWaterOK ? 'data/images/Water_Blue.png' : 'data/images/Water_No_Blue.png';

                    // Determine hot water status
                    isHotWaterOK = item.hot_water !== true ||
                                   (item.hot_water === true &&
                                    item.hot_water_in_pressure && item.hot_water_out_pressure &&
                                    item.hot_water_in_pressure >= 1 && item.hot_water_out_pressure >= 1);
                    hotWaterImage = (item.hot_water === false)
                        ? 'data/images/Water_Red.png'
                        : (isHotWaterOK ? 'data/images/Water_Red.png' : 'data/images/Water_No_Red.png');

                    // Определяем статус датчика протечки
                    hasLeak = item.leak_sensor === true;
                    leakSensorImage = hasLeak ? 'data/images/leak1.png' : 'data/images/Leak_Green.png';

                    // Determine marker color based on status
                    if (hasLeak) {
                        status = 'leak';
                    } else if (isElectricityOK && isColdWaterOK && isHotWaterOK) {
                        status = 'ok';
                    } else if (item.controller_id && (
                        ((!item.electricity_ph1 || item.electricity_ph1 <= 0) &&
                         (!item.electricity_ph2 || item.electricity_ph2 <= 0) &&
                         (!item.electricity_ph3 || item.electricity_ph3 <= 0)) ||
                        (!item.cold_water_pressure || item.cold_water_pressure <= 0) ||
                        (item.hot_water &&
                         (!item.hot_water_in_pressure || item.hot_water_in_pressure <= 0) &&
                         (!item.hot_water_out_pressure || item.hot_water_out_pressure <= 0))
                    )) {
                        status = 'critical';
                    } else if (item.controller_id && (
                        (item.electricity_ph1 > 0 || item.electricity_ph2 > 0 || item.electricity_ph3 > 0) &&
                        (item.cold_water_pressure && item.cold_water_pressure > 0) &&
                        (!item.hot_water ||
                         (item.hot_water_in_pressure && item.hot_water_in_pressure > 0) ||
                         (item.hot_water_out_pressure && item.hot_water_out_pressure > 0))
                    )) {
                        status = 'warning';
                    } else {
                        status = 'no';
                    }
                } else {
                    // Анонимный пользователь — только наличие оборудования
                    status = item.has_controller ? 'public' : 'no';
                }

                // Стиль маркера берётся из токенов темы, а не из литералов:
                // здесь была отдельная палитра — смесь CSS-ключевых слов
                // ('green', 'gray', 'orange', 'red') и хексов, не совпадавшая
                // ни с легендой выше, ни с остальным интерфейсом.
                // Правило «норма без заливки» живёт в brandTokens.markerStyle.
                const circleOptions = window.BrandTokens
                    ? window.BrandTokens.markerStyle(status)
                    : {
                        radius: status === 'leak' ? 10 : 8,
                        weight: status === 'leak' ? 2 : 1,
                        color: status === 'leak' ? '#1e88e5' : 'white',
                        fillColor: status === 'ok' ? '#4caf50' :
                                    status === 'warning' ? 'orange' :
                                    status === 'leak' ? '#2196f3' :
                                    status === 'critical' ? 'red' :
                                    status === 'public' ? '#607d8b' : 'gray',
                        fillOpacity: status === 'leak' ? 0.8 : 1,
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

                // [AUD-016] SEC-30: building_id reaches HTML id="" and the fetch URL —
                // coerce to a clean integer. Declared at ITERATION scope (not inside the
                // else branch as before) so the popupopen handler below can capture it;
                // previously it was block-scoped to `else` → ReferenceError in the
                // handler → power data silently never loaded.
                const safeBuildingId = /^\d+$/.test(String(item.building_id)) ? String(item.building_id) : '';

                // Create a popup with building details
                if (status === 'public') {
                    // Анонимный доступ — минимальная информация
                    popupContent = `
                    <div>
                        <strong>${escapeHTML(item.building_name || '')}</strong><br>
                        <span style="color: ${T('--st-public', '#607d8b')};">${escapeHTML(item.address || '')}</span><br>
                        <span style="color: ${T('--muted-foreground', '#90a4ae')}; font-size: 0.85em;">Оборудование установлено</span>
                    </div>`;
                }
                else if(status === 'no'){
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
                    // (safeBuildingId declared at iteration scope above — AUD-016)
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
                    <tr id="power-row-${safeBuildingId}" style="display: none;">
                        <td style="font-size: 10px; color: ${T('--power-label', '#666')};">💡</td>
                        <td id="power-ph1-${safeBuildingId}" style="font-size: 11px; font-weight: 600; color: ${T('--popup-body', '#2d3748')};"></td>
                        <td id="power-ph2-${safeBuildingId}" style="font-size: 11px; font-weight: 600; color: ${T('--popup-body', '#2d3748')};"></td>
                        <td id="power-ph3-${safeBuildingId}" style="font-size: 11px; font-weight: 600; color: ${T('--popup-body', '#2d3748')};"></td>
                    </tr>

                    <!-- Total Power - будет загружено динамически -->
                    <tr id="total-power-row-${safeBuildingId}" style="display: none;">
                        <td style="font-size: 10px; color: ${T('--power-label', '#666')};">Σ</td>
                        <td colspan="3" id="total-power-${safeBuildingId}" style="font-size: 11px; font-weight: 700; color: ${T('--power-total', '#1a5490')};"></td>
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
                }

                // ИСПРАВЛЕНИЕ XSS: Санитизируем popup контент перед использованием.
                // [M-9] Fail-close: если DOMSecurity недоступен (например, bundling
                // сломался или скрипт заблокирован), popupContent НЕ должен уйти в
                // Leaflet как сырой HTML — вместо этого он схлопывается в
                // экранированный текст тем же textContent-приёмом, что и внутренний
                // fallback sanitizePopupContent на случай отсутствия DOMPurify.
                if (window.DOMSecurity && window.DOMSecurity.sanitizePopupContent) {
                    popupContent = window.DOMSecurity.sanitizePopupContent(popupContent);
                } else {
                    console.error('DOMSecurity недоступен — popup контент экранируется как обычный текст (fail-closed).');
                    const fallbackDiv = document.createElement('div');
                    fallbackDiv.textContent = String(popupContent);
                    popupContent = fallbackDiv.innerHTML;
                }

                marker.bindPopup(popupContent).addTo(markers);
                markers.addLayer(marker);

                // Сохраняем содержимое попапа глобально для этого маркера (уже санитизированное)
                marker._popupContent = popupContent;
                
                // Сохраняем popup контент в глобальное хранилище для использования при клике из списка
                buildingPopupStorage.set(item.building_id, popupContent);
                
                // При открытии popup загружаем данные мощности
                marker.on('popupopen', async () => {
                    // SEC-30: без валидного числового id динамическая мощность не грузится
                    // (id'ы в HTML пустые) — пропускаем fetch, чтобы не бить по /buildings/.
                    if (!safeBuildingId) return;
                    try {
                        const powerResponse = await fetch(`/api/power-analytics/buildings/${safeBuildingId}`);
                        if (powerResponse.ok) {
                            const powerData = await powerResponse.json();

                            if (powerData.success && powerData.data) {
                                const data = powerData.data;

                                // Обновляем ячейки с мощностью по фазам
                                const powerPh1 = document.getElementById(`power-ph1-${safeBuildingId}`);
                                const powerPh2 = document.getElementById(`power-ph2-${safeBuildingId}`);
                                const powerPh3 = document.getElementById(`power-ph3-${safeBuildingId}`);
                                const powerRow = document.getElementById(`power-row-${safeBuildingId}`);

                                if (powerPh1 && powerPh2 && powerPh3 && powerRow) {
                                    powerPh1.textContent = `${data.power_ph1_kw} кВт`;
                                    powerPh2.textContent = `${data.power_ph2_kw} кВт`;
                                    powerPh3.textContent = `${data.power_ph3_kw} кВт`;
                                    powerRow.style.display = '';
                                }

                                // Обновляем общую мощность
                                const totalPower = document.getElementById(`total-power-${safeBuildingId}`);
                                const totalPowerRow = document.getElementById(`total-power-row-${safeBuildingId}`);
                                
                                if (totalPower && totalPowerRow) {
                                    totalPower.textContent = '';
                                    const strongPower = document.createElement('strong');
                                    strongPower.textContent = 'Общая мощность:';
                                    totalPower.appendChild(strongPower);
                                    totalPower.appendChild(document.createTextNode(` ${parseFloat(data.total_power_kw) || 0} кВт`));
                                    totalPowerRow.style.display = '';
                                }
                            }
                        }
                    } catch (error) {
                        console.warn('Не удалось загрузить данные мощности для здания:', error);
                    }
                });

                // Сохраняем данные здания в глобальный массив для промышленной панели
                window.buildingsData.push({
                    building_id: item.building_id,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    building_name: item.building_name || '',
                    status: status,
                    controller_id: item.controller_id,
                    electricityImage: electricityImage,
                    coldWaterImage: coldWaterImage,
                    hotWaterImage: hotWaterImage,
                    leakSensorImage: leakSensorImage,
                    isColdWaterOK: isColdWaterOK,
                    hasHotWater: item.hot_water !== false
                });
            });

            // [R2-28] Auto-fit only on the first successful render, so periodic
            // refreshes don't yank the user's current pan/zoom.
            if (!hasFitBounds && markers.getLayers().length > 0) {
                map.fitBounds(markers.getBounds(), { padding: [50, 50] });
                hasFitBounds = true;
            }

            // Синхронизируем статусы с промышленной панелью
            if (window.industrialPanel && typeof window.industrialPanel.updateStatusGroups === 'function') {
                window.industrialPanel.updateStatusGroups();
            }

            // Скрываем skeleton loader карты
            hideMapSkeleton();

            // Обновляем время последнего обновления
            lastUpdateTime = new Date();
            updateLastUpdateTime();

            // Возвращаем успешный результат
            return true;
        } catch (error) {
            console.error("Error loading data:", error);
            
            // Показываем Toast уведомление об ошибке
            showToast(`Ошибка загрузки данных: ${error.message || 'Неизвестная ошибка'}`, 'error');
            
            // Скрываем skeleton и показываем ошибку
            hideMapSkeleton();
            return false;
        } finally {
            // [R2-28] Always release the in-flight guard, success or failure.
            isLoadingData = false;
        }
    }

    // ============================================================
    // АВТОРИЗАЦИЯ НА КАРТЕ (кнопка + модальное окно)
    // ============================================================

    // [1A-FU-C-M1] UI state derived from apiClient.isAuthenticated
    // (in-memory). Initial value is set by an early /api/auth/profile
    // probe in the boot sequence below.
    function updateAuthButton() {
        const btn = document.getElementById('map-auth-btn');
        const btnText = document.getElementById('map-auth-btn-text');
        if (!btn || !btnText) return;

        if (apiClient && apiClient.isAuthenticated) {
            btn.classList.add('authenticated');
            btnText.textContent = 'Выйти';
            btn.setAttribute('aria-label', 'Выйти');
        } else {
            btn.classList.remove('authenticated');
            btnText.textContent = 'Войти';
            btn.setAttribute('aria-label', 'Войти');
        }
    }

    function showLoginModal() {
        const modal = document.getElementById('map-login-modal');
        if (modal) {
            modal.style.display = 'flex';
            const usernameInput = document.getElementById('map-login-username');
            if (usernameInput) usernameInput.focus();
        }
    }

    function hideLoginModal() {
        const modal = document.getElementById('map-login-modal');
        if (modal) {
            modal.style.display = 'none';
            // Reset to step 1 and clear errors
            ['map-login-error', 'map-2fa-error', 'map-setup-error'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            const loginF = document.getElementById('map-login-form');
            const tfaF = document.getElementById('map-2fa-form');
            const setupF = document.getElementById('map-2fa-setup');
            if (loginF) loginF.style.display = 'block';
            if (tfaF) tfaF.style.display = 'none';
            if (setupF) setupF.style.display = 'none';
            const title = document.getElementById('map-login-title');
            if (title) title.textContent = 'Вход в систему';
        }
    }

    // [1A-FU-C-M1] Initial auth probe — runs once at boot to set the
    // UI state. HttpOnly cookie can't be read by JS so we ask the
    // server. Failure (401/network) → treat as logged-out.
    (async () => {
        try {
            const res = await fetch(`${window.BACKEND_URL}/auth/profile`, {
                method: 'GET',
                credentials: 'same-origin'
            });
            apiClient.isAuthenticated = res.ok;
        } catch (_) {
            apiClient.isAuthenticated = false;
        }
        updateAuthButton();
        // [AUD-033] Drive the map's JWT-gated infra layers from the
        // server-authoritative probe (was broken: map read a dead admin_token
        // and never auto-loaded infra for an already-logged-in operator).
        // handleAuthChange is gated behind mapLayersControl._ready so it can't
        // race init(); fire-and-forget. Login/logout paths call it separately.
        if (window.mapLayersControl) {
            window.mapLayersControl.handleAuthChange(apiClient.isAuthenticated);
        }
    })();

    // Кнопка "Войти"/"Выйти" в header
    const authBtn = document.getElementById('map-auth-btn');
    if (authBtn) {
        authBtn.addEventListener('click', async () => {
            if (apiClient.isAuthenticated) {
                // Выход — server clears HttpOnly cookies and blacklists tokens.
                // [P1-V1 / 1A-FU-C-M1] No more refreshToken in body — the
                // refresh_token cookie is sent automatically with credentials.
                try {
                    await fetch(`${window.BACKEND_URL}/auth/logout`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin'
                    });
                } catch (e) { /* продолжаем logout в любом случае */ }
                apiClient.setToken(null);
                updateAuthButton();
                // Перезагружаем карту (анонимные данные)
                loadData();
                // Скрываем слои инфраструктуры
                if (window.mapLayersControl) {
                    window.mapLayersControl.handleAuthChange(false);
                }
                showToast('Вы вышли из системы', 'info');
            } else {
                showLoginModal();
            }
        });
    }

    // Закрытие модального окна
    const loginClose = document.getElementById('map-login-close');
    if (loginClose) {
        loginClose.addEventListener('click', hideLoginModal);
    }
    const loginBackdrop = document.querySelector('.map-login-backdrop');
    if (loginBackdrop) {
        loginBackdrop.addEventListener('click', hideLoginModal);
    }

    // --- 2FA state for map login modal ---
    let mapTempToken = null;

    function showMapLoginStep(step) {
        document.getElementById('map-login-form').style.display = step === 'login' ? 'block' : 'none';
        document.getElementById('map-2fa-form').style.display = step === '2fa' ? 'block' : 'none';
        document.getElementById('map-2fa-setup').style.display = step === 'setup' ? 'block' : 'none';
        const title = document.getElementById('map-login-title');
        if (step === 'login') title.textContent = 'Вход в систему';
        if (step === '2fa') title.textContent = 'Двухфакторная аутентификация';
        if (step === 'setup') title.textContent = 'Настройка 2FA';
    }

    function showMapError(containerId, msg) {
        const el = document.getElementById(containerId);
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    function hideMapErrors() {
        ['map-login-error', 'map-2fa-error', 'map-setup-error'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    async function completeMapLogin(_data) {
        // [1A-FU2-S-M2] Tokens no longer in response body — cookies are
        // source of truth. apiClient.setToken() is kept as a no-op-with-
        // side-effect (flips isAuthenticated boolean) for legacy code.
        apiClient.setToken('cookie-session');
        // Critical UX: close the modal and flip the button BEFORE any
        // network work. If loadData() throws (network blip, slow API),
        // the user must still see they're logged in.
        hideLoginModal();
        showMapLoginStep('login');
        mapTempToken = null;
        updateAuthButton();
        if (window.mapLayersControl) window.mapLayersControl.handleAuthChange(true);
        showToast('Вы вошли в систему', 'success');
        try {
            await loadData();
        } catch (err) {
            // Modal/button state already updated — log and continue.
            console.error('loadData after login failed:', err);
        }
    }

    // Step 1: Login form
    const loginForm = document.getElementById('map-login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('map-login-username').value;
            const password = document.getElementById('map-login-password').value;
            const submitBtn = document.getElementById('map-login-submit');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Вход...';
            hideMapErrors();

            try {
                // [R2-12] Shared POST-JSON boilerplate; branching unchanged.
                const { res: response, data } = await AuthFlow.postJson(AuthFlow.AUTH_ENDPOINTS.login, { username, password });

                // Order matters: /api/auth/login returns `{success:true, requires2FA:true, tempToken}`
                // for admin accounts — checking `data.success` first would close the modal
                // before the 2FA step, leaving the user without an HttpOnly cookie. Check the
                // 2FA branches first so that `data.success` is only treated as a terminal
                // login when neither 2FA flag is present.
                if (response.ok && data.requires2FA) {
                    mapTempToken = data.tempToken;
                    showMapLoginStep('2fa');
                    document.getElementById('map-2fa-code').focus();
                } else if (response.ok && data.requires2FASetup) {
                    mapTempToken = data.tempToken;
                    // Fetch QR setup
                    const { res: setupRes, data: setupData } = await AuthFlow.postJson(AuthFlow.AUTH_ENDPOINTS.setup2fa, { tempToken: mapTempToken });
                    if (setupRes.ok) {
                        // [R2-12] QR validation single-sourced in AuthFlow (security
                        // check gating img.src; must not drift from login.js).
                        if (!AuthFlow.validateQrCodeUrl(setupData.qrCodeUrl)) {
                            showMapError('map-login-error', 'Сервер вернул некорректный QR-код');
                            return;
                        }
                        document.getElementById('map-qr-img').src = String(setupData.qrCodeUrl);
                        document.getElementById('map-qr-secret').textContent = setupData.secret;
                        document.getElementById('map-recovery-codes').textContent = setupData.recoveryCodes.join('\n');
                        showMapLoginStep('setup');
                        document.getElementById('map-confirm-code').focus();
                    } else {
                        showMapError('map-login-error', setupData.message || 'Ошибка настройки 2FA');
                    }
                } else if (response.ok && data.success) {
                    // No 2FA path — user без 2FA, server already issued the auth cookies.
                    await completeMapLogin(data);
                } else {
                    showMapError('map-login-error', data.message || data.error || 'Неверные учетные данные');
                }
            } catch (err) {
                showMapError('map-login-error', 'Ошибка подключения к серверу');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти';
            }
        });
    }

    // Step 2: 2FA verification
    const tfaForm = document.getElementById('map-2fa-form');
    if (tfaForm) {
        tfaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('map-2fa-code').value.trim();
            const btn = document.getElementById('map-2fa-submit');
            if (!code) return;
            btn.disabled = true;
            hideMapErrors();
            try {
                const { res, data } = await AuthFlow.postJson(AuthFlow.AUTH_ENDPOINTS.verify2fa, { tempToken: mapTempToken, code });
                // [1A-FU2-S-M2] success marker is `data.success` (cookies set).
                if (res.ok && data.success) {
                    await completeMapLogin(data);
                } else {
                    showMapError('map-2fa-error', data.message || data.error || 'Неверный код');
                    document.getElementById('map-2fa-code').value = '';
                    document.getElementById('map-2fa-code').focus();
                }
            } catch (err) {
                showMapError('map-2fa-error', 'Ошибка подключения');
            } finally {
                btn.disabled = false;
            }
        });
        document.getElementById('map-2fa-back').addEventListener('click', (e) => {
            e.preventDefault();
            mapTempToken = null;
            showMapLoginStep('login');
        });
    }

    // Step 2b: 2FA setup confirm
    const confirmForm = document.getElementById('map-confirm-2fa-form');
    if (confirmForm) {
        confirmForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('map-confirm-code').value.trim();
            const btn = document.getElementById('map-confirm-submit');
            if (!code) return;
            btn.disabled = true;
            hideMapErrors();
            try {
                const { res, data } = await AuthFlow.postJson(AuthFlow.AUTH_ENDPOINTS.confirm2fa, { tempToken: mapTempToken, code });
                // [1A-FU2-S-M2] success marker is `data.success` (cookies set).
                if (res.ok && data.success) {
                    await completeMapLogin(data);
                } else {
                    showMapError('map-setup-error', data.message || data.error || 'Неверный код');
                    document.getElementById('map-confirm-code').value = '';
                    document.getElementById('map-confirm-code').focus();
                }
            } catch (err) {
                showMapError('map-setup-error', 'Ошибка подключения');
            } finally {
                btn.disabled = false;
            }
        });
    }

    // Инициализация состояния кнопки
    updateAuthButton();

    // Загрузка данных при инициализации
    await loadData();
});
