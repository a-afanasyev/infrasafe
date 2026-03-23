const { sendSuccess, sendError, sendCreated, sendNotFound } = require('../../../src/utils/apiResponse');

describe('apiResponse utilities', () => {
    let res;

    beforeEach(() => {
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
    });

    describe('sendSuccess', () => {
        test('sends 200 with data by default', () => {
            sendSuccess(res, { id: 1 });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 1 } });
        });

        test('includes pagination when provided', () => {
            const pagination = { page: 1, limit: 10, total: 50, totalPages: 5 };
            sendSuccess(res, [1, 2], { pagination });
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [1, 2],
                pagination
            });
        });

        test('includes message when provided', () => {
            sendSuccess(res, null, { message: 'Done' });
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: null,
                message: 'Done'
            });
        });

        test('uses custom status code', () => {
            sendSuccess(res, {}, { status: 202 });
            expect(res.status).toHaveBeenCalledWith(202);
        });
    });

    describe('sendError', () => {
        test('sends error envelope with status code', () => {
            sendError(res, 400, 'Bad request');
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: { message: 'Bad request', status: 400 }
            });
        });

        test('sends 500 error', () => {
            sendError(res, 500, 'Internal error');
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: { message: 'Internal error', status: 500 }
            });
        });
    });

    describe('sendCreated', () => {
        test('sends 201 with data', () => {
            sendCreated(res, { id: 5 }, 'Created');
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { id: 5 },
                message: 'Created'
            });
        });
    });

    describe('sendNotFound', () => {
        test('sends 404 with default message', () => {
            sendNotFound(res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: { message: 'Ресурс не найден', status: 404 }
            });
        });

        test('sends 404 with custom message', () => {
            sendNotFound(res, 'Building not found');
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: { message: 'Building not found', status: 404 }
            });
        });
    });
});
