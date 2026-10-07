/**
 * @jest-environment jsdom
 *
 * [N-61] Редактор линий на карте: длина и поля формы.
 *
 * 07.10 на infrasafe.uz создание ЛЭП падало: «length_km: Поле «Длина (км)»:
 * обязательно для заполнения». В `lines` колонка NOT NULL с CHECK > 0, а в
 * форме редактора такого поля нет и сам он длину не отправлял — создать линию
 * через карту было невозможно никогда (до AR-10 тот же отказ приходил 500-й).
 * Длина теперь считается по нарисованной трассе: основной путь + ответвления.
 *
 * Второй дефект там же: `editLine` передавал `voltage_kv`, `transformer_id`,
 * `length_km` из загруженной записи в `additionalFields`, а те накладывались
 * ПОВЕРХ формы — правка напряжения или трансформатора молча откатывалась.
 */

const { InfrastructureLineEditor } = require('../../../../public/infrastructure-line-editor.js');

// Две точки на одной долготе, 0.01° широты ≈ 1.112 км.
const A = { lat: 41.30, lng: 69.24 };
const B = { lat: 41.31, lng: 69.24 };
const C = { lat: 41.32, lng: 69.24 };
const KM_PER_001_DEG = 1.112;

function mountForm({ name = 'ЛЭП-1', voltage = '', transformer = '' } = {}) {
    document.body.innerHTML = `
        <div id="infrastructure-line-editor-modal">
            <input id="line-name" value="${name}">
            <textarea id="line-description"></textarea>
            <input id="line-voltage" value="${voltage}">
            <input id="line-transformer" value="${transformer}">
            <input id="line-cable-type" value="">
            <input id="line-commissioning-year" value="">
        </div>`;
}

function editor(opts) {
    const e = new InfrastructureLineEditor({ lineType: 'electricity', apiEndpoint: '/api/lines', ...opts });
    jest.spyOn(e, 'showToast').mockImplementation(() => {});
    jest.spyOn(e, 'close').mockImplementation(() => {});
    return e;
}

let sentBody;
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    sentBody = null;
    global.fetch = jest.fn(async (_url, init) => {
        sentBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true, data: {} }) };
    });
});
afterEach(() => jest.restoreAllMocks());

describe('[N-61] pathLengthKm', () => {
    test('один отрезок — расстояние по большому кругу', () => {
        expect(InfrastructureLineEditor.pathLengthKm([A, B])).toBeCloseTo(KM_PER_001_DEG, 2);
    });

    test('основной путь и ответвления складываются', () => {
        const km = InfrastructureLineEditor.pathLengthKm([A, B, C], [[B, { lat: 41.31, lng: 69.25 }]]);
        expect(km).toBeCloseTo(2 * KM_PER_001_DEG + 0.835, 1);
    });

    test('мусорные точки и пустые ответвления не ломают подсчёт', () => {
        expect(InfrastructureLineEditor.pathLengthKm([A, { lat: null, lng: 1 }, B], [[], null])).toBeCloseTo(KM_PER_001_DEG, 2);
        expect(InfrastructureLineEditor.pathLengthKm([], [])).toBe(0);
    });
});

describe('[N-61] создание ЛЭП отправляет длину по трассе', () => {
    test('POST несёт length_km > 0, рассчитанную по точкам', async () => {
        mountForm({ voltage: '10', transformer: '3' });
        const e = editor({ lineId: null });
        e.mainPath = [A, B, C];

        await e.saveLine();

        expect(global.fetch).toHaveBeenCalledWith('/api/lines', expect.objectContaining({ method: 'POST' }));
        expect(sentBody.length_km).toBeCloseTo(2 * KM_PER_001_DEG, 2);
        expect(sentBody.voltage_kv).toBe(10);
    });
});

describe('[N-61] редактирование: форма важнее загруженных значений', () => {
    test('новое напряжение и трансформатор из формы не затираются, длина пересчитана', async () => {
        mountForm({ voltage: '35', transformer: '7' });
        // Так editLine вызывал редактор: старые значения в additionalFields.
        const e = editor({
            lineId: 5,
            existingData: { name: 'ЛЭП-1', voltage_kv: 10, transformer_id: 3, main_path: [A, B, C] },
            additionalFields: { voltage_kv: 10, transformer_id: 3, length_km: 99 },
        });

        await e.saveLine();

        expect(global.fetch).toHaveBeenCalledWith('/api/lines/5', expect.objectContaining({ method: 'PUT' }));
        expect(sentBody.voltage_kv).toBe(35);
        expect(sentBody.transformer_id).toBe(7);
        expect(sentBody.length_km).toBeCloseTo(2 * KM_PER_001_DEG, 2);
    });
});
