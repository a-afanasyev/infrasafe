/**
 * [N-38] Настоящий bcrypt с потолком стоимости для юнит-тестов.
 *
 * `totpService` хэширует 8 кодов восстановления с 12 раундами: около секунды
 * на `generateSetup` на холостой машине и больше 5 с под нагрузкой полного
 * прогона. Тест упирался в таймаут, его незабранные `mockResolvedValueOnce`
 * уезжали в следующие, и падал каскад.
 *
 * Подключение: `jest.mock('bcrypt', () => require('../helpers/fastBcrypt'))`.
 * Фабрика — обычные функции, а не `jest.fn`, поэтому `restoreAllMocks` и
 * `resetAllMocks` её не снимают. Хэши остаются настоящими ($2b$, сверяются
 * `compare`), меняется только стоимость. Запрошенную сервисом стоимость
 * обёртка запоминает в `requestedRounds`, чтобы тест мог закрепить продовое
 * значение, не платя за него.
 */
const actual = jest.requireActual('bcrypt');

const TEST_MAX_ROUNDS = 4;
const requestedRounds = [];

const cap = (saltOrRounds) => {
    if (typeof saltOrRounds !== 'number') return saltOrRounds;
    requestedRounds.push(saltOrRounds);
    return Math.min(saltOrRounds, TEST_MAX_ROUNDS);
};

module.exports = {
    ...actual,
    hash: (data, saltOrRounds, ...rest) => actual.hash(data, cap(saltOrRounds), ...rest),
    hashSync: (data, saltOrRounds) => actual.hashSync(data, cap(saltOrRounds)),
    requestedRounds,
    TEST_MAX_ROUNDS,
};
