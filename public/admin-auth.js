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
