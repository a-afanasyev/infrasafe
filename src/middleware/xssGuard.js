// [SEC-10 / AR-10] Детектор XSS-токенов. Вынесен из validators.js, когда у него
// появился второй потребитель (validatorFields.js): правило безопасности должно
// жить в одном месте, иначе его чинят в одной копии и забывают про вторую.

// Функция для проверки XSS.
// SEC-10: заменён прежний паттерн с вложенным квантификатором
// (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/) — он давал
// катастрофический backtracking (ReDoS, ~2.2s на 15k символов).
// Все паттерны ниже линейны по времени и не содержат вложенных квантификаторов:
// детектируем сам опасный токен (открывающий тег / javascript: / on-handler),
// а не полностью сбалансированную пару тегов. Контракт truthy/falsy сохранён —
// функция возвращает true только если ни один опасный токен не найден.
const XSS_PATTERNS = [
    /<\s*script\b/i,   // открывающий тег <script (с возможным пробелом)
    /<\s*iframe\b/i,
    /<\s*object\b/i,
    /<\s*embed\b/i,
    /javascript:/i,
    /\bon\w+\s*=/i      // inline event-handler, напр. onerror=, onload=
];

const isXSSFree = (value) => {
    if (typeof value !== 'string') {
        return true;
    }
    return !XSS_PATTERNS.some(pattern => pattern.test(value));
};

module.exports = { isXSSFree };
