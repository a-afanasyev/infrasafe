/**
 * [SE-2] SSRF-хвост: цепочка редиректов не проверяется allowlist'ом.
 *
 * `validateUKApiUrl` (R2-19) проверяет хост при КАЖДОМ вызове send(), а не
 * только при сохранении конфига — это правильно. Но axios по умолчанию сам
 * следует за 3xx, и повторной валидации на редиректе нет: allowlisted хост,
 * ответив `302 Location: http://169.254.169.254/...`, увёл бы подписанный
 * запрос на внутренний адрес.
 *
 * Практическая значимость низкая — нужен контроль над уже доверенным
 * UK-хостом. Это defense-in-depth: 3xx должен становиться обычным неуспехом,
 * который отработает существующая логика retry/dead, а не молча уводить
 * запрос.
 */

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const axios = require('axios');
const client = require('../../../src/clients/ukWebhookClient');

describe('[SE-2] ukWebhookClient не следует за редиректами', () => {
    const ORIGINAL = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.UK_API_URL = 'https://infrasafe.uz/uk';
        process.env.UK_API_ALLOWED_HOSTS = 'infrasafe.uz';
        process.env.UK_WEBHOOK_SECRET = 'secret-0123456789abcdef-0123456789';
    });

    afterEach(() => {
        process.env = { ...ORIGINAL };
    });

    test('axios вызывается с maxRedirects: 0', async () => {
        axios.post.mockResolvedValue({ status: 200, data: {} });

        await client.send('{"event":"alert.created"}');

        expect(axios.post).toHaveBeenCalled();
        const config = axios.post.mock.calls[0][2];
        expect(config.maxRedirects).toBe(0);
    });

    test('3xx не считается успехом', async () => {
        axios.post.mockResolvedValue({
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
            data: {}
        });

        const result = await client.send('{"event":"alert.created"}');

        expect(result.outcome).not.toBe('success');
    });
});
