/**
 * [AR-5] HALF_OPEN пропускает ограниченное число одновременных проб.
 *
 * Раньше переход OPEN→HALF_OPEN не ограничивал параллелизм: все запросы,
 * скопившиеся к моменту истечения resetTimeout, разом шли по
 * восстанавливающемуся сервису — то есть только что упавший под нагрузкой
 * бэкенд получал залп вместо щупа. Закрытие цепи требует 3 успехов
 * (onSuccess), поэтому потолок одновременных проб по умолчанию — 3;
 * остальные вызовы в это время получают fallback, как при OPEN.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const { CircuitBreaker } = require('../../../src/utils/circuitBreaker');

const failTimes = async (breaker, n) => {
    for (let i = 0; i < n; i++) {
        await breaker.execute(() => Promise.reject(new Error('down'))).catch(() => {});
    }
};

describe('[AR-5] ограничение проб в HALF_OPEN', () => {
    let breaker;

    afterEach(() => {
        if (breaker) { breaker.destroy(); breaker = null; }
    });

    test('одновременных проб не больше halfOpenMaxProbes, остальные идут в fallback', async () => {
        breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 10, name: 'Probe' });
        await failTimes(breaker, 2);
        expect(breaker.state).toBe('OPEN');
        await new Promise((r) => setTimeout(r, 15)); // ждём nextAttempt

        let release;
        const gate = new Promise((r) => { release = r; });
        const operation = jest.fn().mockImplementation(() => gate);
        const fallback = jest.fn().mockResolvedValue('fallback');

        const calls = Array.from({ length: 6 }, () => breaker.execute(operation, fallback));
        // даём микротаскам стартовать до release
        await new Promise((r) => setImmediate(r));
        release('ok');
        const results = await Promise.all(calls);

        expect(operation.mock.calls.length).toBeLessThanOrEqual(3);
        expect(fallback).toHaveBeenCalled();
        expect(results.filter((r) => r === 'fallback').length).toBeGreaterThanOrEqual(3);
    });

    test('после завершения пробы слот освобождается', async () => {
        breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 10, name: 'Probe2' });
        await failTimes(breaker, 2);
        await new Promise((r) => setTimeout(r, 15));

        // Первая проба успешна и завершена — следующий вызов снова доходит
        // до operation (state ещё HALF_OPEN: закрытие требует 3 успехов)
        const op = jest.fn().mockResolvedValue('ok');
        await breaker.execute(op);
        await breaker.execute(op);
        expect(op).toHaveBeenCalledTimes(2);
        expect(breaker.state).toBe('HALF_OPEN');
    });
});
