/**
 * Shared DB mock helper for tests that require server.js without a live database.
 * Sets up query pattern matching to simulate common DB responses.
 */
const bcrypt = require('bcrypt');

// Pre-computed hash for 'TestPass123'
let testPasswordHash;

const getTestPasswordHash = async () => {
    if (!testPasswordHash) {
        testPasswordHash = await bcrypt.hash('TestPass123', 10);
    }
    return testPasswordHash;
};

let buildingIdSeq = 100;
let controllerIdSeq = 200;

const makeUser = (overrides = {}) => ({
    user_id: 1,
    username: 'testuser',
    email: 'testuser@test.com',
    role: 'user',
    is_active: true,
    created_at: new Date().toISOString(),
    failed_login_attempts: 0,
    locked_until: null,
    ...overrides
});

const setupQueryMock = (db) => {
    // Track register calls to differentiate from login
    const registeredUsers = new Set();

    db.query.mockImplementation(async (sql, params) => {
        const s = typeof sql === 'string' ? sql : '';

        // Health check
        if (s === 'SELECT 1') {
            return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }

        // Token blacklist check — always return "not blacklisted"
        if (s.includes('token_blacklist')) {
            return { rows: [], rowCount: 0 };
        }

        // Find user by ID (JWT middleware verification)
        if (s.includes('FROM users') && s.includes('user_id = $1') && !s.includes('INSERT') && !s.includes('UPDATE')) {
            const hash = await getTestPasswordHash();
            return { rows: [makeUser({ user_id: params[0], password_hash: hash })], rowCount: 1 };
        }

        // Find user by username OR email (login/register check)
        if (s.includes('FROM users') && s.includes('username') && !s.includes('INSERT') && !s.includes('UPDATE')) {
            const login = params[0];
            const email = params[1];

            // If this is a register check (2 params, username != email), return empty for new users
            if (email && email !== login && !registeredUsers.has(login)) {
                return { rows: [], rowCount: 0 };
            }

            // Login flow: return user with password hash
            const hash = await getTestPasswordHash();
            return { rows: [makeUser({ username: login, password_hash: hash })], rowCount: 1 };
        }

        // INSERT user (register)
        if (s.includes('INSERT INTO users')) {
            const user = makeUser({
                user_id: 50 + registeredUsers.size,
                username: params[0],
                email: params[1],
                role: params[3] || 'user'
            });
            registeredUsers.add(params[0]);
            return { rows: [user], rowCount: 1 };
        }

        // Update failed_login_attempts
        if (s.includes('failed_login_attempts') || s.includes('UPDATE users')) {
            return { rows: [], rowCount: 0 };
        }

        // COUNT queries
        if (s.includes('COUNT(*)') || s.includes('count(*)')) {
            return { rows: [{ count: '0' }], rowCount: 1 };
        }

        // Buildings
        if (s.includes('buildings')) {
            if (s.includes('INSERT')) {
                return { rows: [{ building_id: buildingIdSeq++, name: params[0], address: params[1] }], rowCount: 1 };
            }
            if (s.includes('UPDATE') && s.includes('RETURNING')) {
                return { rows: [{ building_id: parseInt(params[params.length - 1]) || 1, name: params[0] }], rowCount: 1 };
            }
            if (s.includes('DELETE')) {
                return { rows: [{ building_id: parseInt(params[0]) }], rowCount: 1 };
            }
            if (params && params.length > 0 && s.includes('building_id')) {
                return { rows: [{ building_id: parseInt(params[0]), name: 'Test Building', address: 'Test Address', controllers: '[]' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        // Controllers
        if (s.includes('controllers')) {
            if (s.includes('INSERT')) {
                return { rows: [{ controller_id: controllerIdSeq++, serial_number: params[0], building_id: params[3] }], rowCount: 1 };
            }
            if (s.includes('serial_number')) {
                return { rows: [], rowCount: 0 }; // telemetry: controller not found
            }
            if (params && params.length > 0 && s.includes('controller_id')) {
                return { rows: [{ controller_id: parseInt(params[0]), serial_number: 'TEST-001' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        // Metrics
        if (s.includes('metrics')) {
            if (s.includes('INSERT')) {
                return { rows: [{ metric_id: 1 }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        // Alerts
        if (s.includes('alert')) {
            if (s.includes('INSERT')) {
                return { rows: [{ alert_id: 1, type: 'TEMPERATURE_HIGH', severity: 'WARNING', status: 'active', created_at: new Date().toISOString() }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        // Transformers / analytics
        if (s.includes('transformer')) {
            return { rows: [], rowCount: 0 };
        }

        // Default
        return { rows: [], rowCount: 0 };
    });
};

module.exports = { setupQueryMock, makeUser, getTestPasswordHash };
