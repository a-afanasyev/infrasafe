'use strict';

/**
 * [N-55] Таймауты обработки запроса — в одном месте, потому что они связаны.
 *
 * Порядок строгий, с запасом:
 *   STATEMENT_TIMEOUT_MS (БД)  <  HTTP_REQUEST_TIMEOUT_MS (Node)  <  proxy_read_timeout (nginx, 60 с)
 *
 * При равенстве первых двух (так было: оба 30 с) сокет закрывался раньше, чем
 * errorHandler успевал ответить на запрос, упёршийся в таймаут БД, — клиент
 * получал пустой ответ, за nginx это 502. Соотношение, включая значения из
 * конфигов периметров, сторожит tests/jest/unit/timeoutChain.test.js.
 */

// Предел выполнения одного SQL-запроса (параметр подключения пула, N-29).
const STATEMENT_TIMEOUT_MS = 30000;

// Запас после отказа БД: откат, breaker, errorHandler и запись ответа.
const RESPONSE_MARGIN_MS = 15000;

// Простой сокета, после которого Node закрывает запрос (server.timeout).
const HTTP_REQUEST_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + RESPONSE_MARGIN_MS;

module.exports = { STATEMENT_TIMEOUT_MS, RESPONSE_MARGIN_MS, HTTP_REQUEST_TIMEOUT_MS };
