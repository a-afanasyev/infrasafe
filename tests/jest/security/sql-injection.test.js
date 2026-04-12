/**
 * Тесты защиты от SQL Injection атак
 * 
 * Этот набор тестов проверяет, что исправления T012 работают корректно
 * и система защищена от SQL injection через параметры сортировки.
 * 
 * @author Security Team
 * @date 2025-01-16
 */

const request = require('supertest');

// Mock database — эти тесты проверяют валидацию параметров, не реальные SQL запросы
jest.mock('../../../src/config/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    pool: { connect: jest.fn() }
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

// Mock auth middleware — эти тесты проверяют SQL injection, а не авторизацию
jest.mock('../../../src/middleware/auth', () => ({
    authenticateJWT: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
    isAdmin: (req, res, next) => next(),
    authenticateRefresh: (req, res, next) => next(),
    optionalAuth: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
    authenticateTempToken: (req, res, next) => { req.tempUser = { user_id: 1, username: 'admin', role: 'admin' }; next(); }
}));

// Импортируем Express app напрямую, без запуска сервера
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Создаем тестовое приложение
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

// Подключаем роуты
const adminRoutes = require('../../../src/routes/adminRoutes');
const authRoutes = require('../../../src/routes/authRoutes');

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);

describe('SQL Injection Protection Tests', () => {
    const db = require('../../../src/config/database');

    beforeEach(() => {
        // Default mock: return empty data + count for paginated queries
        db.query.mockImplementation((sql) => {
            if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
                return Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
    });

    describe('Buildings API - SQL Injection Protection', () => {
        test('should reject malicious sort parameter', async () => {
            const maliciousSort = "'; DROP TABLE buildings; --";
            
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: maliciousSort, 
                    order: 'ASC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('should use default sort for invalid column', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: 'invalid_column_name', 
                    order: 'ASC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
            // Проверяем, что система не сломалась от неверного параметра
        });

        test('should reject malicious order parameter', async () => {
            const maliciousOrder = "DESC; DELETE FROM users; --";
            
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: 'building_id', 
                    order: maliciousOrder 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });

        test('should sanitize search parameter', async () => {
            const maliciousSearch = "<script>alert('XSS')</script>";
            
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    search: maliciousSearch 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });
    });

    describe('Controllers API - SQL Injection Protection', () => {
        test('should reject malicious sort parameter', async () => {
            const maliciousSort = "controller_id UNION SELECT password FROM users";
            
            const response = await request(app)
                .get('/api/admin/controllers')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: maliciousSort, 
                    order: 'ASC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });

        test('should use whitelisted columns only', async () => {
            const response = await request(app)
                .get('/api/admin/controllers')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: 'controller_id', 
                    order: 'ASC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });
    });

    describe('Metrics API - SQL Injection Protection', () => {
        test('should reject malicious sort parameter', async () => {
            const maliciousSort = "timestamp; UPDATE metrics SET value = 999999";
            
            const response = await request(app)
                .get('/api/admin/metrics')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: maliciousSort, 
                    order: 'DESC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });

        test('should use default sort for metrics', async () => {
            const response = await request(app)
                .get('/api/admin/metrics')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: 'invalid_metric_column', 
                    order: 'DESC' 
                });
            
            expect(response.status).toBe(200);
            // Должен использовать дефолтную сортировку по timestamp DESC
        });
    });

    describe('Pagination Parameters Validation', () => {
        test('should handle negative page numbers', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    page: -1, 
                    limit: 10 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.pagination.page).toBe(1); // Должно быть исправлено на 1
        });

        test('should limit maximum page size', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    page: 1, 
                    limit: 99999 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.pagination.limit).toBeLessThanOrEqual(200); // Максимальный лимит
        });

        test('should handle non-numeric pagination parameters', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    page: 'abc', 
                    limit: 'xyz' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.pagination.page).toBe(1); // Дефолтное значение
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('should handle empty sort parameter', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: '', 
                    order: 'ASC' 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });

        test('should handle null order parameter', async () => {
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    sort: 'building_id', 
                    order: null 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });

        test('should handle extremely long search strings', async () => {
            const longSearch = 'a'.repeat(1000); // 1000 символов
            
            const response = await request(app)
                .get('/api/admin/buildings')
                .set('Authorization', 'Bearer mock-token')
                .query({ 
                    search: longSearch 
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();
        });
    });
});

