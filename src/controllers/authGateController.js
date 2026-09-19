'use strict';

/**
 * [FOUNTAIN] Сторожа доступа для `auth_request` на периметре.
 *
 * Панель фонтана живёт на чужом устройстве за VPN, но закрывается НАШЕЙ
 * авторизацией: nginx на каждый запрос делает подзапрос сюда и пускает дальше
 * только при 2xx. Кругов два и они не совпадают — смотреть показания может
 * любой вошедший, переключать насос только администратор.
 *
 * Почему отдельные обработчики, а не `/auth/profile` и не любой admin-маршрут:
 * те ходят в базу и отдают тело, а подзапрос делается на КАЖДЫЙ запрос к
 * панели, включая долгоживущий поток событий. Сторожу нужен один вердикт;
 * пользователь к этому моменту уже разобран middleware'ом и лежит в `req.user`.
 *
 * Тела нет намеренно: nginx его выбрасывает, и отдавать его — греть канал зря.
 */

const logger = require('../utils/logger');

// Значение HTTP-заголовка обязано быть ASCII. Имя вроде «Смотритель фонтана»
// делает ответ невалидным, и падает не журнал, а ВЕСЬ запрос: панель перестаёт
// открываться из-за поля, которое нужно было только для записи в лог.
// Процентное кодирование сохраняет личность (её видно после декодирования) и
// при этом не трогает обычные ASCII-имена — `admin` остаётся `admin`.
const MAX_HEADER_VALUE = 200;

function asciiSafe(value) {
    if (value === null || value === undefined) return '';
    return encodeURIComponent(String(value)).slice(0, MAX_HEADER_VALUE);
}

/**
 * Личность пропущенного — периметру, чтобы он записал в журнал, КТО нажал.
 * Наружу эти заголовки не попадают: ответ подзапроса браузеру не отдаётся.
 */
function setIdentityHeaders(res, user) {
    res.set('X-Auth-User', String(user.user_id));
    res.set('X-Auth-Username', asciiSafe(user.username));
    res.set('X-Auth-Role', asciiSafe(user.role));
}

/** Круг чтения: любой вошедший. Сюда доходят только прошедшие authenticateJWT. */
function gate(req, res) {
    setIdentityHeaders(res, req.user);
    return res.status(204).end();
}

/**
 * Круг управления: только администратор.
 *
 * Проверка роли повторена здесь, а не отдана `isAdmin` на уровне маршрута,
 * ровно по одной причине: этот обработчик — единственное, что стоит между
 * внешним запросом и физическим оборудованием. Условие должно быть видно в
 * том же файле, где написано, что он разрешает.
 */
function adminGate(req, res) {
    if (!req.user || req.user.role !== 'admin') {
        logger.warn(
            `[FOUNTAIN] отказ в управлении: пользователь ${req.user?.username || 'anonymous'} не администратор`
        );
        return res.status(403).end();
    }
    setIdentityHeaders(res, req.user);
    return res.status(204).end();
}

module.exports = { gate, adminGate, asciiSafe };
