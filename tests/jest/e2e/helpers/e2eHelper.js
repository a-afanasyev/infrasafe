/**
 * E2E Test Helper — hits the REAL running API (Docker containers).
 * Requires: docker compose -f docker-compose.dev.yml up
 *
 * [#150] Auth is cookie-based now (HttpOnly access_token / refresh_token), not
 * Bearer tokens in the body. `login()`/`registerAndLogin()` return the Cookie
 * header STRING in the `accessToken` field (kept for back-compat with existing
 * suites that do `const { accessToken } = await login(); authed(accessToken)…`),
 * and `authed()` sends it as `Cookie` plus an allowed `Origin` (SEC-23 CSRF guard).
 */
const request = require('supertest');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:3000';

// Set-Cookie array → "name=value; name=value" Cookie request header.
function cookieHeader(setCookie) {
  return (setCookie || []).map((c) => c.split(';')[0]).join('; ');
}

// Pull the refresh_token VALUE out of a Cookie header string (the refresh endpoint
// also accepts it in the body).
function refreshTokenFromCookie(cookie) {
  const m = (cookie || '').match(/(?:^|;\s*)refresh_token=([^;]+)/);
  return m ? m[1] : '';
}

/** Cached admin session (cookie) from globalSetup — no login request needed. */
function login(username = 'admin', password = 'admin123') {
  if (username === 'admin' && process.env.E2E_ADMIN_COOKIE) {
    const cookie = process.env.E2E_ADMIN_COOKIE;
    return Promise.resolve({
      accessToken: cookie, // back-compat: callers pass this into authed()
      cookie,
      refreshToken: refreshTokenFromCookie(cookie),
      user: { username: 'admin', role: 'admin' },
    });
  }
  // Non-admin: real login (no 2FA) → cookies on the response.
  return request(BASE_URL)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .send({ username, password })
    .then((res) => {
      if (res.status !== 200) throw new Error(`login(${username}) got ${res.status}`);
      const cookie = cookieHeader(res.headers['set-cookie']);
      return { accessToken: cookie, cookie, refreshToken: refreshTokenFromCookie(cookie), user: res.body.user };
    });
}

/**
 * Fresh, uncached cookie session — for tests that mutate session state (logout,
 * refresh, password change) and must not disturb the shared cached session.
 * Only valid for NON-admin users (admin needs the 2FA dance done in globalSetup);
 * callers should register a throwaway user first.
 */
async function loginFresh(username, password = 'TestPass123') {
  const res = await request(BASE_URL)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .send({ username, password });
  if (res.status !== 200) {
    throw new Error(`loginFresh(${username}) got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (res.body.requires2FA || res.body.requires2FASetup) {
    throw new Error(`loginFresh(${username}) hit 2FA — use a non-admin user for fresh sessions`);
  }
  const cookie = cookieHeader(res.headers['set-cookie']);
  return { accessToken: cookie, cookie, refreshToken: refreshTokenFromCookie(cookie), user: res.body.user };
}

/** Authenticated supertest agent — cookie auth + allowed Origin (CSRF). */
function authed(cookie) {
  const withAuth = (method, url) =>
    request(BASE_URL)[method](url).set('Cookie', cookie).set('Origin', ORIGIN);
  return {
    get: (url) => withAuth('get', url),
    post: (url) => withAuth('post', url),
    put: (url) => withAuth('put', url),
    patch: (url) => withAuth('patch', url),
    delete: (url) => withAuth('delete', url),
  };
}

// [R2-01] Registration is admin-only. globalSetup caches an admin Cookie header in
// E2E_ADMIN_COOKIE; send it so fresh test users can still be created.
async function registerUser(username, password = 'TestPass123') {
  const email = `${username}@test.com`;
  const adminCookie = process.env.E2E_ADMIN_COOKIE;
  if (!adminCookie) {
    throw new Error('registerUser: E2E_ADMIN_COOKIE not set (globalSetup must run first)');
  }
  const res = await request(BASE_URL)
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('Cookie', adminCookie)
    .send({ username, password, email });

  // 201 = created, 409 = already exists
  if (![201, 409].includes(res.status)) {
    throw new Error(`registerUser(${username}) failed with ${res.status}`);
  }

  return { username, password, email };
}

/** Register a new user and login. With no args, reuses the cached test user. */
async function registerAndLogin(username, password = 'TestPass123') {
  if (!username && process.env.E2E_USER_COOKIE) {
    const cookie = process.env.E2E_USER_COOKIE;
    return {
      username: process.env.E2E_USER_NAME,
      password,
      accessToken: cookie,
      cookie,
      refreshToken: refreshTokenFromCookie(cookie),
      user: { username: process.env.E2E_USER_NAME, role: 'user' },
    };
  }
  const name = username || `e2e_user_${Date.now()}`;
  await registerUser(name, password);
  const auth = await login(name, password);
  return { username: name, password, ...auth };
}

/** Unauthenticated request (still sends an allowed Origin for parity). */
function anon() {
  return {
    get: (url) => request(BASE_URL).get(url).set('Origin', ORIGIN),
    post: (url) => request(BASE_URL).post(url).set('Origin', ORIGIN),
  };
}

/** Test data factories */
const factory = {
  building: (overrides = {}) => ({
    name: `E2E-Building-${Date.now()}`,
    address: `ул. Тестовая ${Math.floor(Math.random() * 100)}`,
    town: 'Ташкент',
    latitude: 41.311 + Math.random() * 0.01,
    longitude: 69.280 + Math.random() * 0.01,
    floors: 9,
    ...overrides,
  }),
  controller: (buildingId, overrides = {}) => ({
    serial_number: `E2E-CTRL-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    vendor: 'TestVendor',
    model: 'E2E-Model',
    building_id: buildingId,
    status: 'online',
    ...overrides,
  }),
  telemetry: (serialNumber, overrides = {}) => ({
    serial_number: serialNumber,
    timestamp: new Date().toISOString(),
    metrics: {
      electricity_ph1: 220 + Math.random() * 10,
      electricity_ph2: 221 + Math.random() * 10,
      electricity_ph3: 219 + Math.random() * 10,
      cold_water_pressure: 3.5 + Math.random(),
      cold_water_temp: 12 + Math.random() * 3,
      air_temp: 21 + Math.random() * 3,
      humidity: 45 + Math.random() * 15,
    },
    ...overrides,
  }),
  alert: (overrides = {}) => ({
    type: 'TRANSFORMER_OVERLOAD',
    infrastructure_id: '1',
    infrastructure_type: 'transformer',
    severity: 'WARNING',
    message: `E2E test alert ${Date.now()}`,
    ...overrides,
  }),
};

/** Cleanup helper — delete a building by ID with cascade (controllers/metrics).
 *  Without ?cascade=true the API returns 400 if building has controllers.
 *  `cookie` is the Cookie header string (back-compat: tests pass `accessToken`). */
async function deleteBuilding(cookie, id) {
  const res = await request(BASE_URL)
    .delete(`/api/buildings/${id}?cascade=true`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .catch(() => null);
  if (res && res.status !== 200 && res.status !== 404) {
    console.warn(`deleteBuilding(${id}) cleanup returned ${res.status}`);
  }
}

module.exports = {
  BASE_URL,
  login,
  loginFresh,
  registerUser,
  registerAndLogin,
  authed,
  anon,
  factory,
  deleteBuilding,
};
