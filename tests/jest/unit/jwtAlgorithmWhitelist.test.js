/**
 * [P1-V3] Regression: alg-confusion / RS-HS swap attack must be rejected.
 *
 * Six jwt.verify callsites now pass { algorithms: ['HS256'] } explicitly.
 * Without the whitelist, jsonwebtoken honors the `alg` claim from the
 * incoming token header — which permits the well-known RS256→HS256
 * confusion attack (an attacker signs with the public key as if it were
 * an HMAC secret).
 *
 * These tests exercise the *real* jsonwebtoken module (not mocked) so we
 * verify the actual options that we pass downstream, not just the JS
 * shape of our middleware.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

describe('[P1-V3] JWT algorithms whitelist — RS256→HS256 confusion blocked', () => {
    const HS_SECRET = 'unit-test-hs-secret';
    const ISSUER = 'infrasafe-api';
    const AUDIENCE = 'infrasafe-client';

    let rsaPrivateKey;
    let rsaPublicKey;

    beforeAll(() => {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        rsaPrivateKey = privateKey;
        rsaPublicKey = publicKey;
    });

    test('HS256 token is accepted when algorithms whitelist matches', () => {
        const token = jwt.sign(
            { user_id: 42 },
            HS_SECRET,
            { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
        );

        const decoded = jwt.verify(token, HS_SECRET, {
            algorithms: ['HS256'],
            issuer: ISSUER,
            audience: AUDIENCE
        });

        expect(decoded.user_id).toBe(42);
    });

    test('RS256-signed token verified with HS256 whitelist is rejected', () => {
        const rs256Token = jwt.sign(
            { user_id: 999 },
            rsaPrivateKey,
            { algorithm: 'RS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
        );

        // Classic alg-confusion: attacker uses RS256 public key as if it
        // were the HS256 shared secret. Without algorithms: ['HS256'],
        // jsonwebtoken trusts the token's `alg` header.
        expect(() => {
            jwt.verify(rs256Token, rsaPublicKey, {
                algorithms: ['HS256'],
                issuer: ISSUER,
                audience: AUDIENCE
            });
        }).toThrow(jwt.JsonWebTokenError);
    });

    test('alg=none token is rejected even when "none" is in the whitelist would be unsafe (sanity)', () => {
        // node-jsonwebtoken disallows alg=none in v9+ regardless; this test
        // pins that behavior for our deployment.
        const noneToken =
            Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
            '.' +
            Buffer.from(JSON.stringify({ user_id: 1, iss: ISSUER, aud: AUDIENCE })).toString('base64url') +
            '.';

        expect(() => {
            jwt.verify(noneToken, HS_SECRET, {
                algorithms: ['HS256'],
                issuer: ISSUER,
                audience: AUDIENCE
            });
        }).toThrow(jwt.JsonWebTokenError);
    });

    describe('verifyTempToken applies the whitelist via authService', () => {
        const authService = require('../../../src/services/authService');
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv, JWT_SECRET: HS_SECRET };
            // Force the service to pick up the new env-derived secret. The
            // singleton caches jwtSecret at construction; mutate directly so
            // we don't depend on require-cache invalidation in tests.
            authService.jwtSecret = HS_SECRET;
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        test('rejects RS256-signed token even when payload includes scope:2fa', async () => {
            const rsTemp = jwt.sign(
                { user_id: 7, scope: '2fa' },
                rsaPrivateKey,
                { algorithm: 'RS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
            );

            // SEC-4: verifyTempToken is now async (adds a cutoff check after
            // signature verification). The signature whitelist still rejects
            // the RS256 token before any user lookup.
            await expect(authService.verifyTempToken(rsTemp)).rejects.toThrow();
        });

        test('accepts HS256 token with scope:2fa', async () => {
            const okTemp = jwt.sign(
                { user_id: 7, scope: '2fa' },
                HS_SECRET,
                { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
            );

            // SEC-4: verifyTempToken now looks up the user for the cutoff check.
            const findUserSpy = jest
                .spyOn(authService, 'findUserById')
                .mockResolvedValue({ user_id: 7, username: 'u', role: 'admin', password_changed_at: null });

            const decoded = await authService.verifyTempToken(okTemp);
            expect(decoded.scope).toBe('2fa');
            expect(decoded.user_id).toBe(7);

            findUserSpy.mockRestore();
        });

        // SEC-4: a temp token issued before a mid-session password change must
        // be rejected, mirroring the access/refresh cutoff enforcement.
        test('rejects HS256 scope:2fa token issued before password_changed_at', async () => {
            const okTemp = jwt.sign(
                { user_id: 7, scope: '2fa' },
                HS_SECRET,
                { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
            );

            // Password changed an hour in the future relative to the token's iat
            // → _isIssuedBeforeCutoff returns true.
            const findUserSpy = jest
                .spyOn(authService, 'findUserById')
                .mockResolvedValue({
                    user_id: 7,
                    username: 'u',
                    role: 'admin',
                    password_changed_at: new Date(Date.now() + 3600 * 1000).toISOString()
                });

            await expect(authService.verifyTempToken(okTemp)).rejects.toThrow(
                /password change/i
            );

            findUserSpy.mockRestore();
        });
    });
});
