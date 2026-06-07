// [SEC-23] Unit tests for the CSRF Origin/Referer guard.
//
// Policy (validate-if-present): for state-changing methods on COOKIE-authenticated
// requests, reject (403) when a present Origin/Referer is not in the allowlist;
// allow when both are absent (SameSite=strict is the primary defense and browsers
// always attach Origin to cross-site mutations). Bearer/webhook/non-mutation pass.

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const csrfOriginGuard = require('../../../src/middleware/csrfOriginGuard');

const ALLOWED = 'https://app.example.com';
const EVIL = 'https://evil.com';

const mkRes = () => {
    const r = {};
    r.status = jest.fn().mockReturnValue(r);
    r.json = jest.fn().mockReturnValue(r);
    return r;
};

const run = (req) => {
    const res = mkRes();
    const next = jest.fn();
    csrfOriginGuard(
        { method: 'POST', path: '/buildings', cookies: {}, headers: {}, ...req },
        res,
        next
    );
    return { res, next };
};

const expectPass = ({ res, next }) => {
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
};
const expect403 = ({ res, next }) => {
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
};

describe('csrfOriginGuard (SEC-23)', () => {
    const ORIG = process.env.CORS_ORIGINS;
    beforeEach(() => { process.env.CORS_ORIGINS = ALLOWED; });
    afterEach(() => {
        if (ORIG === undefined) delete process.env.CORS_ORIGINS;
        else process.env.CORS_ORIGINS = ORIG;
    });

    test('GET is never checked (non-mutation), even cookie + evil Origin', () => {
        expectPass(run({ method: 'GET', cookies: { access_token: 'a' }, headers: { origin: EVIL } }));
    });

    test('access-cookie + POST + allowed Origin → pass', () => {
        expectPass(run({ cookies: { access_token: 'a' }, headers: { origin: ALLOWED } }));
    });

    test('access-cookie + POST + evil Origin → 403', () => {
        expect403(run({ cookies: { access_token: 'a' }, headers: { origin: EVIL } }));
    });

    test('refresh-cookie + POST /auth/refresh + evil Origin → 403', () => {
        expect403(run({ path: '/auth/refresh', cookies: { refresh_token: 'r' }, headers: { origin: EVIL } }));
    });

    test('refresh-cookie + POST /auth/refresh/ (trailing slash) + evil Origin → 403 (normalized)', () => {
        expect403(run({ path: '/auth/refresh/', cookies: { refresh_token: 'r' }, headers: { origin: EVIL } }));
    });

    test('refresh-cookie (no access) on a NORMAL endpoint + Bearer + evil Origin → pass (not cookie-auth there)', () => {
        expectPass(run({
            path: '/buildings',
            cookies: { refresh_token: 'r' },
            headers: { authorization: 'Bearer xyz', origin: EVIL }
        }));
    });

    test('cookie + POST + no Origin and no Referer → pass (lenient)', () => {
        expectPass(run({ cookies: { access_token: 'a' }, headers: {} }));
    });

    test('cookie + POST + allowed Referer (no Origin) → pass', () => {
        expectPass(run({ cookies: { access_token: 'a' }, headers: { referer: `${ALLOWED}/admin/x` } }));
    });

    test('cookie + POST + evil Referer (no Origin) → 403', () => {
        expect403(run({ cookies: { access_token: 'a' }, headers: { referer: `${EVIL}/x` } }));
    });

    test('cookie + POST + present-but-empty Origin → 403', () => {
        expect403(run({ cookies: { access_token: 'a' }, headers: { origin: '' } }));
    });

    test('cookie + POST + present-but-empty Referer → 403', () => {
        expect403(run({ cookies: { access_token: 'a' }, headers: { referer: '' } }));
    });

    test('cookie + POST + malformed Referer → 403, not 500', () => {
        expect403(run({ cookies: { access_token: 'a' }, headers: { referer: 'not a url' } }));
    });

    test('object-valued cookie (cookie-parser parsed j:{...}) + Bearer + evil Origin → pass (not a string ⇒ not cookie-auth)', () => {
        expectPass(run({
            cookies: { access_token: { j: 1 } },
            headers: { authorization: 'Bearer xyz', origin: EVIL }
        }));
    });

    test('empty-string cookie value → not cookie-auth → pass', () => {
        expectPass(run({ cookies: { access_token: '' }, headers: { origin: EVIL } }));
    });

    test('Bearer-only (no cookie) + evil Origin → pass (CSRF-immune)', () => {
        expectPass(run({ headers: { authorization: 'Bearer xyz', origin: EVIL } }));
    });

    test('webhook-style (no cookie, no Origin) → pass', () => {
        expectPass(run({ path: '/webhooks/uk/request', headers: { 'x-webhook-signature': 't=1,v1=ab' } }));
    });

    test('PUT/PATCH/DELETE are also guarded', () => {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            expect403(run({ method, cookies: { access_token: 'a' }, headers: { origin: EVIL } }));
        }
    });
});
