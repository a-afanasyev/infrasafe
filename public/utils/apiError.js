/**
 * [AR-4] Единая распаковка сообщения об ошибке из ответа API.
 *
 * Бэкенд исторически отдаёт ошибки в пяти несовместимых формах, и фронт читал
 * их двадцатью разными способами. Самый частый — `body.error || body.message ||
 * 'запасной текст'` — на канонической форме (`error` это ОБЪЕКТ) выдаёт объект,
 * а `new Error(объект).message` превращается в `"[object Object]"`. Поскольку
 * `errorHandler` отдаёт именно канон, оператор видел эту строку вместо причины
 * отказа на каждой неудачной админской операции.
 *
 * Хелпер принимает любую форму и всегда возвращает читаемую строку. Смысл не в
 * экономии кода, а в развязке: фронт перестаёт зависеть от формы конверта, и
 * канонизация бэкенда больше не может его сломать.
 *
 * Экспортируется и как глобал (esbuild с bundle:false сохраняет глобалы), и как
 * CommonJS-модуль для unit-тестов — как остальные утилиты в этом каталоге.
 */
(function (root) {
    'use strict';

    const DEFAULT_FALLBACK = 'Операция не выполнена';

    const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

    /**
     * Собрать текст из массива ошибок валидации.
     * Поддерживает обе формы: express-validator (`msg` + `path`/`param`) и
     * канонические details (`message` + `field`).
     */
    function joinValidationErrors(list) {
        const parts = [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const text = isNonEmptyString(item.msg) ? item.msg
                : isNonEmptyString(item.message) ? item.message
                    : null;
            if (!text) continue;
            const field = isNonEmptyString(item.field) ? item.field
                : isNonEmptyString(item.path) ? item.path
                    : isNonEmptyString(item.param) ? item.param
                        : null;
            parts.push(field ? `${field}: ${text}` : text);
        }
        return parts.join('; ');
    }

    /**
     * @param {*} body      разобранное тело ответа (любой формы или мусор)
     * @param {string} [fallback] что показать, если извлечь нечего
     * @returns {string} всегда непустая строка, никогда не "[object Object]"
     */
    function extractApiError(body, fallback) {
        const fb = isNonEmptyString(fallback) ? fallback : DEFAULT_FALLBACK;
        if (!body || typeof body !== 'object') return fb;

        const err = body.error;

        // Канон: error — объект. Детали валидации, если есть, дописываем к тексту:
        // «Ошибка валидации» без указания поля бесполезна для исправления.
        if (err && typeof err === 'object') {
            const base = isNonEmptyString(err.message) ? err.message : null;
            const details = Array.isArray(err.details) ? joinValidationErrors(err.details) : '';
            if (base && details) return `${base}: ${details}`;
            if (base) return base;
            if (details) return details;
        }

        // Форма лимитера: error — строка-КОД, message — человеческий текст.
        // Человеку показываем текст, код оставляем машинам.
        if (isNonEmptyString(body.message)) return body.message;

        // error — строка и никакого message: это и есть сообщение.
        if (isNonEmptyString(err)) return err;

        // express-validator: errors[] без success.
        if (Array.isArray(body.errors)) {
            const joined = joinValidationErrors(body.errors);
            if (joined) return joined;
        }

        return fb;
    }

    const api = { extractApiError };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ApiError = api;
    }
})(typeof window !== 'undefined' ? window : this);
