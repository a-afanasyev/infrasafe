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
const crypto = require('crypto');

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
    generateSync: ({ secret }) => {
        // Детерминированный шестизначный код для тестов.
        const time = Math.floor(Date.now() / 30000);
        const hash = crypto.createHmac('sha1', secret).update(String(time)).digest('hex');
        return String(parseInt(hash.slice(-6), 16) % 1000000).padStart(6, '0');
    },
    generateURI: ({ issuer, label, secret }) =>
        `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`,
    verifySync: ({ secret, token }) => {
        const value = assertTokenShape(token);
        const expected = module.exports.generateSync({ secret });
        return { valid: value === expected, delta: 0 };
    },
    verify: ({ secret, token }) => Promise.resolve(module.exports.verifySync({ secret, token })),
};
