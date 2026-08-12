const otplib = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

// [AR-3(а)] Здесь был хелпер `invalidateUserCache`, который приходилось звать
// после КАЖДОГО UPDATE по `users`, иначе логин до пяти минут читал устаревший
// `totp_enabled` из кэша authService. Теперь запись идёт через `models/User.js`,
// и сброс кэша — часть самой операции: звать его отсюда больше нечем и незачем.

const ISSUER = 'InfraSafe';
const RECOVERY_CODE_COUNT = 8;
const BCRYPT_ROUNDS = 12;

// SEC-26: the anti-replay TTL must outlast a TOTP code's validity window
// (otplib step 30s + ±1 step ≈ 90s). A 60s TTL evicted the code while it was
// still otplib-valid, leaving a ~30s replay gap. 120s closes it with margin.
const REPLAY_WINDOW_MS = 120000;

// SEC-28: recovery codes shown during setup are reused (not rotated) while a
// setup is in-flight, so a QR-page refresh / re-login does not silently
// invalidate codes the user already saved. The plaintext set lives only in
// this short-lived cache entry (bounds exposure), keyed per pending setup.
const RECOVERY_SETUP_CACHE_PREFIX = 'totp:setup:recovery:';
const RECOVERY_SETUP_CACHE_TTL_SECONDS = 900; // 15 min

// SEC-106: anti-replay — track used TOTP codes to prevent reuse within validity window
const usedCodes = new Map();

// Evict expired anti-replay entries. Exported so the TTL boundary can be
// tested deterministically; the production interval below calls it on a timer.
function sweepExpiredCodes(now = Date.now()) {
    for (const [hash, expiresAt] of usedCodes.entries()) {
        if (now > expiresAt) usedCodes.delete(hash);
    }
}
setInterval(() => sweepExpiredCodes(), REPLAY_WINDOW_MS).unref();

function markCodeUsed(userId, code) {
    const hash = crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
    if (usedCodes.has(hash)) return false;
    usedCodes.set(hash, Date.now() + REPLAY_WINDOW_MS);
    return true;
}

function recoverySetupCacheKey(userId) {
    return `${RECOVERY_SETUP_CACHE_PREFIX}${userId}`;
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
    const existing = await User.getTotpState(userId);
    if (!existing) {
        throw new Error('User not found');
    }

    const isResume = existing.totp_secret && !existing.totp_enabled;

    let secret;
    if (isResume) {
        secret = decrypt(existing.totp_secret);
        logger.info(`TOTP setup resumed for user ${userId} — reusing pending secret`);
    } else {
        secret = otplib.generateSecret();
    }

    const otpauthUrl = otplib.generateURI({ issuer: ISSUER, label: username, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // SEC-28: keep recovery codes stable for the duration of one setup. On a
    // resume, reuse the pending plaintext set from cache; only mint a fresh set
    // for a brand-new setup or when the cache has expired (graceful fallback).
    const cacheKey = recoverySetupCacheKey(userId);
    let plainRecoveryCodes = null;
    if (isResume) {
        try {
            const cached = await cacheService.get(cacheKey);
            if (Array.isArray(cached) && cached.length) {
                plainRecoveryCodes = cached;
            }
        } catch (err) {
            logger.error(`Failed to read pending recovery codes for user ${userId}: ${err.message}`);
        }
    }
    if (!plainRecoveryCodes) {
        plainRecoveryCodes = generateRecoveryCodes();
    }
    const hashedRecoveryCodes = await hashRecoveryCodes(plainRecoveryCodes);

    const encryptedSecret = encrypt(secret);

    await User.setTotpSecret(userId, encryptedSecret, JSON.stringify(hashedRecoveryCodes));

    // Best-effort: persist the plaintext set so a resume returns the same codes.
    try {
        await cacheService.set(cacheKey, plainRecoveryCodes, { ttl: RECOVERY_SETUP_CACHE_TTL_SECONDS });
    } catch (err) {
        logger.error(`Failed to cache pending recovery codes for user ${userId}: ${err.message}`);
    }

    logger.info(`TOTP setup initiated for user ${userId}`);

    return {
        qrCodeUrl: qrCodeDataUrl,
        secret,
        recoveryCodes: plainRecoveryCodes
    };
}

async function confirmSetup(userId, code) {
    const user = await User.getTotpState(userId);

    if (!user) {
        throw new Error('User not found');
    }

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

    await User.enableTotp(userId);

    // [M-4] Коды восстановления показываются ЗДЕСЬ — один раз, в момент, когда
    // 2FA действительно включилась. Берём отложенный при setup открытый набор.
    let plainRecoveryCodes = null;
    try {
        const cached = await cacheService.get(recoverySetupCacheKey(userId));
        if (Array.isArray(cached) && cached.length) {
            plainRecoveryCodes = cached;
        }
    } catch (err) {
        logger.error(`Failed to read pending recovery codes for user ${userId}: ${err.message}`);
    }

    // Кэш мог протухнуть между setup и confirm (или Redis моргнул). Тогда
    // выпускаем свежий набор ПРЯМО СЕЙЧАС и перезаписываем хэши: отдать
    // пользователю пустоту нельзя — способа перевыпустить коды у него нет,
    // и он остался бы с 2FA без единого запасного ключа.
    if (!plainRecoveryCodes) {
        logger.warn(`Pending recovery codes lost for user ${userId} — issuing a fresh set at confirm`);
        plainRecoveryCodes = generateRecoveryCodes();
        const hashed = await hashRecoveryCodes(plainRecoveryCodes);
        await User.setRecoveryCodes(userId, JSON.stringify(hashed));
    }

    // SEC-28: the pending plaintext recovery codes are no longer needed once
    // 2FA is enabled — drop them from cache to minimise exposure.
    try {
        await cacheService.invalidate(recoverySetupCacheKey(userId));
    } catch (err) {
        logger.error(`Failed to clear pending recovery codes for user ${userId}: ${err.message}`);
    }

    logger.info(`TOTP 2FA enabled for user ${userId}`);
    return plainRecoveryCodes;
}

async function verifyCode(userId, code) {
    const state = await User.getTotpState(userId, { withRecoveryCodes: true });

    if (!state) {
        throw new Error('User not found');
    }

    const user = state;
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
            await User.setRecoveryCodes(userId, JSON.stringify(updatedCodes));

            logger.warn(`Recovery code used for user ${userId}, ${updatedCodes.length} remaining`);
            return { valid: true, method: 'recovery' };
        }
    }

    return { valid: false };
}

async function disable(userId) {
    // Check if user is admin — admins cannot disable 2FA via API
    const role = await User.getRole(userId);

    if (role === null) {
        throw new Error('User not found');
    }

    if (role === 'admin') {
        throw new Error('Admins cannot disable 2FA');
    }

    await User.disableTotp(userId);

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
    hashRecoveryCodes,
    sweepExpiredCodes
};
