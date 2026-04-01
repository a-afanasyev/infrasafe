jest.mock('axios');
jest.mock('../../../src/models/IntegrationConfig', () => ({
    get: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const axios = require('axios');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');

// The module exports a singleton, so we need to re-require it for each test
let client;

describe('UKApiClient', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        process.env = {
            ...originalEnv,
            UK_SERVICE_USER: 'testuser',
            UK_SERVICE_PASSWORD: 'testpass'
        };
        // Re-require to get a fresh singleton with cleared token state
        jest.isolateModules(() => {
            client = require('../../../src/clients/ukApiClient');
        });
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.useRealTimers();
    });

    describe('authenticate', () => {
        test('fetches a new token when no cached token exists', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post.mockResolvedValue({ data: { token: 'fresh-token' } });

            const token = await client.authenticate();

            expect(token).toBe('fresh-token');
            expect(axios.post).toHaveBeenCalledWith(
                'https://uk-api.test/auth/login',
                { username: 'testuser', password: 'testpass' },
                { timeout: 10000 }
            );
        });

        test('returns cached token when not expired', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post.mockResolvedValue({ data: { token: 'cached-token' } });

            // First call sets the token
            await client.authenticate();
            // Second call should use cache
            const token = await client.authenticate();

            expect(token).toBe('cached-token');
            expect(axios.post).toHaveBeenCalledTimes(1);
        });

        test('refreshes token after TTL expires', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'old-token' } })
                .mockResolvedValueOnce({ data: { token: 'new-token' } });

            await client.authenticate();

            // Advance time past 25 minutes TTL
            jest.advanceTimersByTime(26 * 60 * 1000);

            const token = await client.authenticate();

            expect(token).toBe('new-token');
            expect(axios.post).toHaveBeenCalledTimes(2);
        });

        test('throws when credentials are not configured', async () => {
            IntegrationConfig.get.mockResolvedValue(null);

            await expect(client.authenticate()).rejects.toThrow('UK API credentials not configured');
        });

        test('throws when env vars are missing', async () => {
            delete process.env.UK_SERVICE_USER;
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');

            await expect(client.authenticate()).rejects.toThrow('UK API credentials not configured');
        });
    });

    describe('clearToken', () => {
        test('clears cached token so next authenticate fetches fresh', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'token-1' } })
                .mockResolvedValueOnce({ data: { token: 'token-2' } });

            await client.authenticate();
            client.clearToken();
            const token = await client.authenticate();

            expect(token).toBe('token-2');
            expect(axios.post).toHaveBeenCalledTimes(2);
        });
    });

    describe('createRequest', () => {
        const requestData = {
            building_external_id: 'B-001',
            category: 'electrical',
            urgency: 'high',
            description: 'Power outage',
            idempotency_key: 'idem-123'
        };

        test('creates a request successfully on first attempt', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'tok' } })   // authenticate
                .mockResolvedValueOnce({ data: { request_number: 'REQ-001' } }); // createRequest

            const result = await client.createRequest(requestData);

            expect(result).toEqual({ request_number: 'REQ-001' });
            expect(axios.post).toHaveBeenCalledTimes(2);
        });

        test('retries on failure with exponential backoff', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'tok' } })        // authenticate
                .mockRejectedValueOnce(new Error('timeout'))               // attempt 1 fails
                .mockResolvedValueOnce({ data: { request_number: 'REQ-002' } }); // attempt 2 succeeds

            const promise = client.createRequest(requestData);

            // Advance past 1s backoff for first retry
            await jest.advanceTimersByTimeAsync(1100);

            const result = await promise;

            expect(result).toEqual({ request_number: 'REQ-002' });
        });

        test('clears token on 401 response and retries', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = { status: 401 };

            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'tok1' } })       // initial authenticate
                .mockRejectedValueOnce(error401)                           // attempt 1 => 401
                .mockResolvedValueOnce({ data: { request_number: 'REQ-003' } }); // attempt 2

            const promise = client.createRequest(requestData);
            await jest.advanceTimersByTimeAsync(1100);
            const result = await promise;

            expect(result).toEqual({ request_number: 'REQ-003' });
        });

        test('throws after all retries exhausted', async () => {
            // Use real timers for this test to avoid async rejection timing issues
            jest.useRealTimers();

            // Override the backoff by mocking setTimeout to resolve immediately
            const origSetTimeout = global.setTimeout;
            global.setTimeout = (fn) => origSetTimeout(fn, 0);

            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'tok' } })   // authenticate
                .mockRejectedValueOnce(new Error('fail1'))
                .mockRejectedValueOnce(new Error('fail2'))
                .mockRejectedValueOnce(new Error('fail3'));

            await expect(client.createRequest(requestData)).rejects.toThrow('fail3');
            expect(axios.post).toHaveBeenCalledTimes(4); // 1 auth + 3 attempts

            global.setTimeout = origSetTimeout;
            jest.useFakeTimers();
        });
    });

    describe('get', () => {
        test('returns data on successful GET', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post.mockResolvedValue({ data: { token: 'tok' } });
            axios.get.mockResolvedValue({ data: { status: 'ok' } });

            const result = await client.get('/status');

            expect(result).toEqual({ status: 'ok' });
            expect(axios.get).toHaveBeenCalledWith(
                'https://uk-api.test/status',
                { headers: { Authorization: 'Bearer tok' }, timeout: 10000 }
            );
        });

        test('retries once with fresh token on 401', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = { status: 401 };

            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post
                .mockResolvedValueOnce({ data: { token: 'old-tok' } })
                .mockResolvedValueOnce({ data: { token: 'new-tok' } });
            axios.get
                .mockRejectedValueOnce(error401)
                .mockResolvedValueOnce({ data: { retried: true } });

            const result = await client.get('/info');

            expect(result).toEqual({ retried: true });
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(axios.post).toHaveBeenCalledTimes(2); // two auth calls
        });

        test('throws non-401 errors directly', async () => {
            IntegrationConfig.get.mockResolvedValue('https://uk-api.test');
            axios.post.mockResolvedValue({ data: { token: 'tok' } });
            const error500 = new Error('Server Error');
            error500.response = { status: 500 };
            axios.get.mockRejectedValue(error500);

            await expect(client.get('/broken')).rejects.toThrow('Server Error');
            expect(axios.get).toHaveBeenCalledTimes(1);
        });
    });
});
