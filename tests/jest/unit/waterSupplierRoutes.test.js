'use strict';

jest.mock('../../../src/models/WaterSupplier', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
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
const WaterSupplier = require('../../../src/models/WaterSupplier');
const waterSupplierRoutes = require('../../../src/routes/waterSupplierRoutes');

describe('waterSupplierRoutes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use('/api/water-suppliers', waterSupplierRoutes);
        // Error handler
        app.use((err, req, res, _next) => {
            const status = err.statusCode || 500;
            res.status(status).json({ message: err.message });
        });
    });

    // -------------------------------------------------------------------------
    // GET /
    // -------------------------------------------------------------------------
    describe('GET /api/water-suppliers', () => {
        it('returns all water suppliers with default pagination', async () => {
            const mockSuppliers = [
                { supplier_id: 1, name: 'Supplier A', type: 'municipal' }
            ];
            WaterSupplier.findAll.mockResolvedValue(mockSuppliers);

            const res = await request(app).get('/api/water-suppliers');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSuppliers);
            expect(WaterSupplier.findAll).toHaveBeenCalledWith(1, 100, {});
        });

        it('passes type filter from query params', async () => {
            WaterSupplier.findAll.mockResolvedValue([]);

            const res = await request(app).get('/api/water-suppliers?type=municipal&page=2&limit=5');

            expect(res.status).toBe(200);
            expect(WaterSupplier.findAll).toHaveBeenCalledWith('2', '5', expect.objectContaining({ type: 'municipal' }));
        });

        it('returns 500 on database error', async () => {
            WaterSupplier.findAll.mockRejectedValue(new Error('DB error'));

            const res = await request(app).get('/api/water-suppliers');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка получения поставщиков воды');
        });
    });

    // -------------------------------------------------------------------------
    // GET /:id
    // -------------------------------------------------------------------------
    describe('GET /api/water-suppliers/:id', () => {
        it('returns a water supplier by id', async () => {
            const mockSupplier = { supplier_id: 1, name: 'Supplier A' };
            WaterSupplier.findById.mockResolvedValue(mockSupplier);

            const res = await request(app).get('/api/water-suppliers/1');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockSupplier);
            expect(WaterSupplier.findById).toHaveBeenCalledWith('1');
        });

        it('returns 404 when supplier not found', async () => {
            WaterSupplier.findById.mockResolvedValue(null);

            const res = await request(app).get('/api/water-suppliers/999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Поставщик воды не найден');
        });

        it('returns 500 on database error', async () => {
            WaterSupplier.findById.mockRejectedValue(new Error('DB error'));

            const res = await request(app).get('/api/water-suppliers/1');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка получения поставщика воды');
        });
    });

    // -------------------------------------------------------------------------
    // POST /
    // -------------------------------------------------------------------------
    describe('POST /api/water-suppliers', () => {
        it('creates a new water supplier and returns 201', async () => {
            const newSupplier = { supplier_id: 3, name: 'Supplier C', type: 'private' };
            WaterSupplier.create.mockResolvedValue(newSupplier);

            const res = await request(app)
                .post('/api/water-suppliers')
                .send({ name: 'Supplier C', type: 'private' });

            expect(res.status).toBe(201);
            expect(res.body).toEqual(newSupplier);
            expect(WaterSupplier.create).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Supplier C', type: 'private' })
            );
        });

        it('returns 500 on creation error', async () => {
            WaterSupplier.create.mockRejectedValue(new Error('Constraint violation'));

            const res = await request(app)
                .post('/api/water-suppliers')
                .send({ name: 'Bad Supplier' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка создания поставщика воды');
        });
    });

    // -------------------------------------------------------------------------
    // PUT /:id
    // -------------------------------------------------------------------------
    describe('PUT /api/water-suppliers/:id', () => {
        it('updates an existing water supplier', async () => {
            const updated = { supplier_id: 1, name: 'Updated Supplier' };
            WaterSupplier.update.mockResolvedValue(updated);

            const res = await request(app)
                .put('/api/water-suppliers/1')
                .send({ name: 'Updated Supplier' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(updated);
            expect(WaterSupplier.update).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'Updated Supplier' }));
        });

        it('returns 404 when supplier not found', async () => {
            WaterSupplier.update.mockResolvedValue(null);

            const res = await request(app)
                .put('/api/water-suppliers/999')
                .send({ name: 'Ghost' });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Поставщик воды не найден');
        });

        it('returns 500 on update error', async () => {
            WaterSupplier.update.mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .put('/api/water-suppliers/1')
                .send({ name: 'Failing' });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка обновления поставщика воды');
        });
    });

    // -------------------------------------------------------------------------
    // DELETE /:id
    // -------------------------------------------------------------------------
    describe('DELETE /api/water-suppliers/:id', () => {
        it('deletes a water supplier and returns success message', async () => {
            WaterSupplier.delete.mockResolvedValue({ supplier_id: 1 });

            const res = await request(app).delete('/api/water-suppliers/1');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Поставщик воды успешно удален');
            expect(WaterSupplier.delete).toHaveBeenCalledWith('1');
        });

        it('returns 404 when supplier not found', async () => {
            WaterSupplier.delete.mockResolvedValue(null);

            const res = await request(app).delete('/api/water-suppliers/999');

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Поставщик воды не найден');
        });

        it('returns 500 on deletion error', async () => {
            WaterSupplier.delete.mockRejectedValue(new Error('FK constraint'));

            const res = await request(app).delete('/api/water-suppliers/1');

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Ошибка удаления поставщика воды');
        });
    });
});
