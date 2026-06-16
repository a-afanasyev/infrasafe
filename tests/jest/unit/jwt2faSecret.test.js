/**
 * [SEC-34h] 2FA temp-tokens are signed/verified with a SEPARATE secret
 * (JWT_2FA_SECRET), not the access-token JWT_SECRET.
 *
 * Rationale: the 2FA temp-token (scope:'2fa') is a distinct credential class
 * with a distinct trust boundary. Signing it under the same key as full
 * access tokens means a leak/rotation of one forces the other, and couples
 * the blast radius. With a dedicated secret, a token signed under the old
 * shared access secret must NOT verify as a temp-token once the secrets
 * diverge.
 *
 * These tests use the *real* jsonwebtoken module so we assert actual
 * signature behavior, not mock shapes.
 */

const jwt = require('jsonwebtoken');

const authService = require('../../../src/services/authService');

describe('[SEC-34h] temp-token uses JWT_2FA_SECRET, not JWT_SECRET', () => {
    const ACCESS_SECRET = 'unit-access-secret-aaa';
    const TFA_SECRET = 'unit-2fa-secret-bbb';
    const ISSUER = 'infrasafe-api';
    const AUDIENCE = 'infrasafe-client';

    let origJwtSecret;
    let origJwt2faSecret;

    beforeEach(() => {
        origJwtSecret = authService.jwtSecret;
        origJwt2faSecret = authService.jwt2faSecret;
        // Diverge the two secrets so the separation is observable.
        authService.jwtSecret = ACCESS_SECRET;
        authService.jwt2faSecret = TFA_SECRET;
    });

    afterEach(() => {
        authService.jwtSecret = origJwtSecret;
        authService.jwt2faSecret = origJwt2faSecret;
        jest.restoreAllMocks();
    });

    test('generateTempToken signs with JWT_2FA_SECRET (verifies under 2fa secret, not access secret)', () => {
        const token = authService.generateTempToken({ user_id: 7, username: 'u', role: 'admin' });

        // Verifies under the 2FA secret.
        const decoded = jwt.verify(token, TFA_SECRET, {
            algorithms: ['HS256'],
            issuer: ISSUER,
            audience: AUDIENCE,
        });
        expect(decoded.scope).toBe('2fa');
        expect(decoded.user_id).toBe(7);

        // Does NOT verify under the access secret.
        expect(() =>
            jwt.verify(token, ACCESS_SECRET, {
                algorithms: ['HS256'],
                issuer: ISSUER,
                audience: AUDIENCE,
            })
        ).toThrow(jwt.JsonWebTokenError);
    });

    test('verifyTempToken accepts a token signed with JWT_2FA_SECRET', async () => {
        const token = jwt.sign(
            { user_id: 7, username: 'u', role: 'admin', scope: '2fa' },
            TFA_SECRET,
            { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
        );

        jest
            .spyOn(authService, 'findUserById')
            .mockResolvedValue({ user_id: 7, username: 'u', role: 'admin', password_changed_at: null });

        const decoded = await authService.verifyTempToken(token);
        expect(decoded.scope).toBe('2fa');
        expect(decoded.user_id).toBe(7);
    });

    test('verifyTempToken rejects a token signed with the OLD shared access secret once secrets diverge', async () => {
        const tokenUnderAccessSecret = jwt.sign(
            { user_id: 7, username: 'u', role: 'admin', scope: '2fa' },
            ACCESS_SECRET,
            { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' }
        );

        await expect(authService.verifyTempToken(tokenUnderAccessSecret)).rejects.toThrow();
    });
});
