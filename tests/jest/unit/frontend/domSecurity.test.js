/**
 * @jest-environment jsdom
 *
 * First frontend behavioral tests (AUD-015). Exercises the pure helpers in
 * public/utils/domSecurity.js under jsdom — insurance for the AUD-013/014
 * frontend correctness fixes that ship alongside.
 */

const DOMSecurity = require('../../../../public/utils/domSecurity');

describe('domSecurity.escapeHTML', () => {
    test('escapes angle brackets so markup cannot inject', () => {
        const out = DOMSecurity.escapeHTML('<script>alert(1)</script>');
        expect(out).not.toContain('<script>');
        expect(out).toContain('&lt;script&gt;');
    });

    test('returns empty string for null/undefined', () => {
        expect(DOMSecurity.escapeHTML(null)).toBe('');
        expect(DOMSecurity.escapeHTML(undefined)).toBe('');
    });

    test('passes plain text through unchanged', () => {
        expect(DOMSecurity.escapeHTML('Подстанция №3')).toBe('Подстанция №3');
    });
});

describe('domSecurity.formatPopupValue', () => {
    test('null/undefined yields the default label', () => {
        expect(DOMSecurity.formatPopupValue(null)).toBe('Нет данных');
        expect(DOMSecurity.formatPopupValue(undefined, 'V')).toBe('Нет данных');
    });

    test('numeric string is parsed and suffixed', () => {
        expect(DOMSecurity.formatPopupValue('220', 'V')).toBe('220V');
    });

    test('zero is a real value, not treated as missing', () => {
        expect(DOMSecurity.formatPopupValue(0, 'V')).toBe('0V');
    });

    test('non-numeric input falls back to the default', () => {
        expect(DOMSecurity.formatPopupValue('abc', 'V', 'н/д')).toBe('н/д');
    });
});

// [AUD-021 hygiene] validateToken / getValidToken removed as dead code
// (cookie-auth migration, AUD-033) — their tests removed with them.

describe('domSecurity.setSecureText', () => {
    test('writes text as textContent, never as live markup', () => {
        const el = document.createElement('div');
        DOMSecurity.setSecureText(el, '<b>x</b>');
        expect(el.querySelector('b')).toBeNull();
        expect(el.textContent).toBe('<b>x</b>');
    });

    test('ignores null/undefined without throwing', () => {
        const el = document.createElement('div');
        el.textContent = 'keep';
        DOMSecurity.setSecureText(el, null);
        expect(el.textContent).toBe('keep');
    });
});
