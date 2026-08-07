/**
 * [AR-12] Характеризующие тесты перед выносом контроллерного слоя.
 *
 * `integrationRoutes.js` (321 строка) и `webhookRoutes.js` держат в себе всё
 * сразу: валидацию, доступ к моделям, формирование ответов и 16 копий
 * `catch → 500`. Контроллерного слоя нет вовсе.
 *
 * Эти тесты написаны ДО переноса и описывают наблюдаемое поведение, а не
 * внутреннее устройство: тот же путь, тот же статус, те же данные. Они должны
 * проходить и до, и после — иначе вынос перестал быть переносом и стал
 * изменением поведения.
 *
 * Единственное намеренное отличие после переноса — форма ошибки: `{success:false,
 * message}` заменяется каноном (AR-4). Это зафиксировано отдельным ожиданием
 * через `error.message`, а не через `message`.
 */

jest.mock('../../../src/services/ukIntegrationService', () => ({
    getRequestCounts: jest.fn(),
    getBuildingRequests: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    findAll: jest.fn(), findById: jest.fn(), countAll: jest.fn(),
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findAll: jest.fn(), listWithStats: jest.fn(), update: jest.fn(),
    findById: jest.fn(), toggle: jest.fn(),
}));
jest.mock('../../../src/middleware/auth', () => ({
    isAdmin: (req, res, next) => next(),
    authenticateJWT: (req, res, next) => next(),
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const errorHandler = require('../../../src/middleware/errorHandler');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/integration', require('../../../src/routes/integrationRoutes'));
    app.use(errorHandler);
    return app;
};

beforeEach(() => jest.clearAllMocks());

describe('[AR-12] GET /integration/request-counts', () => {
    test('успех: success + data', async () => {
        ukIntegrationService.getRequestCounts.mockResolvedValue({ 5: 2 });

        const res = await request(buildApp()).get('/api/integration/request-counts');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { 5: 2 } });
    });

    test('отказ сервиса: 500 в каноническом конверте, без утечки деталей', async () => {
        ukIntegrationService.getRequestCounts.mockRejectedValue(new Error('пароль=секрет'));

        const res = await request(buildApp()).get('/api/integration/request-counts');

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(typeof res.body.error).toBe('object');
        expect(JSON.stringify(res.body)).not.toContain('секрет');
    });
});

describe('[AR-12] GET /integration/building-requests/:externalId', () => {
    const UUID = '11111111-1111-4111-8111-111111111111';

    test('валидный UUID проходит и limit по умолчанию = 3', async () => {
        ukIntegrationService.getBuildingRequests.mockResolvedValue([]);

        const res = await request(buildApp()).get(`/api/integration/building-requests/${UUID}`);

        expect(res.status).toBe(200);
        expect(ukIntegrationService.getBuildingRequests).toHaveBeenCalledWith(UUID, 3);
    });

    test('limit ограничен сверху десятью', async () => {
        ukIntegrationService.getBuildingRequests.mockResolvedValue([]);

        await request(buildApp()).get(`/api/integration/building-requests/${UUID}?limit=999`);

        expect(ukIntegrationService.getBuildingRequests).toHaveBeenCalledWith(UUID, 10);
    });

    test('нечисловой limit откатывается к 3, а не роняет запрос', async () => {
        ukIntegrationService.getBuildingRequests.mockResolvedValue([]);

        await request(buildApp()).get(`/api/integration/building-requests/${UUID}?limit=abc`);

        expect(ukIntegrationService.getBuildingRequests).toHaveBeenCalledWith(UUID, 3);
    });

    test('невалидный UUID → 400, до сервиса не доходит', async () => {
        const res = await request(buildApp()).get('/api/integration/building-requests/not-a-uuid');

        expect(res.status).toBe(400);
        expect(ukIntegrationService.getBuildingRequests).not.toHaveBeenCalled();
    });
});

describe('[AR-12] GET /integration/config', () => {
    test('успех: конфигурация отдаётся как data', async () => {
        ukIntegrationService.getConfig.mockResolvedValue({ uk_integration_enabled: 'true' });

        const res = await request(buildApp()).get('/api/integration/config');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.uk_integration_enabled).toBe('true');
    });

    test('отказ: 500 канонический, внутренние детали не раскрываются', async () => {
        ukIntegrationService.getConfig.mockRejectedValue(new Error('DSN=postgres://u:p@h/db'));

        const res = await request(buildApp()).get('/api/integration/config');

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('postgres://');
    });
});
