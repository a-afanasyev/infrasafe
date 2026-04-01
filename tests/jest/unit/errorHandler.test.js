jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const errorHandler = require('../../../src/middleware/errorHandler');
const logger = require('../../../src/utils/logger');

describe('Error Handler Middleware', () => {
    let req, res, next;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        req = { method: 'GET', url: '/api/test' };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('uses error statusCode when provided', () => {
        const err = new Error('Not found');
        err.statusCode = 404;

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                error: expect.objectContaining({
                    message: 'Not found',
                    status: 404
                })
            })
        );
    });

    test('defaults to 500 when no statusCode is provided', () => {
        const err = new Error('Something went wrong');

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                error: expect.objectContaining({
                    status: 500
                })
            })
        );
    });

    test('includes error message in response', () => {
        const err = new Error('Validation failed');
        err.statusCode = 400;

        errorHandler(err, req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    message: 'Validation failed'
                })
            })
        );
    });

    test('includes stack trace in development mode', () => {
        process.env.NODE_ENV = 'development';
        const err = new Error('Dev error');
        err.statusCode = 500;

        errorHandler(err, req, res, next);

        const responseBody = res.json.mock.calls[0][0];
        expect(responseBody.error.stack).toBeDefined();
        expect(typeof responseBody.error.stack).toBe('string');
    });

    test('does not include stack trace in production mode', () => {
        process.env.NODE_ENV = 'production';
        const err = new Error('Prod error');
        err.statusCode = 500;

        errorHandler(err, req, res, next);

        const responseBody = res.json.mock.calls[0][0];
        expect(responseBody.error.stack).toBeUndefined();
    });

    test('does not include stack trace when NODE_ENV is not development', () => {
        process.env.NODE_ENV = 'test';
        const err = new Error('Test error');

        errorHandler(err, req, res, next);

        const responseBody = res.json.mock.calls[0][0];
        expect(responseBody.error.stack).toBeUndefined();
    });

    test('logs error message', () => {
        const err = new Error('Logged error');
        err.statusCode = 400;

        errorHandler(err, req, res, next);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Logged error'));
    });

    test('logs stack trace at debug level when stack exists', () => {
        const err = new Error('With stack');

        errorHandler(err, req, res, next);

        expect(logger.debug).toHaveBeenCalledWith(expect.any(String));
    });

    test('handles error without message gracefully', () => {
        const err = new Error();

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        // The default message from the source is the Russian string or empty
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false
            })
        );
    });

    test('handles various HTTP status codes', () => {
        const statusCodes = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

        statusCodes.forEach(code => {
            jest.clearAllMocks();
            const err = new Error(`Error ${code}`);
            err.statusCode = code;

            errorHandler(err, req, res, next);

            expect(res.status).toHaveBeenCalledWith(code);
        });
    });

    test('always sets success to false', () => {
        const err = new Error('any error');
        err.statusCode = 200; // Even with a 200 statusCode (unusual)

        errorHandler(err, req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false
            })
        );
    });
});
