/**
 * [SEC-13] Bootstrap-admin CLI — createAdmin() unit tests.
 *
 * Closes the DR bootstrap-gap: register hardcodes role='user'
 * (authController.js:94), so on a fresh prod DB (no seed users) there is no
 * application path to create the first admin. createAdmin() provides one,
 * with strict "first admin only" semantics and a transaction + advisory lock
 * so two concurrent runs cannot both insert.
 *
 * The DB layer is mocked: we assert the SQL/transaction choreography
 * (BEGIN → advisory lock → checks → COMMIT/ROLLBACK → release → close) and
 * the decision semantics, not a live database.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const db = require('../../../src/config/database');
const authService = require('../../../src/services/authService');
const { createAdmin } = require('../../../src/cli/create-admin');

/**
 * Build a mock pg client whose query() routes by SQL fragment and records the
 * ordered list of executed statements.
 *
 * @param {object} rows - canned result rows keyed by query kind:
 *   selectAdmin: rows for "WHERE role = 'admin'"
 *   selectUsername: rows for "WHERE username = $1"
 *   selectEmail: rows for "WHERE email = $1"
 *   insert: rows for the INSERT ... RETURNING
 */
function makeClient(rows = {}) {
    const calls = [];
    const client = {
        calls,
        released: false,
        query: jest.fn(async (text, params) => {
            calls.push(text.trim().split('\n')[0].trim());
            if (/^BEGIN/i.test(text)) return {};
            if (/^COMMIT/i.test(text)) return {};
            if (/^ROLLBACK/i.test(text)) return {};
            if (/pg_advisory_xact_lock/i.test(text)) return { rows: [{}] };
            if (/role\s*=\s*'admin'/i.test(text)) return { rows: rows.selectAdmin || [] };
            if (/WHERE\s+username\s*=\s*\$1/i.test(text)) return { rows: rows.selectUsername || [] };
            if (/WHERE\s+email\s*=\s*\$1/i.test(text)) return { rows: rows.selectEmail || [] };
            if (/^INSERT\s+INTO\s+users/i.test(text)) {
                return { rows: rows.insert || [{ user_id: 1, username: params[0], email: params[1], role: 'admin', is_active: true }] };
            }
            return { rows: [] };
        }),
        release: jest.fn(function () { client.released = true; }),
    };
    return client;
}

function wireDb(client) {
    jest.spyOn(db, 'init').mockResolvedValue();
    jest.spyOn(db, 'close').mockResolvedValue();
    jest.spyOn(db, 'getPool').mockReturnValue({
        connect: jest.fn().mockResolvedValue(client),
    });
}

const VALID = { username: 'rootadmin', email: 'root@infrasafe.uz', password: 'Str0ngPass1' };

describe('[SEC-13] createAdmin', () => {
    beforeEach(() => {
        jest.spyOn(authService, 'hashPassword').mockResolvedValue('$2b$12$mockhashmockhashmockhashmockhashmockhash');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('creates the first admin (role=admin, hashed password) when none exists', async () => {
        const client = makeClient({}); // no admin, username/email free
        wireDb(client);

        const result = await createAdmin({ ...VALID });

        expect(result.status).toBe('created');
        expect(result.user.role).toBe('admin');
        expect(authService.hashPassword).toHaveBeenCalledWith(VALID.password);

        // INSERT used the hashed password, never the plaintext.
        const insertCall = client.query.mock.calls.find(([t]) => /^INSERT\s+INTO\s+users/i.test(t));
        expect(insertCall).toBeDefined();
        expect(insertCall[1]).not.toContain(VALID.password);
    });

    test('transaction choreography: BEGIN → advisory lock → COMMIT, then release + close', async () => {
        const client = makeClient({});
        wireDb(client);

        await createAdmin({ ...VALID });

        const order = client.calls;
        const iBegin = order.findIndex(s => /^BEGIN/i.test(s));
        const iLock = order.findIndex(s => /pg_advisory_xact_lock/i.test(s));
        const iCommit = order.findIndex(s => /^COMMIT/i.test(s));
        expect(iBegin).toBeGreaterThanOrEqual(0);
        expect(iLock).toBeGreaterThan(iBegin);   // BEGIN strictly before lock
        expect(iCommit).toBeGreaterThan(iLock);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(db.close).toHaveBeenCalledTimes(1);
    });

    test('idempotent: same username AND email as existing admin → already-exists (no INSERT)', async () => {
        const client = makeClient({
            selectAdmin: [{ user_id: 9, username: VALID.username, email: VALID.email }],
        });
        wireDb(client);

        const result = await createAdmin({ ...VALID });

        expect(result.status).toBe('already-exists');
        const insertCall = client.query.mock.calls.find(([t]) => /^INSERT\s+INTO\s+users/i.test(t));
        expect(insertCall).toBeUndefined();
    });

    test('same username but DIFFERENT email as existing admin → error (likely typo)', async () => {
        const client = makeClient({
            selectAdmin: [{ user_id: 9, username: VALID.username, email: 'different@infrasafe.uz' }],
        });
        wireDb(client);

        await expect(createAdmin({ ...VALID })).rejects.toThrow();
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(db.close).toHaveBeenCalledTimes(1);
    });

    test('a different admin already exists → error', async () => {
        const client = makeClient({
            selectAdmin: [{ user_id: 9, username: 'someoneelse', email: 'else@infrasafe.uz' }],
        });
        wireDb(client);

        await expect(createAdmin({ ...VALID })).rejects.toThrow(/admin already exists/i);
    });

    test('username taken by a non-admin user → error', async () => {
        const client = makeClient({
            selectAdmin: [],
            selectUsername: [{ user_id: 4, role: 'user' }],
        });
        wireDb(client);

        await expect(createAdmin({ ...VALID })).rejects.toThrow(/username/i);
    });

    test('email already in use → error', async () => {
        const client = makeClient({
            selectAdmin: [],
            selectUsername: [],
            selectEmail: [{ user_id: 5 }],
        });
        wireDb(client);

        await expect(createAdmin({ ...VALID })).rejects.toThrow(/email/i);
    });

    test('weak password fails fast WITHOUT opening a DB connection', async () => {
        const initSpy = jest.spyOn(db, 'init').mockResolvedValue();
        jest.spyOn(db, 'getPool').mockReturnValue({ connect: jest.fn() });

        await expect(createAdmin({ username: 'rootadmin', email: 'root@infrasafe.uz', password: 'weak' }))
            .rejects.toThrow();
        expect(initSpy).not.toHaveBeenCalled();
    });
});
