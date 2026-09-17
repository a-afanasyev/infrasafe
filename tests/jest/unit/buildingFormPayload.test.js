'use strict';

/**
 * [A-06] Поля-связи формы здания.
 *
 * Дефект: справочник в форме грузится первой страницей из десяти
 * (`/api/transformers` без `limit` → `validatePagination(..., 10)`), и если
 * текущая связь здания в неё не попала, `select.value = <id>` МОЛЧА оставляет
 * пустую строку — подходящей опции нет. Дальше submit пропускал пустое поле, а
 * фиксированный UPDATE писал в колонку NULL: смена названия удаляла связь.
 *
 * Частичное обновление на бэкенде убирает потерю, но взамен требует ответа на
 * вопрос «а как тогда сбросить связь?». Отсюда три состояния, проверяемые ниже.
 */

const {
    isReferenceLoaded,
    hasOptionFor,
    linkFieldPayload,
    collectLinkFields,
    ensureOption,
    clearInjectedOptions,
} = require('../../../public/utils/buildingFormPayload');

/** Минимальный двойник `<select>`: настоящему нужны те же два поля. */
const select = (value, ids = []) => ({
    value: String(value),
    options: [{ value: '' }].concat(ids.map((id) => ({ value: String(id) }))),
});

describe('[A-06] три состояния поля-связи', () => {
    test('справочник не загрузился → поле НЕ отправляем', () => {
        // Иначе сбой загрузки формы стирал бы связи при любом сохранении.
        expect(linkFieldPayload(select('', []))).toEqual({ omit: true });
        expect(isReferenceLoaded(select('', []))).toBe(false);
    });

    test('справочник есть, выбрано «не задано» → отправляем null', () => {
        // Осознанный сброс должен оставаться выразимым.
        expect(linkFieldPayload(select('', [7, 8]))).toEqual({ omit: false, value: null });
    });

    test('справочник есть, выбран объект → отправляем число', () => {
        expect(linkFieldPayload(select('8', [7, 8]))).toEqual({ omit: false, value: 8 });
    });

    test('нечисловое значение не отправляется и не стирает связь', () => {
        // Испорченный DOM — не выбор оператора.
        expect(linkFieldPayload(select('abc', [7]))).toEqual({ omit: true });
    });
});

describe('[A-06] сборка payload по нескольким полям', () => {
    test('незагруженные справочники выпадают, остальные попадают', () => {
        const payload = collectLinkFields({
            primary_transformer_id: select('5', [5, 6]),
            backup_transformer_id: select('', [5, 6]),
            cold_water_line_id: select('', []),
        });

        expect(payload).toEqual({
            primary_transformer_id: 5,
            backup_transformer_id: null,
        });
        // Именно ОТСУТСТВИЕ ключа, а не null: null означал бы сброс.
        expect('cold_water_line_id' in payload).toBe(false);
    });

    test('пустая карта даёт пустой объект, а не падение', () => {
        expect(collectLinkFields({})).toEqual({});
        expect(collectLinkFields(null)).toEqual({});
    });
});

describe('[A-06] текущая связь всегда представлена опцией', () => {
    const makeOption = (value, text) => ({ value, text });

    test('значение вне загруженной страницы добавляется в список', () => {
        // Сердцевина находки: здание связано с трансформатором №42, а
        // справочник привёз первые десять.
        const el = select('', [1, 2, 3]);

        expect(ensureOption(el, 42, 'ТП-42', makeOption)).toBe(true);
        expect(hasOptionFor(el, 42)).toBe(true);
    });

    test('подпись берётся из данных, иначе показывается идентификатор', () => {
        const el = select('', [1]);
        ensureOption(el, 42, null, makeOption);

        const added = el.options[el.options.length - 1];
        expect(added.text).toContain('42');
        // Оператор должен видеть, что связь есть, а справочник её не привёз.
        expect(added.text).toMatch(/нет в справочнике/);
    });

    test('существующее значение не дублируется', () => {
        const el = select('2', [1, 2, 3]);
        const before = el.options.length;

        expect(ensureOption(el, 2, 'ТП-2', makeOption)).toBe(false);
        expect(el.options.length).toBe(before);
    });

    test('пустая связь ничего не добавляет', () => {
        const el = select('', [1]);
        for (const empty of [null, undefined, '']) {
            expect(ensureOption(el, empty, 'x', makeOption)).toBe(false);
        }
        expect(el.options.length).toBe(2);
    });

    test('подставленные опции снимаются, а настоящие остаются', () => {
        // Форму открывают много раз подряд. Без уборки в списке копились бы
        // «# 42 (нет в справочнике)» от ранее отредактированных зданий.
        const el = select('', [1, 2]);
        ensureOption(el, 42, 'ТП-42', makeOption);
        ensureOption(el, 43, 'ТП-43', makeOption);
        expect(el.options).toHaveLength(5);

        clearInjectedOptions(el);

        expect(el.options.map((o) => o.value)).toEqual(['', '1', '2']);
    });

    test('уборка не трогает список, в который ничего не подставляли', () => {
        const el = select('2', [1, 2]);
        clearInjectedOptions(el);
        expect(el.options).toHaveLength(3);
    });

    test('после добавления опции значение действительно выставляется', () => {
        // Ради этого всё и делается: без опции присваивание не срабатывает
        // молча, и дальше поле считается пустым.
        const el = select('', [1, 2]);
        ensureOption(el, 42, 'ТП-42', makeOption);
        el.value = '42';

        expect(linkFieldPayload(el)).toEqual({ omit: false, value: 42 });
    });
});
