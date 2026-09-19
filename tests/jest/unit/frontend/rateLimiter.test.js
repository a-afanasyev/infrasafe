/**
 * @jest-environment jsdom
 *
 * [CO-4] Клиентский ограничитель запросов — живой код с нулевым покрытием.
 *
 * `public/utils/rateLimiter.js` стоит на пути КАЖДОГО запроса карты:
 * `script.js:225` спрашивает `window.apiRateLimiter.canMakeRequest()` перед
 * обращением к API и, получив отказ, показывает оператору, сколько ждать.
 * Покрытие модуля было ровно 0% — порог на `public/` не распространялся, и
 * сигнала об этом не приходило.
 *
 * Окно здесь скользящее, а не фиксированное: `canMakeRequest` каждый раз
 * отбрасывает записи старше `windowMs`. Разница видна только на времени,
 * поэтому тесты идут на фальшивых таймерах — иначе они проверяли бы скорость
 * машины, а не поведение.
 */

jest.useFakeTimers();

const RateLimiter = require('../../../../public/utils/rateLimiter');

beforeEach(() => {
    jest.setSystemTime(new Date('2026-09-19T12:00:00.000Z'));
});

afterAll(() => {
    jest.useRealTimers();
});

describe('[CO-4] лимит в пределах окна', () => {
    test('пропускает ровно maxRequests и отказывает следующему', () => {
        const limiter = new RateLimiter(3, 60000);
        expect([1, 2, 3].map(() => limiter.canMakeRequest())).toEqual([true, true, true]);
        expect(limiter.canMakeRequest()).toBe(false);
    });

    test('отказ НЕ засчитывается как запрос — иначе отказ продлевал бы сам себя', () => {
        const limiter = new RateLimiter(1, 60000);
        limiter.canMakeRequest();
        limiter.canMakeRequest();
        limiter.canMakeRequest();
        jest.advanceTimersByTime(60001);
        // Если бы отказы попадали в окно, здесь всё ещё было бы занято.
        expect(limiter.canMakeRequest()).toBe(true);
    });

    test('умолчания конструктора — 10 запросов в минуту', () => {
        const limiter = new RateLimiter();
        expect([limiter.maxRequests, limiter.windowMs]).toEqual([10, 60000]);
    });
});

describe('[CO-4] окно скользящее, а не фиксированное', () => {
    test('слот освобождается ровно тогда, когда истекает САМЫЙ СТАРЫЙ запрос', () => {
        const limiter = new RateLimiter(2, 60000);
        limiter.canMakeRequest();               // t=0
        jest.advanceTimersByTime(30000);
        limiter.canMakeRequest();               // t=30s
        expect(limiter.canMakeRequest()).toBe(false);

        jest.advanceTimersByTime(29999);        // t=59.999s — первый ещё в окне
        expect(limiter.canMakeRequest()).toBe(false);

        jest.advanceTimersByTime(2);            // t=60.001s — первый вышел
        expect(limiter.canMakeRequest()).toBe(true);
        // Второй (t=30s) всё ещё в окне, поэтому места снова нет.
        expect(limiter.canMakeRequest()).toBe(false);
    });
});

describe('[CO-4] то, что видит оператор', () => {
    test('getRemainingRequests уменьшается и не уходит в минус', () => {
        const limiter = new RateLimiter(2, 60000);
        expect(limiter.getRemainingRequests()).toBe(2);
        limiter.canMakeRequest();
        expect(limiter.getRemainingRequests()).toBe(1);
        limiter.canMakeRequest();
        limiter.canMakeRequest();
        expect(limiter.getRemainingRequests()).toBe(0);
    });

    test('getRemainingRequests восстанавливается по мере выхода из окна', () => {
        const limiter = new RateLimiter(2, 60000);
        limiter.canMakeRequest();
        jest.advanceTimersByTime(60001);
        expect(limiter.getRemainingRequests()).toBe(2);
    });

    test('пока лимит не исчерпан, ждать не нужно', () => {
        const limiter = new RateLimiter(2, 60000);
        limiter.canMakeRequest();
        expect(limiter.getTimeUntilNextRequest()).toBe(0);
    });

    test('исчерпав лимит, отдаёт секунды до освобождения слота', () => {
        const limiter = new RateLimiter(1, 60000);
        limiter.canMakeRequest();
        expect(limiter.getTimeUntilNextRequest()).toBe(60);
        jest.advanceTimersByTime(30000);
        // Округление вверх: показать «0 секунд» там, где ждать ещё нужно, —
        // хуже, чем показать лишнюю.
        expect(limiter.getTimeUntilNextRequest()).toBe(30);
        jest.advanceTimersByTime(29500);
        expect(limiter.getTimeUntilNextRequest()).toBe(1);
    });

    test('reset освобождает окно целиком', () => {
        const limiter = new RateLimiter(1, 60000);
        limiter.canMakeRequest();
        expect(limiter.canMakeRequest()).toBe(false);
        limiter.reset();
        expect(limiter.canMakeRequest()).toBe(true);
        expect(limiter.getTimeUntilNextRequest()).toBe(60);
    });
});

describe('[CO-4] глобальный экземпляр, на который опирается карта', () => {
    test('window.apiRateLimiter существует и настроен на 10/мин', () => {
        // `script.js:225` обращается именно к нему; его исчезновение тихо
        // снимет ограничение со всех запросов карты.
        expect(window.apiRateLimiter).toBeInstanceOf(RateLimiter);
        expect([window.apiRateLimiter.maxRequests, window.apiRateLimiter.windowMs]).toEqual([10, 60000]);
    });
});
