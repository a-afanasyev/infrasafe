/**
 * [1A-FU-C-M3] + [1A-FU-C-L2] Contract tests for client login UX hardening.
 *
 * Pure functions inside an IIFE in public/login.js — direct unit testing
 * requires either exposing them on window or splitting them into a
 * shared module. We deliberately keep them in login.js (small surface,
 * no other consumer) and assert via file-content contracts instead.
 *
 * If a future refactor moves normalizeError() or removes the qrCodeUrl
 * validator, these tests fail loudly and the PR can decide whether
 * the removal was intentional + how to preserve the security property.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOGIN_JS = fs.readFileSync(
    path.resolve(__dirname, '../../../public/login.js'),
    'utf8'
);

describe('[1A-FU-C-M3] + [1A-FU2-S-M3] login.js validates qrCodeUrl before img.src', () => {
    test('qrCodeUrl assignment uses tight data:image/png;base64 prefix', () => {
        // Sprint 2 hardening: narrowed allowlist to ONLY the format that
        // totpService emits. Earlier wider check accepted any https://
        // URL — an attacker-controlled CDN could be rendered through img.src.
        expect(LOGIN_JS).toMatch(/data:image\/png;base64,/);
        // The previous broader 'https://' allowlist must NOT be present.
        expect(LOGIN_JS).not.toMatch(/startsWith\(\s*['"]https:\/\/['"]\)/);
    });

    test('qrCodeUrl length is capped to prevent giant data: URLs', () => {
        // 8KB cap — actual QR is ~1-2KB. Guards against DoS via huge
        // data: URLs in a compromised response.
        expect(LOGIN_JS).toMatch(/QR_MAX_LEN[\s\S]*?8\s*\*\s*1024/);
        expect(LOGIN_JS).toMatch(/qrUrl\.length\s*<=\s*QR_MAX_LEN/);
    });

    test('no direct img.src assignment of unvalidated data field exists', () => {
        // Guard against regression: `img.src = data.qrCodeUrl;`
        // without a prior validation step would slip through code review.
        // This regex catches the unguarded form specifically.
        const unguardedPattern = /qr-code-img[^;]*\.src\s*=\s*data\.qrCodeUrl/;
        expect(LOGIN_JS).not.toMatch(unguardedPattern);
    });

    test('failure path throws with a Russian-language user message', () => {
        // The validation throws → showError displays it. Message must
        // be the normalized Russian string (no English server vocab leak).
        expect(LOGIN_JS).toMatch(/Сервер вернул некорректный QR-код/);
    });
});

describe('[1A-FU-C-L2] login.js normalizes server error messages', () => {
    test('normalizeError function exists and is referenced from every showError call', () => {
        expect(LOGIN_JS).toMatch(/function normalizeError\s*\(/);
        // Every showError that displays a server-derived err.message
        // must route through normalizeError.
        const showErrorCalls = LOGIN_JS.match(/showError\([^)]+\)/g) || [];
        const directErrMessageLeaks = showErrorCalls.filter(call =>
            /\berr\.message\b/.test(call) && !/normalizeError/.test(call)
        );
        expect(directErrMessageLeaks).toEqual([]);
    });

    test('lockout pattern is mapped — prevents ISO-timestamp leak', () => {
        // The specific concern: server's
        //   `Аккаунт заблокирован до 2026-05-22T10:00:00.000Z`
        // leaks exactly when lockout ends. The pattern map must catch this.
        expect(LOGIN_JS).toMatch(/заблокирован[\s\S]*?match[\s\S]*?Аккаунт временно заблокирован/);
    });

    test('credential-error pattern collapses "user not found" into the generic message', () => {
        // Hiding "user not found" specifically — server-side enumeration
        // protection — by mapping it to the same string as wrong-password.
        expect(LOGIN_JS).toMatch(/user not found[\s\S]*?Неверный логин или пароль/i);
    });

    test('fallback strips ISO timestamps from unmatched messages', () => {
        // The fall-through path checks for `\d{4}-\d{2}-\d{2}` before
        // letting an unrecognized server message through.
        expect(LOGIN_JS).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
        // Generic fallback string is present.
        expect(LOGIN_JS).toMatch(/Не удалось войти\. Проверьте данные/);
    });

    test('fallback strips emails and IPs from unmatched messages', () => {
        // Defence-in-depth: even if the server leaks an internal IP or
        // email, normalizeError refuses to render it.
        expect(LOGIN_JS).toMatch(/\\b\\d\{1,3\}\(\?:\\\.\\d\{1,3\}\)\{3\}\\b/);  // IPv4
        expect(LOGIN_JS).toMatch(/\[\\w\.\+-\]\+@\[\\w-\]\+/);                  // email
    });
});
