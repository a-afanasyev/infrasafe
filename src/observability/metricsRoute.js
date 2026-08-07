'use strict';

/**
 * [AR-2 / Task 6] Эндпоинт скрейпа Prometheus.
 *
 * Путь и способ авторизации продиктованы строфой в profk-observability
 * (`alloy/config.alloy`): `metrics_path = "/internal/metrics"` +
 * `bearer_token_file`. Путь именно /internal/metrics, а не /metrics, потому
 * что /metrics в приложении уже занят telemetry-API (`routes/index.js`).
 *
 * Монтируется НАПРЯМУЮ на app (как /health), а не под /api — иначе он попал бы
 * под default-deny JWT-мидлварь, которая для машинного скрейпа не подходит.
 * Публичный эдж в приложение проксирует только /api/, поэтому снаружи путь
 * недостижим; авторизация здесь — второй рубеж, а не единственный.
 */

const crypto = require('crypto');
const metrics = require('./metrics');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiResponse');

const METRICS_PATH = '/internal/metrics';
const TOKEN_ENV = 'INTERNAL_METRICS_TOKEN';

/**
 * Постоянное по времени сравнение. Разная длина отсекается ДО timingSafeEqual:
 * он бросает исключение на буферах разного размера.
 */
function tokenMatches(expected, provided) {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Разбор `Authorization: Bearer <token>` БЕЗ регулярного выражения.
 *
 * Была `/^Bearer\s+(.+)$/` — CodeQL справедливо пометил её как
 * polynomial-redos: `\s+` рядом с `.+` на заголовке, который приходит от
 * кого угодно, даёт квадратичный откат на подобранной строке. Здесь разбор
 * линейный, а поведение то же: схема сравнивается точно, разделителем
 * считается пробел или таб, пустой токен отвергается.
 */
function extractBearer(header) {
    if (typeof header !== 'string') return null;
    const trimmed = header.trim();
    const SCHEME = 'Bearer';
    if (!trimmed.startsWith(SCHEME)) return null;

    const rest = trimmed.slice(SCHEME.length);
    // Нужен явный разделитель: "BearerXYZ" — не наша схема.
    if (rest.length === 0 || (rest[0] !== ' ' && rest[0] !== '\t')) return null;

    const token = rest.trim();
    return token || null;
}

function mountInternalMetrics(app) {
    app.get(METRICS_PATH, async (req, res) => {
        const expected = process.env[TOKEN_ENV];

        // Fail-closed: «не настроено» = «выключено». Намеренно строже, чем
        // requireServiceToken (H-4), который спит до настройки: там речь о
        // совместимости с УК, здесь — о раскрытии операционной картины.
        if (!expected) {
            return sendError(res, 503, `Metrics endpoint disabled: ${TOKEN_ENV} is not set`);
        }

        const provided = extractBearer(req.headers.authorization);
        if (!provided || !tokenMatches(expected, provided)) {
            return sendError(res, 401, 'Unauthorized');
        }

        try {
            // Порядок важен: сперва подтягиваем гейджи из БД, потом
            // сериализуем — см. комментарий про Promise.all в metrics.js.
            await metrics.refresh();
            res.set('Content-Type', metrics.registry.contentType);
            res.send(await metrics.registry.metrics());
        } catch (error) {
            // Скрейп не должен ронять процесс; Prometheus сам отметит
            // up{job="infrasafe_app"}=0, и это уже алертится (blackbox.yml).
            logger.error(`metrics: скрейп не удался: ${error.message}`);
            sendError(res, 500, 'Metrics collection failed');
        }
    });
}

module.exports = { mountInternalMetrics, METRICS_PATH, TOKEN_ENV };
