// Jest manual mock for otplib (ESM package)
const crypto = require('crypto');

module.exports = {
    generateSecret: () => crypto.randomBytes(20).toString('base64url').slice(0, 32).toUpperCase(),
    generateSync: ({ secret }) => {
        // Generate a deterministic 6-digit code for testing
        const time = Math.floor(Date.now() / 30000);
        const hash = crypto.createHmac('sha1', secret).update(String(time)).digest('hex');
        return String(parseInt(hash.slice(-6), 16) % 1000000).padStart(6, '0');
    },
    generateURI: ({ issuer, accountName, secret }) =>
        `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}`,
    verifySync: ({ secret, token }) => {
        // In mock: accept any 6-digit code for test simplicity
        // Real verification is tested in the Docker container integration test
        const expected = module.exports.generateSync({ secret });
        return { valid: token === expected, delta: 0 };
    },
    verify: ({ secret, token }) => Promise.resolve(module.exports.verifySync({ secret, token }))
};
