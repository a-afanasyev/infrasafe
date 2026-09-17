/**
 * [A-06] Поля-связи в форме здания: что отправлять, а что не трогать.
 *
 * Дефект был двусторонним. Со стороны API «поле не передано» означало «поле
 * сброшено» (чинится в `models/Building.js`). Со стороны формы поле пропадало
 * само: справочник грузится ПЕРВОЙ страницей из десяти, и если текущая связь
 * здания в неё не попала, `select.value = <id>` не находит `option` и молча
 * оставляет пустую строку. Оператор менял название — и связь исчезала.
 *
 * Частичное обновление на бэкенде закрывает потерю, но порождает вопрос: как
 * тогда СБРОСИТЬ связь? Если пустой select всегда означает «не трогать», то
 * отвязать здание станет нечем. Поэтому здесь различаются три состояния, и
 * различие держится на том, загрузился ли справочник вообще:
 *
 *   - справочник пуст (не загрузился)     → поле не отправляем;
 *   - справочник есть, выбрано «не задано» → отправляем `null` (сброс);
 *   - справочник есть, выбран объект       → отправляем идентификатор.
 *
 * Пустой справочник как признак «не загрузился» — не догадка: в форме всегда
 * есть placeholder-опция, поэтому «ноль опций помимо пустой» достижимо только
 * когда `loadFormData` не отработал.
 *
 * Модуль намеренно не знает про DOM: на вход идёт минимальная форма
 * `{ value, options }`, которую даёт и настоящий `<select>`, и объект в тесте.
 * Внутри 3983-строчного `admin.js` эту логику проверить было бы нечем.
 */
(function (root) {
    'use strict';

    // Метка подставленной опции — см. ensureOption / clearInjectedOptions.
    const INJECTED_FLAG = '__a06InjectedLink';

    /** Опции без placeholder'а: у него пустое значение. */
    function realOptions(select) {
        const options = (select && select.options) || [];
        return Array.prototype.filter.call(options, (opt) => String(opt.value) !== '');
    }

    /** Справочник загрузился? */
    function isReferenceLoaded(select) {
        return realOptions(select).length > 0;
    }

    /** Есть ли в списке опция под это значение. */
    function hasOptionFor(select, value) {
        if (value === null || value === undefined || value === '') return false;
        return realOptions(select).some((opt) => String(opt.value) === String(value));
    }

    /**
     * Что отправлять по одному полю-связи.
     * @returns {{omit: true}|{omit: false, value: number|null}}
     */
    function linkFieldPayload(select) {
        if (!isReferenceLoaded(select)) {
            return { omit: true };
        }
        const raw = select.value;
        if (raw === '' || raw === null || raw === undefined) {
            return { omit: false, value: null };
        }
        const parsed = parseInt(raw, 10);
        // Нечисловое значение в select'е связи — испорченный DOM, а не выбор
        // оператора: отправлять его нельзя, но и стирать связь не за что.
        return Number.isNaN(parsed) ? { omit: true } : { omit: false, value: parsed };
    }

    /**
     * Собрать часть payload'а по карте `имя_поля → select`.
     * Поля, по которым справочник не загрузился, в объект не попадают.
     */
    function collectLinkFields(selectsByField) {
        const payload = {};
        Object.keys(selectsByField || {}).forEach((field) => {
            const decision = linkFieldPayload(selectsByField[field]);
            if (!decision.omit) {
                payload[field] = decision.value;
            }
        });
        return payload;
    }

    /**
     * Убедиться, что текущее значение представлено опцией.
     *
     * Иначе присваивание `select.value` не срабатывает МОЛЧА — ни исключения,
     * ни предупреждения, просто пустой select. Подпись опции берётся из данных
     * здания, если там она есть; иначе показываем идентификатор, чтобы оператор
     * видел: связь есть, справочник просто её не привёз.
     *
     * @param {{value: string, options: Array}} select
     * @param {number|string|null} value
     * @param {string} [label]
     * @param {Function} [makeOption] — фабрика опции (для среды без DOM)
     * @returns {boolean} была ли опция добавлена
     */
    function ensureOption(select, value, label, makeOption) {
        if (!select || value === null || value === undefined || value === '') return false;
        if (hasOptionFor(select, value)) return false;

        const text = label || `# ${value} (нет в справочнике)`;
        const factory = makeOption || ((v, t) => new Option(t, v));
        const option = factory(String(value), text);
        // Метка, чтобы потом снять ИМЕННО подставленные опции: форму открывают
        // много раз подряд, и без уборки в списке копились бы записи от ранее
        // отредактированных зданий. Обычное свойство работает и на DOM-элементе,
        // и на объекте в тесте.
        option[INJECTED_FLAG] = true;
        if (typeof select.add === 'function') {
            select.add(option);
        } else if (Array.isArray(select.options)) {
            select.options.push(option);
        }
        return true;
    }

    /**
     * Снять опции, подставленные `ensureOption`. Настоящий справочник не
     * трогается.
     */
    function clearInjectedOptions(select) {
        const options = (select && select.options) || [];
        const injected = Array.prototype.filter.call(options, (opt) => opt[INJECTED_FLAG] === true);
        injected.forEach((opt) => {
            if (typeof select.remove === 'function' && typeof opt.index === 'number') {
                select.remove(opt.index);
            } else if (Array.isArray(select.options)) {
                select.options.splice(select.options.indexOf(opt), 1);
            }
        });
        return injected.length;
    }

    const api = {
        isReferenceLoaded,
        hasOptionFor,
        linkFieldPayload,
        collectLinkFields,
        ensureOption,
        clearInjectedOptions,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.BuildingFormPayload = api;
    }
})(typeof window !== 'undefined' ? window : this);
