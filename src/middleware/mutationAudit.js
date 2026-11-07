'use strict';

/**
 * [S-PERIM-4, аудит 05.11.2026] Журнал мутаций: кто, откуда и что менял.
 *
 * До этого «кто что поменял» было только у правил эскалации
 * (alert_rule_changes). CRUD зданий, контроллеров, трансформаторов, линий,
 * пользователей проходил без следа — при компрометации админ-учётки
 * восстановить картину было нечем.
 *
 * Один глобальный middleware сразу после default-deny в routes/index.js, а не
 * по роутерам: isAdmin у половины маршрутов стоит внутри маршрута
 * (lineRoutes, powerAnalyticsRoutes), и «router.use после guard» их бы
 * пропустил. Пишем в лог, не в таблицу: логи уже уезжают в Alloy/Loki,
 * а таблица аудита — отдельное решение с ретенцией и UI.
 *
 * Пропускаем /auth/* — у входа свои события (auth.*) с login_hash.
 */

const logger = require('../utils/logger');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Путь без префикса монтирования (/api): middleware живёт в роутере /api,
// где req.path = /auth/login, но тест может повесить его на корень.
const isAuthPath = (req) => /^(\/api)?\/auth\//.test(req.originalUrl || req.path || '');

const mutationAudit = (req, res, next) => {
    if (!MUTATING.has(req.method) || isAuthPath(req)) {
        return next();
    }
    res.on('finish', () => {
        if (res.statusCode >= 400 || !req.user) return;
        logger.info('mutation', {
            event: 'mutation',
            user_id: req.user.id ?? req.user.user_id,
            role: req.user.role,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            id: req.params?.id,
            ip: req.ip,
            status: res.statusCode,
            correlationId: req.correlationId
        });
    });
    next();
};

module.exports = mutationAudit;
