/**
 * InfraSafe v2 — Main Application
 * Command Center Map Interface
 */

(function () {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================
    const API = window.BACKEND_URL || '/api';
    const MAP_CENTER = [41.32, 69.25]; // Tashkent
    const MAP_ZOOM = 13;

    // Status color mapping — brand palette from logo
    const STATUS_COLORS = {
        ok:       { color: '#41D54A', label: 'Норма' },
        warning:  { color: '#F5A623', label: 'Предупреждение' },
        leak:     { color: '#00BFA5', label: 'Протечка' },
        critical: { color: '#E53935', label: 'Авария' },
        no:       { color: '#546e7a', label: 'Нет контроллера' }
    };

    // ============================================================
    // STATE
    // ============================================================
    let map;
    let markerClusterGroup;
    let buildingsData = [];
    let buildingMarkers = new Map();
    let updateTimer = null;
    let lastUpdateTime = null;

    // Layer groups
    const layerGroups = {
        buildings:      null,
        transformers:   null,
        'power-lines':  null,
        'water-sources': null,
        'water-lines':  null,
        'heat-sources': null,
        controllers:    null,
        alerts:         null
    };

    // Layer data cache
    const layerDataCache = {};

    // Base tile layers
    const baseLayers = {};

    // Active filter
    let activeStatusFilter = 'all';

    // ============================================================
    // UTILITIES
    // ============================================================
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** Build a DOM element tree safely */
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.entries(attrs).forEach(([k, v]) => {
                if (k === 'className') node.className = v;
                else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
                else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
                else node.setAttribute(k, v);
            });
        }
        children.forEach(child => {
            if (child === null || child === undefined) return;
            if (typeof child === 'string') node.appendChild(document.createTextNode(child));
            else if (child instanceof Node) node.appendChild(child);
        });
        return node;
    }

    function formatTimeAgo(date) {
        if (!date) return '--:--';
        const now = Date.now();
        const diff = now - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);

        if (mins < 1) return 'только что';
        if (mins === 1) return '1 минуту назад';
        if (mins < 5) return mins + ' минуты назад';
        if (mins < 60) return mins + ' минут назад';
        if (hours === 1) return '1 час назад';
        if (hours < 5) return hours + ' часа назад';
        return hours + ' часов назад';
    }

    // ============================================================
    // MOCK DATA — used when API is unavailable (demo mode)
    // ============================================================
    var USE_MOCK = false; // auto-detected on first API failure

    var MOCK_BUILDINGS = [
        { building_id: 1, building_name: 'ЖК "Навруз" корпус 1', address: 'ул. Навои, 12', town: 'Ташкент', management_company: 'УК Комфорт', latitude: 41.3111, longitude: 69.2797, controller_id: 101, controller_serial: 'CTR-2024-0001', controller_status: 'online', electricity_ph1: 223, electricity_ph2: 221, electricity_ph3: 225, cold_water_pressure: 2.4, cold_water_temp: 14, has_hot_water: true, hot_water_in_pressure: 1.8, hot_water_out_pressure: 1.5, hot_water_in_temp: 58, leak_sensor: false, timestamp: new Date().toISOString() },
        { building_id: 2, building_name: 'ЖК "Навруз" корпус 2', address: 'ул. Навои, 14', town: 'Ташкент', management_company: 'УК Комфорт', latitude: 41.3125, longitude: 69.2810, controller_id: 102, controller_serial: 'CTR-2024-0002', controller_status: 'online', electricity_ph1: 218, electricity_ph2: 220, electricity_ph3: 219, cold_water_pressure: 2.1, cold_water_temp: 13, has_hot_water: true, hot_water_in_pressure: 1.6, hot_water_out_pressure: 1.4, hot_water_in_temp: 55, leak_sensor: false, timestamp: new Date().toISOString() },
        { building_id: 3, building_name: 'Дом быта "Мехргиё"', address: 'ул. Бабура, 44', town: 'Ташкент', management_company: 'УК Строй-Сервис', latitude: 41.3189, longitude: 69.2654, controller_id: 103, controller_serial: 'CTR-2024-0003', controller_status: 'warning', electricity_ph1: 198, electricity_ph2: 215, electricity_ph3: 222, cold_water_pressure: 1.2, cold_water_temp: 15, has_hot_water: false, hot_water_in_pressure: null, hot_water_out_pressure: null, hot_water_in_temp: null, leak_sensor: false, timestamp: new Date(Date.now() - 600000).toISOString() },
        { building_id: 4, building_name: 'ЖК "Олтин Водий"', address: 'пр. Мустакиллик, 78', town: 'Ташкент', management_company: 'УК Элит', latitude: 41.3255, longitude: 69.2480, controller_id: 104, controller_serial: 'CTR-2024-0004', controller_status: 'online', electricity_ph1: 225, electricity_ph2: 224, electricity_ph3: 226, cold_water_pressure: 3.0, cold_water_temp: 12, has_hot_water: true, hot_water_in_pressure: 2.0, hot_water_out_pressure: 1.8, hot_water_in_temp: 62, leak_sensor: true, timestamp: new Date(Date.now() - 120000).toISOString() },
        { building_id: 5, building_name: 'Торговый центр "Пойтахт"', address: 'ул. Шота Руставели, 5', town: 'Ташкент', management_company: 'УК Центр', latitude: 41.3040, longitude: 69.2715, controller_id: 105, controller_serial: 'CTR-2024-0005', controller_status: 'online', electricity_ph1: 0, electricity_ph2: 0, electricity_ph3: 0, cold_water_pressure: 0.3, cold_water_temp: 11, has_hot_water: true, hot_water_in_pressure: 0.4, hot_water_out_pressure: 0.2, hot_water_in_temp: 35, leak_sensor: false, timestamp: new Date(Date.now() - 300000).toISOString() },
        { building_id: 6, building_name: 'ЖК "Зумрад"', address: 'ул. Мирзо Улугбека, 33', town: 'Ташкент', management_company: 'УК Комфорт', latitude: 41.3310, longitude: 69.2590, controller_id: null, controller_serial: null, controller_status: null, electricity_ph1: null, electricity_ph2: null, electricity_ph3: null, cold_water_pressure: null, cold_water_temp: null, has_hot_water: true, hot_water_in_pressure: null, hot_water_out_pressure: null, hot_water_in_temp: null, leak_sensor: false, timestamp: null },
        { building_id: 7, building_name: 'Школа №145', address: 'ул. Амира Темура, 90', town: 'Ташкент', management_company: 'ГУО Ташкент', latitude: 41.3170, longitude: 69.2530, controller_id: 107, controller_serial: 'CTR-2024-0007', controller_status: 'online', electricity_ph1: 230, electricity_ph2: 228, electricity_ph3: 231, cold_water_pressure: 2.8, cold_water_temp: 13, has_hot_water: true, hot_water_in_pressure: 1.9, hot_water_out_pressure: 1.7, hot_water_in_temp: 60, leak_sensor: false, timestamp: new Date(Date.now() - 60000).toISOString() },
        { building_id: 8, building_name: 'Поликлиника №7', address: 'ул. Катартал, 15', town: 'Ташкент', management_company: 'Минздрав', latitude: 41.3220, longitude: 69.2870, controller_id: 108, controller_serial: 'CTR-2024-0008', controller_status: 'online', electricity_ph1: 222, electricity_ph2: 180, electricity_ph3: 220, cold_water_pressure: 1.5, cold_water_temp: 14, has_hot_water: true, hot_water_in_pressure: 1.1, hot_water_out_pressure: 0.9, hot_water_in_temp: 48, leak_sensor: false, timestamp: new Date(Date.now() - 900000).toISOString() },
        { building_id: 9, building_name: 'ЖК "Сарбон" блок А', address: 'ул. Нукусская, 67', town: 'Ташкент', management_company: 'УК Строй-Сервис', latitude: 41.3085, longitude: 69.2400, controller_id: 109, controller_serial: 'CTR-2024-0009', controller_status: 'online', electricity_ph1: 235, electricity_ph2: 233, electricity_ph3: 234, cold_water_pressure: 2.6, cold_water_temp: 12, has_hot_water: false, hot_water_in_pressure: null, hot_water_out_pressure: null, hot_water_in_temp: null, leak_sensor: false, timestamp: new Date().toISOString() },
        { building_id: 10, building_name: 'Бизнес-центр "Инком"', address: 'ул. Тараса Шевченко, 21', town: 'Ташкент', management_company: 'УК Бизнес-Про', latitude: 41.3145, longitude: 69.2950, controller_id: null, controller_serial: null, controller_status: null, electricity_ph1: null, electricity_ph2: null, electricity_ph3: null, cold_water_pressure: null, cold_water_temp: null, has_hot_water: true, hot_water_in_pressure: null, hot_water_out_pressure: null, hot_water_in_temp: null, leak_sensor: false, timestamp: null },
        { building_id: 11, building_name: 'ЖК "Ипак Йули" корпус 3', address: 'пр. Буюк Ипак Йули, 120', town: 'Ташкент', management_company: 'УК Элит', latitude: 41.3350, longitude: 69.2700, controller_id: 111, controller_serial: 'CTR-2024-0011', controller_status: 'online', electricity_ph1: 220, electricity_ph2: 222, electricity_ph3: 221, cold_water_pressure: 2.2, cold_water_temp: 13, has_hot_water: true, hot_water_in_pressure: 1.5, hot_water_out_pressure: 1.3, hot_water_in_temp: 56, leak_sensor: false, timestamp: new Date(Date.now() - 180000).toISOString() },
        { building_id: 12, building_name: 'Детский сад "Чинор"', address: 'ул. Фидокор, 8', town: 'Ташкент', management_company: 'ГУО Ташкент', latitude: 41.3280, longitude: 69.2380, controller_id: 112, controller_serial: 'CTR-2024-0012', controller_status: 'online', electricity_ph1: 228, electricity_ph2: 226, electricity_ph3: 230, cold_water_pressure: 2.0, cold_water_temp: 14, has_hot_water: true, hot_water_in_pressure: 1.4, hot_water_out_pressure: 1.2, hot_water_in_temp: 52, leak_sensor: true, timestamp: new Date(Date.now() - 45000).toISOString() }
    ];

    var MOCK_TRANSFORMERS = [
        { transformer_id: 1, name: 'ТП-1201 Навои', address: 'ул. Навои, 10', latitude: 41.3100, longitude: 69.2780, power_kva: 630, status: 'active' },
        { transformer_id: 2, name: 'ТП-1202 Центральная', address: 'пр. Мустакиллик, 50', latitude: 41.3240, longitude: 69.2500, power_kva: 1000, status: 'active' },
        { transformer_id: 3, name: 'ТП-1203 Учтепа', address: 'ул. Бабура, 30', latitude: 41.3200, longitude: 69.2630, power_kva: 400, status: 'maintenance' },
        { transformer_id: 4, name: 'ТП-1204 Восточная', address: 'ул. Катартал, 22', latitude: 41.3210, longitude: 69.2900, power_kva: 630, status: 'active' },
        { transformer_id: 5, name: 'ТП-1205 Ипак Йули', address: 'пр. Буюк Ипак Йули, 100', latitude: 41.3340, longitude: 69.2680, power_kva: 1000, status: 'active' }
    ];

    var MOCK_TRANSFORMER_ANALYTICS = [
        { transformer_id: 1, load_percent: 62 },
        { transformer_id: 2, load_percent: 45 },
        { transformer_id: 3, load_percent: 0 },
        { transformer_id: 4, load_percent: 91 },
        { transformer_id: 5, load_percent: 78 }
    ];

    var MOCK_WATER_SOURCES = [
        { id: 1, name: 'Скважина Чирчик-1', source_type: 'Скважина', capacity_m3: 500, latitude: 41.3050, longitude: 69.2600 },
        { id: 2, name: 'Насосная станция Сергели', source_type: 'Насосная станция', capacity_m3: 2000, latitude: 41.3300, longitude: 69.2450 },
        { id: 3, name: 'Водозабор Бозсу', source_type: 'Водозабор', capacity_m3: 5000, latitude: 41.3150, longitude: 69.2350 }
    ];

    var MOCK_HEAT_SOURCES = [
        { id: 1, name: 'Котельная №4 Центр', source_type: 'Газовая котельная', capacity_mw: 12.5, latitude: 41.3160, longitude: 69.2750 },
        { id: 2, name: 'ТЭЦ Ташкент-Южная', source_type: 'ТЭЦ', capacity_mw: 120, latitude: 41.3060, longitude: 69.2550 }
    ];

    var MOCK_ALERTS = [
        { id: 1, building_id: 4, title: 'Протечка в подвале', severity: 'critical', message: 'Датчик зафиксировал воду. Необходим выезд аварийной бригады.', status: 'active' },
        { id: 2, building_id: 5, title: 'Отключение электроснабжения', severity: 'critical', message: 'Все 3 фазы без напряжения более 5 минут.', status: 'active' },
        { id: 3, building_id: 8, title: 'Просадка напряжения фаза L2', severity: 'warning', message: 'Напряжение на фазе L2 = 180В (ниже нормы 200-240В).', status: 'active' },
        { id: 4, building_id: 12, title: 'Протечка — корпус ДС', severity: 'warning', message: 'Датчик протечки сработал в техническом помещении.', status: 'active' }
    ];

    /** Return mock data for a given endpoint */
    function getMockData(endpoint) {
        if (endpoint.indexOf('/buildings-metrics') !== -1) return MOCK_BUILDINGS;
        if (endpoint.indexOf('/transformers') !== -1 && endpoint.indexOf('analytics') === -1) return { data: MOCK_TRANSFORMERS, total: MOCK_TRANSFORMERS.length };
        if (endpoint.indexOf('/power-analytics/transformers') !== -1) return MOCK_TRANSFORMER_ANALYTICS;
        if (endpoint.indexOf('/cold-water-sources') !== -1) return MOCK_WATER_SOURCES;
        if (endpoint.indexOf('/heat-sources') !== -1) return MOCK_HEAT_SOURCES;
        if (endpoint.indexOf('/alerts') !== -1) return MOCK_ALERTS;
        if (endpoint.indexOf('/lines') !== -1) return [];
        if (endpoint.indexOf('/water-lines') !== -1) return [];
        return [];
    }

    // ============================================================
    // API CLIENT (with mock fallback)
    // ============================================================
    async function apiFetch(endpoint) {
        // If already in mock mode, return mock data immediately
        if (USE_MOCK) {
            return getMockData(endpoint);
        }

        try {
            var url = API + endpoint;
            var res = await fetch(url, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
            return res.json();
        } catch (err) {
            // Switch to mock mode on first failure
            if (!USE_MOCK) {
                USE_MOCK = true;
                console.warn('API unavailable, switching to DEMO mode with mock data');
                showToast('API недоступен — демо-режим с тестовыми данными', 'warning', 5000);
            }
            return getMockData(endpoint);
        }
    }

    // ============================================================
    // TOAST SYSTEM (DOM-safe)
    // ============================================================
    const TOAST_ICONS = {
        info: '\u2139\uFE0F',
        success: '\u2705',
        warning: '\u26A0\uFE0F',
        error: '\u274C'
    };

    function showToast(message, type, duration) {
        type = type || 'info';
        duration = duration || 4000;
        var container = document.getElementById('toast-container');
        if (!container) return;

        var progress = el('div', { className: 'toast__progress' });
        progress.style.animationDuration = duration + 'ms';

        var toast = el('div', { className: 'toast toast--' + type },
            el('span', { className: 'toast__icon' }, TOAST_ICONS[type] || TOAST_ICONS.info),
            el('span', { className: 'toast__msg' }, message),
            el('button', { className: 'toast__close', onClick: function() { removeToast(toast); } }, '\u00D7'),
            progress
        );

        container.appendChild(toast);

        // Remove excess toasts
        while (container.children.length > 5) {
            removeToast(container.firstChild);
        }

        setTimeout(function() { removeToast(toast); }, duration);
    }

    function removeToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.style.animation = 'toast-out 0.25s ease-in forwards';
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
    }

    // ============================================================
    // THEME
    // ============================================================
    function initTheme() {
        var saved = localStorage.getItem('infrasafe-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);

        document.getElementById('theme-toggle').addEventListener('click', function() {
            var current = document.documentElement.getAttribute('data-theme');
            var next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('infrasafe-theme', next);
        });
    }

    // ============================================================
    // SIDEBAR
    // ============================================================
    function initSidebar() {
        var sidebar = document.getElementById('sidebar');
        var toggle = document.getElementById('sidebar-toggle');

        toggle.addEventListener('click', function() {
            sidebar.classList.toggle('collapsed');
            setTimeout(function() { if (map) map.invalidateSize(); }, 400);
        });

        // Tab switching
        document.querySelectorAll('.sidebar__tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                var target = tab.dataset.tab;

                document.querySelectorAll('.sidebar__tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelectorAll('.sidebar__panel').forEach(function(p) { p.classList.remove('active'); });

                tab.classList.add('active');
                var panel = document.querySelector('.sidebar__panel[data-panel="' + target + '"]');
                if (panel) panel.classList.add('active');

                if (target === 'status') populateStatusPanel();
            });
        });
    }

    // ============================================================
    // MAP INITIALIZATION
    // ============================================================
    function initMap() {
        map = L.map('map', {
            center: MAP_CENTER,
            zoom: MAP_ZOOM,
            minZoom: 3,
            maxZoom: 19,
            zoomControl: true,
            attributionControl: true
        });

        // Base layers
        baseLayers.map = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19
        });

        baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        });

        baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenTopoMap',
            maxZoom: 17
        });

        baseLayers.map.addTo(map);

        // Initialize overlay layer groups
        Object.keys(layerGroups).forEach(function(key) {
            layerGroups[key] = L.layerGroup();
        });

        // Marker cluster group
        markerClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: createClusterIcon
        });
        map.addLayer(markerClusterGroup);

        // Base layer switching
        document.querySelectorAll('input[name="base-layer"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                Object.values(baseLayers).forEach(function(l) { map.removeLayer(l); });
                baseLayers[radio.value].addTo(map);
            });
        });

        // Overlay layer toggling
        document.querySelectorAll('#overlay-layers input[type="checkbox"]').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var layerKey = cb.value;
                if (cb.checked) {
                    loadLayerData(layerKey);
                    layerGroups[layerKey].addTo(map);
                } else {
                    map.removeLayer(layerGroups[layerKey]);
                }
            });
        });
    }

    // ============================================================
    // CLUSTER ICON
    // ============================================================
    function createClusterIcon(cluster) {
        var children = cluster.getAllChildMarkers();
        var dominant = 'ok';
        var priority = { critical: 5, leak: 4, warning: 3, no: 2, ok: 1 };
        var hasMixed = false;
        var firstStatus = null;

        children.forEach(function(m) {
            var s = m.options.buildingStatus || 'ok';
            if (!firstStatus) firstStatus = s;
            else if (s !== firstStatus) hasMixed = true;
            if ((priority[s] || 0) > (priority[dominant] || 0)) dominant = s;
        });

        var className = hasMixed ? 'marker-cluster-mixed' : ('marker-cluster-' + dominant);
        var size = children.length < 10 ? 34 : children.length < 50 ? 42 : 50;

        return L.divIcon({
            html: '<div style="width:' + size + 'px;height:' + size + 'px">' + children.length + '</div>',
            className: 'marker-cluster ' + className,
            iconSize: L.point(size, size)
        });
    }

    // ============================================================
    // BUILDING STATUS LOGIC
    // ============================================================
    function determineBuildingStatus(b) {
        if (!b.controller_id) return 'no';
        if (b.leak_sensor === true) return 'leak';

        var phOk = function(v) { return v !== null && v !== undefined && v >= 200 && v <= 240; };
        var elecOk = phOk(b.electricity_ph1) && phOk(b.electricity_ph2) && phOk(b.electricity_ph3);
        var elecNone = !phOk(b.electricity_ph1) && !phOk(b.electricity_ph2) && !phOk(b.electricity_ph3);

        var coldOk = b.cold_water_pressure !== null && b.cold_water_pressure > 1;

        var hotOk = true;
        if (b.has_hot_water === true) {
            hotOk = (b.hot_water_in_pressure !== null && b.hot_water_in_pressure >= 1) &&
                    (b.hot_water_out_pressure !== null && b.hot_water_out_pressure >= 1);
        }

        if (elecNone && !coldOk) return 'critical';
        if (!elecOk || !coldOk || !hotOk) return 'warning';
        return 'ok';
    }

    // ============================================================
    // LOAD BUILDINGS DATA
    // ============================================================
    async function loadBuildings() {
        try {
            var data = await apiFetch('/buildings-metrics');
            buildingsData = Array.isArray(data) ? data : (data.data || []);

            buildingsData.forEach(function(b) {
                b._status = determineBuildingStatus(b);
            });

            renderBuildingMarkers();
            updateStats();
            updateLayerCount('buildings', buildingsData.length);
            setConnectionStatus('online');
            lastUpdateTime = new Date();
            updateTimeDisplay();

            showToast('Загружено ' + buildingsData.length + ' объектов', 'success', 3000);
        } catch (err) {
            console.error('Error loading buildings:', err);
            setConnectionStatus('offline');
            showToast('Ошибка загрузки данных: ' + err.message, 'error');
        }
    }

    // ============================================================
    // RENDER BUILDING MARKERS
    // ============================================================
    function renderBuildingMarkers() {
        markerClusterGroup.clearLayers();
        buildingMarkers.clear();

        var filteredData = activeStatusFilter === 'all'
            ? buildingsData
            : buildingsData.filter(function(b) { return b._status === activeStatusFilter; });

        filteredData.forEach(function(b) {
            var lat = parseFloat(b.latitude);
            var lng = parseFloat(b.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var status = b._status;
            var color = (STATUS_COLORS[status] || STATUS_COLORS.no).color;

            var marker = L.circleMarker([lat, lng], {
                radius: 7,
                fillColor: color,
                fillOpacity: 0.9,
                color: 'rgba(255,255,255,0.8)',
                weight: 2,
                buildingStatus: status
            });

            marker.bindPopup(function() { return createBuildingPopupDOM(b); }, {
                maxWidth: 300,
                minWidth: 240,
                className: 'popup-building'
            });

            markerClusterGroup.addLayer(marker);
            buildingMarkers.set(b.building_id, marker);
        });
    }

    // ============================================================
    // BUILDING POPUP — DOM-safe construction
    // ============================================================
    function createBuildingPopupDOM(b) {
        var status = b._status;
        var statusInfo = STATUS_COLORS[status] || STATUS_COLORS.no;

        // Root
        var root = el('div', { className: 'popup' });

        // Header
        var header = el('div', { className: 'popup__header' },
            el('span', { className: 'popup__icon' }, '\uD83C\uDFE2'),
            el('div', null,
                el('div', { className: 'popup__title' }, b.building_name || 'Здание'),
                el('div', { className: 'popup__subtitle' }, b.address || '')
            )
        );
        root.appendChild(header);

        // Info rows
        root.appendChild(popupRow('Город', b.town || '---'));
        root.appendChild(popupRow('УК', b.management_company || '---'));
        root.appendChild(popupRow('Контроллер', b.controller_serial || 'Не подключен'));

        // Status badge row
        var statusRow = el('div', { className: 'popup__row' },
            el('span', { className: 'popup__label' }, 'Статус'),
            el('span', { className: 'popup__status-badge popup__status-badge--' + status }, statusInfo.label)
        );
        root.appendChild(statusRow);

        // Metrics section (only if controller attached)
        if (b.controller_id) {
            var metrics = el('div', { className: 'popup__metrics' },
                el('div', { className: 'popup__metrics-title' }, 'Последние метрики')
            );

            // Phases
            metrics.appendChild(metricRow('L1', 'Напряжение', b.electricity_ph1, 'В', function(v) { return v >= 200 && v <= 240; }));
            metrics.appendChild(metricRow('L2', 'Напряжение', b.electricity_ph2, 'В', function(v) { return v >= 200 && v <= 240; }));
            metrics.appendChild(metricRow('L3', 'Напряжение', b.electricity_ph3, 'В', function(v) { return v >= 200 && v <= 240; }));

            // Cold water
            var coldOk = b.cold_water_pressure !== null && b.cold_water_pressure > 1;
            metrics.appendChild(metricRow('\uD83D\uDCA7', 'Холодная вода', b.cold_water_pressure, 'бар', function() { return coldOk; }));

            // Hot water
            if (b.has_hot_water) {
                var hotInOk = b.hot_water_in_pressure !== null && b.hot_water_in_pressure >= 1;
                metrics.appendChild(metricRow('\uD83D\uDD25', 'Горячая (вх.)', b.hot_water_in_pressure, 'бар', function() { return hotInOk; }));
            }

            // Leak sensor
            var leakDetected = b.leak_sensor === true;
            var leakVal = el('span', {
                className: 'popup__metric-val ' + (leakDetected ? 'popup__metric-val--err' : 'popup__metric-val--ok')
            }, leakDetected ? 'ОБНАРУЖЕНА' : 'Норма');

            metrics.appendChild(el('div', { className: 'popup__metric' },
                el('span', { className: 'popup__metric-icon' }, '\uD83D\uDEA8'),
                el('span', { className: 'popup__metric-name' }, 'Протечка'),
                leakVal
            ));

            root.appendChild(metrics);

            // Timestamp
            var tsText = b.timestamp
                ? new Date(b.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Нет данных';
            root.appendChild(el('div', { className: 'popup__time' }, '\uD83D\uDD52 ' + tsText));
        }

        return root;
    }

    function popupRow(label, value) {
        return el('div', { className: 'popup__row' },
            el('span', { className: 'popup__label' }, label),
            el('span', { className: 'popup__value' }, value)
        );
    }

    function metricRow(icon, name, value, unit, isOkFn) {
        var display = (value !== null && value !== undefined) ? (value + ' ' + unit) : '---';
        var ok = (value !== null && value !== undefined) ? isOkFn(value) : false;
        var cls = 'popup__metric-val ' + (ok ? 'popup__metric-val--ok' : 'popup__metric-val--err');

        return el('div', { className: 'popup__metric' },
            el('span', { className: 'popup__metric-icon' }, icon),
            el('span', { className: 'popup__metric-name' }, name),
            el('span', { className: cls }, display)
        );
    }

    // ============================================================
    // UPDATE STATS BAR
    // ============================================================
    function updateStats() {
        var counts = { ok: 0, warning: 0, leak: 0, critical: 0, no: 0 };
        buildingsData.forEach(function(b) {
            counts[b._status] = (counts[b._status] || 0) + 1;
        });

        Object.keys(counts).forEach(function(key) {
            var statEl = document.getElementById('stat-' + key);
            if (statEl) statEl.textContent = counts[key];
        });
    }

    // ============================================================
    // STATUS PANEL (DOM-safe)
    // ============================================================
    function populateStatusPanel() {
        var container = document.getElementById('status-panel-content');
        if (!container) return;
        container.textContent = ''; // safe clear

        var groups = [
            { key: 'ok',       label: 'Нет проблем',       cls: 'ok' },
            { key: 'warning',  label: 'Предупреждение',     cls: 'warning' },
            { key: 'leak',     label: 'Вода в подвале',     cls: 'leak' },
            { key: 'critical', label: 'Авария',             cls: 'critical' },
            { key: 'no',       label: 'Нет контроллера',    cls: 'no' }
        ];

        groups.forEach(function(g) {
            var buildings = buildingsData.filter(function(b) { return b._status === g.key; });

            // Group container
            var group = el('div', { className: 'status-group status-group--' + g.cls });

            // Chevron SVG
            var chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            chevronSvg.setAttribute('class', 'status-group__chevron');
            chevronSvg.setAttribute('viewBox', '0 0 24 24');
            chevronSvg.setAttribute('fill', 'none');
            chevronSvg.setAttribute('stroke', 'currentColor');
            chevronSvg.setAttribute('stroke-width', '2');
            var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', '6 9 12 15 18 9');
            chevronSvg.appendChild(polyline);

            // Header button
            var headerBtn = el('button', { className: 'status-group__header' },
                el('span', { className: 'status-group__dot' }),
                el('span', null, g.label),
                el('span', { className: 'status-group__count' }, String(buildings.length))
            );
            headerBtn.appendChild(chevronSvg);

            headerBtn.addEventListener('click', function() {
                group.classList.toggle('expanded');
            });

            group.appendChild(headerBtn);

            // Body
            var body = el('div', { className: 'status-group__body' });
            buildings.forEach(function(b) {
                var item = el('div', { className: 'status-building', onClick: function() { flyToBuilding(b); } },
                    b.building_name || b.address || ('ID: ' + b.building_id)
                );
                body.appendChild(item);
            });
            group.appendChild(body);

            container.appendChild(group);
        });
    }

    function flyToBuilding(b) {
        var lat = parseFloat(b.latitude);
        var lng = parseFloat(b.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        map.flyTo([lat, lng], 17, { duration: 1 });

        var marker = buildingMarkers.get(b.building_id);
        if (marker) {
            setTimeout(function() {
                markerClusterGroup.zoomToShowLayer(marker, function() {
                    marker.openPopup();
                });
            }, 1200);
        }
    }

    // ============================================================
    // OVERLAY LAYER DATA LOADING
    // ============================================================
    async function loadLayerData(layerKey) {
        if (layerDataCache[layerKey]) return;

        var group = layerGroups[layerKey];
        if (!group) return;

        try {
            switch (layerKey) {
                case 'buildings': break;
                case 'transformers': await loadTransformers(group); break;
                case 'power-lines': await loadPowerLines(group); break;
                case 'water-sources': await loadWaterSources(group); break;
                case 'water-lines': await loadWaterLines(group); break;
                case 'heat-sources': await loadHeatSources(group); break;
                case 'controllers': await loadControllers(group); break;
                case 'alerts': await loadAlerts(group); break;
            }
            layerDataCache[layerKey] = true;
        } catch (err) {
            console.error('Error loading layer ' + layerKey + ':', err);
            showToast('Ошибка загрузки слоя: ' + err.message, 'error');
        }
    }

    // --- Transformer popup (DOM-safe) ---
    function createTransformerPopup(t, loadPercent, isOverloaded) {
        var root = el('div', { className: 'popup' });
        root.appendChild(el('div', { className: 'popup__header' },
            el('span', { className: 'popup__icon' }, '\u26A1'),
            el('div', null,
                el('div', { className: 'popup__title' }, t.name || 'Трансформатор'),
                el('div', { className: 'popup__subtitle' }, t.address || '')
            )
        ));
        root.appendChild(popupRow('Мощность', (t.power_kva || t.capacity_kva || '---') + ' кВА'));
        var loadCls = isOverloaded ? 'popup__value popup__metric-val--err' : 'popup__value';
        var loadRow = el('div', { className: 'popup__row' },
            el('span', { className: 'popup__label' }, 'Нагрузка'),
            el('span', { className: loadCls }, loadPercent + '%')
        );
        root.appendChild(loadRow);
        var statusCls = t.status === 'active' ? 'ok' : 'warning';
        root.appendChild(el('div', { className: 'popup__row' },
            el('span', { className: 'popup__label' }, 'Статус'),
            el('span', { className: 'popup__status-badge popup__status-badge--' + statusCls }, t.status || '---')
        ));
        return root;
    }

    async function loadTransformers(group) {
        var results = await Promise.all([
            apiFetch('/transformers?page=1&limit=100').then(function(r) { return r.data || r; }),
            apiFetch('/power-analytics/transformers').catch(function() { return []; })
        ]);
        var transformers = results[0];
        var analytics = results[1];

        var loadMap = {};
        (Array.isArray(analytics) ? analytics : []).forEach(function(a) {
            loadMap[a.transformer_id] = a;
        });

        var count = 0;
        (Array.isArray(transformers) ? transformers : []).forEach(function(t) {
            var lat = parseFloat(t.latitude);
            var lng = parseFloat(t.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var load = loadMap[t.transformer_id || t.id];
            var loadPercent = load ? Math.round(load.load_percent || 0) : 0;
            var isOverloaded = loadPercent > 90;
            var color = isOverloaded ? '#ff1744' : loadPercent > 70 ? '#ffab00' : '#8B4513';

            // Build SVG for marker icon using DOM
            var svgNs = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(svgNs, 'svg');
            svg.setAttribute('viewBox', '0 0 32 32');
            var rect = document.createElementNS(svgNs, 'rect');
            rect.setAttribute('x', '4'); rect.setAttribute('y', '4');
            rect.setAttribute('width', '24'); rect.setAttribute('height', '24');
            rect.setAttribute('rx', '3'); rect.setAttribute('fill', color);
            rect.setAttribute('stroke', 'white'); rect.setAttribute('stroke-width', '1.5');
            rect.setAttribute('opacity', '0.9');
            svg.appendChild(rect);
            var txt = document.createElementNS(svgNs, 'text');
            txt.setAttribute('x', '16'); txt.setAttribute('y', '19');
            txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', 'white');
            txt.setAttribute('font-size', '10'); txt.setAttribute('font-weight', 'bold');
            txt.setAttribute('font-family', 'monospace');
            txt.textContent = loadPercent + '%';
            svg.appendChild(txt);

            // Serialize SVG to string for Leaflet DivIcon
            var serializer = new XMLSerializer();
            var svgStr = serializer.serializeToString(svg);

            var icon = L.divIcon({
                className: 'transformer-marker-v2',
                html: svgStr,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            var marker = L.marker([lat, lng], { icon: icon });
            marker.bindPopup(function() { return createTransformerPopup(t, loadPercent, isOverloaded); }, { maxWidth: 280 });
            group.addLayer(marker);
            count++;
        });

        updateLayerCount('transformers', count);
    }

    async function loadPowerLines(group) {
        var lines = await apiFetch('/lines');
        var data = Array.isArray(lines) ? lines : (lines.data || []);
        var count = 0;

        data.forEach(function(line) {
            if (!line.coordinates || !Array.isArray(line.coordinates) || line.coordinates.length < 2) return;

            var latlngs = line.coordinates.map(function(c) { return [c.lat || c[0], c.lng || c[1]]; });
            var polyline = L.polyline(latlngs, {
                color: '#ffab00', weight: 2, opacity: 0.7, dashArray: '8 4'
            });

            polyline.bindPopup(function() {
                return el('div', { className: 'popup' },
                    el('div', { className: 'popup__header' },
                        el('span', { className: 'popup__icon' }, '\uD83D\uDD0C'),
                        el('div', null, el('div', { className: 'popup__title' }, line.name || 'Линия электропередач'))
                    ),
                    popupRow('Тип', line.line_type || '---')
                );
            });

            group.addLayer(polyline);
            count++;
        });

        updateLayerCount('power-lines', count);
    }

    async function loadWaterSources(group) {
        var sources = await apiFetch('/cold-water-sources');
        var data = Array.isArray(sources) ? sources : (sources.data || []);
        var count = 0;

        data.forEach(function(src) {
            var lat = parseFloat(src.latitude);
            var lng = parseFloat(src.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var marker = L.circleMarker([lat, lng], {
                radius: 8, fillColor: '#448aff', fillOpacity: 0.8, color: 'white', weight: 2
            });

            marker.bindPopup(function() {
                return el('div', { className: 'popup' },
                    el('div', { className: 'popup__header' },
                        el('span', { className: 'popup__icon' }, '\uD83D\uDCA7'),
                        el('div', null, el('div', { className: 'popup__title' }, src.name || 'Источник воды'))
                    ),
                    popupRow('Тип', src.source_type || '---'),
                    popupRow('Ёмкость', (src.capacity_m3 || '---') + ' м\u00B3')
                );
            });

            group.addLayer(marker);
            count++;
        });

        updateLayerCount('water-sources', count);
    }

    async function loadWaterLines(group) {
        var lines = await apiFetch('/water-lines');
        var data = Array.isArray(lines) ? lines : (lines.data || []);
        var count = 0;

        data.forEach(function(line) {
            if (line.source_lat && line.source_lng && line.dest_lat && line.dest_lng) {
                var color = line.water_type === 'hot' ? '#ff5722' : '#2196f3';
                var polyline = L.polyline(
                    [[line.source_lat, line.source_lng], [line.dest_lat, line.dest_lng]],
                    { color: color, weight: 2, opacity: 0.6 }
                );
                group.addLayer(polyline);
            }
            count++;
        });

        updateLayerCount('water-lines', count);
    }

    async function loadHeatSources(group) {
        var sources = await apiFetch('/heat-sources');
        var data = Array.isArray(sources) ? sources : (sources.data || []);
        var count = 0;

        data.forEach(function(src) {
            var lat = parseFloat(src.latitude);
            var lng = parseFloat(src.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var marker = L.circleMarker([lat, lng], {
                radius: 9, fillColor: '#ff5722', fillOpacity: 0.8, color: 'white', weight: 2
            });

            marker.bindPopup(function() {
                return el('div', { className: 'popup' },
                    el('div', { className: 'popup__header' },
                        el('span', { className: 'popup__icon' }, '\uD83D\uDD25'),
                        el('div', null, el('div', { className: 'popup__title' }, src.name || 'Источник тепла'))
                    ),
                    popupRow('Тип', src.source_type || '---'),
                    popupRow('Мощность', (src.capacity_mw || '---') + ' МВт')
                );
            });

            group.addLayer(marker);
            count++;
        });

        updateLayerCount('heat-sources', count);
    }

    async function loadControllers(group) {
        var buildings = buildingsData.length ? buildingsData : await apiFetch('/buildings-metrics').then(function(r) { return Array.isArray(r) ? r : (r.data || []); });
        var count = 0;

        buildings.forEach(function(b) {
            if (!b.controller_id) return;
            var lat = parseFloat(b.latitude);
            var lng = parseFloat(b.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var statusColor = b.controller_status === 'online' ? '#00e676' :
                             b.controller_status === 'warning' ? '#ffab00' : '#ff1744';

            // Build marker icon via DOM
            var markerDiv = document.createElement('div');
            markerDiv.style.cssText = 'width:12px;height:12px;border-radius:3px;background:' + statusColor + ';border:2px solid white;box-shadow:0 0 6px ' + statusColor;

            var icon = L.divIcon({
                className: 'controller-marker',
                html: markerDiv.outerHTML,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            var marker = L.marker([lat, lng], { icon: icon });
            marker.bindPopup(function() {
                var statusCls = b.controller_status === 'online' ? 'ok' : 'warning';
                return el('div', { className: 'popup' },
                    el('div', { className: 'popup__header' },
                        el('span', { className: 'popup__icon' }, '\uD83D\uDCCA'),
                        el('div', null,
                            el('div', { className: 'popup__title' }, b.controller_serial || 'Контроллер'),
                            el('div', { className: 'popup__subtitle' }, 'Здание: ' + (b.building_name || ''))
                        )
                    ),
                    el('div', { className: 'popup__row' },
                        el('span', { className: 'popup__label' }, 'Статус'),
                        el('span', { className: 'popup__status-badge popup__status-badge--' + statusCls }, b.controller_status || '---')
                    )
                );
            });

            group.addLayer(marker);
            count++;
        });

        updateLayerCount('controllers', count);
    }

    async function loadAlerts(group) {
        var alerts = await apiFetch('/alerts?status=active');
        var data = Array.isArray(alerts) ? alerts : (alerts.data || []);
        var count = 0;

        data.forEach(function(alert) {
            var building = buildingsData.find(function(b) { return b.building_id === alert.building_id; });
            if (!building) return;

            var lat = parseFloat(building.latitude);
            var lng = parseFloat(building.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var severity = alert.severity || 'warning';
            var color = severity === 'critical' ? '#ff1744' : severity === 'warning' ? '#ffab00' : '#448aff';

            // Build alert marker via DOM
            var alertDiv = document.createElement('div');
            alertDiv.style.cssText = 'width:20px;height:20px;border-radius:50%;background:' + color + ';border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;color:white;font-weight:bold';
            alertDiv.textContent = '!';

            var icon = L.divIcon({
                className: 'alert-marker',
                html: alertDiv.outerHTML,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            var marker = L.marker([lat, lng], { icon: icon });
            marker.bindPopup(function() {
                var popup = el('div', { className: 'popup' },
                    el('div', { className: 'popup__header' },
                        el('span', { className: 'popup__icon' }, '\u26A0\uFE0F'),
                        el('div', null, el('div', { className: 'popup__title' }, alert.title || alert.alert_type || 'Алерт'))
                    ),
                    popupRow('Серьёзность', severity),
                    popupRow('Здание', building.building_name || '')
                );
                if (alert.message) {
                    popup.appendChild(popupRow('Сообщение', alert.message));
                }
                return popup;
            });

            group.addLayer(marker);
            count++;
        });

        updateLayerCount('alerts', count);
    }

    // ============================================================
    // LAYER COUNTS
    // ============================================================
    function updateLayerCount(layerKey, count) {
        var countEl = document.querySelector('[data-count="' + layerKey + '"]');
        if (countEl) {
            countEl.textContent = count;
            countEl.classList.add('loaded');
        }
    }

    // ============================================================
    // CONNECTION STATUS
    // ============================================================
    function setConnectionStatus(status) {
        var statusEl = document.getElementById('connection-status');
        if (!statusEl) return;

        var dot = statusEl.querySelector('.status-dot');
        var label = statusEl.querySelector('.status-label');

        dot.className = 'status-dot';

        if (status === 'online') {
            dot.classList.add('status-dot--online');
            label.textContent = 'Подключено';
        } else if (status === 'offline') {
            dot.classList.add('status-dot--offline');
            label.textContent = 'Нет связи';
        } else {
            dot.classList.add('status-dot--connecting');
            label.textContent = 'Подключение...';
        }
    }

    // ============================================================
    // UPDATE CONTROL
    // ============================================================
    function initUpdateControl() {
        var control = document.getElementById('update-control');
        var toggleBtn = document.getElementById('update-toggle');
        var refreshBtn = document.getElementById('refresh-btn');
        var autoUpdate = document.getElementById('auto-update');
        var intervalSelect = document.getElementById('update-interval');
        var loadFilter = document.getElementById('load-filter');
        var loadValue = document.getElementById('load-filter-value');

        toggleBtn.addEventListener('click', function() {
            control.classList.toggle('expanded');
        });

        refreshBtn.addEventListener('click', function() {
            loadBuildings();
            // Reset layer caches on refresh
            Object.keys(layerDataCache).forEach(function(k) { delete layerDataCache[k]; });
            Object.keys(layerGroups).forEach(function(k) {
                if (layerGroups[k]) layerGroups[k].clearLayers();
            });
            // Reload visible layers
            document.querySelectorAll('#overlay-layers input[type="checkbox"]:checked').forEach(function(cb) {
                loadLayerData(cb.value);
            });
        });

        autoUpdate.addEventListener('change', function() {
            if (autoUpdate.checked) {
                startAutoUpdate(parseInt(intervalSelect.value));
            } else {
                stopAutoUpdate();
            }
        });

        intervalSelect.addEventListener('change', function() {
            if (autoUpdate.checked) {
                stopAutoUpdate();
                startAutoUpdate(parseInt(intervalSelect.value));
            }
        });

        // Load filter
        if (loadFilter) {
            loadFilter.addEventListener('input', function() {
                if (loadValue) loadValue.textContent = loadFilter.value + '%';
            });
        }

        // Start auto-update
        startAutoUpdate(parseInt(intervalSelect.value));

        // Update time display every 30s
        setInterval(updateTimeDisplay, 30000);
    }

    function startAutoUpdate(interval) {
        stopAutoUpdate();
        updateTimer = setInterval(function() { loadBuildings(); }, interval);
    }

    function stopAutoUpdate() {
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    }

    function updateTimeDisplay() {
        var timeEl = document.getElementById('update-time');
        if (timeEl) timeEl.textContent = formatTimeAgo(lastUpdateTime);
    }

    // ============================================================
    // FILTERS
    // ============================================================
    function initFilters() {
        // Status filter chips
        document.querySelectorAll('#status-filter .filter-chip').forEach(function(chip) {
            chip.addEventListener('click', function() {
                document.querySelectorAll('#status-filter .filter-chip').forEach(function(c) { c.classList.remove('active'); });
                chip.classList.add('active');
                activeStatusFilter = chip.dataset.status;
                renderBuildingMarkers();
            });
        });

        // Apply / Reset filter buttons
        var applyBtn = document.getElementById('apply-filters');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                renderBuildingMarkers();
                showToast('Фильтры применены', 'info', 2000);
            });
        }

        var resetBtn = document.getElementById('reset-filters');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                activeStatusFilter = 'all';
                document.querySelectorAll('#status-filter .filter-chip').forEach(function(c) { c.classList.remove('active'); });
                var allChip = document.querySelector('#status-filter .filter-chip[data-status="all"]');
                if (allChip) allChip.classList.add('active');

                var loadFilterEl = document.getElementById('load-filter');
                if (loadFilterEl) {
                    loadFilterEl.value = 100;
                    var lv = document.getElementById('load-filter-value');
                    if (lv) lv.textContent = '100%';
                }

                renderBuildingMarkers();
                showToast('Фильтры сброшены', 'info', 2000);
            });
        }
    }

    // ============================================================
    // PRELOAD LAYER COUNTS
    // ============================================================
    async function preloadLayerCounts() {
        var loaders = [
            apiFetch('/transformers?page=1&limit=1').then(function(r) { updateLayerCount('transformers', r.total || (r.data || []).length || 0); }).catch(function() {}),
            apiFetch('/lines').then(function(r) { updateLayerCount('power-lines', (Array.isArray(r) ? r : (r.data || [])).length); }).catch(function() {}),
            apiFetch('/cold-water-sources').then(function(r) { updateLayerCount('water-sources', (Array.isArray(r) ? r : (r.data || [])).length); }).catch(function() {}),
            apiFetch('/water-lines').then(function(r) { updateLayerCount('water-lines', (Array.isArray(r) ? r : (r.data || [])).length); }).catch(function() {}),
            apiFetch('/heat-sources').then(function(r) { updateLayerCount('heat-sources', (Array.isArray(r) ? r : (r.data || [])).length); }).catch(function() {}),
            apiFetch('/alerts?status=active').then(function(r) { updateLayerCount('alerts', (Array.isArray(r) ? r : (r.data || [])).length); }).catch(function() {})
        ];

        await Promise.allSettled(loaders);
    }

    // ============================================================
    // BOOT
    // ============================================================
    document.addEventListener('DOMContentLoaded', async function() {
        initTheme();
        initSidebar();
        initMap();
        initUpdateControl();
        initFilters();

        // Load data
        await loadBuildings();

        // Preload counts for layer badges
        preloadLayerCounts();

        // Count controllers from buildings data
        var controllerCount = buildingsData.filter(function(b) { return b.controller_id; }).length;
        updateLayerCount('controllers', controllerCount);
    });

})();
