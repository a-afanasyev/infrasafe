// Admin-panel auth guard.
// Responsibilities:
//   1. On load, validate the current session against /api/auth/profile.
//      Authentication is via the HttpOnly access_token cookie that the
//      server set on /auth/login; the browser sends it automatically.
//   2. If the session is invalid/expired, redirect to /login.html — where
//      the full 2FA flow (verify-2fa, setup-2fa, confirm-2fa) lives.
//   3. Intercept window.fetch to apply CSRF tokens to mutating /api/* calls
//      and to force logout on the first 401 response. (Authorization header
//      is no longer injected — cookies handle that.)
//
// This file intentionally does NOT render a login form or speak the 2FA protocol.
// Duplicating that here historically caused the "different OTP" bug: POST /api/auth/login
// returned { requires2FASetup:true, tempToken:'...' } (no accessToken), and the old
// flow stored the literal string "undefined" as admin_token.
//
// [1A-FU-C-M1] Phase 2 of P1-2: localStorage cleanup. The class no
// longer reads or writes admin_token / refresh_token in localStorage;
// the HttpOnly cookie set by the server is the single source of truth.
// Any leftover localStorage entries from prior versions are cleared
// once on load to prevent confusion (no security gain, just hygiene).

class AdminAuth {
    constructor() {
        this.isAuthenticated = false;
        this.fetchIntercepted = false;
        // One-shot migration hygiene: scrub leftover legacy entries.
        try {
            localStorage.removeItem('admin_token');
            localStorage.removeItem('refresh_token');
        } catch (_) { /* private mode etc — non-fatal */ }
        this.init();
    }

    init() {
        // No client-side token state. Ask the server.
        this.validateToken();
    }

    async validateToken() {
        try {
            const response = await fetch('/api/auth/profile', {
                method: 'GET',
                credentials: 'same-origin'   // [1A-FU-C-M1] cookie carries auth
            });

            if (response.ok) {
                this.isAuthenticated = true;
                this.showAdminPanel();
                this.setupAuthHeaders();
                this.setupChangePassword();
                window.dispatchEvent(new CustomEvent('admin-auth-ready'));
            } else {
                this.logout();
            }
        } catch (error) {
            console.error('Ошибка валидации токена:', error);
            this.logout();
        }
    }

    logout() {
        // [P1-V1 / 1A-FU-C-M1] Best-effort server-side blacklist + cookie clear.
        // No localStorage to clean — cookies are the only token store now.
        // We don't await; network failures must not block the redirect.
        // _originalFetch skips the 401-intercept self-recursion that the
        // patched window.fetch would trigger.
        const fetchFn = window._originalFetch || window.fetch;
        try {
            fetchFn.call(window, '/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                keepalive: true
            }).catch(() => { /* network failure must not block redirect */ });
        } catch (_) { /* eslint-disable-line no-unused-vars */ }

        this.isAuthenticated = false;
        this.restoreFetch();
        this.redirectToLogin();
    }

    redirectToLogin() {
        // Hard-coded destination — no query-param parsing, no open-redirect risk.
        window.location.replace('/login.html');
    }

    restoreFetch() {
        if (window._originalFetch) {
            window.fetch = window._originalFetch;
        }
        this.fetchIntercepted = false;
    }

    setupAuthHeaders() {
        // [1A-FU-C-M1] Renamed for clarity but kept the symbol — admin.js
        // doesn't call it directly. The interceptor no longer injects
        // Authorization headers (the browser-set cookie handles that
        // automatically). It still:
        //   • applies CSRF tokens to mutating /api/* requests
        //   • forces logout on the first 401 from /api/*
        //   • ensures `credentials: 'same-origin'` is set so the cookie
        //     reaches the server even on calls that started without it
        if (this.fetchIntercepted) {
            // [1A-FU2-C-L4] Silently ignore double-init — the flag check
            // already covers correctness. Previous console.warn fired in
            // SPA-style page transitions and added noise.
            return;
        }

        if (!window._originalFetch) {
            window._originalFetch = window.fetch;
        }

        const originalFetch = window._originalFetch;
        const self = this;

        window.fetch = function(url, options = {}) {
            if (!options.headers) {
                options.headers = {};
            }

            const isApiRequest = typeof url === 'string' &&
                                 (url.startsWith('/api/') || url.includes('/api/'));

            // Ensure credentials are included on every /api/* call so the
            // HttpOnly cookie reaches the server. Default is 'same-origin'
            // which works for same-host requests; we set it explicitly to
            // survive callers that pass `credentials: 'omit'` accidentally.
            if (isApiRequest && !options.credentials) {
                options.credentials = 'same-origin';
            }

            const method = (options.method || 'GET').toUpperCase();
            // [1A-FU2-C-M1] Explicit failure mode for missing csrfProtection.
            // Earlier code used `window.csrfProtection?.` which silently
            // omitted the CSRF header if the module hadn't loaded — a load-
            // order regression would make CSRF a no-op without any signal.
            // For API-modifying requests we now require csrfProtection to be
            // present; if it is missing we log loudly and refuse to send.
            const csrfApi = window.csrfProtection;
            const isModifying = csrfApi
                ? csrfApi.isModifyingMethod(method)
                : ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
            if (isApiRequest && isModifying) {
                if (!csrfApi) {
                    console.error('[CSRF] window.csrfProtection not loaded — refusing to send modifying API request', { method, url });
                    return Promise.reject(new Error('CSRF protection module not loaded'));
                }
                const updatedOptions = csrfApi.addToHeaders(options);
                options.headers = { ...options.headers, ...updatedOptions.headers };
            }

            return originalFetch.call(this, url, options).then(response => {
                if (response.status === 401 && isApiRequest) {
                    self.logout();
                }
                return response;
            });
        };

        this.fetchIntercepted = true;
        // [1A-FU2-C-L4] Removed per-load `console.log` confirmation —
        // it fired on every admin panel page load in production. The
        // `fetchIntercepted` flag and the visible CSRF behavior are
        // sufficient evidence of success. The `console.error` paths
        // above remain — they fire only on actual failures.
    }

    showAdminPanel() {
        const adminContent = document.querySelector('.admin-container');
        if (adminContent) {
            adminContent.style.display = 'block';
        }
        this.injectLogoutStyles();
        this.addLogoutButton();
    }

    addLogoutButton() {
        if (document.getElementById('logout-btn')) return;

        const logoutHTML = `
            <button id="logout-btn" class="logout-btn" title="Выйти из админки">
                🚪 Выйти
            </button>
        `;
        const header = document.querySelector('.admin-header');
        if (header) {
            header.insertAdjacentHTML('beforeend', logoutHTML);
            document.getElementById('logout-btn').addEventListener('click', () => {
                if (confirm('Вы действительно хотите выйти?')) {
                    this.logout();
                }
            });
        }
    }

    setupChangePassword() {
        const btn = document.getElementById('btn-change-password');
        const modal = document.getElementById('change-password-modal');
        if (!btn || !modal) return;

        const form = document.getElementById('change-password-form');
        const current = document.getElementById('cp-current');
        const newPwd = document.getElementById('cp-new');
        const confirm = document.getElementById('cp-confirm');
        const submit = document.getElementById('cp-submit');
        const cancel = document.getElementById('cp-cancel');
        const toggle = document.getElementById('cp-toggle-visibility');
        const currentError = document.getElementById('cp-current-error');
        const confirmError = document.getElementById('cp-confirm-error');
        const serverError = document.getElementById('cp-server-error');
        const successBanner = document.getElementById('cp-success-banner');
        const actionsBlock = form.querySelector('.modal-actions');
        const rules = {
            length: form.querySelector('li[data-rule="length"]'),
            lower:  form.querySelector('li[data-rule="lower"]'),
            upper:  form.querySelector('li[data-rule="upper"]'),
            digit:  form.querySelector('li[data-rule="digit"]')
        };

        const setRule = (el, met) => {
            el.classList.toggle('rule-met', met);
            el.classList.toggle('rule-missing', !met);
        };

        const showError = (el, message) => {
            el.textContent = message;
            el.hidden = false;
        };
        const hideError = (el) => {
            el.textContent = '';
            el.hidden = true;
        };

        const validateLive = () => {
            const v = newPwd.value;
            const lengthOk = v.length >= 8;
            const lowerOk  = /[a-z]/.test(v);
            const upperOk  = /[A-Z]/.test(v);
            const digitOk  = /\d/.test(v);
            setRule(rules.length, lengthOk);
            setRule(rules.lower,  lowerOk);
            setRule(rules.upper,  upperOk);
            setRule(rules.digit,  digitOk);

            const allRulesMet = lengthOk && lowerOk && upperOk && digitOk;
            const filled = current.value && newPwd.value && confirm.value;
            const matches = newPwd.value === confirm.value;
            const different = newPwd.value !== current.value;

            if (filled && newPwd.value && !matches) {
                showError(confirmError, 'Пароли не совпадают');
            } else {
                hideError(confirmError);
            }

            submit.disabled = !(filled && allRulesMet && matches && different);
        };

        const reset = () => {
            form.reset();
            hideError(currentError);
            hideError(confirmError);
            hideError(serverError);
            successBanner.hidden = true;
            actionsBlock.hidden = false;
            submit.disabled = true;
            submit.textContent = 'Сменить пароль';
            Object.values(rules).forEach(el => setRule(el, false));
        };

        btn.addEventListener('click', () => {
            reset();
            modal.showModal();
            current.focus();
        });

        cancel.addEventListener('click', () => modal.close());

        toggle.addEventListener('click', () => {
            const isPwd = newPwd.type === 'password';
            newPwd.type = isPwd ? 'text' : 'password';
            toggle.textContent = isPwd ? '🙈' : '👁';
        });

        [current, newPwd, confirm].forEach(el => el.addEventListener('input', validateLive));

        const showSuccessAndLogout = () => {
            // Hide all transient inputs/errors, reveal the success banner, then logout.
            [current, newPwd, confirm].forEach(el => { el.disabled = true; });
            actionsBlock.hidden = true;
            hideError(currentError);
            hideError(confirmError);
            hideError(serverError);
            successBanner.hidden = false;
            setTimeout(() => this.logout(), 1500);
        };

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            submit.textContent = 'Меняем…';
            hideError(currentError);
            hideError(serverError);

            try {
                // [1A-FU-C-M1] Authorization header removed — the
                // intercepted fetch sets credentials: 'same-origin' so
                // the HttpOnly cookie reaches the server.
                const response = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        currentPassword: current.value,
                        newPassword: newPwd.value
                    }),
                    signal: AbortSignal.timeout(10000)
                });

                if (response.status === 200) {
                    showSuccessAndLogout();
                    return;
                }

                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
                    showError(serverError, `Слишком много попыток. Повторите через ${retryAfter} с.`);
                    submit.disabled = true;
                    setTimeout(() => {
                        submit.disabled = false;
                        submit.textContent = 'Сменить пароль';
                    }, retryAfter * 1000);
                    return;
                }

                let body;
                try { body = await response.json(); } catch { body = {}; }
                const message = body.error || body.message || 'Не удалось изменить пароль';

                if (response.status === 400 && /текущий|current/i.test(message)) {
                    showError(currentError, message);
                    current.value = '';
                    current.focus();
                } else if (response.status === 400) {
                    showError(serverError, message);
                } else if (response.status === 401) {
                    showError(serverError, 'Сессия истекла. Перенаправление…');
                } else {
                    showError(serverError, message);
                }
                submit.disabled = false;
                submit.textContent = 'Сменить пароль';
            } catch (error) {
                if (error.name === 'TimeoutError') {
                    showError(serverError, 'Превышено время ожидания');
                } else {
                    showError(serverError, 'Не удалось изменить пароль. Попробуйте ещё раз.');
                }
                submit.disabled = false;
                submit.textContent = 'Сменить пароль';
            }
        });
    }

    injectLogoutStyles() {
        if (document.getElementById('admin-auth-styles')) return;
        const styles = `
            <style id="admin-auth-styles">
                .logout-btn {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 0.5rem 1rem;
                    background: #dc3545;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    z-index: 1000;
                }
                .logout-btn:hover { background: #c82333; }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }

    // [1A-FU-C-M1] getToken() removed — no JS-readable token exists.
    // Any consumer that needs to call /api/* should simply make the
    // request; the HttpOnly cookie carries auth automatically.

    isAuthorized() {
        return this.isAuthenticated;
    }
}

window.adminAuth = new AdminAuth();
