const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const db = require('../config/database');
const { createError } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'your_very_secure_jwt_secret_key';
const SALT_ROUNDS = 10;

// Логин пользователя
const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            throw createError('Username and password are required', 400);
        }

        // Поиск пользователя в базе данных
        const userQuery = 'SELECT * FROM users WHERE username = $1';
        const userResult = await db.query(userQuery, [username]);

        if (userResult.rows.length === 0) {
            throw createError('Invalid credentials', 401);
        }

        const user = userResult.rows[0];

        // Проверка пароля
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            throw createError('Invalid credentials', 401);
        }

        // Создание JWT токена
        const token = jwt.sign(
            { 
                userId: user.user_id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        logger.info(`Успешный вход в систему: ${username}`);

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.user_id,
                username: user.username,
                role: user.role,
                created_at: user.created_at
            }
        });

    } catch (error) {
        next(error);
    }
};

// Регистрация нового пользователя
const register = async (req, res, next) => {
    try {
        const { username, password, role = 'user' } = req.body;

        if (!username || !password) {
            throw createError('Username and password are required', 400);
        }

        if (password.length < 6) {
            throw createError('Password must be at least 6 characters long', 400);
        }

        // Проверка что пользователь не существует
        const existingUserQuery = 'SELECT user_id FROM users WHERE username = $1';
        const existingUserResult = await db.query(existingUserQuery, [username]);

        if (existingUserResult.rows.length > 0) {
            throw createError('Username already exists', 409);
        }

        // Хеширование пароля
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Создание пользователя
        const insertQuery = `
            INSERT INTO users (username, password, role, created_at) 
            VALUES ($1, $2, $3, NOW()) 
            RETURNING user_id, username, role, created_at
        `;
        
        const result = await db.query(insertQuery, [username, passwordHash, role]);
        const newUser = result.rows[0];

        logger.info(`Новый пользователь зарегистрирован: ${username}`);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: {
                id: newUser.user_id,
                username: newUser.username,
                role: newUser.role,
                created_at: newUser.created_at
            }
        });

    } catch (error) {
        next(error);
    }
};

// Получение информации о текущем пользователе
const getProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const userQuery = 'SELECT user_id, username, role, created_at FROM users WHERE user_id = $1';
        const userResult = await db.query(userQuery, [userId]);

        if (userResult.rows.length === 0) {
            throw createError('User not found', 404);
        }

        const user = userResult.rows[0];

        res.json({
            success: true,
            user: {
                id: user.user_id,
                username: user.username,
                role: user.role,
                created_at: user.created_at
            }
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    login,
    register,
    getProfile
}; 