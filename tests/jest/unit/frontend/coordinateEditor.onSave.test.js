/**
 * @jest-environment jsdom
 *
 * Bug: editing a transformer's coordinates via the map picker wiped all
 * coordinates on save.
 *
 * Root cause — CoordinateEditor.save() on the objectId (edit) path called
 * `onSave(result.data)` (a single object arg), but every caller's callback is
 * `(lat, lng)`. The callback bound `lat = <object>`, `lng = undefined`; the edit
 * form fields became "[object Object]" / "undefined"; the subsequent form submit
 * ran `parseFloat(...)` → NaN → JSON `null` → the PUT erased latitude/longitude.
 *
 * Contract: save() must ALWAYS invoke onSave(lat, lng) with the picked numbers,
 * on both the add (objectId null) and edit (objectId set) paths.
 */

// [CO-10] Редактор спрашивает общий валидатор через window.CoordValidation —
// в браузере его ставит <script> в admin.html, в jsdom ставим здесь.
window.CoordValidation = require('../../../../public/utils/coordValidation.js');

const { CoordinateEditor } = require('../../../../public/admin-coordinate-editor.js');

function setCoordInputs(lat, lng) {
    document.body.innerHTML =
        `<input id="edit-latitude" value="${lat}"><input id="edit-longitude" value="${lng}">`;
}

beforeEach(() => {
    global.showToast = jest.fn();
});

afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete window.fetch;
    delete global.showToast;
    document.body.innerHTML = '';
});

describe('CoordinateEditor.save — onSave(lat, lng) contract', () => {
    test('edit path (objectId set, PUT ok) calls onSave with numeric lat/lng — not the response object', async () => {
        const onSave = jest.fn();
        const ed = new CoordinateEditor({
            objectType: 'transformer', objectId: 10, latitude: 1, longitude: 2, onSave,
        });
        jest.spyOn(ed, 'close').mockImplementation(() => {});
        setCoordInputs(41.351234, 69.252345);

        const fetchFn = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                success: true,
                data: { transformer_id: 10, latitude: 41.351234, longitude: 69.252345 },
            }),
        }));
        global.fetch = fetchFn;
        window.fetch = fetchFn;

        await ed.save();

        // The editor still persists the edit (single coords-only PUT).
        expect(fetchFn).toHaveBeenCalledTimes(1);

        // The callback must receive two numeric args — NOT a single object.
        expect(onSave).toHaveBeenCalledTimes(1);
        const args = onSave.mock.calls[0];
        expect(args).toHaveLength(2);
        expect(typeof args[0]).toBe('number');
        expect(typeof args[1]).toBe('number');
        expect(args[0]).toBeCloseTo(41.351234, 6);
        expect(args[1]).toBeCloseTo(69.252345, 6);

        // Regression guard: the value a (lat,lng) callback would write back into
        // the edit form must be a finite number, never NaN ("[object Object]").
        expect(Number.isFinite(parseFloat(String(args[0])))).toBe(true);
        expect(Number.isFinite(parseFloat(String(args[1])))).toBe(true);
    });

    test('add path (objectId null, no PUT) calls onSave with numeric lat/lng', async () => {
        const onSave = jest.fn();
        const ed = new CoordinateEditor({
            objectType: 'transformer', objectId: null, onSave,
        });
        jest.spyOn(ed, 'close').mockImplementation(() => {});
        setCoordInputs(41.300000, 69.200000);

        const fetchFn = jest.fn();
        global.fetch = fetchFn;
        window.fetch = fetchFn;

        await ed.save();

        // Add path has no backend entity yet → must NOT PUT.
        expect(fetchFn).not.toHaveBeenCalled();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(41.3, 69.2);
    });
});
