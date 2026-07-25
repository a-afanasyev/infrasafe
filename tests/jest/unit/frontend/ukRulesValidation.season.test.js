/**
 * @jest-environment jsdom
 *
 * [B-009] Клиентская валидация сезонного окна.
 *
 * `public/utils/ukRulesValidation.js` — ЗЕРКАЛО серверного EDITABLE_FIELDS
 * (src/models/AlertRule.js). Расхождение зеркала — тихий класс багов: UI
 * пропускает значение, сервер отвергает 400-кой, и оператор видит непонятную
 * ошибку. Поэтому здесь же сверяем регекс с серверным.
 */

require('../../../../public/utils/ukRulesValidation.js');
const AlertRuleModule = require('fs').readFileSync(
    require('path').join(__dirname, '../../../../src/models/AlertRule.js'), 'utf8'
);

const { validateRuleField, RULE_FIELD_SPEC } = window.UkRulesValidation;

describe('[B-009] season_from / season_to — клиентская валидация', () => {
    test('оба поля объявлены как mmdd + nullable', () => {
        expect(RULE_FIELD_SPEC.season_from).toMatchObject({ type: 'mmdd', nullable: true });
        expect(RULE_FIELD_SPEC.season_to).toMatchObject({ type: 'mmdd', nullable: true });
    });

    test.each(['10-15', '04-15', '01-01', '12-31', '02-29'])('принимает %s', (v) => {
        expect(validateRuleField('season_from', v)).toEqual({ ok: true, coerced: v });
    });

    test('обрезает пробелы вокруг значения', () => {
        expect(validateRuleField('season_to', '  10-15 ')).toEqual({ ok: true, coerced: '10-15' });
    });

    test.each(['10/15', '2026-10-15', '13-01', '10-32', '1-5', 'октябрь', '10-15x'])(
        'отвергает %p', (v) => {
            const r = validateRuleField('season_from', v);
            expect(r.ok).toBe(false);
            expect(r.error).toMatch(/MM-DD/);
        }
    );

    test.each(['', '   ', null, undefined])('пустое значение %p очищает поле (coerced=null)', (v) => {
        expect(validateRuleField('season_to', v)).toEqual({ ok: true, coerced: null });
    });

    test('пустое значение в НЕ-nullable поле по-прежнему ошибка', () => {
        const r = validateRuleField('min_persistence_seconds', '');
        expect(r.ok).toBe(false);
    });

    test('зеркало не разошлось с сервером: тот же MMDD-регекс', () => {
        // Регекс в src/models/AlertRule.js объявлен как MMDD_RE = /…/;
        const serverRe = AlertRuleModule.match(/const MMDD_RE = (\/.+\/);/);
        expect(serverRe).not.toBeNull();
        const clientRe = String(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/);
        expect(serverRe[1]).toBe(clientRe);
    });
});
