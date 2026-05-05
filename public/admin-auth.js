// Admin-panel auth guard.
// Responsibilities:
//   1. On load, validate the JWT from localStorage against /api/auth/profile.
//   2. If there is no token, or the token is invalid/expired, redirect to /login.html —
//      where the full 2FA flow (verify-2fa, setup-2fa, confirm-2fa) lives.
//   3. Intercept window.fetch to attach Authorization: Bearer <token> to /api/* calls
//      and to force logout on the first 401 response.
//
// This file intentionally does NOT render a login form or speak the 2FA protocol.
// Duplicating that here historically caused the "different OTP" bug: POST /api/auth/login
// returned { requires2FASetup:true, tempToken:'...' } (no accessToken), and the old
// flow stored the literal string "undefined" as admin_token.

class AdminAuth {
    constructor() {
        this.token = localStorage.getItem('admin_token');
        this.isAuthenticated = false;
        this.fetchIntercepted = false;
        this.init();
    }

    init() {
        if (this.token && this.token !== 'undefined' && this.token !== 'null') {
            this.validateToken();
        } else {
            this.redirectToLogin();
        }
    }

    async validateToken() {
        try {
            const response = await fetch('/api/auth/profile', {
                headers: { 'Authorization': `Bearer ${this.token}` }
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
        this.token = null;
        this.isAuthenticated = false;
        localStorage.removeItem('admin_token');
        localStorage.removeItem('refresh_token');
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
        if (this.fetchIntercepted) {
            console.warn('Fetch уже перехвачен, пропускаем повторную установку');
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

            if (self.token && isApiRequest) {
                options.headers['Authorization'] = `Bearer ${self.token}`;
            }

            const method = (options.method || 'GET').toUpperCase();
            if (window.csrfProtection && window.csrfProtection.isModifyingMethod(method)) {
                const updatedOptions = window.csrfProtection.addToHeaders(options);
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
        console.log('✅ Fetch перехвачен для авторизации');
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
                const response = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + this.token
                    },
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

    getToken() {
        return this.token;
    }

    isAuthorized() {
        return this.isAuthenticated;
    }
}

window.adminAuth = new AdminAuth();
