/**
 * [Новое №8] Catch admin-контроллеров не должен глушить 4xx из модели.
 *
 * Модели бросают типизированные ошибки: `assertValidStatus` в `WaterLine`
 * отдаёт 400 (M-12), `Line`/`WaterSupplier`/`createCrudModel` явно
 * перебрасывают всё, у чего есть `statusCode`. А catch в admin-контроллерах
 * вызывал `next(createError('Internal server error', 500))` без разбора —
 * то есть любой whitelist или guard, добавленный в модель, доходил до
 * клиента как «сервер упал».
 *
 * Это не косметика статуса. Пункт стоит первым в связке с AR-3(б): перевод
 * контроллеров на модели УВЕЛИЧИТ число мест, где модель бросает 4xx. Сделать
 * перевод раньше этой правки значит осознанно ухудшить поведение — проверка
 * появится, но снаружи будет неотличима от аварии.
 *
 * Здесь проверяются те четыре функции, что УЖЕ ходят в модели (переведены
 * в PR-3 / AUD-008). Остальные подтянутся вместе с AR-3(б).
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/models/ColdWaterSource');
jest.mock('../../../src/models/HeatSource');
jest.mock('../../../src/models/Transformer');
jest.mock('../../../src/models/Line');

const ColdWaterSource = require('../../../src/models/ColdWaterSource');
const HeatSource = require('../../../src/models/HeatSource');
const Transformer = require('../../../src/models/Transformer');
const Line = require('../../../src/models/Line');

const { deleteColdWaterSource } = require('../../../src/controllers/admin/adminColdWaterSourceController');
const { deleteHeatSource } = require('../../../src/controllers/admin/adminHeatSourceController');
const { deleteTransformer } = require('../../../src/controllers/admin/adminTransformerController');
const { deleteLine } = require('../../../src/controllers/admin/adminLineController');

/** Ошибка ровно той формы, какую бросают модели (`utils/helpers.createError`). */
function modelError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

const CASES = [
    { name: 'adminColdWaterSourceController.deleteColdWaterSource', model: () => ColdWaterSource, handler: () => deleteColdWaterSource },
    { name: 'adminHeatSourceController.deleteHeatSource',           model: () => HeatSource,      handler: () => deleteHeatSource },
    { name: 'adminTransformerController.deleteTransformer',         model: () => Transformer,     handler: () => deleteTransformer },
    { name: 'adminLineController.deleteLine',                       model: () => Line,            handler: () => deleteLine },
];

describe('[Новое №8] admin-контроллеры пробрасывают 4xx модели', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: { id: '1' }, query: {}, body: {} };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        next = jest.fn();
    });

    describe.each(CASES)('$name', ({ model, handler }) => {
        test('ошибка модели с statusCode 400 доходит как 400, а не 500', async () => {
            model().delete.mockRejectedValue(
                modelError('Invalid status: allowed values are active, maintenance, inactive', 400)
            );

            await handler()(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            const passed = next.mock.calls[0][0];
            expect(passed.statusCode).toBe(400);
            // Сообщение модели должно дойти до клиента: errorHandler прячет текст
            // только у 5xx, и ради этого статус и нужно сохранять.
            expect(passed.message).toMatch(/Invalid status/);
        });

        test('ошибка модели с statusCode 409 доходит как 409', async () => {
            model().delete.mockRejectedValue(modelError('Linked buildings exist', 409));

            await handler()(req, res, next);

            expect(next.mock.calls[0][0].statusCode).toBe(409);
        });

        test('нетипизированная ошибка по-прежнему становится 500 без утечки текста', async () => {
            // Внутренний сбой не должен внезапно начать раскрывать детали:
            // единственное, что меняет эта правка, — судьба ошибок СО статусом.
            model().delete.mockRejectedValue(new Error('connection terminated unexpectedly'));

            await handler()(req, res, next);

            const passed = next.mock.calls[0][0];
            expect(passed.statusCode).toBe(500);
            expect(passed.message).not.toMatch(/connection terminated/);
        });
    });
});
