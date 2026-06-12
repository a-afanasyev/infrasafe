/**
 * @jest-environment jsdom
 *
 * AUD-014: validateToken() must distinguish a genuine auth failure (401/403 →
 * log out) from a transient connection failure (network drop / 5xx → keep the
 * session, surface a notice, retry). The old code logged the operator out on
 * ANY non-OK response or fetch rejection.
 */

const AdminAuth = require('../../../../public/admin-auth.js');

function makeAuth() {
    const auth = new AdminAuth({ autoInit: false });
    // Neutralise side-effecting collaborators so the test asserts only the
    // logout/keep-session decision.
    jest.spyOn(auth, 'logout').mockImplementation(() => {});
    jest.spyOn(auth, 'showAdminPanel').mockImplementation(() => {});
    jest.spyOn(auth, 'setupAuthHeaders').mockImplementation(() => {});
    jest.spyOn(auth, 'setupChangePassword').mockImplementation(() => {});
    return auth;
}

function mockFetch(impl) {
    const fn = jest.fn(impl);
    global.fetch = fn;
    window.fetch = fn;
    return fn;
}

afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete window.fetch;
    document.body.innerHTML = '';
    jest.useRealTimers();
});

describe('validateToken — auth failure vs transient failure', () => {
    test('network error does NOT log the operator out', async () => {
        jest.useFakeTimers();
        const auth = makeAuth();
        mockFetch(() => Promise.reject(new Error('Failed to fetch')));

        await auth.validateToken();

        expect(auth.logout).not.toHaveBeenCalled();
        expect(auth.isAuthenticated).toBe(false);
    });

    test('5xx server blip does NOT log the operator out', async () => {
        jest.useFakeTimers();
        const auth = makeAuth();
        mockFetch(() => Promise.resolve({ ok: false, status: 502 }));

        await auth.validateToken();

        expect(auth.logout).not.toHaveBeenCalled();
    });

    test('a transient failure surfaces a connection notice and schedules a retry', async () => {
        jest.useFakeTimers();
        const auth = makeAuth();
        const fetchFn = mockFetch(() => Promise.reject(new Error('offline')));

        await auth.validateToken();

        const notice = document.getElementById('admin-connection-notice');
        expect(notice).not.toBeNull();
        expect(auth._connectionRetries).toBe(1);

        // The scheduled retry fires another probe — this time it succeeds.
        fetchFn.mockImplementation(() => Promise.resolve({ ok: true }));
        await jest.runOnlyPendingTimersAsync();

        expect(auth.showAdminPanel).toHaveBeenCalled();
        expect(document.getElementById('admin-connection-notice')).toBeNull();
        expect(auth.logout).not.toHaveBeenCalled();
    });

    test('explicit 401 logs the operator out', async () => {
        const auth = makeAuth();
        mockFetch(() => Promise.resolve({ ok: false, status: 401 }));

        await auth.validateToken();

        expect(auth.logout).toHaveBeenCalledTimes(1);
    });

    test('explicit 403 logs the operator out', async () => {
        const auth = makeAuth();
        mockFetch(() => Promise.resolve({ ok: false, status: 403 }));

        await auth.validateToken();

        expect(auth.logout).toHaveBeenCalledTimes(1);
    });

    test('a valid session shows the admin panel and does not log out', async () => {
        const auth = makeAuth();
        mockFetch(() => Promise.resolve({ ok: true, status: 200 }));

        await auth.validateToken();

        expect(auth.showAdminPanel).toHaveBeenCalledTimes(1);
        expect(auth.isAuthenticated).toBe(true);
        expect(auth.logout).not.toHaveBeenCalled();
    });

    test('a recovered connection resets the retry counter', async () => {
        const auth = makeAuth();
        auth._connectionRetries = 3;
        mockFetch(() => Promise.resolve({ ok: true, status: 200 }));

        await auth.validateToken();

        expect(auth._connectionRetries).toBe(0);
    });
});
