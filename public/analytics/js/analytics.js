/**
 * Аналитика зданий - Infrasafe
 * Страница с графиками истории метрик
 */

// Глобальные переменные
let currentBuilding = null;
let currentPeriod = '6h';
let charts = {};
let metricsData = [];

// API базовый URL (настройте под ваш backend)
// В production используем относительные пути через Nginx прокси
const API_BASE = window.BACKEND_URL || '/api';

/**
 * Инициализация при загрузке страницы
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadBuildings();
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showLoading(false);
    }
});

/**
 * Загрузить список зданий
 */
async function loadBuildings() {
    try {
        showLoading(true);

        const response = await fetch(`${API_BASE}/buildings-metrics`);
        if (!response.ok) throw new Error('Ошибка загрузки зданий');

        const result = await response.json();
        const selector = document.getElementById('building-selector');

        // Safe: static HTML string with no user input
        selector.innerHTML = '<option value="">Выберите здание...</option>';

        // API может вернуть {data: [...]} или просто [...]
        const data = result.data || result;

        if (!Array.isArray(data)) {
            throw new Error('Некорректный формат данных от API');
        }

        const buildingsWithControllers = data.filter(b => b.controller_id);

        buildingsWithControllers.forEach(building => {
            const option = document.createElement('option');
            option.value = building.building_id;
            option.textContent = `${building.building_name}${building.address ? ` - ${building.address}` : ''}`;
            option.dataset.building = JSON.stringify(building);
            selector.appendChild(option);
        });

        showLoading(false);

    } catch (error) {
        console.error('Ошибка загрузки зданий:', error);
        showLoading(false);
        alert('Ошибка загрузки списка зданий');
    }
}

/**
 * Обработчик изменения здания
 */
async function onBuildingChange() {
    const selector = document.getElementById('building-selector');
    const selectedOption = selector.options[selector.selectedIndex];
    
    if (!selectedOption.value) {
        document.getElementById('building-info').style.display = 'none';
        return;
    }
    
    currentBuilding = JSON.parse(selectedOption.dataset.building);
    updateBuildingInfo();
    await loadMetricsData();
}

/**
 * Обновить информацию о здании
 */
function updateBuildingInfo() {
    const infoBlock = document.getElementById('building-info');
    
    document.getElementById('building-name').textContent = currentBuilding.building_name;
    document.getElementById('building-address').textContent = currentBuilding.address || 'Не указан';
    document.getElementById('building-status').textContent = currentBuilding.status || 'active';
    document.getElementById('building-status').className = `info-value status-badge ${currentBuilding.status || 'active'}`;
    document.getElementById('building-controllers').textContent = currentBuilding.controller_id ? '1' : '0';
    
    infoBlock.style.display = 'block';
}

/**
 * Обработчик изменения периода
 */
async function onPeriodChange() {
    const selector = document.getElementById('period-selector');
    currentPeriod = selector.value;
    
    if (currentBuilding) {
        await loadMetricsData();
    }
}

/**
 * Обновить данные
 */
async function refreshData() {
    if (!currentBuilding) return;
    
    const icon = document.getElementById('refresh-icon');
    icon.classList.add('spinning');
    
    await loadMetricsData();
    
    setTimeout(() => {
        icon.classList.remove('spinning');
    }, 1000);
}

/**
 * Загрузить метрики здания
 */
async function loadMetricsData() {
    if (!currentBuilding) return;
    
    try {
        showLoading(true);
        
        // ВАЖНО: Создайте этот endpoint в backend!
        // Пример: GET /api/metrics/building/:buildingId/history?period=6h
        const response = await fetch(
            `${API_BASE}/metrics/building/${currentBuilding.building_id}/history?period=${currentPeriod}`
        );
        
        if (!response.ok) {
            metricsData = generateMockData(currentPeriod);
        } else {
            const data = await response.json();
            metricsData = data.data || data;
        }

        document.getElementById('last-update').textContent = new Date().toLocaleString('ru-RU');

        createAllCharts();
        showLoading(false);

    } catch (error) {
        console.error('Ошибка загрузки метрик:', error);

        metricsData = generateMockData(currentPeriod);
        createAllCharts();
        showLoading(false);
    }
}

/**
 * Создать все графики
 */
/**
 * Создать все графики с обработкой ошибок
 */
function createAllCharts() {
    try {
        createVoltageChart();
        createAmperageChart();
        createPowerPhasesChart();
        createPowerTotalChart();
        createWaterPressureChart();
        createWaterTemperatureChart();
        createEnvironmentChart();
        createLeakChart();
    } catch (error) {
        console.error('Ошибка создания графиков:', error);
    }
}

/**
 * График напряжения по фазам
 */
function createVoltageChart() {
    const ctx = document.getElementById('voltage-chart');
    if (!ctx) return;
    
    // Уничтожаем старый график
    if (charts.voltage) charts.voltage.destroy();
    
    charts.voltage = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Фаза 1',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.electricity_ph1) || 0
                    })),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,          // Убираем точки
                    pointHoverRadius: 4      // Показываем при наведении
                },
                {
                    label: 'Фаза 2',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.electricity_ph2) || 0
                    })),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,          // Убираем точки
                    pointHoverRadius: 4      // Показываем при наведении
                },
                {
                    label: 'Фаза 3',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.electricity_ph3) || 0
                    })),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,          // Убираем точки
                    pointHoverRadius: 4      // Показываем при наведении
                }
            ]
        },
        options: getChartOptions('Напряжение (V)', 'V', 'voltage')
    });
}

/**
 * График силы тока по фазам
 */
function createAmperageChart() {
    const ctx = document.getElementById('amperage-chart');
    if (!ctx) return;
    
    if (charts.amperage) charts.amperage.destroy();
    
    charts.amperage = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Ток Фаза 1',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.amperage_ph1) || 0
                    })),
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Ток Фаза 2',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.amperage_ph2) || 0
                    })),
                    borderColor: '#10b981',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Ток Фаза 3',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.amperage_ph3) || 0
                    })),
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: getChartOptions('Сила тока (A)', 'A', 'amperage')
    });
}

/**
 * График мощности по фазам
 */
function createPowerPhasesChart() {
    const ctx = document.getElementById('power-phases-chart');
    if (!ctx) return;
    
    if (charts.powerPhases) charts.powerPhases.destroy();
    
    charts.powerPhases = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [
                {
                    label: 'Мощность Ф1',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: calculatePower(d.electricity_ph1, d.amperage_ph1)
                    })),
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: '#3b82f6',
                    borderWidth: 1
                },
                {
                    label: 'Мощность Ф2',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: calculatePower(d.electricity_ph2, d.amperage_ph2)
                    })),
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 1
                },
                {
                    label: 'Мощность Ф3',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: calculatePower(d.electricity_ph3, d.amperage_ph3)
                    })),
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderColor: '#f59e0b',
                    borderWidth: 1
                }
            ]
        },
        options: getChartOptions('Мощность (кВт)', 'кВт', 'power')
    });
}

/**
 * График общей мощности
 */
function createPowerTotalChart() {
    const ctx = document.getElementById('power-total-chart');
    if (!ctx) return;
    
    if (charts.powerTotal) charts.powerTotal.destroy();
    
    const totalPowerData = metricsData.map(d => ({
        x: new Date(d.timestamp),
        y: calculatePower(d.electricity_ph1, d.amperage_ph1) +
           calculatePower(d.electricity_ph2, d.amperage_ph2) +
           calculatePower(d.electricity_ph3, d.amperage_ph3)
    }));
    
    charts.powerTotal = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Общая мощность',
                data: totalPowerData,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: getChartOptions('Общая мощность (кВт)', 'кВт', 'power')
    });
}

/**
 * График давления воды
 */
function createWaterPressureChart() {
    const ctx = document.getElementById('water-pressure-chart');
    if (!ctx) return;
    
    if (charts.waterPressure) charts.waterPressure.destroy();
    
    charts.waterPressure = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'ХВС давление',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.cold_water_pressure) || 0
                    })),
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'ГВС подача',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.hot_water_in_pressure) || 0
                    })),
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'ГВС обратка',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.hot_water_out_pressure) || 0
                    })),
                    borderColor: '#f97316',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: getChartOptions('Давление (Bar)', 'Bar', 'pressure')
    });
}

/**
 * График температуры воды
 */
function createWaterTemperatureChart() {
    const ctx = document.getElementById('water-temperature-chart');
    if (!ctx) return;
    
    if (charts.waterTemperature) charts.waterTemperature.destroy();
    
    charts.waterTemperature = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'ХВС',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.cold_water_temp) || 0
                    })),
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'ГВС подача',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.hot_water_in_temp) || 0
                    })),
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'ГВС обратка',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.hot_water_out_temp) || 0
                    })),
                    borderColor: '#f97316',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: getChartOptions('Температура (°C)', '°C', 'temperature')
    });
}

/**
 * График температуры и влажности окружения
 */
function createEnvironmentChart() {
    const ctx = document.getElementById('environment-chart');
    if (!ctx) return;
    
    if (charts.environment) charts.environment.destroy();
    
    charts.environment = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Температура',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.ambient_temp) || 0
                    })),
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'y',
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Влажность',
                    data: metricsData.map(d => ({
                        x: new Date(d.timestamp),
                        y: parseFloat(d.humidity) || 0
                    })),
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'y1',
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            ...getChartOptions('Температура / Влажность', ''),
            scales: {
                ...getChartOptions('', '').scales,
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Влажность (%)',
                        color: '#2d3748'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

/**
 * График протечек
 */
function createLeakChart() {
    const ctx = document.getElementById('leak-chart');
    if (!ctx) return;
    
    if (charts.leak) charts.leak.destroy();
    
    charts.leak = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Датчик протечки',
                data: metricsData.map(d => ({
                    x: new Date(d.timestamp),
                    y: d.leak_sensor ? 1 : 0
                })),
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                borderWidth: 2,
                stepped: true,
                fill: true
            }]
        },
        options: {
            ...getChartOptions('Статус протечки', ''),
            scales: {
                ...getChartOptions('', '').scales,
                y: {
                    ...getChartOptions('', '').scales.y,
                    ticks: {
                        stepSize: 1,
                        callback: (value) => value === 1 ? 'Протечка' : 'OK'
                    },
                    min: 0,
                    max: 1
                }
            }
        }
    });
}

/**
 * Рассчитать оптимальный диапазон для оси Y
 * Начинает не с 0, а с (min - step), чтобы лучше видны колебания
 * @param {string} dataType - тип данных ('voltage', 'amperage', 'power', 'pressure', 'temperature')
 * @returns {Object} - {min, max, suggestedMin, suggestedMax}
 */
function calculateYAxisRange(dataType) {
    if (metricsData.length === 0) return { beginAtZero: true };
    
    // Собираем все значения в зависимости от типа
    let values = [];
    
    switch (dataType) {
        case 'voltage':
            values = metricsData.flatMap(d => [
                parseFloat(d.electricity_ph1) || 0,
                parseFloat(d.electricity_ph2) || 0,
                parseFloat(d.electricity_ph3) || 0
            ]);
            break;
        case 'amperage':
            values = metricsData.flatMap(d => [
                parseFloat(d.amperage_ph1) || 0,
                parseFloat(d.amperage_ph2) || 0,
                parseFloat(d.amperage_ph3) || 0
            ]);
            break;
        case 'power':
            values = metricsData.map(d => 
                calculatePower(d.electricity_ph1, d.amperage_ph1) +
                calculatePower(d.electricity_ph2, d.amperage_ph2) +
                calculatePower(d.electricity_ph3, d.amperage_ph3)
            );
            break;
        case 'pressure':
            values = metricsData.flatMap(d => [
                parseFloat(d.cold_water_pressure) || 0,
                parseFloat(d.hot_water_in_pressure) || 0,
                parseFloat(d.hot_water_out_pressure) || 0
            ]);
            break;
        case 'temperature':
            values = metricsData.flatMap(d => [
                parseFloat(d.cold_water_temp) || 0,
                parseFloat(d.hot_water_in_temp) || 0,
                parseFloat(d.hot_water_out_temp) || 0
            ]);
            break;
        default:
            return { beginAtZero: true };
    }
    
    // Убираем нулевые значения для точного расчета
    values = values.filter(v => v > 0);
    
    if (values.length === 0) return { beginAtZero: true };
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    
    // Если диапазон очень маленький (почти нет колебаний), добавляем фиксированный запас
    const step = range < 1 ? 1 : range * 0.1;
    
    return {
        min: Math.max(0, min - step),  // Не уходим в отрицательные
        max: max + step,
        beginAtZero: false
    };
}

/**
 * Получить базовые настройки графика
 * @param {string} yAxisLabel - Название оси Y
 * @param {string} unit - Единица измерения
 * @param {string} dataType - Тип данных для расчета диапазона
 */
function getChartOptions(yAxisLabel, unit, dataType = null) {
    const timeUnit = getTimeUnit(currentPeriod);
    const yAxisRange = dataType ? calculateYAxisRange(dataType) : { beginAtZero: true };
    
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            legend: {
                labels: {
                    color: '#2d3748',
                    font: { size: 12 }
                }
            },
            tooltip: {
                callbacks: {
                    title: (context) => {
                        return new Date(context[0].parsed.x).toLocaleString('ru-RU');
                    },
                    label: (context) => {
                        return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} ${unit}`;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: timeUnit,
                    displayFormats: {
                        minute: 'HH:mm',
                        hour: 'HH:mm',
                        day: 'dd MMM'
                    }
                },
                ticks: { color: '#4a5568' },
                grid: { color: 'rgba(0, 0, 0, 0.05)' }
            },
            y: {
                ...yAxisRange,
                title: {
                    display: true,
                    text: yAxisLabel,
                    color: '#2d3748'
                },
                ticks: { color: '#4a5568' },
                grid: { color: 'rgba(0, 0, 0, 0.05)' }
            }
        }
    };
}

/**
 * Переключение вкладок
 */
function switchTab(tabName) {
    // Убираем активный класс со всех кнопок и контента
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Добавляем активный класс к выбранным элементам
    event.target.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

/**
 * Показать/скрыть индикатор загрузки
 */
/**
 * Показать/скрыть индикатор загрузки
 */
function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return; // Защита от ошибок если элемент не найден
    
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

/**
 * Получить единицу времени для графика
 */
function getTimeUnit(period) {
    switch (period) {
        case '1h': return 'minute';
        case '6h':
        case '24h': return 'hour';
        case '7d':
        case '30d': return 'day';
        default: return 'hour';
    }
}

/**
 * Рассчитать мощность (P = U * I * 0.95 / 1000)
 */
function calculatePower(voltage, amperage) {
    const v = parseFloat(voltage) || 0;
    const a = parseFloat(amperage) || 0;
    return (v * a * 0.95) / 1000;
}

/**
 * Генерация mock данных для демонстрации
 * (удалите эту функцию когда будет готов backend endpoint)
 */
function generateMockData(period) {
    const now = new Date();
    const points = period === '1h' ? 60 : period === '6h' ? 72 : period === '24h' ? 96 : 168;
    const interval = period === '1h' ? 60000 : period === '6h' ? 300000 : period === '24h' ? 900000 : 3600000;
    
    const data = [];
    for (let i = points; i >= 0; i--) {
        const timestamp = new Date(now - (i * interval));
        data.push({
            timestamp: timestamp.toISOString(),
            electricity_ph1: 220 + Math.random() * 10 - 5,
            electricity_ph2: 220 + Math.random() * 10 - 5,
            electricity_ph3: 220 + Math.random() * 10 - 5,
            amperage_ph1: 5 + Math.random() * 3,
            amperage_ph2: 5 + Math.random() * 3,
            amperage_ph3: 5 + Math.random() * 3,
            cold_water_pressure: 2.5 + Math.random() * 0.5,
            cold_water_temp: 12 + Math.random() * 2,
            hot_water_in_pressure: 3 + Math.random() * 0.5,
            hot_water_in_temp: 55 + Math.random() * 5,
            hot_water_out_pressure: 2.8 + Math.random() * 0.3,
            hot_water_out_temp: 45 + Math.random() * 5,
            ambient_temp: 20 + Math.random() * 5,
            humidity: 50 + Math.random() * 10,
            leak_sensor: Math.random() > 0.95 ? 1 : 0
        });
    }
    return data;
}