/**
 * @jest-environment node
 *
 * [N-63] Удаление трансформатора из админки: если у него есть линии, сервер
 * отвечает 409 TRANSFORMER_HAS_LINES со списком, и оператор решает, удалять ли
 * их вместе с трансформатором. Только после «да» уходит `?cascade=lines`.
 */

const { deleteTransformerFlow } = require('../../../../public/utils/transformerDelete.js');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const HAS_LINES = json(409, {
    success: false,
    error: {
        message: 'У трансформатора 2 линий: они будут удалены вместе с ним. Подтвердите удаление.',
        status: 409,
        code: 'TRANSFORMER_HAS_LINES',
        meta: { count: 2, lines: [{ line_id: 1, name: 'ЛЭП-1' }, { line_id: 2, name: 'ЛЭП-2' }] },
    },
});

test('без линий — один DELETE без cascade', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json(200, { success: true }));
    const confirmFn = jest.fn();

    const result = await deleteTransformerFlow(5, { fetchFn, confirmFn });

    expect(result).toEqual({ status: 'deleted' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/transformers/5', { method: 'DELETE' });
    expect(confirmFn).not.toHaveBeenCalled();
});

test('есть линии, оператор согласен — второй DELETE с cascade=lines', async () => {
    const fetchFn = jest.fn()
        .mockResolvedValueOnce(HAS_LINES)
        .mockResolvedValueOnce(json(200, { success: true }));
    const confirmFn = jest.fn().mockReturnValue(true);

    const result = await deleteTransformerFlow(5, { fetchFn, confirmFn });

    const question = confirmFn.mock.calls[0][0];
    expect(question).toMatch(/ЛЭП-1/);
    expect(question).toMatch(/ЛЭП-2/);
    expect(fetchFn).toHaveBeenLastCalledWith('/api/transformers/5?cascade=lines', { method: 'DELETE' });
    expect(result).toEqual({ status: 'deleted', linesDeleted: 2 });
});

test('есть линии, оператор отказался — второго запроса нет', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(HAS_LINES);
    const confirmFn = jest.fn().mockReturnValue(false);

    const result = await deleteTransformerFlow(5, { fetchFn, confirmFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'cancelled' });
});

test('здания — ошибка с текстом сервера, без диалога', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json(409, {
        success: false,
        error: { message: 'Трансформатор нельзя удалить: к нему привязаны здания', status: 409, code: 'TRANSFORMER_HAS_BUILDINGS' },
    }));
    const confirmFn = jest.fn();

    await expect(deleteTransformerFlow(5, { fetchFn, confirmFn })).rejects.toThrow(/привязаны здания/);
    expect(confirmFn).not.toHaveBeenCalled();
});

test('длинный список линий в вопросе обрезается', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ line_id: i + 1, name: `ЛЭП-${i + 1}` }));
    const fetchFn = jest.fn().mockResolvedValueOnce(json(409, {
        success: false, error: { message: 'x', status: 409, code: 'TRANSFORMER_HAS_LINES', meta: { count: 25, lines } },
    }));
    const confirmFn = jest.fn().mockReturnValue(false);

    await deleteTransformerFlow(5, { fetchFn, confirmFn });

    const question = confirmFn.mock.calls[0][0];
    expect(question).toMatch(/ЛЭП-10\b/);
    expect(question).not.toMatch(/ЛЭП-11\b/);
    expect(question).toMatch(/и ещё 15/);
});
