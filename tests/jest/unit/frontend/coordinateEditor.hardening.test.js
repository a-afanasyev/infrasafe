/**
 * @jest-environment jsdom
 *
 * [Новое №3] Два укрепления CoordinateEditor:
 *
 * 1. Guard от двойного сабмита: save() делает async PUT, форма при этом
 *    оставалась живой — двойной Enter отправлял два PUT (единственная
 *    admin-форма без такого guard'а).
 * 2. Мёртвый маппинг `infrastructure-line(s)` → `/api/infrastructure-lines`:
 *    такой роут не смонтирован (линии редактируются своим редактором мимо
 *    CoordinateEditor), маппинг только вводил в заблуждение.
 */

const fs = require('fs');
const path = require('path');
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

describe('[Новое №3] guard от двойного сабмита в save()', () => {
    test('повторный save() во время незавершённого PUT не шлёт второй запрос', async () => {
        setCoordInputs('41.3', '69.2');
        let resolveFetch;
        const pending = new Promise((resolve) => { resolveFetch = resolve; });
        global.fetch = jest.fn().mockReturnValue(pending);
        window.fetch = global.fetch;

        const ed = new CoordinateEditor({
            objectType: 'transformer', objectId: 10,
            latitude: 41.3, longitude: 69.2, onSave: jest.fn()
        });
        // модалки в jsdom нет — close() не должен ронять тест
        ed.close = jest.fn();

        const first = ed.save();
        const second = ed.save(); // double-Enter пока первый PUT в полёте
        resolveFetch({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });
        await Promise.all([first, second]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('после завершения сохранения save() снова доступен', async () => {
        setCoordInputs('41.3', '69.2');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });
        window.fetch = global.fetch;

        const ed = new CoordinateEditor({
            objectType: 'transformer', objectId: 10,
            latitude: 41.3, longitude: 69.2, onSave: jest.fn()
        });
        ed.close = jest.fn();

        await ed.save();
        await ed.save();

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('[Новое №3] мёртвый маппинг infrastructure-lines удалён', () => {
    test('в источнике нет ссылки на несмонтированный /api/infrastructure-lines', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../../public/admin-coordinate-editor.js'),
            'utf8'
        );
        expect(source).not.toMatch(/\/api\/infrastructure-lines/);
    });
});
