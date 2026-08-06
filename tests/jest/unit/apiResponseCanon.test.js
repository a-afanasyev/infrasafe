/**
 * [AR-4] Канонический конверт ответа.
 *
 * До этой правки конвертов было ПЯТЬ несовместимых:
 *   1. канон            {success, data} / {success:false, error:{message,status}}
 *   2. middleware       {success:false, message}            — 23 места
 *   3. express-validator {errors:[…]}                        — без success вообще
 *   4. лимитер          {success:false, message, error:'КОД'} — error СТРОКА,
 *                       тогда как в каноне error — ОБЪЕКТ. Один ключ, две формы.
 *   5. листинги         {data, pagination}                   — без success
 *
 * Канон расширяется двумя необязательными полями, без которых формы 3 и 4
 * невозможно выразить без потери смысла:
 *   - `details` — по-полевые ошибки валидации (иначе «Ошибка валидации» без
 *     указания поля, и пользователю нечего исправлять);
 *   - `code`    — машинный код (RATE_LIMIT_EXCEEDED и т.п.). Именно КОД, а не
 *     перегрузка ключа `error` строкой: `error` остаётся объектом всегда.
 */

const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../../../src/utils/apiResponse');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const bodyOf = (res) => res.json.mock.calls[0][0];

describe('[AR-4] sendError — форма ошибки', () => {
    test('базовая форма не изменилась', () => {
        const res = mockRes();
        sendError(res, 404, 'Здание не найдено');

        expect(res.status).toHaveBeenCalledWith(404);
        expect(bodyOf(res)).toEqual({
            success: false,
            error: { message: 'Здание не найдено', status: 404 }
        });
    });

    test('details добавляются только когда переданы', () => {
        const res = mockRes();
        const details = [{ field: 'name', message: 'обязательно' }];
        sendError(res, 400, 'Ошибка валидации', { details });

        expect(bodyOf(res).error.details).toEqual(details);
    });

    test('пустой массив details не попадает в ответ — это шум', () => {
        const res = mockRes();
        sendError(res, 400, 'Ошибка', { details: [] });

        expect(bodyOf(res).error).not.toHaveProperty('details');
    });

    test('code добавляется отдельным полем, error остаётся объектом', () => {
        const res = mockRes();
        sendError(res, 429, 'Слишком много запросов', { code: 'RATE_LIMIT_EXCEEDED' });

        const body = bodyOf(res);
        expect(typeof body.error).toBe('object');
        expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(body.error.message).toBe('Слишком много запросов');
    });

    test('meta для машинных подробностей (лимиты, retryAfter)', () => {
        const res = mockRes();
        sendError(res, 429, 'Слишком много запросов', {
            code: 'RATE_LIMIT_EXCEEDED',
            meta: { limit: 60, current: 61, retryAfter: 42 }
        });

        expect(bodyOf(res).error.meta).toEqual({ limit: 60, current: 61, retryAfter: 42 });
    });

    test('третий аргумент по-прежнему можно звать без опций (23 существующих места)', () => {
        const res = mockRes();
        expect(() => sendError(res, 500, 'Внутренняя ошибка')).not.toThrow();
        expect(bodyOf(res).error.message).toBe('Внутренняя ошибка');
    });
});

describe('[AR-4] sendSuccess — форма успеха', () => {
    test('листинг с пагинацией получает success — раньше его не было', () => {
        const res = mockRes();
        sendSuccess(res, [{ id: 1 }], { pagination: { total: 1, page: 1, limit: 50, totalPages: 1 } });

        const body = bodyOf(res);
        expect(body.success).toBe(true);
        expect(body.data).toEqual([{ id: 1 }]);
        expect(body.pagination.total).toBe(1);
    });

    test('sendCreated → 201 и message', () => {
        const res = mockRes();
        sendCreated(res, { id: 7 }, 'Создано');

        expect(res.status).toHaveBeenCalledWith(201);
        expect(bodyOf(res)).toEqual({ success: true, data: { id: 7 }, message: 'Создано' });
    });

    test('sendNotFound → 404 в канонической форме', () => {
        const res = mockRes();
        sendNotFound(res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(bodyOf(res).error.status).toBe(404);
    });
});
