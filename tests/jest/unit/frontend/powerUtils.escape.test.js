/**
 * @jest-environment jsdom
 *
 * [CO-6] `createOverloadWarning` вставляет `objectName` в HTML-строку, которая
 * уходит в разметку попапа. Сегодня единственный вызывающий подаёт имя
 * трансформатора из своей же БД — но «безопасно, пока данные хорошие» не
 * контракт: имя редактируется в админке, и один сохранённый `<img onerror=…>`
 * стал бы stored-XSS в попапе карты. Экранируем на месте вставки.
 */

require('../../../../public/utils/powerUtils.js');

const PU = window.PowerUtils;
const PAYLOAD = '<img src=x onerror="alert(1)">';

describe('[CO-6] экранирование objectName в powerUtils', () => {
    test('createOverloadWarning не пропускает HTML из имени объекта', () => {
        const html = PU.createOverloadWarning(95, PAYLOAD);

        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        // Разметка самого предупреждения при этом жива
        expect(html).toContain('ПЕРЕГРУЗКА!');
    });

    test('formatTransformerLoadInfo не пропускает HTML из transformer.name', () => {
        const html = PU.formatTransformerLoadInfo(
            { name: PAYLOAD, capacity_kva: '100' },
            { total_power_kw: '95', load_percent: '95' }
        );

        expect(html).not.toContain('<img');
    });

    test('обычное имя проходит как есть', () => {
        const html = PU.createOverloadWarning(95, 'ТП-Фараби');
        expect(html).toContain('ТП-Фараби');
    });
});
