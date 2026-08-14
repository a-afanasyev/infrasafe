/**
 * Утилиты для работы с данными о мощности
 * Используются для визуализации загрузки трансформаторов, линий и зданий
 */

/**
 * Цвет из токенов темы с запасным литералом.
 * Разметка здесь собирается строками и вставляется через innerHTML, поэтому
 * CSS-переменные приходится разрешать в коде. Запасное значение — литерал:
 * в окне деплоя бандл может оказаться новее CSS.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function PU_T(name, fallback) {
    return (typeof window !== 'undefined' && window.BrandTokens)
        ? window.BrandTokens.token(name, fallback)
        : fallback;
}

/**
 * [CO-6] Экранирование значения перед вставкой в HTML-строку.
 * Имена объектов приходят из БД и редактируются в админке — сохранённый
 * `<img onerror=…>` без экранирования стал бы stored-XSS в попапе карты.
 *
 * @param {*} value
 * @returns {string}
 */
function PU_escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * Создать SVG прогресс-бар для маркера трансформатора
 * 
 * @param {number} loadPercent - Процент загрузки (0-100)
 * @returns {string} HTML с SVG элементом
 */
function createTransformerProgressRing(loadPercent) {
    // Определяем цвет в зависимости от загрузки
    const color = getLoadColor(loadPercent);
    
    // Параметры круга
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (loadPercent / 100) * circumference;
    
    return `
        <svg class="transformer-progress-ring" width="40" height="40" viewBox="0 0 40 40">
            <circle class="ring-background" cx="20" cy="20" r="${radius}"></circle>
            <circle 
                class="ring-progress" 
                cx="20" 
                cy="20" 
                r="${radius}"
                stroke="${color}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}">
            </circle>
        </svg>
    `;
}

/**
 * Получить цвет в зависимости от процента загрузки
 * 
 * @param {number} loadPercent - Процент загрузки
 * @returns {string} HEX цвет
 */
function getLoadColor(loadPercent) {
    // Норма здесь заливается ЦВЕТОМ, а не остаётся пустой: это шкала
    // величины, а не состояние объекта на карте. Пустое кольцо на индикаторе
    // нагрузки читалось бы как «нет данных», а не как «нагрузка в норме»,
    // поэтому берётся --st-success, а не --st-ok.
    if (loadPercent >= 90) return PU_T('--st-crit', '#EF4444');        // критическая перегрузка
    if (loadPercent >= 80) return PU_T('--st-warn-strong', '#FF9800'); // высокая загрузка
    if (loadPercent >= 60) return PU_T('--st-warn', '#F59E0B');        // средняя загрузка
    return PU_T('--st-success', '#10B981');                            // нормальная загрузка
}

/**
 * Создать HTML маркера трансформатора с прогресс-баром
 * 
 * @param {number} loadPercent - Процент загрузки
 * @param {boolean} isOverloaded - Флаг перегрузки (>90%)
 * @returns {string} HTML код маркера
 */
function createTransformerMarkerHTML(loadPercent, isOverloaded) {
    const progressRing = createTransformerProgressRing(loadPercent);
    const overloadClass = isOverloaded ? 'transformer-overload-marker' : '';
    
    return `
        <div class="transformer-marker-container ${overloadClass}">
            ${progressRing}
            <div class="transformer-icon">⚡</div>
        </div>
    `;
}

/**
 * Создать визуальный индикатор мощности для одной фазы
 * 
 * @param {string} phaseLabel - Название фазы ("Фаза 1", "Фаза 2", "Фаза 3")
 * @param {number} powerKw - Мощность в кВт
 * @param {number} percentOfMax - Процент от максимума (для ширины полоски)
 * @returns {string} HTML с индикатором
 */
function createPhaseIndicator(phaseLabel, powerKw, percentOfMax) {
    const color = getLoadColor(percentOfMax);
    const width = Math.min(100, Math.max(0, percentOfMax));
    
    return `
        <div class="power-phase-row">
            <span class="phase-label">${phaseLabel}:</span>
            <div class="power-indicator-bar">
                <div class="power-fill" style="width: ${width}%; background: ${color};"></div>
            </div>
            <span class="phase-value">${powerKw.toFixed(2)} кВт</span>
        </div>
    `;
}

/**
 * Создать секцию с данными мощности для popup
 * 
 * @param {Object} powerData - Данные о мощности из API
 * @param {Object} options - Опции отображения
 * @returns {string} HTML секции с мощностью
 */
function createPowerSection(powerData, options = {}) {
    const {
        showPhaseDetails = true,
        showSummary = true,
        capacityKva = null,
        title = 'Потребляемая мощность'
    } = options;
    
    if (!powerData) {
        return `<p style="color: ${PU_T('--muted-foreground', '#718096')};">Нет данных о мощности</p>`;
    }
    
    const ph1 = parseFloat(powerData.power_ph1_kw) || 0;
    const ph2 = parseFloat(powerData.power_ph2_kw) || 0;
    const ph3 = parseFloat(powerData.power_ph3_kw) || 0;
    const total = parseFloat(powerData.total_power_kw) || 0;
    
    // Для расчёта процента от capacity
    const maxPowerPerPhase = capacityKva ? capacityKva / 3 : Math.max(ph1, ph2, ph3) * 1.5;
    
    let html = `<div class="power-section">`;
    html += `<div class="power-section-title" style="color: ${PU_T('--popup-body', '#2d3748')};">💡 ${title}</div>`;
    
    if (showPhaseDetails) {
        html += createPhaseIndicator('Фаза 1', ph1, (ph1 / maxPowerPerPhase) * 100);
        html += createPhaseIndicator('Фаза 2', ph2, (ph2 / maxPowerPerPhase) * 100);
        html += createPhaseIndicator('Фаза 3', ph3, (ph3 / maxPowerPerPhase) * 100);
    }
    
    if (showSummary) {
        const summaryText = showPhaseDetails 
            ? `${ph1.toFixed(1)} / ${ph2.toFixed(1)} / ${ph3.toFixed(1)} кВт`
            : `${total.toFixed(2)} кВт`;
        
        html += `
            <div class="power-summary" style="color: ${PU_T('--popup-body', '#2d3748')};">
                ${showPhaseDetails ? 'По фазам: ' + summaryText + ' | ' : ''}
                <strong>Всего: ${total.toFixed(2)} кВт</strong>
            </div>
        `;
    }
    
    html += `</div>`;
    return html;
}

/**
 * Создать предупреждение о перегрузке
 * 
 * @param {number} loadPercent - Процент загрузки
 * @param {string} objectName - Название объекта
 * @returns {string} HTML предупреждения или пустая строка
 */
function createOverloadWarning(loadPercent, objectName) {
    if (loadPercent < 90) return '';
    
    return `
        <div class="overload-warning" style="color: ${PU_T('--popup-danger', '#c53030')}; background-color: ${PU_T('--overload-surface', '#fff5f5')}; padding: 8px; border-radius: 4px; border-left: 4px solid #fc8181;">
            <strong>ПЕРЕГРУЗКА!</strong> ${PU_escape(objectName)} загружен на ${loadPercent.toFixed(1)}%
        </div>
    `;
}

/**
 * Форматировать данные загрузки трансформатора для popup
 * 
 * @param {Object} transformer - Данные трансформатора
 * @param {Object} powerData - Данные мощности
 * @returns {string} HTML с детальной информацией
 */
function formatTransformerLoadInfo(transformer, powerData) {
    const capacity = parseFloat(transformer.capacity_kva) || 0;
    const totalPower = parseFloat(powerData.total_power_kw) || 0;
    const loadPercent = parseFloat(powerData.load_percent) || 0;
    
    let html = '';
    
    // Предупреждение о перегрузке
    html += createOverloadWarning(loadPercent, transformer.name);
    
    // Общая информация о загрузке
    html += `
        <p style="margin: 8px 0; color: ${PU_T('--popup-body', '#2d3748')};">
            <strong>Загрузка:</strong> 
            ${totalPower.toFixed(2)} кВт / ${capacity.toFixed(0)} кВА 
            (<strong style="color: ${getLoadColor(loadPercent)};">${loadPercent.toFixed(1)}%</strong>)
        </p>
    `;
    
    // Детализация по фазам
    html += createPowerSection(powerData, {
        title: 'Распределение по фазам',
        capacityKva: capacity,
        showPhaseDetails: true,
        showSummary: false
    });
    
    // Статистика
    html += `
        <p style="margin: 8px 0; font-size: 12px; color: ${PU_T('--power-label', '#4a5568')};">
            Зданий: ${powerData.buildings_count || 0} | 
            Линий: ${powerData.lines_count || 0} | 
            Контроллеров: ${powerData.active_controllers_count || 0}/${powerData.controllers_count || 0}
        </p>
    `;
    
    return html;
}

// Экспортируем для использования в других файлах
if (typeof window !== 'undefined') {
    window.PowerUtils = {
        createTransformerProgressRing,
        createTransformerMarkerHTML,
        createPhaseIndicator,
        createPowerSection,
        createOverloadWarning,
        formatTransformerLoadInfo,
        getLoadColor
    };
}
