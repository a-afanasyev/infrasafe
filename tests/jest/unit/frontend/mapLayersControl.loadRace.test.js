/**
 * @jest-environment jsdom
 *
 * [CO-1] Гонка загрузчиков слоёв карты.
 *
 * Каждый загрузчик делает fetch → `clearLayers()` → перерисовку, и ни у одного
 * не было защиты от повторного входа. `toggleOverlay` дёргается прямо из
 * обработчика клика без debounce, а `loadLayerDataSilent` параллельно грузит те
 * же слои при логине (`handleAuthChange` → `loadInfrastructureLayers`). Два
 * запроса в полёте + обратный порядок ответов (сеть порядок не гарантирует) →
 * слой перерисовывается УСТАРЕВШИМИ данными. На карте мониторинга это может
 * скрыть активную протечку или перегрузку до следующего тика.
 *
 * Тот же класс бага уже закрыт для главного `loadData()` в script.js флагом
 * `isLoadingData` с комментарием [R2-28] — сюда фикс перенесён не был.
 */

const MapLayersControl = require('../../../../public/map-layers-control.js');

const TRANSFORMERS = '⚡ Трансформаторы';
const BUILDINGS = '🏢 Здания';

function makeControl() {
    const map = { hasLayer: () => false, addLayer() {}, removeLayer() {} };
    const c = new MapLayersControl(map, { autoInit: false });
    jest.spyOn(c, 'initializeLayers').mockImplementation(() => {});
    jest.spyOn(c, 'createLayerControl').mockImplementation(() => {});
    jest.spyOn(c, 'setupEventHandlers').mockImplementation(() => {});
    return c;
}

/** Загрузчик, который держится «в полёте», пока его не отпустят. */
function deferred() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release: () => release() };
}

afterEach(() => jest.restoreAllMocks());

describe('[CO-1] loadLayerData не допускает параллельных загрузок одного слоя', () => {
    test('второй вызов во время первого не запускает загрузчик повторно', async () => {
        const c = makeControl();
        const gate = deferred();
        const loader = jest.spyOn(c, 'loadTransformers').mockImplementation(() => gate.promise);

        const first = c.loadLayerData(TRANSFORMERS);
        const second = c.loadLayerData(TRANSFORMERS);

        gate.release();
        await Promise.all([first, second]);

        expect(loader).toHaveBeenCalledTimes(1);
    });

    test('после завершения загрузки слой можно грузить снова', async () => {
        const c = makeControl();
        const loader = jest.spyOn(c, 'loadTransformers').mockResolvedValue(undefined);

        await c.loadLayerData(TRANSFORMERS);
        await c.loadLayerData(TRANSFORMERS);

        expect(loader).toHaveBeenCalledTimes(2);
    });

    test('разные слои по-прежнему грузятся параллельно', async () => {
        const c = makeControl();
        const gate = deferred();
        const transformers = jest.spyOn(c, 'loadTransformers').mockImplementation(() => gate.promise);
        const buildings = jest.spyOn(c, 'loadBuildings').mockResolvedValue(undefined);

        const a = c.loadLayerData(TRANSFORMERS);
        await c.loadLayerData(BUILDINGS);

        gate.release();
        await a;

        expect(transformers).toHaveBeenCalledTimes(1);
        expect(buildings).toHaveBeenCalledTimes(1);
    });

    test('упавший загрузчик не оставляет слой заблокированным навсегда', async () => {
        const c = makeControl();
        const loader = jest.spyOn(c, 'loadTransformers')
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce(undefined);

        await c.loadLayerData(TRANSFORMERS);
        await c.loadLayerData(TRANSFORMERS);

        expect(loader).toHaveBeenCalledTimes(2);
    });
});

describe('[CO-1] тихая предзагрузка и пользовательский тогл не гоняются', () => {
    test('loadLayerDataSilent во время loadLayerData того же слоя пропускается', async () => {
        const c = makeControl();
        const gate = deferred();
        const loader = jest.spyOn(c, 'loadTransformers').mockImplementation(() => gate.promise);

        const toggle = c.loadLayerData(TRANSFORMERS);
        const silent = c.loadLayerDataSilent(TRANSFORMERS);

        gate.release();
        await Promise.all([toggle, silent]);

        expect(loader).toHaveBeenCalledTimes(1);
    });

    test('loadLayerData во время loadLayerDataSilent того же слоя пропускается', async () => {
        const c = makeControl();
        const gate = deferred();
        const loader = jest.spyOn(c, 'loadTransformers').mockImplementation(() => gate.promise);

        const silent = c.loadLayerDataSilent(TRANSFORMERS);
        const toggle = c.loadLayerData(TRANSFORMERS);

        gate.release();
        await Promise.all([silent, toggle]);

        expect(loader).toHaveBeenCalledTimes(1);
    });
});

// Найдено код-ревью: третий, периодический вход в ту же гонку.
// `updateRealTimeMetrics` тикает раз в 30 с (toggleRealTimeMetrics) и звал
// `loadTransformers` НАПРЯМУЮ, минуя оба защищённых входа. Тот же
// clearLayers() + перерисовка, тот же слой — то есть замок закрывал не всю
// гонку, которую обещал закрыть.
describe('[CO-1] периодическое обновление метрик тоже под замком', () => {
    test('updateRealTimeMetrics не запускает вторую загрузку слоя параллельно', async () => {
        const c = makeControl();
        c.overlays = { [TRANSFORMERS]: {} };
        c.map.hasLayer = () => true;

        const gate = deferred();
        const loader = jest.spyOn(c, 'loadTransformers').mockImplementation(() => gate.promise);

        const toggle = c.loadLayerData(TRANSFORMERS);
        const realtime = c.updateRealTimeMetrics();

        gate.release();
        await Promise.all([toggle, realtime]);

        expect(loader).toHaveBeenCalledTimes(1);
    });
});
