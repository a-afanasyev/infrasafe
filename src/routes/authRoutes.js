const express = require('express');
const authController = require('../controllers/authController');
const { authenticateRefresh, authenticateTempToken } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimiter');
const router = express.Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Авторизация пользователя
 *     description: Авторизует пользователя и возвращает JWT токен
 *     security: [] # Без авторизации
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Имя пользователя
 *               password:
 *                 type: string
 *                 description: Пароль пользователя
 *     responses:
 *       200:
 *         description: Успешная авторизация
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *                   description: JWT токен
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     role:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Неверные учетные данные
 *       400:
 *         description: Отсутствуют обязательные поля
 */
router.post('/login', authLimiter.middleware(), authController.login);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Регистрация нового пользователя
 *     description: Создает нового пользователя в системе
 *     security: [] # Без авторизации
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Имя пользователя (уникальное)
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 description: Пароль (минимум 6 символов)
 *               email:
 *                 type: string
 *                 description: Email пользователя
 *     responses:
 *       201:
 *         description: Пользователь успешно зарегистрирован
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     role:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Ошибка валидации данных
 *       409:
 *         description: Пользователь уже существует
 */
router.post('/register', registerLimiter.middleware(), authController.register);

/**
 * @swagger
 * /auth/profile:
 *   get:
 *     summary: Получить профиль текущего пользователя
 *     description: Возвращает информацию о текущем авторизованном пользователе
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Информация о пользователе
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     role:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 *       404:
 *         description: Пользователь не найден
 */
router.get('/profile', authController.getProfile);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Выход из системы
 *     description: Выход из системы с добавлением токена в черный список
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Успешный выход из системы
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Обновление токенов
 *     description: Обновляет access и refresh токены
 *     security: [] # Без авторизации (используется refresh токен)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh токен для обновления
 *     responses:
 *       200:
 *         description: Токены успешно обновлены
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 accessToken:
 *                   type: string
 *                   description: Новый access токен
 *                 refreshToken:
 *                   type: string
 *                   description: Новый refresh токен
 *       401:
 *         description: Недействительный refresh токен
 *       400:
 *         description: Отсутствует refresh токен
 */
router.post('/refresh', authLimiter.middleware(), authenticateRefresh, authController.refreshToken);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Смена пароля
 *     description: Смена пароля для текущего пользователя
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 description: Текущий пароль
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: Новый пароль (минимум 8 символов, должен содержать буквы и цифры)
 *     responses:
 *       200:
 *         description: Пароль успешно изменен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Неверный текущий пароль или отсутствует токен авторизации
 *       400:
 *         description: Недостаточно сложный новый пароль
 *       403:
 *         description: Недействительный токен
 */
router.post('/change-password', authController.changePassword);

// 2FA routes (public — use tempToken for auth, rate limited)
router.post('/verify-2fa', authLimiter.middleware(), authenticateTempToken, authController.verify2FA);
router.post('/setup-2fa', authLimiter.middleware(), authenticateTempToken, authController.setup2FA);
router.post('/confirm-2fa', authLimiter.middleware(), authenticateTempToken, authController.confirm2FA);

// Disable 2FA (requires full JWT auth + password confirmation)
router.post('/disable-2fa', authLimiter.middleware(), authController.disable2FA);

module.exports = router;