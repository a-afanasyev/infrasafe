/**
 * @jest-environment jsdom
 *
 * [N-54] Одно здание без координат обрывало отрисовку слоя зданий.
 *
 * Миграция 011 намеренно сделала `buildings.latitude/longitude` nullable:
 * здания из УК приходят без координат. Основная карта это учитывает
 * (`script.js` пропускает такие записи), а `createBuildingMarker` делал
 * `parseFloat(null)` → NaN → `L.circleMarker` бросал `Invalid LatLng object`
 * внутри `forEach`, и все здания ПОСЛЕ плохого не рисовались. На .105 так
 * пропадали 2 маркера из 8. Тот же приём в `loadControllers`.
 *
 * Leaflet — настоящий, из `public/libs`: исключение бросает его конструктор
 * LatLng, и мок, который его не бросает, пропустил бы дефект.
 */

const L = require('../../../../public/libs/leaflet/leaflet.js');
global.L = L;
const MapLayersControl = require('../../../../public/map-layers-control.js');

const BUILDINGS = '🏢 Здания';
const CONTROLLERS = '📊 Контроллеры';

const building = (id, lat, lng, extra = {}) => ({
    building_id: id,
    building_name: `Дом ${id}`,
    latitude: lat,
    longitude: lng,
    controller_id: id,
    controller_status: 'online',
    ...extra,
});

// Порядок важен: здания без координат стоят ПЕРЕД валидными — прежний код
// бросал на них и терял всё, что шло дальше.
const PAYLOAD = [
    building(1, 41.31, 69.28),
    building(11, null, null),
    building(12, undefined, 69.2),
    building(13, 'abc', 69.2),
    building(2, 41.32, 69.29),
    building(3, 0, 0), // ноль — законная координата, не «отсутствие»
];
const VALID_IDS = [1, 2, 3];

function makeControl() {
    const map = { hasLayer: () => false, addLayer() {}, removeLayer() {} };
    const c = new MapLayersControl(map, { autoInit: false });
    c.overlays[BUILDINGS] = L.layerGroup();
    c.overlays[CONTROLLERS] = L.layerGroup();
    jest.spyOn(c, 'updateLayerCount').mockImplementation(() => {});
    return c;
}

function mockFetch(payload) {
    global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ data: payload }),
    });
}

const drawnLatLngs = (layer) => layer.getLayers()
    .map((m) => m.getLatLng())
    .map(({ lat, lng }) => [lat, lng]);

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
});

describe('[N-54] слой зданий переживает здания без координат', () => {
    test('рисует все здания с координатами, пропуская остальные', async () => {
        const c = makeControl();
        mockFetch(PAYLOAD);

        await expect(c.loadBuildings({})).resolves.toBeUndefined();

        expect(drawnLatLngs(c.overlays[BUILDINGS])).toEqual([[41.31, 69.28], [41.32, 69.29], [0, 0]]);
    });

    test('счётчик слоя — число нарисованных, а не полученных', async () => {
        const c = makeControl();
        mockFetch(PAYLOAD);

        await c.loadBuildings({});

        expect(c.updateLayerCount).toHaveBeenCalledWith(BUILDINGS, VALID_IDS.length);
    });

    test('пропуск заметен в консоли', async () => {
        const c = makeControl();
        mockFetch(PAYLOAD);

        await c.loadBuildings({});

        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('N-54'), expect.anything());
    });

    test('сбой одного маркера не гасит остальные', async () => {
        const c = makeControl();
        mockFetch([building(1, 41.31, 69.28), building(2, 41.32, 69.29), building(3, 41.33, 69.3)]);
        const real = c.createBuildingMarker.bind(c);
        jest.spyOn(c, 'createBuildingMarker').mockImplementation((b) => {
            if (b.building_id === 2) throw new Error('boom');
            return real(b);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await c.loadBuildings({});

        expect(drawnLatLngs(c.overlays[BUILDINGS])).toEqual([[41.31, 69.28], [41.33, 69.3]]);
        expect(c.updateLayerCount).toHaveBeenCalledWith(BUILDINGS, 2);
        expect(console.error).toHaveBeenCalled();
    });
});

describe('[N-54] слой контроллеров — тот же класс', () => {
    test('рисует контроллеры зданий с координатами, пропуская остальные', async () => {
        const c = makeControl();
        mockFetch(PAYLOAD);

        await expect(c.loadControllers({})).resolves.toBeUndefined();

        expect(drawnLatLngs(c.overlays[CONTROLLERS])).toEqual([[41.31, 69.28], [41.32, 69.29], [0, 0]]);
        expect(c.updateLayerCount).toHaveBeenCalledWith(CONTROLLERS, VALID_IDS.length);
    });

    test('сбой одного маркера контроллера не гасит остальные', async () => {
        const c = makeControl();
        mockFetch([building(1, 41.31, 69.28), building(2, 41.32, 69.29), building(3, 41.33, 69.3)]);
        const real = c.createControllerMarker.bind(c);
        jest.spyOn(c, 'createControllerMarker').mockImplementation((b, latLng) => {
            if (b.building_id === 2) throw new Error('boom');
            return real(b, latLng);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await c.loadControllers({});

        expect(drawnLatLngs(c.overlays[CONTROLLERS])).toEqual([[41.31, 69.28], [41.33, 69.3]]);
        expect(c.updateLayerCount).toHaveBeenCalledWith(CONTROLLERS, 2);
        expect(console.error).toHaveBeenCalled();
    });
});
