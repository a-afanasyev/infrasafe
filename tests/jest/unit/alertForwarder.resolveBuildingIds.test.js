/**
 * [N-07] resolveBuildingIds: «зданий нет» и «прочитать не удалось» — разные
 * ответы, когда вызывающему это важно.
 *
 * Прежний контракт — «никогда не бросает, на ошибке `[]`» — удобен форвардеру
 * (он и так обходит пустой список), но сверяющий проход A-03 делал из пустоты
 * терминальный вывод «адресата нет». Поэтому различие включается опцией, а не
 * меняет контракт для всех: остальные вызывающие ждут именно «не бросает».
 */
jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../../../src/config/database');
const alertForwarder = require('../../../src/services/uk/alertForwarder');

beforeEach(() => jest.clearAllMocks());

describe('[N-07] alertForwarder.resolveBuildingIds', () => {
    test('по умолчанию ошибка БД по-прежнему даёт пустой список', async () => {
        db.query.mockRejectedValue(new Error('connection terminated'));

        await expect(alertForwarder.resolveBuildingIds(7, 'controller')).resolves.toEqual([]);
    });

    test('с throwOnError ошибка БД пробрасывается', async () => {
        db.query.mockRejectedValue(new Error('connection terminated'));

        await expect(alertForwarder.resolveBuildingIds(7, 'controller', { throwOnError: true }))
            .rejects.toThrow('connection terminated');
    });

    test('с throwOnError пустой результат — это пустой список, а не ошибка', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await expect(alertForwarder.resolveBuildingIds(7, 'controller', { throwOnError: true }))
            .resolves.toEqual([]);
    });

    test('неизвестный тип инфраструктуры — постоянное состояние, остаётся пустым списком', async () => {
        await expect(alertForwarder.resolveBuildingIds(7, 'spaceship', { throwOnError: true }))
            .resolves.toEqual([]);
        expect(db.query).not.toHaveBeenCalled();
    });
});
