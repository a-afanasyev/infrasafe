/**
 * [M-17] Redaction of sensitive values in log records.
 *
 * Чистая функция без зависимости от winston — тестируется напрямую, а в
 * логгер подключается тонкой обёрткой winston.format(...) ПЕРЕД json().
 *
 * Контракт (важен для тестов и для будущих правок):
 *  - deny-list по ИМЕНИ ключа, case-insensitive, `-` и `_` нормализуются;
 *  - символы winston (Symbol.for('level') / ('message') / ('splat')) переносятся
 *    на возвращаемый объект — их потеря ломает маршрутизацию по уровням;
 *  - циклы → '[Circular]';
 *  - глубина > MAX_DEPTH → '[Truncated]' (не пропускаем поддерево сырым, иначе
 *    глубоко лежащий секрет утечёт);
 *  - обходятся только plain-объекты и массивы; Date/Buffer/Error/типизированные
 *    массивы отдаются как есть, без схлопывания в {};
 *  - вход не мутируется.
 */

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

// Имена нормализуются: lower-case, `-` и `_` удаляются. Поэтому
// 'access_token', 'access-token' и 'accessToken' сводятся к 'accesstoken'.
const DENY_LIST_RAW = [
    'password', 'pass', 'password_hash',
    'token', 'access_token', 'refresh_token', 'temp_token',
    'secret', 'client_secret', 'api_key',
    'totp_secret', 'recovery_codes',
    'authorization', 'cookie', 'cookies', 'set-cookie',
    'x-service-token', 'x-telemetry-signature', 'x-webhook-signature',
];

const normalizeKey = (key) => String(key).toLowerCase().replace(/[-_]/g, '');

const DENY_SET = new Set(DENY_LIST_RAW.map(normalizeKey));

const isSensitiveKey = (key) => DENY_SET.has(normalizeKey(key));

/**
 * Значения, которые обходить НЕЛЬЗЯ: копия через {...} превратила бы их в
 * бесполезный {} (Date), в {type:'Buffer',data:[...]} или потеряла бы stack.
 */
const isTraversable = (value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return true;
    if (value instanceof Date) return false;
    if (value instanceof Error) return false;
    if (value instanceof RegExp) return false;
    if (value instanceof Map || value instanceof Set) return false;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return false;
    if (ArrayBuffer.isView(value)) return false;
    return true;
};

function redactValue(value, depth, seen) {
    if (!isTraversable(value)) return value;

    if (seen.has(value)) return '[Circular]';
    if (depth > MAX_DEPTH) return '[Truncated]';

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => redactValue(item, depth + 1, seen));
        }

        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = isSensitiveKey(key)
                ? REDACTED
                : redactValue(value[key], depth + 1, seen);
        }
        return out;
    } finally {
        seen.delete(value);
    }
}

/**
 * Возвращает копию log-записи с вычищенными чувствительными значениями.
 * Символы winston переносятся на копию.
 *
 * @param {object} info запись winston (или произвольный plain-объект)
 * @returns {object}
 */
function redactLogInfo(info) {
    if (info === null || typeof info !== 'object' || Array.isArray(info)) {
        return info;
    }

    const redacted = redactValue(info, 0, new Set());

    // Символы не перечисляются Object.keys — переносим вручную.
    for (const sym of Object.getOwnPropertySymbols(info)) {
        redacted[sym] = info[sym];
    }

    return redacted;
}

module.exports = {
    redactLogInfo,
    isSensitiveKey,
    REDACTED,
    MAX_DEPTH,
    DENY_LIST: Object.freeze([...DENY_LIST_RAW]),
};
