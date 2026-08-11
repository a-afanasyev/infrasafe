/**
 * [AR-21] Планировщик перевода молчащих контроллеров в offline.
 *
 * Логика «молчит больше 10 минут → offline» написана, корректна и покрыта
 * тестами — но её НИКТО не вызывает по расписанию. Единственный вход —
 * admin-эндпоинт `POST /api/controllers/update-status`, то есть кнопка,
 * которую надо нажать руками.
 *
 * Пока телеметрии нет, дыра невидима: переводить в offline нечего. Она
 * проявится в первый же день после подключения железа — контроллер замолчит,
 * а карта будет показывать его зелёным, пока кто-нибудь не нажмёт кнопку.
 * Поэтому пункт закрывается ДО приезда контроллеров, а не после.
 *
 * Форма — та же, что у трёх существующих воркеров (`mvRefreshService`,
 * `ukOutboxService`, `alertVerificationService`): синглтон, advisory-লок
 * между репликами, env-гейт, `unref()` на таймерах. Отклоняться от неё здесь
 * незачем, а сходство даёт предсказуемость при разборе инцидента.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: () => ({ connect: jest.fn(async () => mockClient) }),
}));

jest.mock('../../../src/services/controllerService', () => ({
    updateControllersStatusByActivity: jest.fn(),
}));

const controllerService = require('../../../src/services/controllerService');
const scheduler = require('../../../src/services/controllerStatusScheduler');

/** Ответ advisory-lock: захвачен или занят другой репликой. */
function lockGranted(granted) {
    mockClient.query.mockImplementation(async (sql) => {
        if (String(sql).includes('pg_try_advisory_lock')) {
            return { rows: [{ locked: granted }] };
        }
        return { rows: [] };
    });
}

describe('[AR-21] планировщик статуса контроллеров', () => {
    const ORIGINAL = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIGINAL };
        lockGranted(true);
        controllerService.updateControllersStatusByActivity.mockResolvedValue(0);
        // Планировщик — синглтон, и `stop()` из afterEach оставляет `_stopped`
        // взведённым на весь файл. Без этого сброса каждый следующий `_tick()`
        // выходил бы первой строкой, а проверка вида «не вызвано» проходила бы
        // по неверной причине — ровно тот ложнозелёный тест, ради поимки
        // которого эти проверки и пишутся.
        scheduler._stopped = false;
        scheduler._running = false;
    });

    afterEach(async () => {
        await scheduler.stop();
        process.env = ORIGINAL;
    });

    test('тик вызывает пересчёт статусов', async () => {
        await scheduler._tick();
        expect(controllerService.updateControllersStatusByActivity).toHaveBeenCalledTimes(1);
    });

    test('замок занят другой репликой — тик тихо пропускается', async () => {
        lockGranted(false);

        await scheduler._tick();

        // Иначе N реплик перевели бы одни и те же строки N раз, наперегонки.
        expect(controllerService.updateControllersStatusByActivity).not.toHaveBeenCalled();
    });

    test('замок освобождается даже когда пересчёт упал', async () => {
        controllerService.updateControllersStatusByActivity.mockRejectedValue(new Error('БД недоступна'));

        await scheduler._tick();

        const unlocked = mockClient.query.mock.calls.some(
            ([sql]) => String(sql).includes('pg_advisory_unlock')
        );
        expect(unlocked).toBe(true);
        expect(mockClient.release).toHaveBeenCalled();
    });

    test('падение пересчёта не роняет планировщик', async () => {
        controllerService.updateControllersStatusByActivity.mockRejectedValue(new Error('БД недоступна'));

        // Воркер обязан пережить отказ БД: иначе одна сетевая икота навсегда
        // выключает перевод в offline, и об этом никто не узнает.
        await expect(scheduler._tick()).resolves.not.toThrow();

        controllerService.updateControllersStatusByActivity.mockResolvedValue(1);
        await scheduler._tick();
        expect(controllerService.updateControllersStatusByActivity).toHaveBeenCalledTimes(2);
    });

    test('перекрытие тиков исключено', async () => {
        let release;
        controllerService.updateControllersStatusByActivity.mockImplementation(
            () => new Promise((resolve) => { release = resolve; })
        );

        const first = scheduler._tick();
        // Дать первому тику дойти до самого пересчёта: до него он проходит
        // через await на connect() и на захват лока, и без этой паузы мы
        // проверяли бы момент, когда работать ещё не начал никто.
        await new Promise((resolve) => setImmediate(resolve));

        await scheduler._tick();          // второй тик, пока первый не завершён
        expect(controllerService.updateControllersStatusByActivity).toHaveBeenCalledTimes(1);

        release(0);
        await first;
    });

    test('выключается переменной окружения', () => {
        process.env.CONTROLLER_STATUS_SCHEDULER_ENABLED = 'false';
        scheduler.start();
        expect(scheduler._timer).toBeNull();
    });

    test('интервал по умолчанию заметно короче окна в 10 минут', () => {
        // Смысл: контроллер, замолчавший сразу после тика, не должен ждать
        // очередной полный интервал сверх десяти минут. Проверяем свойство,
        // а не конкретное число.
        expect(scheduler.intervalSeconds()).toBeLessThanOrEqual(300);
        expect(scheduler.intervalSeconds()).toBeGreaterThanOrEqual(30);
    });

    test('интервал берётся из окружения и зажимается в границы', () => {
        process.env.CONTROLLER_STATUS_INTERVAL_SECONDS = '5';
        expect(scheduler.intervalSeconds()).toBeGreaterThanOrEqual(30);

        process.env.CONTROLLER_STATUS_INTERVAL_SECONDS = '99999';
        expect(scheduler.intervalSeconds()).toBeLessThanOrEqual(3600);
    });

    test('повторный start не заводит второй таймер', () => {
        scheduler.start();
        const first = scheduler._timer;
        scheduler.start();
        expect(scheduler._timer).toBe(first);
    });
});
