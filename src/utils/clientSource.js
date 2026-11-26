'use strict';

/**
 * [аудит #12, п. 9] Источник запроса как ключ счётчика промахов входа.
 *
 * Адрес приводится к виду, в котором один абонент — один ключ:
 *   - IPv4 — как есть;
 *   - IPv4-mapped IPv6 (`::ffff:1.2.3.4`) — к IPv4, иначе один и тот же адрес
 *     получал бы два независимых счётчика;
 *   - IPv6 — префикс /64: такая подсеть выдаётся абоненту целиком, и счёт по
 *     полному адресу дал бы ему 2^64 счётчиков;
 *   - всё остальное (нет адреса, мусор) — общий источник `unknown`. Он
 *     намеренно один на всех: вызов без адреса не должен получать собственный
 *     неисчерпаемый счётчик.
 */

const net = require('net');

const UNKNOWN_SOURCE = 'unknown';
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Первые четыре группы IPv6-адреса (его /64) в канонической записи. */
function ipv6Prefix64(address) {
    const [head, tail] = address.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = address.includes('::') ? Math.max(8 - headGroups.length - tailGroups.length, 0) : 0;
    const groups = [...headGroups, ...new Array(missing).fill('0'), ...tailGroups];
    return groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16)).join(':');
}

/**
 * @param {unknown} ip - `req.ip`
 * @returns {string} нормализованный источник
 */
function normalizeSource(ip) {
    if (typeof ip !== 'string' || ip.length === 0) return UNKNOWN_SOURCE;
    const address = ip.split('%')[0]; // zone id (`fe80::1%eth0`)
    const mapped = IPV4_MAPPED.exec(address);
    if (mapped && net.isIPv4(mapped[1])) return mapped[1];
    if (net.isIPv4(address)) return address;
    if (net.isIPv6(address)) return `${ipv6Prefix64(address)}::/64`;
    return UNKNOWN_SOURCE;
}

module.exports = { normalizeSource, UNKNOWN_SOURCE };
