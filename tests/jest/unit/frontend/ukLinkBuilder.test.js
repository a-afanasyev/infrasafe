/**
 * [UK-URGENCY remnant] admin-UI «Открыть в УК» reopen-meta passthrough.
 *
 * The B-001 deep-link builder substituted only ${uk_frontend_url} +
 * ${uk_request_number}. For a reopened alert the operator should land on the UK
 * request WITH reopen context so the UK side (`onOpenRelated`) can surface
 * "Повторное обращение №N · связана с XXX". The alert item already carries
 * reopen_sequence / reopen_chain_id / previous_uk_request_number (the /api/alerts
 * SELECT ia.* exposes them), so this is a pure front-end passthrough.
 *
 * Contract (PROPOSED to UK, gated on their confirm): for a real reopen
 * (reopen_sequence > 1) append query params reopen_sequence + related_request +
 * reopen_chain_id. Non-reopen alerts (sequence 1 / absent) get the unchanged
 * B-001 URL — no empty params shipped.
 */

const { buildUkRequestUrl } = require('../../../../public/utils/ukLinkBuilder');

const config = {
    uk_frontend_url: 'https://infrasafe.uz/uk',
    // default B-001 template
    uk_request_url_template: '${uk_frontend_url}/dashboard?request=${uk_request_number}',
};

describe('[UK-URGENCY] buildUkRequestUrl — base (B-001 behaviour preserved)', () => {
    test('no reopen meta → unchanged deep-link', () => {
        expect(buildUkRequestUrl('260613-001', config))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-001');
    });

    test('trailing slash on uk_frontend_url is trimmed', () => {
        expect(buildUkRequestUrl('260613-001', { ...config, uk_frontend_url: 'https://infrasafe.uz/uk/' }))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-001');
    });

    test('null when uk_frontend_url missing', () => {
        expect(buildUkRequestUrl('260613-001', { ...config, uk_frontend_url: '' })).toBeNull();
    });

    test('null when uk_request_number missing', () => {
        expect(buildUkRequestUrl('', config)).toBeNull();
        expect(buildUkRequestUrl(null, config)).toBeNull();
    });

    test('uk_request_number is URL-encoded', () => {
        expect(buildUkRequestUrl('260613/001', config))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613%2F001');
    });
});

describe('[UK-URGENCY] buildUkRequestUrl — reopen-meta passthrough', () => {
    test('reopen_sequence > 1 → appends reopen_sequence + related_request + reopen_chain_id', () => {
        const url = buildUkRequestUrl('260613-009', config, {
            reopen_sequence: 3,
            related_request_number: '260101-001',
            reopen_chain_id: 'abc-123',
        });
        expect(url).toBe(
            'https://infrasafe.uz/uk/dashboard?request=260613-009'
            + '&reopen_sequence=3&related_request=260101-001&reopen_chain_id=abc-123'
        );
    });

    test('reopen with only sequence (no related/chain) → appends only reopen_sequence', () => {
        expect(buildUkRequestUrl('260613-009', config, { reopen_sequence: 2 }))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-009&reopen_sequence=2');
    });

    test('reopen_sequence 1 (original, not a reopen) → no reopen params', () => {
        expect(buildUkRequestUrl('260613-001', config, {
            reopen_sequence: 1,
            related_request_number: null,
            reopen_chain_id: null,
        })).toBe('https://infrasafe.uz/uk/dashboard?request=260613-001');
    });

    test('absent/empty reopen meta → no reopen params', () => {
        expect(buildUkRequestUrl('260613-001', config, {}))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-001');
        expect(buildUkRequestUrl('260613-001', config, { reopen_sequence: undefined }))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-001');
    });

    test('related_request_number is URL-encoded', () => {
        const url = buildUkRequestUrl('260613-009', config, {
            reopen_sequence: 2,
            related_request_number: 'a&b=c',
        });
        expect(url).toContain('related_request=a%26b%3Dc');
        expect(url).not.toContain('related_request=a&b=c');
    });

    test('reopen_sequence as numeric string is honoured (> 1)', () => {
        expect(buildUkRequestUrl('260613-009', config, { reopen_sequence: '4' }))
            .toBe('https://infrasafe.uz/uk/dashboard?request=260613-009&reopen_sequence=4');
    });

    test('path-only template (no query) uses ? separator for reopen params', () => {
        const url = buildUkRequestUrl('260613-009', {
            uk_frontend_url: 'https://infrasafe.uz/uk',
            uk_request_url_template: '${uk_frontend_url}/r/${uk_request_number}',
        }, { reopen_sequence: 2 });
        expect(url).toBe('https://infrasafe.uz/uk/r/260613-009?reopen_sequence=2');
    });
});
