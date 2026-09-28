/**
 * [N-53] Системные resolve при занятом локе верификации не выедают пул.
 *
 * Каждый `_resolveVerifying` берёт соединение из пула и держит его, пока
 * пытается взять advisory-лок верификации (15 попыток × 200 мс ≈ 3 с).
 * `UK_REQUEST_RESOLVED` обрабатывается fire-and-forget, так что пачка вебхуков
 * УК при занятом локе держала столько соединений, сколько пришло событий, —
 * до `DB_POOL_MAX` = 20, и остальные запросы приложения ждали пул. После N-05
 * breaker такую пачку больше не срезает (занятость лока — не отказ БД).
 *
 * Теперь одновременно держат соединение не больше RESOLVE_VERIFYING_CONCURRENCY
 * вызовов; остальные ждут слот, не занимая пул, а не дождавшись — получают тот
 * же VERIFY_LOCK_BUSY (контроллер: 503 «повторите»).
 */
jest.mock('../../../src/config/database', () => {
    const state = { open: 0, maxOpen: 0 };
    const makeClient = () => ({
        // Лок верификации всегда занят — худший случай для пула.
        query: jest.fn(async (text) => (/pg_try_advisory_lock/.test(text) ? { rows: [{ locked: false }] } : { rows: [] })),
        release: jest.fn(() => { state.open -= 1; }),
    });
    const mockPool = {
        connect: jest.fn(async () => {
            state.open += 1;
            state.maxOpen = Math.max(state.maxOpen, state.open);
            return makeClient();
        }),
    };
    return {
        query: jest.fn(),
        getPool: jest.fn(() => mockPool),
        releaseClient: (client) => client.release(),
        __state: state,
    };
});
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(), set: jest.fn(), invalidate: jest.fn(),
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertId: jest.fn().mockResolvedValue([]),
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');
const { VERIFY_LOCK_BUSY } = require('../../../src/services/alert/alertConstants');

const RULE = { verification_grace_seconds: 60, verification_window_seconds: 600 };
const current = (id) => ({ alert_id: id, infrastructure_type: 'transformer', infrastructure_id: '1', type: 'X' });

beforeEach(() => {
    db.__state.open = 0;
    db.__state.maxOpen = 0;
    alertService.resolveLockRetries = 3;
    alertService.resolveLockRetryMs = 20;
});

describe('[N-53] _resolveVerifying ограничен по одновременности', () => {
    test('десять вызовов при занятом локе держат не больше лимита соединений', async () => {
        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, i) => alertService._resolveVerifying(100 + i, null, current(100 + i), RULE))
        );

        expect(db.__state.maxOpen).toBeLessThanOrEqual(alertService.resolveVerifyingConcurrency);
        expect(alertService.resolveVerifyingConcurrency).toBeLessThanOrEqual(5);
        // Все отказали тем же кодом, что и раньше: «очередь занята, повторите».
        expect(results.every((r) => r.status === 'rejected' && r.reason.code === VERIFY_LOCK_BUSY)).toBe(true);
        // Соединения возвращены все.
        expect(db.__state.open).toBe(0);
    });
});
