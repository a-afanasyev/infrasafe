/**
 * SEC-16 — backup-database.sh must not carry hardcoded DB credentials.
 *
 * backup-database.sh is git-tracked. It previously hardcoded
 * DB_USER="postgres" / DB_PASSWORD="postgres", which (a) leaks a credential
 * into the repo and (b) is simply wrong for prod (the role is infrasafe_app).
 * These are content assertions (the file is bash, not JS-executable here),
 * matching the existing xss-protection.test.js precedent.
 */

const fs = require('fs');
const path = require('path');

describe('SEC-16 — backup-database.sh credential hygiene', () => {
    const scriptPath = path.join(__dirname, '../../../backup-database.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');

    test('script exists', () => {
        expect(fs.existsSync(scriptPath)).toBe(true);
    });

    test('does not hardcode postgres credentials', () => {
        expect(content).not.toMatch(/DB_PASSWORD="postgres"/);
        expect(content).not.toMatch(/DB_USER="postgres"/);
    });

    test('reads DB user/password from the environment with safe defaults', () => {
        expect(content).toMatch(/DB_USER="\$\{DB_USER:-/);
        expect(content).toMatch(/DB_PASSWORD="\$\{DB_PASSWORD:-/);
    });

    test('passes the password to pg_dump via PGPASSWORD env (not argv)', () => {
        expect(content).toMatch(/PGPASSWORD/);
    });
});
