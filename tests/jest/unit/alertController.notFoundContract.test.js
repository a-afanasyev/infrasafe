/**
 * [R2-23] 404 определяется типом ошибки, а не подстрокой русского текста.
 *
 * Базовый баг: контроллер решал, что это 404, по
 * `error.message.includes('не найден')`. Связь была невидимой в обе стороны:
 *  - переформулировали сообщение в сервисе («отсутствует», «уже закрыт») —
 *    404 молча стал бы 500;
 *  - любая посторонняя ошибка со словом «не найден» в тексте (например из
 *    вложенного вызова) отдалась бы как 404.
 * Тесты фиксируют оба направления, иначе фикс легко откатить обратно.
 */

// alertService мокается БЕЗ ALERT_NOT_FOUND — намеренно. Контроллер обязан
// брать код из модуля констант; если бы он читал его с сервиса, то здесь
// получил бы undefined, и обычная ошибка без `code` совпала бы по
// `undefined === undefined`, дав ложный 404. Ровно на этом и сгорела первая
// версия фикса.
jest.mock('../../../src/services/alertService', () => ({
    acknowledgeAlert: jest.fn(),
    resolveAlert: jest.fn()
}));

const alertService = require('../../../src/services/alertService');
const { ALERT_NOT_FOUND } = require('../../../src/services/alert/alertConstants');
const AlertController = require('../../../src/controllers/alertController');

const mkRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};
const mkReq = () => ({ params: { alertId: '5' }, user: { user_id: 1 }, body: {} });

const coded = (message) => {
    const e = new Error(message);
    e.code = ALERT_NOT_FOUND;
    return e;
};

describe.each([
    ['acknowledgeAlert', () => alertService.acknowledgeAlert],
    ['resolveAlert', () => alertService.resolveAlert],
])('[R2-23] AlertController.%s', (method, getMock) => {
    beforeEach(() => jest.clearAllMocks());

    test('типизированная ошибка → 404 (next не вызывается)', async () => {
        getMock().mockRejectedValue(coded('Алерт 5 не найден или уже обработан'));
        const res = mkRes();
        const next = jest.fn();

        await AlertController[method](mkReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(next).not.toHaveBeenCalled();
    });

    test('ТЕКСТ сообщения на решение не влияет — важен только code', async () => {
        // Формулировка полностью другая, слова «не найден» нет вовсе.
        getMock().mockRejectedValue(coded('Alert 5 is gone'));
        const res = mkRes();
        const next = jest.fn();

        await AlertController[method](mkReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('чужая ошибка со словом «не найден» больше НЕ становится 404', async () => {
        getMock().mockRejectedValue(new Error('Контроллер не найден при обогащении алерта'));
        const res = mkRes();
        const next = jest.fn();

        await AlertController[method](mkReq(), res, next);

        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('обычная ошибка уходит в next (500 через errorHandler)', async () => {
        getMock().mockRejectedValue(new Error('DB down'));
        const res = mkRes();
        const next = jest.fn();

        await AlertController[method](mkReq(), res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(res.status).not.toHaveBeenCalledWith(404);
    });

    test('без user_id → 401 до обращения к сервису', async () => {
        const res = mkRes();
        const next = jest.fn();

        await AlertController[method]({ params: { alertId: '5' }, body: {} }, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(getMock()).not.toHaveBeenCalled();
    });
});

describe('[R2-23] контракт кода ошибки', () => {
    test('константа живёт в alertConstants, а сервис лишь ре-экспортирует её', () => {
        expect(ALERT_NOT_FOUND).toBe('ALERT_NOT_FOUND');
        const realService = jest.requireActual('../../../src/services/alertService');
        expect(realService.ALERT_NOT_FOUND).toBe(ALERT_NOT_FOUND);
    });

    test('в контроллере не осталось матчинга по подстроке', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../../src/controllers/alertController.js'), 'utf8'
        );
        expect(src).not.toMatch(/includes\(['"]не найден['"]\)/);
        expect(src).toContain("require('../services/alert/alertConstants')");
        expect(src).toMatch(/error\.code === ALERT_NOT_FOUND/);
    });
});
