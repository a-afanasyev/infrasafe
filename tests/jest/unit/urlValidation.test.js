'use strict';

const { validateUKApiUrl } = require('../../../src/utils/urlValidation');

describe('urlValidation', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...origEnv };
    });

    describe('HTTPS-only in production', () => {
        it('allows HTTPS in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.UK_API_ALLOWED_HOSTS = 'api.example.com';
            expect(() => validateUKApiUrl('https://api.example.com/v1')).not.toThrow();
        });

        it('rejects HTTP in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.UK_API_ALLOWED_HOSTS = 'api.example.com';
            expect(() => validateUKApiUrl('http://api.example.com/v1'))
                .toThrow('Only HTTPS URLs allowed for UK API');
        });

        it('allows HTTP in development', () => {
            process.env.NODE_ENV = 'development';
            expect(() => validateUKApiUrl('http://api.example.com/v1')).not.toThrow();
        });

        it('allows HTTPS in development', () => {
            process.env.NODE_ENV = 'development';
            expect(() => validateUKApiUrl('https://api.example.com/v1')).not.toThrow();
        });
    });

    describe('private IPs blocked', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'development';
        });

        it('blocks 127.x.x.x (loopback)', () => {
            expect(() => validateUKApiUrl('http://127.0.0.1/api'))
                .toThrow('Private/internal IP not allowed');
        });

        it('blocks 10.x.x.x (private)', () => {
            expect(() => validateUKApiUrl('http://10.0.0.1/api'))
                .toThrow('Private/internal IP not allowed');
        });

        it('blocks 172.16-31.x.x (private)', () => {
            expect(() => validateUKApiUrl('http://172.16.0.1/api'))
                .toThrow('Private/internal IP not allowed');
            expect(() => validateUKApiUrl('http://172.31.255.255/api'))
                .toThrow('Private/internal IP not allowed');
        });

        it('blocks 192.168.x.x (private)', () => {
            expect(() => validateUKApiUrl('http://192.168.1.1/api'))
                .toThrow('Private/internal IP not allowed');
        });

        it('blocks 169.254.x.x (link-local)', () => {
            expect(() => validateUKApiUrl('http://169.254.169.254/api'))
                .toThrow('Private/internal IP not allowed');
        });

        it('blocks 0.x.x.x', () => {
            expect(() => validateUKApiUrl('http://0.0.0.0/api'))
                .toThrow('Private/internal IP not allowed');
        });
    });

    describe('localhost blocked except in development', () => {
        it('blocks localhost in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.UK_API_ALLOWED_HOSTS = 'localhost';
            expect(() => validateUKApiUrl('https://localhost/api'))
                .toThrow('Blocked hostname: localhost');
        });

        it('allows localhost in development', () => {
            process.env.NODE_ENV = 'development';
            expect(() => validateUKApiUrl('http://localhost:3000/api')).not.toThrow();
        });

        it('blocks metadata.google.internal in any env', () => {
            process.env.NODE_ENV = 'development';
            expect(() => validateUKApiUrl('http://metadata.google.internal/computeMetadata'))
                .toThrow('Blocked hostname: metadata.google.internal');
        });
    });

    describe('mandatory allowlist in production', () => {
        it('throws when UK_API_ALLOWED_HOSTS is not set in production', () => {
            process.env.NODE_ENV = 'production';
            delete process.env.UK_API_ALLOWED_HOSTS;
            expect(() => validateUKApiUrl('https://api.example.com/v1'))
                .toThrow('UK_API_ALLOWED_HOSTS must be configured in production');
        });

        it('does not require allowlist in development', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.UK_API_ALLOWED_HOSTS;
            expect(() => validateUKApiUrl('http://api.example.com/v1')).not.toThrow();
        });
    });

    describe('rejects hosts not in allowlist', () => {
        it('rejects host not in UK_API_ALLOWED_HOSTS', () => {
            process.env.NODE_ENV = 'development';
            process.env.UK_API_ALLOWED_HOSTS = 'allowed.example.com,other.example.com';
            expect(() => validateUKApiUrl('http://evil.example.com/api'))
                .toThrow('Host "evil.example.com" not in allowlist');
        });

        it('accepts host present in UK_API_ALLOWED_HOSTS', () => {
            process.env.NODE_ENV = 'development';
            process.env.UK_API_ALLOWED_HOSTS = 'allowed.example.com,other.example.com';
            expect(() => validateUKApiUrl('http://allowed.example.com/api')).not.toThrow();
        });

        it('trims whitespace in UK_API_ALLOWED_HOSTS entries', () => {
            process.env.NODE_ENV = 'development';
            process.env.UK_API_ALLOWED_HOSTS = ' allowed.example.com , other.example.com ';
            expect(() => validateUKApiUrl('http://allowed.example.com/api')).not.toThrow();
        });
    });

    describe('basic validation', () => {
        it('throws on null/undefined/empty', () => {
            expect(() => validateUKApiUrl(null)).toThrow('UK API URL is required');
            expect(() => validateUKApiUrl(undefined)).toThrow('UK API URL is required');
            expect(() => validateUKApiUrl('')).toThrow('UK API URL is required');
        });

        it('throws on non-string input', () => {
            expect(() => validateUKApiUrl(123)).toThrow('UK API URL is required');
        });

        it('throws on invalid URL', () => {
            expect(() => validateUKApiUrl('not-a-url')).toThrow('Invalid UK API URL');
        });
    });
});
