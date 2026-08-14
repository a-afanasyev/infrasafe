/**
 * @jest-environment jsdom
 *
 * [CO-10] У редактора координат был СОБСТВЕННЫЙ `validateCoordinates` —
 * вторая реализация тех же правил рядом с `utils/coordValidation.js`, которым
 * пользуются все восемь admin-форм. Копии уже разошлись: общий валидатор
 * отвергает нечисловое строгой проверкой (`typeof === 'number' &&
 * Number.isFinite`) и говорит про пустые поля, локальный обходился `isNaN`
 * и своим текстом.
 *
 * Это ровно тот узел, где уже случался баг стирания координат (NaN → JSON
 * null → колонка обнулялась), поэтому две независимые проверки здесь —
 * не стилистика, а риск: правку одной копии легко не перенести во вторую.
 */

const fs = require('fs');
const path = require('path');
const coordValidation = require('../../../../public/utils/coordValidation.js');

// Браузер получает валидатор глобалом (см. порядок <script> в admin.html:
// coordValidation.js грузится раньше редактора); в jsdom ставим его сами.
window.CoordValidation = coordValidation;

const { CoordinateEditor } = require('../../../../public/admin-coordinate-editor.js');

const EDITOR_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../../../public/admin-coordinate-editor.js'),
    'utf8'
);

function setCoordInputs(lat, lng) {
    document.body.innerHTML =
        `<input id="edit-latitude" value="${lat}"><input id="edit-longitude" value="${lng}">`;
}

function makeEditor(overrides = {}) {
    const ed = new CoordinateEditor({
        objectType: 'transformer', objectId: 10,
        latitude: 41.3, longitude: 69.2, onSave: jest.fn(),
        ...overrides
    });
    ed.close = jest.fn();   // модалки в jsdom нет
    return ed;
}

beforeEach(() => {
    global.showToast = jest.fn();
    window.CoordValidation = coordValidation;
});

afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete window.fetch;
    delete global.showToast;
    document.body.innerHTML = '';
});

describe('[CO-10] редактор координат ходит в общий валидатор', () => {
    test('save() спрашивает CoordValidation.validateCoordinatePair, а не свою копию', async () => {
        setCoordInputs('41.3', '69.2');
        const spy = jest.spyOn(window.CoordValidation, 'validateCoordinatePair');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true, json: async () => ({ success: true, data: {} })
        });
        window.fetch = global.fetch;

        await makeEditor().save();

        expect(spy).toHaveBeenCalledWith(41.3, 69.2);
        spy.mockRestore();
    });

    test('вердикт общего валидатора — единственный источник: отказ гасит PUT', async () => {
        setCoordInputs('41.3', '69.2');
        // Подменяем общий валидатор целиком: если редактор всё ещё судит сам,
        // координаты 41.3/69.2 он признает годными и запрос уйдёт.
        window.CoordValidation = {
            validateCoordinatePair: () => ({ valid: false, error: 'вердикт общего валидатора' })
        };
        global.fetch = jest.fn();
        window.fetch = global.fetch;

        await makeEditor().save();

        expect(global.fetch).not.toHaveBeenCalled();
        expect(global.showToast).toHaveBeenCalledWith('вердикт общего валидатора', 'error');
    });

    test('пустое поле даёт формулировку общего валидатора, а не локальную', async () => {
        setCoordInputs('', '69.2');   // parseFloat('') → NaN
        global.fetch = jest.fn();
        window.fetch = global.fetch;

        await makeEditor().save();

        expect(global.fetch).not.toHaveBeenCalled();
        const [message] = global.showToast.mock.calls[0];
        expect(message).toBe(
            coordValidation.validateCoordinatePair(NaN, 69.2).error
        );
    });

    test('в источнике редактора не осталось второй копии проверок диапазона', () => {
        // Ищем именно СРАВНЕНИЯ (`lat < -90`, `lng > 180`) — логику проверки.
        // Литералы -90/-180 в файле остаются законно: это HTML-атрибуты
        // min/max полей ввода (нативная валидация браузера) и подсказка
        // «Диапазон: от -90 до 90» для человека, а не вторая реализация.
        expect(EDITOR_SOURCE).not.toMatch(/[<>]=?\s*-?(90|180)\b/);
        expect(EDITOR_SOURCE).not.toMatch(/\bisNaN\s*\(\s*lat/);
    });
});
