'use strict';

/**
 * [AR-9] Проверка переменных окружения по ЗНАЧЕНИЮ, а не по наличию.
 *
 * `env.js` отвечал на вопрос «переменная задана?». На вопрос «задана
 * осмысленно?» не отвечал никто, и типовой отказ выглядел так:
 *
 *     DB_POOL_MAX=twenty  →  parseInt → NaN  →  pg получает max: NaN
 *
 * Приложение при этом стартовало. Опечатка в одной букве превращалась не в
 * ошибку запуска, а в странное поведение под нагрузкой через час.
 *
 * Здесь описан контракт значений; сам разбор — в `validate()`. Модуль
 * отделён от `env.js` намеренно: там живёт политика («что обязательно в
 * проде»), здесь — грамматика («как выглядит корректное значение»). Их
 * смешение и привело к тому, что вторую половину просто забыли.
 *
 * Пустая строка ВЕЗДЕ означает «переменная не выставлена». Значение по
 * умолчанию подставляет потребитель — дублировать его тут значило бы завести
 * второй источник истины для каждого таймаута.
 */

/** Целое число с необязательными границами. */
const int = (name, { min, max } = {}) => ({
    name,
    check(raw) {
        if (!/^-?\d+$/.test(raw)) {
            return `${name}: ожидается целое число, получено "${raw}"`;
        }
        const n = Number(raw);
        if (min !== undefined && n < min) return `${name}: минимум ${min}, получено ${n}`;
        if (max !== undefined && n > max) return `${name}: максимум ${max}, получено ${n}`;
        return null;
    },
});

/**
 * Булево. Принимаются обе привычные записи — `true/false` и `1/0`, в любом
 * регистре. Всё остальное отвергается, и это главное здесь: код сравнивает
 * значение со строкой `'true'`, поэтому `yes` тихо означает ВЫКЛЮЧЕНО.
 * Оператор, написавший `yes`, уверен в обратном — а выключенным окажется,
 * например, воркер верификации алертов.
 */
const bool = (name) => ({
    name,
    check(raw) {
        return ['true', 'false', '1', '0'].includes(raw.toLowerCase())
            ? null
            : `${name}: ожидается true|false|1|0, получено "${raw}"`;
    },
});

/** Значение из закрытого списка. */
const oneOf = (name, values) => ({
    name,
    check(raw) {
        return values.includes(raw)
            ? null
            : `${name}: ожидается одно из [${values.join(', ')}], получено "${raw}"`;
    },
});

/** URL с ограниченным набором схем. */
const url = (name, schemes) => ({
    name,
    check(raw) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            return `${name}: не является URL ("${raw}")`;
        }
        const scheme = parsed.protocol.replace(':', '');
        return schemes.includes(scheme)
            ? null
            : `${name}: схема должна быть одной из [${schemes.join(', ')}], получена "${scheme}"`;
    },
});

const RULES = [
    // --- База данных -------------------------------------------------------
    int('DB_PORT', { min: 1, max: 65535 }),
    // Верхняя граница пула не формальность: postgres по умолчанию держит 100
    // соединений на весь кластер, и пул на 200 у одной реплики означает отказ
    // обслуживания для всех остальных потребителей той же БД.
    int('DB_POOL_MAX', { min: 1, max: 100 }),
    int('DB_POOL_MIN', { min: 0, max: 100 }),
    int('DB_POOL_IDLE_TIMEOUT', { min: 1000 }),
    int('DB_POOL_CONNECT_TIMEOUT', { min: 100 }),

    // --- Приложение --------------------------------------------------------
    int('PORT', { min: 1, max: 65535 }),
    oneOf('LOG_LEVEL', ['error', 'warn', 'info', 'debug']),
    bool('LOG_CONSOLE_ONLY'),
    bool('SECURE_COOKIES'),
    bool('AUTH_BLACKLIST_FAIL_OPEN'),
    int('REPLICA_COUNT', { min: 1 }),
    url('REDIS_URL', ['redis', 'rediss']),

    // --- Планировщики и воркеры -------------------------------------------
    bool('MV_REFRESH_ENABLED'),
    int('MV_REFRESH_INTERVAL_SECONDS', { min: 10, max: 3600 }),
    bool('ALERT_VERIFICATION_ENABLED'),
    int('ALERT_VERIFICATION_TICK_MS', { min: 5000, max: 60000 }),
    int('UK_OUTBOX_DRAIN_INTERVAL_MS', { min: 500, max: 60000 }),
    int('UK_OUTBOX_MAX_AGE_HOURS', { min: 1 }),

    // --- Интеграция с УК ---------------------------------------------------
    bool('UK_USE_WEBHOOK_SENDER'),
    bool('UK_USE_NEXT_SECRET'),
    bool('UK_ESCALATION_NOTIFY'),
    url('UK_API_URL', ['http', 'https']),

    // --- Лимитер -----------------------------------------------------------
    // Значения по умолчанию (10 и 5) намеренно строгие; переопределяются на
    // прогонах E2E, где один IP делает больше десяти входов подряд.
    int('RATE_LIMIT_AUTH_MAX', { min: 1 }),
    int('RATE_LIMIT_REGISTER_MAX', { min: 1 }),
];

/**
 * Проверить значения выставленных переменных.
 *
 * Незаданные и пустые пропускаются: пустая строка — это «не выставлено», а не
 * мусор, и ронять на ней старт значило бы наказывать за пустую строку в `.env`.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {string[]} список сообщений об ошибках (пустой = всё в порядке)
 */
function validate(env = process.env) {
    const errors = [];

    for (const rule of RULES) {
        const raw = env[rule.name];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const error = rule.check(String(raw).trim());
        if (error) errors.push(error);
    }

    // Соотношение, а не отдельное значение: поодиночке оба корректны, неверно
    // их СОЧЕТАНИЕ. Пул с min > max не стартует внятно, и обнаруживается это
    // под нагрузкой, а не при запуске.
    const min = env.DB_POOL_MIN;
    const max = env.DB_POOL_MAX;
    if (min && max && /^\d+$/.test(String(min).trim()) && /^\d+$/.test(String(max).trim())) {
        if (Number(min) > Number(max)) {
            errors.push(`DB_POOL_MIN (${min}) не может быть больше DB_POOL_MAX (${max})`);
        }
    }

    return errors;
}

module.exports = { validate, RULES };
