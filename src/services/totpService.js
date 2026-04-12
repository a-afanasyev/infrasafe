const otplib = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const logger = require('../utils/logger');

const ISSUER = 'InfraSafe';
const RECOVERY_CODE_COUNT = 8;
const BCRYPT_ROUNDS = 12;

// AES-256-GCM encryption for TOTP secrets
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
    const key = process.env.TOTP_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        throw new Error('TOTP_ENCRYPTION_KEY must be at least 32 characters');
    }
    return crypto.createHash('sha256').update(key).digest();
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
    const secret = otplib.generateSecret();
    const otpauthUrl = otplib.generateURI({ issuer: ISSUER, accountName: username, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    const plainRecoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(plainRecoveryCodes);

    const encryptedSecret = encrypt(secret);

    // Store secret (not yet enabled) — user must confirm with a valid code
    await db.query(
        `UPDATE users SET totp_secret = $1, recovery_codes = $2 WHERE user_id = $3`,
        [encryptedSecret, JSON.stringify(hashedRecoveryCodes), userId]
    );

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

    await db.query(
        'UPDATE users SET totp_enabled = true WHERE user_id = $1',
        [userId]
    );

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
