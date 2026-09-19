/**
 * @jest-environment jsdom
 *
 * [CO-4] Санитизация и — главное — её ЗАПАСНОЙ путь.
 *
 * `public/utils/domSecurity.js` — фронтовый рубеж против XSS, и он был покрыт на
 * 34%: проверены две чистые функции (`escapeHTML`, `formatPopupValue`), а всё,
 * что действительно трогает DOM, — нет. Порог покрытия при этом не
 * распространялся на `public/` вовсе, так что и сигнала об этом не было.
 *
 * Самое важное здесь — ветка «DOMPurify не загружен». Она сегодня fail-SAFE:
 * модуль кладёт текст, а не разметку. Но это решение НИЧЕМ не удерживалось:
 * замена `element.textContent` на `element.innerHTML` в запасном пути выглядит
 * как безобидное упрощение и открывает ровно ту дыру, ради которой модуль
 * написан. Теперь удерживается.
 *
 * DOMPurify берётся НЕ из npm (его там и нет), а из того самого файла, который
 * уезжает пользователям: `public/libs/dompurify/purify.min.js`. Так проверяются
 * ровно те байты, что отдаёт периметр, — подменённый или урезанный вендор-файл
 * тест заметит.
 */

const path = require('path');

const PURIFY = path.resolve(__dirname, '../../../../public/libs/dompurify/purify.min.js');
const DOMSecurity = require('../../../../public/utils/domSecurity');

const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>';

/** Вендорный UMD отдаёт фабрику; инстанс привязывается к окну jsdom. */
function loadPurify() {
    const factory = require(PURIFY);
    global.DOMPurify = typeof factory === 'function' ? factory(window) : factory;
}

beforeEach(() => {
    document.body.innerHTML = '';
    delete global.DOMPurify;
});

describe('[CO-4] setSecureHTML при живом DOMPurify', () => {
    beforeEach(loadPurify);

    test('исполняемое вырезается, разрешённая разметка остаётся', () => {
        const el = document.createElement('div');
        DOMSecurity.setSecureHTML(el, `<p class="x">Подстанция №3</p>${XSS}`);
        expect(el.querySelector('p')).not.toBeNull();
        expect(el.querySelector('script')).toBeNull();
        expect(el.innerHTML).not.toMatch(/onerror/i);
    });

    test('опции вызывающего сужают набор, а не расширяют молча', () => {
        const el = document.createElement('div');
        DOMSecurity.setSecureHTML(el, '<p>текст</p>', { ALLOWED_TAGS: ['span'] });
        expect(el.querySelector('p')).toBeNull();
        expect(el.textContent).toBe('текст');
    });

    test('null/undefined не трогают элемент', () => {
        const el = document.createElement('div');
        el.textContent = 'прежнее';
        DOMSecurity.setSecureHTML(el, null);
        DOMSecurity.setSecureHTML(el, undefined);
        expect(el.textContent).toBe('прежнее');
    });
});

describe('[CO-4] setSecureHTML БЕЗ DOMPurify — запасной путь обязан класть текст', () => {
    test('разметка не становится DOM', () => {
        // Тот самый инвариант: замена textContent на innerHTML здесь выглядит
        // безобидным упрощением и открывает XSS.
        const el = document.createElement('div');
        jest.spyOn(console, 'error').mockImplementation(() => {});
        DOMSecurity.setSecureHTML(el, XSS);
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('script')).toBeNull();
        expect(el.textContent).toBe(XSS);
        console.error.mockRestore();
    });

    test('о подмене сообщается в консоль — тихая деградация защиты недопустима', () => {
        const el = document.createElement('div');
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        DOMSecurity.setSecureHTML(el, '<b>x</b>');
        expect(spy).toHaveBeenCalledWith(expect.stringMatching(/DOMPurify/));
        spy.mockRestore();
    });
});

describe('[CO-4] sanitizePopupContent', () => {
    test('с DOMPurify: таблицы и картинки живут, обработчики — нет', () => {
        loadPurify();
        const out = DOMSecurity.sanitizePopupContent(
            `<table><tr><td>220</td></tr></table><img src="a.png" alt="a">${XSS}`
        );
        expect(out).toMatch(/<table/i);
        expect(out).toMatch(/<img/i);
        expect(out).not.toMatch(/onerror/i);
        expect(out).not.toMatch(/<script/i);
    });

    test('без DOMPurify: на выходе экранированный текст, а не разметка', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const out = DOMSecurity.sanitizePopupContent(XSS);
        expect(out).not.toMatch(/<img/i);
        expect(out).toMatch(/&lt;img/);
        spy.mockRestore();
    });

    test('пустой ввод — пустая строка, без обращения к DOMPurify', () => {
        expect(DOMSecurity.sanitizePopupContent('')).toBe('');
        expect(DOMSecurity.sanitizePopupContent(null)).toBe('');
    });
});

describe('[CO-4] сообщения оператору вставляются текстом', () => {
    // Сообщение об ошибке часто несёт данные из ответа сервера — классический
    // путь для XSS, если вставлять его разметкой.
    test.each([
        ['showSecureErrorMessage', 'error-message'],
        ['showSecureSuccessMessage', 'success-message'],
    ])('%s: полезная нагрузка не исполняется', (fn, defaultClass) => {
        const box = document.createElement('div');
        DOMSecurity[fn](box, XSS);
        expect(box.querySelector('img')).toBeNull();
        expect(box.querySelector('script')).toBeNull();
        expect(box.firstChild.className).toBe(defaultClass);
        expect(box.textContent).toBe(XSS);
    });

    test('повторный вызов заменяет прежнее сообщение, а не копит', () => {
        const box = document.createElement('div');
        DOMSecurity.showSecureErrorMessage(box, 'первая');
        DOMSecurity.showSecureErrorMessage(box, 'вторая');
        expect(box.childNodes.length).toBe(1);
        expect(box.textContent).toBe('вторая');
    });

    test('свой класс передаётся, отсутствующий контейнер не роняет', () => {
        const box = document.createElement('div');
        DOMSecurity.showSecureSuccessMessage(box, 'ок', 'toast');
        expect(box.firstChild.className).toBe('toast');
        expect(() => DOMSecurity.showSecureErrorMessage(null, 'x')).not.toThrow();
    });
});

describe('[CO-4] setSecureText и clearContainer', () => {
    test('setSecureText кладёт строку, а не разметку', () => {
        const el = document.createElement('div');
        DOMSecurity.setSecureText(el, XSS);
        expect(el.querySelector('img')).toBeNull();
        expect(el.textContent).toBe(XSS);
    });

    test('setSecureText приводит к строке и не трогает элемент на null', () => {
        const el = document.createElement('div');
        DOMSecurity.setSecureText(el, 42);
        expect(el.textContent).toBe('42');
        DOMSecurity.setSecureText(el, null);
        expect(el.textContent).toBe('42');
    });

    test('clearContainer опустошает и терпит null', () => {
        const box = document.createElement('div');
        box.appendChild(document.createElement('span'));
        DOMSecurity.clearContainer(box);
        expect(box.childNodes.length).toBe(0);
        expect(() => DOMSecurity.clearContainer(null)).not.toThrow();
    });
});
