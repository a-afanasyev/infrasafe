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

    class LoginHandler {
        constructor() {
            this.tempToken = null;
            this.initializeForm();
            this.initializeTOTPForm();
            this.initializeSetupForm();
        }

        // --- Step 1: Login form ---
        initializeForm() {
            const form = document.getElementById('login-form');
            document.getElementById('username').focus();

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value.trim();
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
                    this.showError('error-container', err.message);
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
            document.getElementById('totp-form').addEventListener('submit', async (e) => {
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
                    this.showError('totp-error-container', err.message);
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

                document.getElementById('qr-code-img').src = data.qrCodeUrl;
                document.getElementById('totp-secret-display').textContent = data.secret;
                document.getElementById('recovery-codes-display').textContent = data.recoveryCodes.join('\n');
                this.showStep('totp-setup');
                document.getElementById('confirm-code').focus();
            } catch (err) {
                this.showError('error-container', err.message);
            }
        }

        initializeSetupForm() {
            document.getElementById('confirm-totp-form').addEventListener('submit', async (e) => {
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
                    this.showError('setup-error-container', err.message);
                    document.getElementById('confirm-code').value = '';
                    document.getElementById('confirm-code').focus();
                } finally {
                    document.getElementById('confirm-button').disabled = false;
                }
            });
        }

        // --- Helpers ---
        completeLogin(data) {
            const token = data.accessToken || data.token;
            if (!token) throw new Error('Токен не получен');
            localStorage.setItem('admin_token', token);
            if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
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

    document.addEventListener('DOMContentLoaded', () => {
        const existingToken = localStorage.getItem('admin_token');
        if (existingToken) { window.location.href = '/admin.html'; return; }
        new LoginHandler();
    });
}());
