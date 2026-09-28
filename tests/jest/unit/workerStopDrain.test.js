/**
 * [N-22] stop() воркера дожидается идущего тика — в пределах бюджета.
 *
 * `stop()` снимал таймеры и сразу возвращался, а `gracefulShutdown` следом
 * закрывал Redis и пул. Тик, пойманный SIGTERM посреди работы, падал на
 * закрытом пуле: у outbox это `markSent` после успешной отправки в УК, и после
 * рестарта событие уходило повторно — от дубля спасала только идемпотентность
 * `event_id` на стороне УК.
 *
 * Ожидание ограничено: у контейнера 10 с между SIGTERM и SIGKILL, а у
 * gracefulShutdown — свой forceExit через 10 с.
 */
jest.mock('../../../src/config/database', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const logger = require('../../../src/utils/logger');
const { waitForIdle, STOP_WAIT_MS } = require('../../../src/utils/workerStop');

const WORKERS = [
    ['mvRefreshService', '../../../src/services/mvRefreshService'],
    ['ukOutboxService', '../../../src/services/uk/ukOutboxService'],
    ['alertVerificationService', '../../../src/services/alertVerificationService'],
    ['alertIntentReconciler', '../../../src/services/uk/alertIntentReconciler'],
    ['controllerStatusScheduler', '../../../src/services/controllerStatusScheduler'],
];

afterEach(() => jest.clearAllMocks());

describe.each(WORKERS)('[N-22] %s.stop()', (_name, mod) => {
    const worker = require(mod);

    afterEach(() => { worker._running = false; });

    test('ждёт окончания идущего тика', async () => {
        worker._running = true;
        let stopped = false;
        const stopping = worker.stop().then(() => { stopped = true; });

        await new Promise((r) => setTimeout(r, 120));
        expect(stopped).toBe(false);

        worker._running = false;
        await stopping;
        expect(stopped).toBe(true);
    });

    test('без идущего тика возвращается сразу', async () => {
        const t0 = Date.now();
        await worker.stop();
        expect(Date.now() - t0).toBeLessThan(100);
    });
});

describe('[N-22] waitForIdle', () => {
    test('не ждёт дольше бюджета и говорит об этом в логе', async () => {
        const stuck = { _running: true };
        const t0 = Date.now();

        const idle = await waitForIdle(stuck, 'stuck-worker', 150);

        expect(idle).toBe(false);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('stuck-worker'));
    });

    test('бюджет по умолчанию укладывается в 10 с до SIGKILL с запасом', () => {
        expect(STOP_WAIT_MS).toBeGreaterThan(0);
        expect(STOP_WAIT_MS).toBeLessThanOrEqual(5000);
    });
});
