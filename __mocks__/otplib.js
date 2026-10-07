// Jest manual mock for otplib (ESM package).
//
// Зачем он вообще: otplib 13 — ESM и тянет @scure/base, который Jest в
// CJS-режиме загрузить не может (`SyntaxError: Unexpected token 'export'`).
// Поэтому в юнит-тестах настоящая библиотека недоступна, и Jest подставляет
// этот файл АВТОМАТИЧЕСКИ во всех сьютах (для пакетов из node_modules вызывать
// `jest.mock` не нужно).
//
// [A-11] Раз подмена неизбежна, мок обязан воспроизводить КОНТРАКТ, а не
// удобство. Прежняя версия возвращала `{valid:false}` на любой неподходящий
// токен — настоящая otplib в этих случаях БРОСАЕТ. Из-за расхождения дефект
// A-11 (код восстановления XXXX-XXXX уходит в otplib как OTP и роняет вход
// 500-й) был невидим для всего набора при покрытии 92%.
//
// Контракт снят с otplib 13.4.1 напрямую (node -e, вне Jest):
//   'A1B2-C3D4' → throw Token must be 6 digits, got 9
//   '123'       → throw Token must be 6 digits, got 3
//   ''          → throw Token must be 6 digits, got 0
//   'не-код'    → throw Token must contain only digits
//   '000000'    → { valid: false }
//   верный код  → { valid: true }
//
// [N-60] epoch / epochTolerance — тоже по настоящей otplib 13 (секунды):
//   epochTolerance по умолчанию 0 — только текущее 30-секундное окно;
//   число N — окна, пересекающие [epoch - N, epoch + N];
//   пара [past, future] — [epoch - past, epoch + future].
const crypto = require('crypto');

const STEP = 30;

function codeForCounter(secret, counter) {
    const hash = crypto.createHmac('sha1', secret).update(String(counter)).digest('hex');
    return String(parseInt(hash.slice(-6), 16) % 1000000).padStart(6, '0');
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function assertTokenShape(token) {
    const value = String(token ?? '');
    if (value.length !== 6) {
        throw new Error(`Token must be 6 digits, got ${value.length}`);
    }
    if (!/^\d{6}$/.test(value)) {
        throw new Error('Token must contain only digits');
    }
    return value;
}

module.exports = {
    generateSecret: () => crypto.randomBytes(20).toString('base64url').slice(0, 32).toUpperCase(),
    generateSync: ({ secret, epoch = nowSeconds() }) =>
        // Детерминированный шестизначный код для тестов.
        codeForCounter(secret, Math.floor(epoch / STEP)),
    generateURI: ({ issuer, label, secret }) =>
        `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`,
    verifySync: ({ secret, token, epoch = nowSeconds(), epochTolerance = 0 }) => {
        const value = assertTokenShape(token);
        const [past, future] = Array.isArray(epochTolerance)
            ? epochTolerance
            : [epochTolerance, epochTolerance];
        const from = Math.floor((epoch - past) / STEP);
        const to = Math.floor((epoch + future) / STEP);
        for (let counter = from; counter <= to; counter++) {
            if (codeForCounter(secret, counter) === value) {
                return { valid: true, delta: counter - Math.floor(epoch / STEP) };
            }
        }
        return { valid: false };
    },
    verify: ({ secret, token }) => Promise.resolve(module.exports.verifySync({ secret, token })),
};
