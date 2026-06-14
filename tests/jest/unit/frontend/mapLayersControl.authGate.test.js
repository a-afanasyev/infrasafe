/**
 * @jest-environment jsdom
 *
 * [AUD-033] Map auth-gate fix. Baseline bug: `isAuthenticated()` read a dead
 * localStorage('admin_token') (always null) → init() never auto-loaded the
 * infra layers for a logged-in operator. The fix moves the auth decision to the
 * server-authoritative boot probe in script.js, which calls handleAuthChange(true)
 * after it resolves. So the class contract becomes:
 *   - init() ALWAYS loads only public layers (buildings + public counts), never
 *     gates infra on a client-side token guess.
 *   - infra layers load via handleAuthChange(true), which must wait for init() to
 *     have set up overlays (the `_ready` guard) so a fast probe can't race init.
 */

const MapLayersControl = require('../../../../public/map-layers-control.js');

function makeControl() {
    const map = { hasLayer: () => false, addLayer() {}, removeLayer() {} };
    const c = new MapLayersControl(map, { autoInit: false });
    jest.spyOn(c, 'initializeLayers').mockImplementation(() => {});
    jest.spyOn(c, 'createLayerControl').mockImplementation(() => {});
    jest.spyOn(c, 'setupEventHandlers').mockImplementation(() => {});
    jest.spyOn(c, 'loadLayerDataSilent').mockResolvedValue(undefined);
    jest.spyOn(c, 'loadPublicLayerCounts').mockResolvedValue(undefined);
    jest.spyOn(c, 'loadInfrastructureLayers').mockResolvedValue(undefined);
    return c;
}

const INFRA = '⚡ Трансформаторы';

afterEach(() => jest.restoreAllMocks());

describe('[AUD-033] init() is public-only (no client-side auth gate)', () => {
    test('init() loads public counts + buildings, never infra inline (no client-side auth gate)', async () => {
        const c = makeControl();
        await c.init();
        expect(c.loadPublicLayerCounts).toHaveBeenCalled();
        const infraInline = c.loadLayerDataSilent.mock.calls.some(([name]) => name === INFRA);
        expect(infraInline).toBe(false);
        // the dead client-side auth gate is gone entirely
        expect(typeof c.isAuthenticated).toBe('undefined');
    });
});

describe('[AUD-033] handleAuthChange drives infra; _ready guard prevents init race', () => {
    test('handleAuthChange(true) loads infra layers', async () => {
        const c = makeControl();
        await c.init();
        await c.handleAuthChange(true);
        expect(c.loadInfrastructureLayers).toHaveBeenCalledTimes(1);
    });

    test('handleAuthChange(true) called BEFORE init waits for _ready, then loads infra', async () => {
        const c = makeControl();
        const pending = c.handleAuthChange(true); // probe resolved before init ran
        // must NOT have loaded infra yet — overlays not initialized
        expect(c.loadInfrastructureLayers).not.toHaveBeenCalled();
        await c.init();   // resolves _ready
        await pending;
        expect(c.loadInfrastructureLayers).toHaveBeenCalledTimes(1);
    });

    test('handleAuthChange(false) clears infra layers (no _ready dependency needed)', async () => {
        const c = makeControl();
        jest.spyOn(c, 'clearInfrastructureLayers').mockImplementation(() => {});
        await c.init();
        await c.handleAuthChange(false);
        expect(c.clearInfrastructureLayers).toHaveBeenCalledTimes(1);
        expect(c.loadInfrastructureLayers).not.toHaveBeenCalled();
    });
});
