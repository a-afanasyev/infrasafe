// [P1-3] Extracted from inline <script> in public/login.html so the
// production CSP can drop 'unsafe-inline' from script-src.
//
// LoginHandler drives the three-step login flow:
//   1. Username/password → /api/auth/login.
//      Response either: requires2FA → show TOTP form;
//                       requires2FASetup → fetch QR + show setup;
//                       plain → store tokens + redirect.
//   2. TOTP verify     → /api/auth/verify-2fa.
//   3. TOTP setup       → /api/auth/setup-2fa then /api/auth/confirm-2fa.

(function () {
    'use strict';

    // [1A-FU-C-L2] Normalize server error messages before displaying them.
    //
    // Raw server messages can leak internal state — e.g.
    //   "Аккаунт заблокирован до 2026-05-22T10:00:00.000Z"
    // tells an attacker exactly when their brute-force attempt locked
    // the account, which is useful for timing follow-up attacks.
    //
    // Map known patterns to short user-friendly strings; fall through
    // to the original message only if it's plausibly safe (≤80 chars,
    // no ISO timestamp, no email/IP-like substrings).
    const ERROR_PATTERNS = [
        // Auth — invalid credentials / account state
        { match: /Неверн|invalid (credentials|username|password)|user not found/i,
          message: 'Неверный логин или пароль' },
        { match: /заблокирован|locked|too many (attempts|requests)/i,
          message: 'Аккаунт временно заблокирован. Повторите позже.' },
        { match: /деактивирован|disabled|inactive/i,
          message: 'Аккаунт деактивирован. Обратитесь к администратору.' },

        // 2FA
        { match: /(invalid|incorrect|wrong)\s*(2fa|totp|code)|неверный (код|tot)/i,
          message: 'Неверный код 2FA' },
        { match: /token (expired|invalid)|истёк|истек/i,
          message: 'Сессия истекла. Войдите заново.' },

        // Generic / network
        { match: /network|timeout|fetch (failed|error)/i,
          message: 'Проблема с сетью. Попробуйте снова.' }
    ];

    function normalizeError(rawMessage) {
        const msg = String(rawMessage || '').trim();
        if (!msg) return 'Не удалось войти. Проверьте данные и попробуйте снова.';
        for (const pattern of ERROR_PATTERNS) {
            if (pattern.match.test(msg)) return pattern.message;
        }
        // Plausibly-safe fall-through: short and free of obvious
        // leak markers (timestamps, emails, IPs).
        const looksSafe =
            msg.length <= 80 &&
            !/\d{4}-\d{2}-\d{2}/.test(msg) &&   // ISO date
            !/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(msg) &&  // IPv4
            !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(msg);   // email
        return looksSafe ? msg : 'Не удалось войти. Проверьте данные и попробуйте снова.';
    }

    class LoginHandler {
        constructor() {
            this.tempToken = null;
            this.initializeForm();
            this.initializeTOTPForm();
            this.initializeSetupForm();
        }

        // --- Step 1: Login form ---
        initializeForm() {
            // [1A-FU2-C-L3] Defensive null-guard: this file is only loaded
            // on login.html, but a misloaded page (HTML/JS cache mismatch,
            // partial deploy, etc.) could ship the JS without the form.
            // Guard so a missing element doesn't blow up the rest of init.
            const form = document.getElementById('login-form');
            const usernameInput = document.getElementById('username');
            if (!form || !usernameInput) return;
            usernameInput.focus();

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('username').value.trim();
                // [1A-FU2-C-H1] Do NOT trim password — bcrypt compare is exact;
                // trimming silently rejects valid passwords with leading/trailing
                // whitespace (uncommon but possible).
                const password = document.getElementById('password').value;
                if (!username || !password) { this.showError('error-container', 'Заполните все поля'); return; }

                this.setLoading('login-button', 'loading', true);
                this.clearAll();

                try {
                    const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, password })
                    });
                    const data = await res.json();

                    if (!res.ok) throw new Error(data.message || data.error || 'Ошибка авторизации');

                    if (data.requires2FA) {
                        // 2FA enabled — show code input
                        this.tempToken = data.tempToken;
                        this.showStep('totp-form');
                        document.getElementById('totp-code').focus();
                    } else if (data.requires2FASetup) {
                        // Admin needs 2FA setup — fetch QR
                        this.tempToken = data.tempToken;
                        await this.loadSetup();
                    } else {
                        // No 2FA — direct login
                        this.completeLogin(data);
                    }
                } catch (err) {
                    this.showError('error-container', normalizeError(err.message));
                } finally {
                    this.setLoading('login-button', 'loading', false);
                }
            });

            document.getElementById('back-to-login').addEventListener('click', (e) => {
                e.preventDefault();
                this.tempToken = null;
                this.showStep('login-form');
                document.getElementById('username').focus();
            });
        }

        // --- Step 2: TOTP verification ---
        initializeTOTPForm() {
            // [1A-FU2-C-L3] Null-guard — see initializeForm.
            const totpForm = document.getElementById('totp-form');
            if (!totpForm) return;
            totpForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const code = document.getElementById('totp-code').value.trim();
                if (!code) { this.showError('totp-error-container', 'Введите код'); return; }

                this.setLoading('totp-button', 'totp-loading', true);
                this.clearAll();

                try {
                    const res = await fetch('/api/auth/verify-2fa', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tempToken: this.tempToken, code })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || data.error || 'Неверный код');
                    this.completeLogin(data);
                } catch (err) {
                    this.showError('totp-error-container', normalizeError(err.message));
                    document.getElementById('totp-code').value = '';
                    document.getElementById('totp-code').focus();
                } finally {
                    this.setLoading('totp-button', 'totp-loading', false);
                }
            });
        }

        // --- Step 2b: 2FA setup ---
        async loadSetup() {
            try {
                const res = await fetch('/api/auth/setup-2fa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tempToken: this.tempToken })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || data.error || 'Ошибка настройки 2FA');

                // [1A-FU-C-M3] + [1A-FU2-S-M3] Defence-in-depth: validate
                // qrCodeUrl scheme + length before assigning to img.src.
                // The totpService produces exactly `data:image/png;base64,<...>`
                // (see src/services/totpService.js QRCode.toDataURL). Anything
                // else is either a server regression or an injection attempt —
                // refuse to render. The earlier wider allowlist (any https://)
                // could route an attacker-controlled CDN URL through img.src;
                // tightened to PNG data URI only.
                const qrUrl = String(data.qrCodeUrl || '');
                const QR_PREFIX = 'data:image/png;base64,';
                const QR_MAX_LEN = 8 * 1024; // 8KB — actual QR is ~1-2KB
                const qrOk = qrUrl.startsWith(QR_PREFIX) && qrUrl.length <= QR_MAX_LEN;
                if (!qrOk) {
                    throw new Error('Сервер вернул некорректный QR-код');
                }
                document.getElementById('qr-code-img').src = qrUrl;
                document.getElementById('totp-secret-display').textContent = data.secret;
                document.getElementById('recovery-codes-display').textContent = data.recoveryCodes.join('\n');
                this.showStep('totp-setup');
                document.getElementById('confirm-code').focus();
            } catch (err) {
                this.showError('error-container', normalizeError(err.message));
            }
        }

        initializeSetupForm() {
            // [1A-FU2-C-L3] Null-guard — see initializeForm.
            const setupForm = document.getElementById('confirm-totp-form');
            if (!setupForm) return;
            setupForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const code = document.getElementById('confirm-code').value.trim();
                if (!code) { this.showError('setup-error-container', 'Введите код'); return; }

                document.getElementById('confirm-button').disabled = true;

                try {
                    const res = await fetch('/api/auth/confirm-2fa', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tempToken: this.tempToken, code })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || data.error || 'Неверный код');
                    this.completeLogin(data);
                } catch (err) {
                    this.showError('setup-error-container', normalizeError(err.message));
                    document.getElementById('confirm-code').value = '';
                    document.getElementById('confirm-code').focus();
                } finally {
                    document.getElementById('confirm-button').disabled = false;
                }
            });
        }

        // --- Helpers ---
        // [1A-FU-C-M1] Phase 2 — no more localStorage.setItem on the access
        // token. The server's Set-Cookie response on /auth/login (and the
        // 2FA endpoints) installs HttpOnly+Secure+SameSite=Strict cookies
        // that the browser sends automatically on subsequent requests.
        // Storing the token in localStorage was the XSS hole that P1-2
        // was supposed to close — Phase 1 left it in for transitional
        // backward-compat; this PR finishes the job.
        completeLogin(data) {
            // [1A-FU2-C-H2] Cookie-first invariant: by the time this body has
            // arrived, the server has already issued Set-Cookie. The presence
            // of `accessToken`/`token` in the body is a transitional artefact
            // (kept for legacy clients) — its absence does NOT mean login
            // failed. The /admin.html load-time profile probe is the source
            // of truth for "are we logged in". Do NOT throw on missing body
            // token, do NOT touch localStorage.
            this.showSuccess('success-container', 'Вход выполнен! Перенаправление...');
            setTimeout(() => { window.location.href = '/admin.html'; }, 1000);
        }

        showStep(stepId) {
            ['login-form', 'totp-form', 'totp-setup'].forEach(id => {
                document.getElementById(id).style.display = id === stepId ? 'block' : 'none';
            });
        }

        setLoading(btnId, loadingId, on) {
            document.getElementById(btnId).disabled = on;
            document.getElementById(loadingId).style.display = on ? 'block' : 'none';
        }

        showError(containerId, message) {
            const c = document.getElementById(containerId);
            c.textContent = '';
            const div = document.createElement('div');
            div.className = 'error-message';
            div.textContent = message;
            c.appendChild(div);
        }

        showSuccess(containerId, message) {
            const c = document.getElementById(containerId);
            c.textContent = '';
            const div = document.createElement('div');
            div.className = 'success-message';
            div.textContent = message;
            c.appendChild(div);
        }

        clearAll() {
            ['error-container', 'success-container', 'totp-error-container', 'totp-success-container', 'setup-error-container'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '';
            });
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        // [AUD-032] removed the flip-trace debug instrumentation (closed
        // 2026-05-27 hotfix incident). If already authenticated, skip the form.
        try {
            const res = await fetch('/api/auth/profile', {
                method: 'GET',
                credentials: 'same-origin'   // browser must send the cookie
            });
            if (res.ok) {
                window.location.href = '/admin.html';
                return;
            }
        } catch (_e) {
            // No valid session probe — fall through to render the login form.
        }
        new LoginHandler();
    });
}());
