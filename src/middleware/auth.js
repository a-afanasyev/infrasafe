const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Проверка JWT токена
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: 'Access token is missing' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_SECRET || 'your_very_secure_jwt_secret_key', (err, user) => {
        if (err) {
            logger.warn(`Неудачная попытка аутентификации: ${err.message}`);
            return res.status(403).json({ message: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    });
};

// Проверка наличия прав администратора
const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        logger.warn(`Попытка доступа к админ-ресурсу без достаточных прав: ${req.originalUrl}`);
        return res.status(403).json({ message: 'Requires admin privileges' });
    }
    next();
};

module.exports = {
    authenticateJWT,
    isAdmin
}; 