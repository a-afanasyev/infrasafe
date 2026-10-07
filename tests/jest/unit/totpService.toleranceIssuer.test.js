/**
 * [N-60] Вход с 2FA на infrasafe.uz: 07.10.2026 четыре кода подряд — 401.
 *
 * Две причины, обе на нашей стороне:
 *
 * 1. Нулевой допуск по времени. otplib 13 по умолчанию сверяет код ТОЛЬКО с
 *    текущим 30-секундным окном (`epochTolerance: 0`). Код, набранный в конце
 *    окна и дошедший до сервера после его смены, отклонялся; часы телефона,
 *    ушедшие на 15–30 с, давали стабильный отказ. Замысел SEC-26 — «±1 шаг»
 *    (см. комментарий у REPLAY_WINDOW_MS) — при переходе на otplib 13 молча
 *    потерялся.
 *
 * 2. Одинаковое имя записи на всех площадках. Обе прод-площадки выдавали
 *    QR с issuer «InfraSafe» и меткой «admin» — в аутентификаторе две
 *    неотличимые записи с разными секретами. Имя теперь берётся из
 *    `TOTP_ISSUER`.
 *
 * Контракт мока otplib для epoch/epochTolerance снят с настоящей otplib 13
 * (node -e, вне Jest) — см. первый блок.
 */

process.env.TOTP_ENCRYPTION_KEY = 'totp-test-key-that-is-at-least-32-bytes-long-123456';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('bcrypt', () => require('../helpers/fastBcrypt'));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    invalidate: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('qrcode', () => ({
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK'),
}));

const otplib = require('otplib');
const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const totpService = require('../../../src/services/totpService');

const SECRET = 'JBSWY3DPEHPK3PXP';
// 10 с от начала 30-секундного окна.
const T = 1_800_000_010;
const codeAt = (offsetSec) => otplib.generateSync({ secret: SECRET, epoch: T + offsetSec });

let nowSpy;
beforeEach(() => {
    db.query.mockReset();
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T * 1000);
});
afterEach(() => {
    nowSpy.mockRestore();
    delete process.env.TOTP_ISSUER;
});

// Разные пользователи на тест: anti-replay общий на модуль.
let userSeq = 9000;

describe('[N-60] мок otplib повторяет контракт epoch/epochTolerance', () => {
    // Снято с otplib 13 при epoch = T (10 с внутри окна).
    test.each([
        [0, -30, false], [0, -15, false], [0, 0, true], [0, 25, false],
        [[30, 0], -60, false], [[30, 0], -30, true], [[30, 0], -15, true],
        [[30, 0], 0, true], [[30, 0], 25, false],
    ])('tolerance %j, код со сдвигом %i с → %s', (tol, offset, valid) => {
        expect(otplib.verifySync({ secret: SECRET, token: codeAt(offset), epoch: T, epochTolerance: tol }).valid)
            .toBe(valid);
    });
});

describe('[N-60] verifyCode принимает код из соседнего окна', () => {
    const enabled = () => db.query.mockResolvedValue({
        rows: [{ totp_secret: totpService.encrypt(SECRET), totp_enabled: true, recovery_codes: [] }],
    });

    test.each([
        ['текущее окно', 0, true],
        ['предыдущее окно (набран до смены окна)', -30, true],
        ['следующее окно (часы телефона спешат)', 25, true],
        ['два окна назад', -60, false],
        ['два окна вперёд', 55, false],
    ])('%s', async (_name, offset, valid) => {
        enabled();
        const result = await totpService.verifyCode(userSeq++, codeAt(offset));
        expect(result.valid).toBe(valid);
    });

    test('принятый код из предыдущего окна повторно не проходит', async () => {
        enabled();
        const user = userSeq++;
        const code = codeAt(-30);
        expect((await totpService.verifyCode(user, code)).valid).toBe(true);
        expect(await totpService.verifyCode(user, code)).toEqual({ valid: false, reason: 'code_already_used' });
    });
});

describe('[N-60] confirmSetup тоже принимает код из предыдущего окна', () => {
    test('код, набранный до смены окна, включает 2FA', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: totpService.encrypt(SECRET), totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        await expect(totpService.confirmSetup(userSeq++, codeAt(-30))).resolves.toBeDefined();
    });
});

describe('[N-60] имя записи в аутентификаторе — из TOTP_ISSUER', () => {
    const setup = async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const spy = jest.spyOn(otplib, 'generateURI');
        await totpService.generateSetup(userSeq++, 'admin');
        const { issuer } = spy.mock.calls[0][0];
        spy.mockRestore();
        return issuer;
    };

    test('задано → в QR уходит оно', async () => {
        process.env.TOTP_ISSUER = 'InfraSafe (infrasafe.uz)';
        expect(await setup()).toBe('InfraSafe (infrasafe.uz)');
    });

    test('не задано → «InfraSafe», как раньше', async () => {
        expect(await setup()).toBe('InfraSafe');
    });

    test.each([
        ['двоеточие ломает метку otpauth', 'Infra:Safe'],
        ['слишком длинное', 'x'.repeat(65)],
        ['пробелы', '   '],
    ])('%s → «InfraSafe» и предупреждение', async (_name, value) => {
        process.env.TOTP_ISSUER = value;
        expect(await setup()).toBe('InfraSafe');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('TOTP_ISSUER'));
    });
});
