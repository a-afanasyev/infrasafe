// Система авторизации для админки
class AdminAuth {
    constructor() {
        this.token = localStorage.getItem('admin_token');
        this.isAuthenticated = false;
        this.init();
    }

    init() {
        if (this.token) {
            this.validateToken();
        } else {
            this.showLoginForm();
        }
    }

    async validateToken() {
        try {
            const response = await fetch('/api/auth/profile', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const userData = await response.json();
                this.isAuthenticated = true;
                this.hideLoginForm();
                this.showAdminPanel();
                this.setupAuthHeaders();
            } else {
                this.logout();
            }
        } catch (error) {
            console.error('Ошибка валидации токена:', error);
            this.logout();
        }
    }

    async login(username, password) {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const data = await response.json();
                this.token = data.accessToken || data.token;
                localStorage.setItem('admin_token', this.token);
                this.isAuthenticated = true;
                this.hideLoginForm();
                this.showAdminPanel();
                this.setupAuthHeaders();
                return true;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка авторизации');
            }
        } catch (error) {
            console.error('Ошибка входа:', error);
            this.showError(error.message);
            return false;
        }
    }

    logout() {
        this.token = null;
        this.isAuthenticated = false;
        localStorage.removeItem('admin_token');
        this.showLoginForm();
        this.hideAdminPanel();
    }

    setupAuthHeaders() {
        // Перехватываем все fetch запросы и добавляем авторизацию
        const originalFetch = window.fetch;
        const self = this;
        window.fetch = (url, options = {}) => {
            // Добавляем авторизацию для всех API запросов
            if (self.token && (url.startsWith('/api/') || url.startsWith('http://localhost:3000/api/') || url.startsWith('http://localhost:8080/api/'))) {
                options.headers = {
                    ...options.headers,
                    'Authorization': `Bearer ${self.token}`
                };
            }

            // Перенаправляем запросы с 8080 на 3000 для API
            if (url.startsWith('http://localhost:8080/api/')) {
                url = url.replace('http://localhost:8080/api/', 'http://localhost:3000/api/');
            } else if (url.startsWith('/api/')) {
                url = 'http://localhost:3000' + url;
            }

            return originalFetch(url, options).then(response => {
                if (response.status === 401) {
                    self.logout();
                }
                return response;
            });
        };
    }

    showLoginForm() {
        const loginHTML = `
            <div id="admin-login" class="login-overlay">
                <div class="login-form">
                    <h2>🔐 Вход в админку InfraSafe</h2>
                    <form id="login-form">
                        <div class="form-group">
                            <label for="username">Логин:</label>
                            <input type="text" id="username" name="username" required
                                   placeholder="admin" autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label for="password">Пароль:</label>
                            <input type="password" id="password" name="password" required
                                   placeholder="••••••••" autocomplete="current-password">
                        </div>
                        <div class="form-group">
                            <button type="submit" class="login-btn">Войти</button>
                        </div>
                        <div id="login-error" class="error-message" style="display: none;"></div>
                    </form>
                    <div class="login-info">
                        <p><strong>Тестовые данные:</strong></p>
                        <p>Логин: <code>admin</code></p>
                        <p>Пароль: <code>Admin123</code></p>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('admin-login')) {
            document.body.insertAdjacentHTML('beforeend', loginHTML);
        }

        // Добавляем стили
        this.addLoginStyles();

        // Обработчик формы входа
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            const loginBtn = document.querySelector('.login-btn');
            loginBtn.disabled = true;
            loginBtn.textContent = 'Вход...';

            await this.login(username, password);

            loginBtn.disabled = false;
            loginBtn.textContent = 'Войти';
        });
    }

    hideLoginForm() {
        const loginElement = document.getElementById('admin-login');
        if (loginElement) {
            loginElement.remove();
        }
    }

    showAdminPanel() {
        const adminContent = document.querySelector('.admin-container');
        if (adminContent) {
            adminContent.style.display = 'block';
        }

        // Добавляем кнопку выхода
        this.addLogoutButton();
    }

    hideAdminPanel() {
        const adminContent = document.querySelector('.admin-container');
        if (adminContent) {
            adminContent.style.display = 'none';
        }
    }

    addLogoutButton() {
        if (!document.getElementById('logout-btn')) {
            const logoutHTML = `
                <button id="logout-btn" class="logout-btn" title="Выйти из админки">
                    🚪 Выйти
                </button>
            `;
            document.querySelector('.admin-header').insertAdjacentHTML('beforeend', logoutHTML);

            document.getElementById('logout-btn').addEventListener('click', () => {
                if (confirm('Вы действительно хотите выйти?')) {
                    this.logout();
                }
            });
        }
    }

    showError(message) {
        const errorElement = document.getElementById('login-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
            setTimeout(() => {
                errorElement.style.display = 'none';
            }, 5000);
        }
    }

    addLoginStyles() {
        if (!document.getElementById('login-styles')) {
            const styles = `
                <style id="login-styles">
                    .login-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.8);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 10000;
                    }

                    .login-form {
                        background: white;
                        padding: 2rem;
                        border-radius: 12px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                        max-width: 400px;
                        width: 90%;
                    }

                    .login-form h2 {
                        text-align: center;
                        margin-bottom: 1.5rem;
                        color: #333;
                        font-size: 1.5rem;
                    }

                    .form-group {
                        margin-bottom: 1rem;
                    }

                    .form-group label {
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 600;
                        color: #555;
                    }

                    .form-group input {
                        width: 100%;
                        padding: 0.75rem;
                        border: 2px solid #ddd;
                        border-radius: 6px;
                        font-size: 1rem;
                        transition: border-color 0.3s;
                    }

                    .form-group input:focus {
                        outline: none;
                        border-color: #007bff;
                    }

                    .login-btn {
                        width: 100%;
                        padding: 0.75rem;
                        background: #007bff;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: background 0.3s;
                    }

                    .login-btn:hover {
                        background: #0056b3;
                    }

                    .login-btn:disabled {
                        background: #ccc;
                        cursor: not-allowed;
                    }

                    .error-message {
                        color: #dc3545;
                        background: #f8d7da;
                        padding: 0.5rem;
                        border-radius: 4px;
                        margin-top: 1rem;
                        text-align: center;
                    }

                    .login-info {
                        margin-top: 1.5rem;
                        padding: 1rem;
                        background: #f8f9fa;
                        border-radius: 6px;
                        font-size: 0.9rem;
                    }

                    .login-info code {
                        background: #e9ecef;
                        padding: 0.2rem 0.4rem;
                        border-radius: 3px;
                        font-family: monospace;
                    }

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

                    .logout-btn:hover {
                        background: #c82333;
                    }

                    .admin-container {
                        display: none;
                    }
                </style>
            `;
            document.head.insertAdjacentHTML('beforeend', styles);
        }
    }

    // Метод для получения токена (для использования в других скриптах)
    getToken() {
        return this.token;
    }

    // Проверка авторизации
    isAuthorized() {
        return this.isAuthenticated;
    }
}

// Создаем глобальный экземпляр
window.adminAuth = new AdminAuth();