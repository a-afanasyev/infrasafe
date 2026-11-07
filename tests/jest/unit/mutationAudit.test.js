'use strict';

/**
 * [S-PERIM-4] Журнал мутаций: одна запись на успешную мутацию
 * аутентифицированного пользователя, с user_id, маршрутом, IP и correlationId.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const logger = require('../../../src/utils/logger');
const mutationAudit = require('../../../src/middleware/mutationAudit');

function build({ user = { id: 7, role: 'admin' }, status = 200 } = {}) {
    const app = express();
    app.use((req, res, next) => { req.user = user; req.correlationId = 'cid-1'; next(); });
    app.use(mutationAudit);
    app.all('/api/buildings/:id', (req, res) => res.status(status).json({ ok: true }));
    app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
    return app;
}

beforeEach(() => jest.clearAllMocks());

describe('[S-PERIM-4] mutationAudit', () => {
    test('PUT 200 от админа → одна запись mutation с user_id, path, id, ip, correlationId', async () => {
        await request(build()).put('/api/buildings/42?x=1');
        const calls = logger.info.mock.calls.filter(([m]) => m === 'mutation');
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual(expect.objectContaining({
            event: 'mutation', user_id: 7, role: 'admin', method: 'PUT',
            path: '/api/buildings/42', id: '42', status: 200, correlationId: 'cid-1'
        }));
        expect(calls[0][1].ip).toBeDefined();
    });

    test('GET не пишется', async () => {
        await request(build()).get('/api/buildings/42');
        expect(logger.info.mock.calls.filter(([m]) => m === 'mutation')).toHaveLength(0);
    });

    test('4xx не пишется (отбитые запросы — не мутации)', async () => {
        await request(build({ status: 403 })).delete('/api/buildings/42');
        expect(logger.info.mock.calls.filter(([m]) => m === 'mutation')).toHaveLength(0);
    });

    test('без req.user не пишется', async () => {
        await request(build({ user: null })).post('/api/buildings/1');
        expect(logger.info.mock.calls.filter(([m]) => m === 'mutation')).toHaveLength(0);
    });

    test('/auth/* пропускается — у входа свои события', async () => {
        await request(build()).post('/api/auth/login');
        expect(logger.info.mock.calls.filter(([m]) => m === 'mutation')).toHaveLength(0);
    });
});
