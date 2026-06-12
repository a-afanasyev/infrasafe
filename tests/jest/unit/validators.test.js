const {
    validateBuildingCreate,
    validateControllerCreate,
    validateIdParam,
    isXSSFree
} = require('../../../src/middleware/validators');

/**
 * Helper to run an express-validator middleware chain.
 * Each validator in the chain is either an express-validator check (calls next internally)
 * or the final handleValidationErrors middleware (calls res.status(400).json or next).
 *
 * We resolve the promise when either next() is called or res.json() is called.
 */
async function runValidation(validationChain, req) {
    let jsonCalled = false;
    let jsonBody = null;
    let statusCode = null;

    const res = {
        status: jest.fn().mockImplementation(function (code) {
            statusCode = code;
            return this;
        }),
        json: jest.fn().mockImplementation(function (body) {
            jsonCalled = true;
            jsonBody = body;
            return this;
        })
    };

    for (const middleware of validationChain) {
        if (jsonCalled) break;

        await new Promise((resolve) => {
            middleware(req, res, () => resolve());

            // If handleValidationErrors sent a response, it won't call next.
            // Use setImmediate to check if json was called after the synchronous code runs.
            setImmediate(() => {
                if (jsonCalled) resolve();
            });
        });
    }

    return {
        res,
        responded: jsonCalled,
        statusCode,
        jsonBody
    };
}

function createMockReq(body = {}, params = {}) {
    return {
        body,
        params,
        query: {},
        headers: {}
    };
}

describe('Validators Middleware', () => {
    describe('validateBuildingCreate', () => {
        test('passes with valid data', async () => {
            const req = createMockReq({
                name: 'Building 1',
                address: '123 Main St',
                town: 'Moscow',
                latitude: 55.7558,
                longitude: 37.6173
            });

            const { responded } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(false);
        });

        test('fails when name is empty', async () => {
            const req = createMockReq({
                name: '',
                address: '123 Main St',
                town: 'Moscow',
                latitude: 55.7558,
                longitude: 37.6173
            });

            const { responded, statusCode } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when address is missing', async () => {
            const req = createMockReq({
                name: 'Building 1',
                town: 'Moscow',
                latitude: 55.7558,
                longitude: 37.6173
            });

            const { responded, statusCode } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when town is missing', async () => {
            const req = createMockReq({
                name: 'Building 1',
                address: '123 Main St',
                latitude: 55.7558,
                longitude: 37.6173
            });

            const { responded, statusCode } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when latitude is not a float', async () => {
            const req = createMockReq({
                name: 'Building 1',
                address: '123 Main St',
                town: 'Moscow',
                latitude: 'not-a-number',
                longitude: 37.6173
            });

            const { responded, statusCode } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when longitude is not a float', async () => {
            const req = createMockReq({
                name: 'Building 1',
                address: '123 Main St',
                town: 'Moscow',
                latitude: 55.7558,
                longitude: 'not-a-number'
            });

            const { responded, statusCode } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('passes with optional management_company', async () => {
            const req = createMockReq({
                name: 'Building 1',
                address: '123 Main St',
                town: 'Moscow',
                latitude: 55.7558,
                longitude: 37.6173,
                management_company: 'UK-1'
            });

            const { responded } = await runValidation(validateBuildingCreate, req);

            expect(responded).toBe(false);
        });
    });

    describe('validateControllerCreate', () => {
        test('passes with valid data', async () => {
            const req = createMockReq({
                serial_number: 'SN-001',
                building_id: 1,
                status: 'online'
            });

            const { responded } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(false);
        });

        test('fails when serial_number is empty', async () => {
            const req = createMockReq({
                serial_number: '',
                building_id: 1,
                status: 'online'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when serial_number contains XSS', async () => {
            const req = createMockReq({
                serial_number: '<script>alert("xss")</script>',
                building_id: 1,
                status: 'online'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when building_id is not an integer', async () => {
            const req = createMockReq({
                serial_number: 'SN-001',
                building_id: 'not-int',
                status: 'online'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when status is invalid', async () => {
            const req = createMockReq({
                serial_number: 'SN-001',
                building_id: 1,
                status: 'invalid_status'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('accepts all valid status values', async () => {
            for (const status of ['online', 'offline', 'maintenance']) {
                const req = createMockReq({
                    serial_number: 'SN-001',
                    building_id: 1,
                    status
                });

                const { responded } = await runValidation(validateControllerCreate, req);

                expect(responded).toBe(false);
            }
        });

        test('rejects XSS in vendor field', async () => {
            const req = createMockReq({
                serial_number: 'SN-001',
                building_id: 1,
                status: 'online',
                vendor: 'javascript:alert(1)'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('rejects XSS in model field', async () => {
            const req = createMockReq({
                serial_number: 'SN-001',
                building_id: 1,
                status: 'online',
                model: '<iframe src="evil.com">'
            });

            const { responded, statusCode } = await runValidation(validateControllerCreate, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });
    });

    describe('isXSSFree (SEC-10 — ReDoS-safe XSS check)', () => {
        test('returns true for clean plain strings', () => {
            expect(isXSSFree('SN-001')).toBe(true);
            expect(isXSSFree('Siemens')).toBe(true);
            expect(isXSSFree('Building 12, floor 3')).toBe(true);
            expect(isXSSFree('')).toBe(true);
        });

        test('returns false for <script> payloads', () => {
            expect(isXSSFree('<script>alert("xss")</script>')).toBe(false);
            expect(isXSSFree('hello <script src="evil.js"></script> world')).toBe(false);
            expect(isXSSFree('<SCRIPT>alert(1)</SCRIPT>')).toBe(false);
        });

        test('returns false for event-handler (onerror=) payloads', () => {
            expect(isXSSFree('<img src=x onerror=alert(1)>')).toBe(false);
            expect(isXSSFree('onload = doEvil()')).toBe(false);
        });

        test('returns false for javascript: URIs', () => {
            expect(isXSSFree('javascript:alert(1)')).toBe(false);
            expect(isXSSFree('JavaScript:void(0)')).toBe(false);
        });

        test('returns false for iframe/object/embed tags', () => {
            expect(isXSSFree('<iframe src="evil.com">')).toBe(false);
            expect(isXSSFree('<object data="evil.swf">')).toBe(false);
            expect(isXSSFree('<embed src="evil">')).toBe(false);
        });

        test('completes quickly on a long adversarial input (no catastrophic backtracking)', () => {
            // Craft an input that triggers exponential backtracking against the old
            // nested-quantifier regex /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/.
            const adversarial = '<script' + '<'.repeat(15000) + 'x';

            const start = Date.now();
            const result = isXSSFree(adversarial);
            const elapsedMs = Date.now() - start;

            // The pre-fix regex took ~2.2s on this; a linear-time check is sub-millisecond.
            expect(elapsedMs).toBeLessThan(100);
            // It still contains a "<script" opener, so it must be rejected.
            expect(result).toBe(false);
        });
    });

    describe('validateIdParam', () => {
        test('passes with valid integer id', async () => {
            const req = createMockReq({}, { id: '1' });

            const { responded } = await runValidation(validateIdParam, req);

            expect(responded).toBe(false);
        });

        test('fails when id is not an integer', async () => {
            const req = createMockReq({}, { id: 'abc' });

            const { responded, statusCode } = await runValidation(validateIdParam, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });

        test('fails when id is a float', async () => {
            const req = createMockReq({}, { id: '1.5' });

            const { responded, statusCode } = await runValidation(validateIdParam, req);

            expect(responded).toBe(true);
            expect(statusCode).toBe(400);
        });
    });
});
