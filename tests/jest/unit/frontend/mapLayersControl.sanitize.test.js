/**
 * @jest-environment jsdom
 *
 * [M-9] Остаток fail-closed санитайзера. Базовый баг: `sanitizePopup` возвращал
 * сырой `html`, если `window.DOMSecurity` недоступен (сломанный бандл,
 * заблокированный скрипт) — и этот HTML уходил в Leaflet на 8 сайтах рендера
 * этого модуля. Вторую копию того же приёма в public/script.js починили раньше;
 * здесь закрывается пропущенная.
 */

const MapLayersControl = require('../../../../public/map-layers-control.js');

const makeControl = () => new MapLayersControl(
    { hasLayer: () => false, addLayer() {}, removeLayer() {} },
    { autoInit: false }
);

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

afterEach(() => {
    delete window.DOMSecurity;
    jest.restoreAllMocks();
});

describe('[M-9] sanitizePopup fail-closed', () => {
    test('без DOMSecurity не отдаёт исполняемую разметку', () => {
        delete window.DOMSecurity;
        const c = makeControl();

        const out = c.sanitizePopup(XSS);

        expect(out).not.toContain('<img');
        expect(out).not.toContain('<script');
        expect(out).toContain('&lt;img');

        // Схлопнутый текст, вставленный в DOM, не создаёт элементов.
        const host = document.createElement('div');
        host.innerHTML = out;
        expect(host.querySelector('img')).toBeNull();
        expect(host.querySelector('script')).toBeNull();
    });

    test('без DOMSecurity пишет в console.error (fail-closed заметен в проде)', () => {
        delete window.DOMSecurity;
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const c = makeControl();

        c.sanitizePopup('<b>x</b>');

        expect(spy).toHaveBeenCalledWith(expect.stringContaining('fail-closed'));
    });

    test('null/undefined не превращаются в строки "null"/"undefined"', () => {
        delete window.DOMSecurity;
        const c = makeControl();

        expect(c.sanitizePopup(null)).toBe('');
        expect(c.sanitizePopup(undefined)).toBe('');
    });

    test('при доступном DOMSecurity делегирует ему', () => {
        const sanitizePopupContent = jest.fn().mockReturnValue('<b>safe</b>');
        window.DOMSecurity = { sanitizePopupContent };
        const c = makeControl();

        expect(c.sanitizePopup('<b>raw</b>')).toBe('<b>safe</b>');
        expect(sanitizePopupContent).toHaveBeenCalledWith('<b>raw</b>');
    });
});
