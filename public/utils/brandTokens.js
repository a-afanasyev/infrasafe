/**
 * Доступ к токенам темы из JavaScript.
 *
 * ЗАЧЕМ. Часть интерфейса рисуется не CSS, а строками в JS: подложки
 * `L.divIcon`, содержимое popup'ов через innerHTML, опции `L.circleMarker`.
 * До этого модуля цвета в таких местах были записаны литералами — около
 * сотни штук, в пяти несовпадающих палитрах. Смена бренда их не касалась:
 * оболочка становилась зелёной, а маркеры на карте оставались от прежнего
 * оформления.
 *
 * КАК. Значения читаются из тех же CSS-переменных, что и всё остальное
 * (:root в css/tokens.css, поверх — /brand/brand.css). Один источник истины,
 * никакой второй палитры в коде.
 *
 * ФОЛБЭКИ ЗАДАНЫ ЛИТЕРАЛАМИ НАМЕРЕННО. В окне деплоя CSS приезжает
 * bind-mount'ом сразу, а бандлы — только с новым образом. Возможна
 * комбинация «новый JS, старый CSS», где переменной ещё нет. Пустая строка
 * дала бы невидимые маркеры; литерал даёт рабочий, пусть и не брендовый цвет.
 *
 * КЭШ. getComputedStyle на каждый маркер — это сотни рефлоу при отрисовке
 * карты. Значения читаются один раз и сбрасываются при смене темы: класс
 * `.dark` на <html> отслеживается MutationObserver'ом.
 */
(function (global) {
    'use strict';

    var FALLBACK = {
        // шкала состояний объекта
        '--st-ok': '#4caf50',
        '--st-ok-ring': 'rgba(26, 29, 43, 0.35)',
        '--st-warn': '#F59E0B',
        '--st-crit': '#EF4444',
        '--st-info': '#3B82F6',
        '--st-offline': '#9CA3AF',
        '--st-public': '#607d8b',
        '--st-success': '#4CAF50',
        // текст и подложки popup'ов
        '--popup-ink': '#333333',
        '--popup-ink-strong': '#1A1D2B',
        '--popup-body': '#2d3748',
        '--popup-danger': '#c53030',
        '--power-label': '#666666',
        '--power-total': '#1A1D2B',
        '--muted-foreground': '#717182',
        '--accent': '#00BFA5',
        '--accent-ink': '#00897B',
        '--destructive': '#EF4444',
        '--marker-stroke': '#ffffff',
        '--border': 'rgba(0, 0, 0, 0.08)'
    };

    var cache = null;

    function root() {
        return document.documentElement;
    }

    /**
     * Значение CSS-переменной с фолбэком.
     * @param {string} name - имя вида '--st-crit'
     * @param {string} [fallback] - если не задан, берётся из таблицы выше
     * @returns {string}
     */
    function token(name, fallback) {
        if (cache === null) {
            cache = Object.create(null);
        }
        if (name in cache) {
            return cache[name];
        }
        var value = '';
        try {
            value = global.getComputedStyle(root()).getPropertyValue(name).trim();
        } catch (_e) {
            value = '';
        }
        if (!value) {
            value = fallback !== undefined ? fallback : (FALLBACK[name] || '');
        }
        cache[name] = value;
        return value;
    }

    /** Сбросить кэш — после смены темы или бренда. */
    function refresh() {
        cache = null;
    }

    /**
     * Текстовый токен бренда (например, имя площадки).
     *
     * CSS-переменная умеет хранить строку, но getPropertyValue возвращает её
     * ВМЕСТЕ с кавычками: `--brand-name: "ProFK"` придёт как `"ProFK"`.
     * Кавычки снимаем здесь, чтобы вызывающий код не знал об этой детали.
     *
     * Зачем через токен, а не строкой в коде: script.js один на оба хоста.
     * Захардкоженное имя показалось бы и на той площадке, которой оно не
     * принадлежит.
     *
     * @param {string} name
     * @param {string} fallback
     * @returns {string}
     */
    function text(name, fallback) {
        var v = token(name, fallback);
        if (v.length > 1 &&
            ((v[0] === '"' && v[v.length - 1] === '"') ||
             (v[0] === "'" && v[v.length - 1] === "'"))) {
            return v.slice(1, -1);
        }
        return v;
    }

    /** Цвет состояния объекта по ключу шкалы. */
    function status(kind) {
        return token('--st-' + kind);
    }

    /**
     * Опции L.circleMarker для статуса здания.
     *
     * Здесь живёт правило «тихая норма»: если бренд объявил --st-ok
     * прозрачным, здоровый объект рисуется контурным кольцом без заливки.
     * Двести залитых точек — шум; значение имеют те несколько, что не в
     * норме. Бренд, которому привычнее сплошная зелёная точка, просто задаёт
     * --st-ok цветом, и эта ветка не срабатывает.
     *
     * @param {string} kind - ok | warning | leak | critical | public | no
     * @returns {{radius:number, weight:number, color:string, fillColor:string, fillOpacity:number}}
     */
    function markerStyle(kind) {
        var leak = kind === 'leak';
        var fill;
        switch (kind) {
            case 'ok':       fill = token('--st-ok'); break;
            case 'warning':  fill = token('--st-warn'); break;
            case 'leak':     fill = token('--st-info'); break;
            case 'critical': fill = token('--st-crit'); break;
            case 'public':   fill = token('--st-public'); break;
            default:         fill = token('--st-offline'); break;
        }

        // Норма без заливки — только кольцо.
        if (kind === 'ok' && (fill === 'transparent' || fill === 'none' || !fill)) {
            return {
                radius: 8,
                weight: 2,
                color: token('--st-ok-ring'),
                fillColor: token('--st-ok-ring'),
                fillOpacity: 0
            };
        }

        return {
            radius: leak ? 10 : 8,
            weight: leak ? 2 : 1,
            color: leak ? token('--st-info') : token('--marker-stroke'),
            fillColor: fill,
            fillOpacity: leak ? 0.8 : 1
        };
    }

    // Смена темы меняет значения переменных — кэш обязан протухнуть.
    // Наблюдаем за class на <html>: именно туда theme-toggle вешает .dark.
    if (typeof MutationObserver === 'function' && root()) {
        new MutationObserver(refresh).observe(root(), {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    global.BrandTokens = {
        token: token,
        text: text,
        status: status,
        markerStyle: markerStyle,
        refresh: refresh
    };
}(typeof window !== 'undefined' ? window : this));
