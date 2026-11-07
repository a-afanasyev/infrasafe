'use strict';

/**
 * [S-INJ-6] PATCH /integration/rules/:id: 400 — только на ошибки валидации
 * (code=VALIDATION_ERROR). Сбой БД раньше попадал в тот же catch и уходил
 * администратору текстом pg в теле 400; теперь — в errorHandler как 500.
 */

jest.mock('../../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../src/models/AlertRule', () => ({ update: jest.fn() }));

const AlertRule = require('../../../src/models/AlertRule');
const integrationController = require('../../../src/controllers/integrationController');

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('[S-INJ-6] integrationController.updateRule', () => {
    beforeEach(() => jest.clearAllMocks());

    test('ошибка валидации (VALIDATION_ERROR) → 400 с её текстом', async () => {
        const err = new Error('AlertRule.update: field "constructor" is not editable');
        err.code = 'VALIDATION_ERROR';
        AlertRule.update.mockRejectedValue(err);
        const res = makeRes();
        const next = jest.fn();

        await integrationController.updateRule({ params: { id: '4' }, body: { fields: { constructor: 1 } }, user: { user_id: 1 } }, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(JSON.stringify(res.json.mock.calls[0][0])).toContain('not editable');
        expect(next).not.toHaveBeenCalled();
    });

    test('ошибка БД → next(err) (500 от errorHandler), текст pg клиенту не уходит', async () => {
        AlertRule.update.mockRejectedValue(new Error('connection terminated unexpectedly'));
        const res = makeRes();
        const next = jest.fn();

        await integrationController.updateRule({ params: { id: '4' }, body: { fields: { enabled: true } }, user: { user_id: 1 } }, res, next);

        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection terminated unexpectedly' }));
    });

    test('успех → 200 с правилом и числом изменений', async () => {
        AlertRule.update.mockResolvedValue({ rule: { id: 4, enabled: true }, changes: [{}] });
        const res = makeRes();

        await integrationController.updateRule({ params: { id: '4' }, body: { fields: { enabled: true } }, user: { user_id: 1 } }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, changes_recorded: 1 }));
    });
});
