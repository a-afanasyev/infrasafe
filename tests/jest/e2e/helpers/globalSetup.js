/**
 * Global E2E setup [#150] — authenticate ONCE via the CURRENT auth contract and
 * stash the resulting Cookie-header strings in env so every suite reuses them
 * (avoids the auth rate limiter).
 *
 * Why this was rewritten: the old setup read `body.accessToken` and sent it as a
 * Bearer header. Two things changed under it:
 *   1. Tokens are HttpOnly cookies now — NOT echoed in the response body
 *      ([1A-FU2-S-M2]) — so body.accessToken is always undefined.
 *   2. Admin login is gated behind mandatory TOTP 2FA — a plain login returns
 *      { requires2FA | requires2FASetup, tempToken }, never tokens.
 *
 * So we now: (a) reset the admin's 2FA in the DB for re-runnability (the secret is
 * AES-encrypted, so we can't seed a known one — we must drive setup→confirm and
 * read the plaintext secret it returns), (b) drive login → setup-2fa → confirm-2fa
 * with an otplib-generated code, and (c) capture Set-Cookie into a Cookie string.
 * A regular (non-admin) user needs no 2FA — register + login is enough.
 */
const request = require('supertest');
const otplib = require('otplib');
const { Client } = require('pg');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
// CSRF Origin guard (SEC-23): cookie-auth mutations require an allowed Origin.
const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:3000';

// Set-Cookie array → "name=value; name=value" for the Cookie request header.
function cookieHeader(setCookie) {
  return (setCookie || []).map((c) => c.split(';')[0]).join('; ');
}

// Clear the admin's 2FA so login returns requires2FASetup → we can read a fresh
// plaintext secret from setup-2fa. Best-effort: fresh CI containers already have an
// unconfigured admin, so a DB failure here is non-fatal — adminCookies() surfaces a
// clear error only if login then reports requires2FA (already configured).
async function resetAdmin2FA() {
  const client = new Client({
    host: process.env.E2E_DB_HOST || 'localhost',
    port: parseInt(process.env.E2E_DB_PORT || '5435', 10),
    user: process.env.E2E_DB_USER || 'postgres',
    password: process.env.E2E_DB_PASSWORD || 'postgres',
    database: process.env.E2E_DB_NAME || 'infrasafe',
  });
  try {
    await client.connect();
    await client.query(
      "UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = NULL WHERE username = 'admin'"
    );
  } catch (e) {
    console.warn(`[e2e setup] admin 2FA reset skipped (${e.message})`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function adminCookies() {
  await resetAdmin2FA();

  const login = await request(BASE).post('/api/auth/login').set('Origin', ORIGIN)
    .send({ username: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    throw new Error(`[e2e setup] admin login failed (${login.status}). Is the API running?`);
  }

  // Already-configured admin and the reset didn't take (no DB access) → we have no
  // secret to compute a code. Fail with an actionable message.
  if (login.body.requires2FA) {
    throw new Error('[e2e setup] admin has 2FA configured and the reset failed — run '
      + 'against fresh containers, or set E2E_DB_HOST/PORT/USER/PASSWORD/NAME so the '
      + 'setup can reset it.');
  }

  // Older build with no 2FA gate: cookies are already on the login response.
  if (!login.body.requires2FASetup) {
    const cookies = cookieHeader(login.headers['set-cookie']);
    if (!cookies) throw new Error('[e2e setup] admin login returned no cookies');
    return cookies;
  }

  const { tempToken } = login.body;
  const setup = await request(BASE).post('/api/auth/setup-2fa').set('Origin', ORIGIN)
    .send({ tempToken });
  if (setup.status !== 200 || !setup.body.secret) {
    throw new Error(`[e2e setup] setup-2fa failed (${setup.status})`);
  }

  const code = String(otplib.generateSync({ secret: setup.body.secret }));
  const confirm = await request(BASE).post('/api/auth/confirm-2fa').set('Origin', ORIGIN)
    .send({ tempToken, code });
  if (confirm.status !== 200) {
    throw new Error(`[e2e setup] confirm-2fa failed (${confirm.status}): ${JSON.stringify(confirm.body)}`);
  }

  const cookies = cookieHeader(confirm.headers['set-cookie']);
  if (!cookies) throw new Error('[e2e setup] confirm-2fa returned no cookies');
  return cookies;
}

// [R2-01] Registration is now admin-only. The admin cookie (obtained first in
// globalSetup) must accompany the register call, otherwise it 401/403s.
async function userCookies(adminCookie) {
  const name = `e2e_testuser_${Date.now()}`;
  const reg = await request(BASE).post('/api/auth/register')
    .set('Origin', ORIGIN).set('Cookie', adminCookie)
    .send({ username: name, password: 'TestPass123', email: `${name}@test.com` });
  if (![201, 409].includes(reg.status)) {
    throw new Error(`[e2e setup] admin-register of test user failed (${reg.status}): ${JSON.stringify(reg.body)}`);
  }
  const login = await request(BASE).post('/api/auth/login').set('Origin', ORIGIN)
    .send({ username: name, password: 'TestPass123' });
  if (login.status !== 200) {
    throw new Error(`[e2e setup] test user login failed (${login.status})`);
  }
  const cookies = cookieHeader(login.headers['set-cookie']);
  if (!cookies) throw new Error('[e2e setup] test user login returned no cookies');
  return { cookies, name };
}

module.exports = async function globalSetup() {
  const adminCookie = await adminCookies();
  process.env.E2E_ADMIN_COOKIE = adminCookie;
  const user = await userCookies(adminCookie);
  process.env.E2E_USER_COOKIE = user.cookies;
  process.env.E2E_USER_NAME = user.name;
};
