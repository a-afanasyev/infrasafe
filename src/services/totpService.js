const otplib = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

// Phase 7.2 (ARCH-113 mitigation): authService caches user rows by
// `auth:user:${userId}` with a 5-minute TTL. totpService mutates the
// users table directly (bypassing the User model / authService),
// so every UPDATE here must invalidate that cache or the login flow
// will read a stale `totp_enabled` value for up to 5 minutes.
async function invalidateUserCache(userId) {
    try {
        await cacheService.invalidate(`auth:user:${userId}`);
    } catch (err) {
        // Best-effort: cache miss is worse than log spam. Never throw here.
        logger.error(`Failed to invalidate auth:user:${userId} cache: ${err.message}`);
    }
}

const ISSUER = 'InfraSafe';
const RECOVERY_CODE_COUNT = 8;
const BCRYPT_ROUNDS = 12;

// SEC-106: anti-replay — track used TOTP codes to prevent reuse within validity window
const usedCodes = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [hash, expiresAt] of usedCodes.entries()) {
        if (now > expiresAt) usedCodes.delete(hash);
    }
}, 60000).unref();

function markCodeUsed(userId, code) {
    const hash = crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
    if (usedCodes.has(hash)) return false;
    usedCodes.set(hash, Date.now() + 60000);
    return true;
}

// AES-256-GCM encryption for TOTP secrets
const ALGORITHM = 'aes-256-gcm';

// SEC-104: use HKDF for proper key derivation instead of raw SHA-256
function getEncryptionKey() {
    const key = process.env.TOTP_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        throw new Error('TOTP_ENCRYPTION_KEY must be at least 32 characters');
    }
    return Buffer.from(
        crypto.hkdfSync('sha256', key, 'infrasafe-totp-v1', 'aes-encryption-key', 32)
    );
}

function encrypt(text) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
    const key = getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function generateRecoveryCodes() {
    const codes = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    return codes;
}

async function hashRecoveryCodes(codes) {
    const hashed = await Promise.all(
        codes.map(code => bcrypt.hash(code, BCRYPT_ROUNDS))
    );
    return hashed;
}

async function generateSetup(userId, username) {
    // Reuse the pending secret if setup is in-flight.
    // Without this guard a user who opens the QR, refreshes, or re-logs-in
    // before scanning ends up with a fresh overwritten secret and the first
    // QR stops working — surfacing as "different OTPs" to the user.
    const existing = await db.query(
        'SELECT totp_secret, totp_enabled FROM users WHERE user_id = $1',
        [userId]
    );
    if (!existing.rows.length) {
        throw new Error('User not found');
    }

    let secret;
    if (existing.rows[0].totp_secret && !existing.rows[0].totp_enabled) {
        secret = decrypt(existing.rows[0].totp_secret);
        logger.info(`TOTP setup resumed for user ${userId} — reusing pending secret`);
    } else {
        secret = otplib.generateSecret();
    }

    const otpauthUrl = otplib.generateURI({ issuer: ISSUER, label: username, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Recovery codes are one-shot — always regenerate; user must save the latest set.
    const plainRecoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(plainRecoveryCodes);

    const encryptedSecret = encrypt(secret);

    await db.query(
        `UPDATE users SET totp_secret = $1, recovery_codes = $2 WHERE user_id = $3`,
        [encryptedSecret, JSON.stringify(hashedRecoveryCodes), userId]
    );
    await invalidateUserCache(userId);

    logger.info(`TOTP setup initiated for user ${userId}`);

    return {
        qrCodeUrl: qrCodeDataUrl,
        secret,
        recoveryCodes: plainRecoveryCodes
    };
}

async function confirmSetup(userId, code) {
    const result = await db.query(
        'SELECT totp_secret, totp_enabled FROM users WHERE user_id = $1',
        [userId]
    );

    if (!result.rows.length) {
        throw new Error('User not found');
    }

    const user = result.rows[0];
    if (user.totp_enabled) {
        throw new Error('2FA is already enabled');
    }
    if (!user.totp_secret) {
        throw new Error('2FA setup not initiated');
    }

    const secret = decrypt(user.totp_secret);
    const verification = otplib.verifySync({ secret, token: code });

    if (!verification.valid) {
        throw new Error('Invalid TOTP code');
    }

    // SEC-106: apply anti-replay to setup confirmation path too
    if (!markCodeUsed(userId, code)) {
        throw new Error('TOTP code already used');
    }

    await db.query(
        'UPDATE users SET totp_enabled = true WHERE user_id = $1',
        [userId]
    );
    await invalidateUserCache(userId);

    logger.info(`TOTP 2FA enabled for user ${userId}`);
    return true;
}

async function verifyCode(userId, code) {
    const result = await db.query(
        'SELECT totp_secret, totp_enabled, recovery_codes FROM users WHERE user_id = $1',
        [userId]
    );

    if (!result.rows.length) {
        throw new Error('User not found');
    }

    const user = result.rows[0];
    if (!user.totp_enabled || !user.totp_secret) {
        throw new Error('2FA is not enabled for this user');
    }

    // Try TOTP code first
    const secret = decrypt(user.totp_secret);
    if (otplib.verifySync({ secret, token: code }).valid) {
        // SEC-106: prevent replay — same code cannot be used twice within 60s
        if (!markCodeUsed(userId, code)) {
            return { valid: false, reason: 'code_already_used' };
        }
        return { valid: true, method: 'totp' };
    }

    // Try recovery code
    const normalizedCode = code.toUpperCase().trim();
    const recoveryCodes = user.recovery_codes || [];

    for (let i = 0; i < recoveryCodes.length; i++) {
        const match = await bcrypt.compare(normalizedCode, recoveryCodes[i]);
        if (match) {
            // Remove used recovery code
            const updatedCodes = [...recoveryCodes];
            updatedCodes.splice(i, 1);
            await db.query(
                'UPDATE users SET recovery_codes = $1 WHERE user_id = $2',
                [JSON.stringify(updatedCodes), userId]
            );
            await invalidateUserCache(userId);

            logger.warn(`Recovery code used for user ${userId}, ${updatedCodes.length} remaining`);
            return { valid: true, method: 'recovery' };
        }
    }

    return { valid: false };
}

async function disable(userId) {
    // Check if user is admin — admins cannot disable 2FA via API
    const result = await db.query(
        'SELECT role FROM users WHERE user_id = $1',
        [userId]
    );

    if (!result.rows.length) {
        throw new Error('User not found');
    }

    if (result.rows[0].role === 'admin') {
        throw new Error('Admins cannot disable 2FA');
    }

    await db.query(
        'UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = NULL WHERE user_id = $1',
        [userId]
    );
    await invalidateUserCache(userId);

    logger.info(`TOTP 2FA disabled for user ${userId}`);
    return true;
}

module.exports = {
    generateSetup,
    confirmSetup,
    verifyCode,
    disable,
    encrypt,
    decrypt,
    generateRecoveryCodes,
    hashRecoveryCodes
};
