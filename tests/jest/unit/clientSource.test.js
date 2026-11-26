/**
 * [аудит #12, п. 9] Нормализация источника для счётчика промахов входа.
 */

const { normalizeSource, UNKNOWN_SOURCE } = require('../../../src/utils/clientSource');

describe('normalizeSource', () => {
    test.each([
        ['203.0.113.10', '203.0.113.10'],
        ['::ffff:203.0.113.10', '203.0.113.10'],
        ['::FFFF:203.0.113.10', '203.0.113.10'],
    ])('IPv4 %s → %s', (input, expected) => {
        expect(normalizeSource(input)).toBe(expected);
    });

    test.each([
        ['2001:db8:aa:bb::1', '2001:db8:aa:bb::/64'],
        ['2001:db8:aa:bb:ffff:ffff:ffff:ffff', '2001:db8:aa:bb::/64'],
        ['2001:0DB8:00AA:00BB:0:0:0:1', '2001:db8:aa:bb::/64'],
        ['2001:db8::1', '2001:db8:0:0::/64'],
        ['::1', '0:0:0:0::/64'],
        ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ])('IPv6 %s → /64 %s', (input, expected) => {
        expect(normalizeSource(input)).toBe(expected);
    });

    test('разные /64 — разные источники', () => {
        expect(normalizeSource('2001:db8:aa:bb::1')).not.toBe(normalizeSource('2001:db8:aa:cc::1'));
    });

    test.each([undefined, null, '', 42, {}, 'not-an-ip', '999.1.1.1', '203.0.113.10, 10.0.0.1', '::ffff:999.1.1.1'])(
        'мусор %p → общий «неизвестный» источник',
        (input) => {
            expect(normalizeSource(input)).toBe(UNKNOWN_SOURCE);
        }
    );

    test('результат годится в ключ: без пробелов и короче 64 символов', () => {
        for (const ip of ['203.0.113.10', '2001:db8:aa:bb:ffff:ffff:ffff:ffff', undefined]) {
            const source = normalizeSource(ip);
            expect(source).toMatch(/^\S+$/);
            expect(source.length).toBeLessThan(64);
        }
    });
});
