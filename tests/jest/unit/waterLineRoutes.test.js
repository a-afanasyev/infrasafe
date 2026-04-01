'use strict';

jest.mock('../../../src/models/WaterLine', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findSuppliersForLine: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/middleware/rateLimiter', () => {
    const passThroughMiddleware = (req, res, next) => next();
    return {
        applyCrudRateLimit: [passThroughMiddleware],
        SimpleRateLimiter: jest.fn().mockImplementation(() => ({
            middleware: () => passThroughMiddleware,
            destroy: jest.fn()
        }))
    };
});

const request = require('supertest');
const express = require('express');
const WaterLine = require('../../../src/models/WaterLine');
const waterLineRoutes = require('../../../src/routes/waterLineRoutes');

describe('waterLineRoutes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use('/api/water-lines', waterLineRoutes);
        // Error handler
        app.use((err, req, res, _next) => {
            const status = err.statusCode || 500;
            res.status(status).json({ message: err.message });
        });
    });

    // -------------------------------------------------------------------------
    // GET /
    // -------------------------------------------------------------------------
    describe('GET /api/water-lines', () => {
        it('returns all water lines', async () => {
            const mockLines = [
                { line_id: 1, name: 'Line A' },
                { line_id: 2, name: 'Line B' }
            ];
            WaterLine.findAll.mockResolvedValue(mockLines);

            const res = await request(app).get('/api/water-lines');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockLines);
            expect(WaterLine.findAll).toHaveBeenCalledTimes(1);
        });

        it('returns 500 on database error', async () => {
            WaterLine.findAll.mockRejectedValue(new Error('DB error'));

            const res = await request(app).get('/api/water-lines');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка получения водных линий');
        });
    });

    // -------------------------------------------------------------------------
    // GET /:id
    // -------------------------------------------------------------------------
    describe('GET /api/water-lines/:id', () => {
        it('returns a water line by id', async () => {
            const mockLine = { line_id: 1, name: 'Line A' };
            WaterLine.findById.mockResolvedValue(mockLine);

            const res = await request(app).get('/api/water-lines/1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockLine);
            expect(WaterLine.findById).toHaveBeenCalledWith('1');
        });

        it('returns 404 when water line not found', async () => {
            WaterLine.findById.mockResolvedValue(null);

            const res = await request(app).get('/api/water-lines/999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Водная линия не найдена');
        });

        it('returns 500 on database error', async () => {
            WaterLine.findById.mockRejectedValue(new Error('DB error'));

            const res = await request(app).get('/api/water-lines/1');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка получения водной линии');
        });
    });

    // -------------------------------------------------------------------------
    // GET /:id/supplier
    // -------------------------------------------------------------------------
    describe('GET /api/water-lines/:id/supplier', () => {
        it('returns suppliers for a water line', async () => {
            const mockLine = { line_id: 1, name: 'Line A' };
            const mockSuppliers = [{ supplier_id: 10, name: 'Supplier X' }];
            WaterLine.findById.mockResolvedValue(mockLine);
            WaterLine.findSuppliersForLine.mockResolvedValue(mockSuppliers);

            const res = await request(app).get('/api/water-lines/1/supplier');

            expect(res.status).toBe(200);
            expect(res.body.suppliers).toEqual(mockSuppliers);
            expect(res.body.line).toEqual({ id: 1, name: 'Line A' });
        });

        it('returns 404 when water line not found', async () => {
            WaterLine.findById.mockResolvedValue(null);

            const res = await request(app).get('/api/water-lines/999/supplier');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Водная линия не найдена');
        });

        it('returns 500 on database error', async () => {
            WaterLine.findById.mockRejectedValue(new Error('DB error'));

            const res = await request(app).get('/api/water-lines/1/supplier');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка получения поставщика линии');
        });
    });

    // -------------------------------------------------------------------------
    // POST /
    // -------------------------------------------------------------------------
    describe('POST /api/water-lines', () => {
        it('creates a new water line and returns 201', async () => {
            const newLine = { line_id: 3, name: 'Line C', diameter: 100 };
            WaterLine.create.mockResolvedValue(newLine);

            const res = await request(app)
                .post('/api/water-lines')
                .send({ name: 'Line C', diameter: 100 });

            expect(res.status).toBe(201);
            expect(res.body).toEqual(newLine);
            expect(WaterLine.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Line C', diameter: 100 })
            );
        });

        it('returns 500 on creation error', async () => {
            WaterLine.create.mockRejectedValue(new Error('Constraint violation'));

            const res = await request(app)
                .post('/api/water-lines')
                .send({ name: 'Bad Line' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка создания водной линии');
        });
    });

    // -------------------------------------------------------------------------
    // PUT /:id
    // -------------------------------------------------------------------------
    describe('PUT /api/water-lines/:id', () => {
        it('updates an existing water line', async () => {
            const updated = { line_id: 1, name: 'Updated Line', diameter: 200 };
            WaterLine.update.mockResolvedValue(updated);

            const res = await request(app)
                .put('/api/water-lines/1')
                .send({ name: 'Updated Line', diameter: 200 });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(updated);
            expect(WaterLine.update).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'Updated Line' }));
        });

        it('returns 404 when water line not found', async () => {
            WaterLine.update.mockResolvedValue(null);

            const res = await request(app)
                .put('/api/water-lines/999')
                .send({ name: 'Ghost' });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Водная линия не найдена');
        });

        it('returns 500 on update error', async () => {
            WaterLine.update.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .put('/api/water-lines/1')
                .send({ name: 'Failing' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка обновления водной линии');
        });
    });

    // -------------------------------------------------------------------------
    // DELETE /:id
    // -------------------------------------------------------------------------
    describe('DELETE /api/water-lines/:id', () => {
        it('deletes a water line and returns success message', async () => {
            WaterLine.delete.mockResolvedValue({ line_id: 1 });

            const res = await request(app).delete('/api/water-lines/1');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Водная линия успешно удалена');
            expect(WaterLine.delete).toHaveBeenCalledWith('1');
        });

        it('returns 404 when water line not found', async () => {
            WaterLine.delete.mockResolvedValue(null);

            const res = await request(app).delete('/api/water-lines/999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Водная линия не найдена');
        });

        it('returns 500 on deletion error', async () => {
            WaterLine.delete.mockRejectedValue(new Error('FK constraint'));

            const res = await request(app).delete('/api/water-lines/1');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка удаления водной линии');
        });
    });
});
