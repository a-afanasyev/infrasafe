/**
 * @jest-environment jsdom
 *
 * [N-63] Редактор ЛЭП на карте: трансформаторы видны и выбираются.
 *
 * Решение владельца 07.10: линия обязана принадлежать трансформатору, а при
 * отрисовке трансформаторы должны быть на карте — линия начинается от них.
 * Поле «ID Трансформатора (опционально)» с ручным вводом числа заменено
 * обязательным списком; клик по трансформатору на карте выбирает его.
 *
 * Leaflet настоящий, из public/libs: маркеры и подсказки создаются им.
 */

const L = require('../../../../public/libs/leaflet/leaflet.js');
global.L = L;
const { InfrastructureLineEditor } = require('../../../../public/infrastructure-line-editor.js');

const TRANSFORMERS = [
    { transformer_id: 10, name: 'Трансформатор Фаза1', latitude: '41.349479', longitude: '69.246450' },
    { transformer_id: 12, name: '<img src=x onerror=alert(1)>', latitude: 41.349366, longitude: 69.247379 },
    { transformer_id: 14, name: 'Без координат', latitude: null, longitude: null },
];

function mountForm() {
    document.body.innerHTML = `
        <div id="infrastructure-line-editor-modal">
            <input id="line-name" value="ЛЭП-1">
            <textarea id="line-description"></textarea>
            <input id="line-voltage" value="10">
            <select id="line-transformer"><option value="">— выберите —</option></select>
            <input id="line-cable-type" value="">
            <input id="line-commissioning-year" value="">
            <div id="line-editor-map" style="width: 400px; height: 300px"></div>
        </div>`;
}

function editor(opts = {}) {
    const e = new InfrastructureLineEditor({ lineType: 'electricity', apiEndpoint: '/api/lines', ...opts });
    jest.spyOn(e, 'showToast').mockImplementation(() => {});
    jest.spyOn(e, 'close').mockImplementation(() => {});
    return e;
}

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mountForm();
});
afterEach(() => jest.restoreAllMocks());

const select = () => document.getElementById('line-transformer');

describe('[N-63] список трансформаторов', () => {
    test('все трансформаторы в списке; имя вставлено текстом, не разметкой', () => {
        const e = editor();
        e.renderTransformerOptions(TRANSFORMERS);

        const options = [...select().options].filter((o) => o.value);
        expect(options.map((o) => o.value)).toEqual(['10', '12', '14']);
        expect(options[1].textContent).toBe('<img src=x onerror=alert(1)>');
        expect(select().querySelector('img')).toBeNull();
    });

    test('при редактировании выбран трансформатор линии', () => {
        const e = editor({ lineId: 5, existingData: { transformer_id: 12 } });
        e.renderTransformerOptions(TRANSFORMERS);
        expect(select().value).toBe('12');
    });
});

describe('[N-63] трансформаторы на карте', () => {
    test('маркеры для всех с координатами; клик по маркеру выбирает трансформатор', () => {
        const e = editor();
        e.map = L.map('line-editor-map').setView([41.35, 69.25], 15);
        e.renderTransformerOptions(TRANSFORMERS);
        e.renderTransformerMarkers(TRANSFORMERS);

        expect(e.transformerMarkers).toHaveLength(2);
        e.transformerMarkers[1].fire('click');
        expect(select().value).toBe('12');
    });

    test('клик по трансформатору не добавляет точку в трассу', () => {
        const e = editor();
        e.map = L.map('line-editor-map').setView([41.35, 69.25], 15);
        e.map.on('click', (ev) => e.handleMapClick(ev));
        e.renderTransformerOptions(TRANSFORMERS);
        e.renderTransformerMarkers(TRANSFORMERS);

        e.transformerMarkers[0].fire('click');
        expect(e.mainPath).toHaveLength(0);
    });

    test('подсказка с именем — текстом, не разметкой', () => {
        const e = editor();
        e.map = L.map('line-editor-map').setView([41.35, 69.25], 15);
        e.renderTransformerMarkers(TRANSFORMERS);

        const content = e.transformerMarkers[1].getTooltip().getContent();
        expect(content.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(content.querySelector('img')).toBeNull();
    });
});

describe('[N-63] трансформатор обязателен', () => {
    test('без выбранного трансформатора линия не сохраняется', async () => {
        global.fetch = jest.fn();
        jest.spyOn(window, 'alert').mockImplementation(() => {});
        const e = editor();
        e.renderTransformerOptions(TRANSFORMERS);
        e.mainPath = [{ lat: 41.30, lng: 69.24 }, { lat: 41.31, lng: 69.24 }];

        expect(e.validateLine()).toContain('Выберите трансформатор, от которого идёт линия');
        await e.saveLine();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('с выбранным трансформатором уходит его id', async () => {
        let body;
        global.fetch = jest.fn(async (_u, init) => {
            body = JSON.parse(init.body);
            return { ok: true, json: async () => ({ success: true }) };
        });
        const e = editor();
        e.renderTransformerOptions(TRANSFORMERS);
        e.selectTransformer(10);
        e.mainPath = [{ lat: 41.30, lng: 69.24 }, { lat: 41.31, lng: 69.24 }];

        await e.saveLine();
        expect(body.transformer_id).toBe(10);
    });
});
