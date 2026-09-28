'use strict';

/** [N-53] Семафор: предел, очередь, таймаут ожидания, повторное освобождение. */
const { Semaphore } = require('../../../src/utils/semaphore');

const tick = () => new Promise((r) => setImmediate(r));

describe('[N-53] Semaphore', () => {
    test('не больше limit владельцев; слот переходит ожидающему по очереди', async () => {
        const sem = new Semaphore(2);
        const a = await sem.acquire(1000);
        const b = await sem.acquire(1000);
        const order = [];
        const c = sem.acquire(1000).then((rel) => { order.push('c'); return rel; });
        const d = sem.acquire(1000).then((rel) => { order.push('d'); return rel; });

        await tick();
        expect(order).toEqual([]);
        expect(sem.active).toBe(2);

        a();
        const relC = await c;
        expect(order).toEqual(['c']);
        b();
        const relD = await d;
        expect(order).toEqual(['c', 'd']);
        relC(); relD();
        expect(sem.active).toBe(0);
    });

    test('не дождался слота — null, и из очереди он убран', async () => {
        const sem = new Semaphore(1);
        const a = await sem.acquire(1000);
        await expect(sem.acquire(30)).resolves.toBeNull();
        expect(sem.waiters).toHaveLength(0);
        a();
        expect(sem.active).toBe(0);
    });

    test('повторный вызов release ничего не ломает', async () => {
        const sem = new Semaphore(1);
        const a = await sem.acquire(1000);
        a(); a();
        expect(sem.active).toBe(0);
        const b = await sem.acquire(1000);
        expect(sem.active).toBe(1);
        b();
    });

    test('неверный limit отвергается', () => {
        expect(() => new Semaphore(0)).toThrow();
        expect(() => new Semaphore(1.5)).toThrow();
    });
});
