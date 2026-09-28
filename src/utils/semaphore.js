'use strict';

/**
 * Счётный семафор внутри процесса: не больше `limit` одновременных владельцев,
 * остальные ждут в порядке очереди.
 *
 * [N-53] Нужен там, где дорог сам факт ожидания с ресурсом в руках: системный
 * resolve держит соединение пула, пока пытается взять лок верификации, и без
 * предела пачка событий УК держала бы пул целиком. Ожидающий слот ресурса не
 * держит. Межпроцессной координации здесь нет и не нужно: предел защищает пул
 * этой реплики.
 */
class Semaphore {
    /** @param {number} limit */
    constructor(limit) {
        if (!Number.isInteger(limit) || limit < 1) throw new Error(`Semaphore: неверный limit ${limit}`);
        this.limit = limit;
        this.active = 0;
        this.waiters = [];
    }

    /**
     * Занять слот.
     *
     * @param {number} timeoutMs — сколько ждать слот
     * @returns {Promise<(() => void) | null>} функция освобождения; null — не дождались
     */
    acquire(timeoutMs) {
        if (this.active < this.limit) {
            this.active += 1;
            return Promise.resolve(this._releaser());
        }
        return new Promise((resolve) => {
            const waiter = { resolve, timer: null };
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter((w) => w !== waiter);
                resolve(null);
            }, timeoutMs);
            this.waiters.push(waiter);
        });
    }

    _releaser() {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.waiters.shift();
            if (next) {
                clearTimeout(next.timer);
                next.resolve(this._releaser()); // слот переходит следующему
            } else {
                this.active -= 1;
            }
        };
    }
}

module.exports = { Semaphore };
