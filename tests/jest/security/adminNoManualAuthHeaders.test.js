// [SEC-32] Guard against re-introducing dead manual auth on the admin page.
//
// The admin-page entrypoints used to send `Authorization: Bearer
// ${localStorage.getItem('admin_token'|'token')}` — always dead in the cookie-auth
// flow (real auth = HttpOnly cookie + the admin-auth.js fetch interceptor). These
// content-assertions fail if anyone re-adds a manual Authorization header or reads
// the dead token keys, and ensure admin-auth.js scrubs the stale 'token' key.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ENTRYPOINTS = [
    'public/admin.js',
    'public/admin-coordinate-editor.js',
    'public/infrastructure-line-editor.js',
];

describe('SEC-32 — no manual Authorization headers on admin-page entrypoints', () => {
    for (const file of ENTRYPOINTS) {
        describe(file, () => {
            const src = read(file);
            test('no manual Authorization header', () => {
                expect(src).not.toMatch(/Authorization/);
            });
            test('no Bearer token interpolation', () => {
                expect(src).not.toMatch(/Bearer /);
            });
            test('no reads of the dead token keys', () => {
                expect(src).not.toMatch(/getItem\(['"]admin_token['"]\)/);
                expect(src).not.toMatch(/getItem\(['"]token['"]\)/);
            });
        });
    }

    test('admin-auth.js scrubs the stale "token" localStorage key (SEC-32)', () => {
        const src = read('public/admin-auth.js');
        expect(src).toMatch(/localStorage\.removeItem\(['"]token['"]\)/);
    });
});
