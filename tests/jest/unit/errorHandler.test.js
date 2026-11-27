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

    // [Sprint 5 / P2-4] Case-insensitive NODE_ENV match.
    test.each(['Development', 'DEVELOPMENT', '  development  '])(
        'includes stack trace when NODE_ENV is %p (case-insensitive)',
        (value) => {
            process.env.NODE_ENV = value;
            const err = new Error('Dev error');
            errorHandler(err, req, res, next);
            const responseBody = res.json.mock.calls[0][0];
            expect(responseBody.error.stack).toBeDefined();
        }
    );

    // [N-63] Машинный код и подробности для клиента — только у 4xx: на них
    // строится диалог (например, «удалить трансформатор вместе с линиями?»).
    test('[N-63] 4xx: apiCode и apiMeta уходят в конверт как code и meta', () => {
        const err = Object.assign(new Error('Есть линии'), {
            statusCode: 409, apiCode: 'TRANSFORMER_HAS_LINES', apiMeta: { count: 2 },
        });
        errorHandler(err, req, res, next);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: 'Есть линии', status: 409, code: 'TRANSFORMER_HAS_LINES', meta: { count: 2 } },
        });
    });

    test('[N-63] 5xx: apiCode и apiMeta наружу не уходят', () => {
        const err = Object.assign(new Error('boom'), { statusCode: 500, apiCode: 'X', apiMeta: { secret: 1 } });
        errorHandler(err, req, res, next);
        const body = res.json.mock.calls[0][0];
        expect(body.error.code).toBeUndefined();
        expect(body.error.meta).toBeUndefined();
    });

    // [пентест 26.11.2026] Битое тело запроса: body-parser кладёт в message текст
    // парсера с фрагментом присланного («Unexpected token '"', ""username""...»).
    // Клиенту — нейтральная фраза; подробность остаётся в серверном логе.
    describe('ошибка разбора тела запроса', () => {
        const parseError = () => Object.assign(
            new SyntaxError('Unexpected token \'"\', ""username""... is not valid JSON'),
            { statusCode: 400, status: 400, type: 'entity.parse.failed', expose: true, body: '{"username":' }
        );

        test('клиент получает нейтральное сообщение без текста парсера', () => {
            errorHandler(parseError(), req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            const body = res.json.mock.calls[0][0];
            expect(body.error.message).toBe('Некорректный JSON в теле запроса');
            expect(JSON.stringify(body)).not.toMatch(/Unexpected|username|token/);
        });

        test('исходный текст остаётся в логе', () => {
            errorHandler(parseError(), req, res, next);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unexpected token'));
        });

        test('обычная 400 с собственным сообщением не затрагивается', () => {
            errorHandler(Object.assign(new Error('Поле name обязательно'), { statusCode: 400 }), req, res, next);
            expect(res.json.mock.calls[0][0].error.message).toBe('Поле name обязательно');
        });
    });

    // [проверка за авторизацией 27.11.2026] Ошибки, причина которых — запрос
    // клиента, уходили как 500: сервисы помечают «не найдено» кодом
    // `*_NOT_FOUND`, но не статусом, а Postgres на нечисловой фильтр отвечает
    // 22P02. Мониторинг видел «сбой сервера» там, где сервер был прав.
    describe('ошибки запроса клиента не превращаются в 500', () => {
        test.each(['CONTROLLER_NOT_FOUND', 'TRANSFORMER_NOT_FOUND', 'BUILDING_NOT_FOUND'])('%s без статуса → 404 с исходным сообщением', (code) => {
            errorHandler(Object.assign(new Error('Контроллер не найден'), { code }), req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json.mock.calls[0][0].error).toMatchObject({ message: 'Контроллер не найден', status: 404 });
        });

        test.each([['22P02', 'invalid input syntax for type integer: "1 or 1=1"'], ['22003', 'value "99999999999" is out of range for type integer']])(
            'ошибка Postgres %s → 400 без текста СУБД',
            (code, pgMessage) => {
                errorHandler(Object.assign(new Error(pgMessage), { code, severity: 'ERROR', routine: 'pg_strtoint32' }), req, res, next);

                expect(res.status).toHaveBeenCalledWith(400);
                const body = res.json.mock.calls[0][0];
                expect(body.error.message).toBe('Некорректное значение параметра запроса');
                expect(JSON.stringify(body)).not.toMatch(/integer|syntax|1 or 1=1|range/);
            }
        );

        test('текст СУБД остаётся в серверном логе', () => {
            errorHandler(Object.assign(new Error('invalid input syntax for type integer: "x"'), { code: '22P02' }), req, res, next);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('invalid input syntax'));
        });

        test('явный статус ошибки главнее кода', () => {
            errorHandler(Object.assign(new Error('Конфликт'), { code: 'CONTROLLER_NOT_FOUND', statusCode: 409 }), req, res, next);
            expect(res.status).toHaveBeenCalledWith(409);
        });

        test.each(['23505', '42703', '57014', 'ECONNREFUSED', 'SOMETHING_ELSE'])('прочие коды (%s) остаются 500 и не раскрывают текст', (code) => {
            errorHandler(Object.assign(new Error('column "transformer_id" does not exist'), { code }), req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json.mock.calls[0][0].error.message).toBe('Внутренняя ошибка сервера');
        });
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
