// Phase 9.2 (YAGNI-005 / YAGNI-006): formatDateForDB and calculateBuildingStatus
// were removed because they had no production callers. Their tests are
// removed with them; the remaining public helpers (createError)
// keep full coverage.

const { createError } = require('../../../src/utils/helpers');

describe('helpers', () => {
    describe('createError', () => {
        test('creates error with default status code 500', () => {
            const error = createError('Something went wrong');
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('Something went wrong');
            expect(error.statusCode).toBe(500);
        });

        test('creates error with custom status code', () => {
            const error = createError('Not found', 404);
            expect(error.message).toBe('Not found');
            expect(error.statusCode).toBe(404);
        });

        test('creates error with 400 status code', () => {
            const error = createError('Bad request', 400);
            expect(error.statusCode).toBe(400);
        });

        test('creates error with 401 status code', () => {
            const error = createError('Unauthorized', 401);
            expect(error.statusCode).toBe(401);
        });
    });
});
