/**
 * E2E Test Helper — hits the REAL running API (Docker containers).
 * Requires: docker compose -f docker-compose.dev.yml up
 */
const request = require('supertest');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

/** Get admin token from globalSetup (no login request needed) */
function login(username = 'admin', password = 'admin123') {
  if (username === 'admin' && process.env.E2E_ADMIN_TOKEN) {
    return Promise.resolve({
      accessToken: process.env.E2E_ADMIN_TOKEN,
      refreshToken: process.env.E2E_ADMIN_REFRESH || '',
      user: { username: 'admin', role: 'admin' },
    });
  }
  // For non-admin users, do a real login
  return request(BASE_URL)
    .post('/api/auth/login')
    .send({ username, password })
    .then((res) => {
      if (res.status !== 200) throw new Error(`login(${username}) got ${res.status}`);
      return {
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        user: res.body.user,
      };
    });
}

/** Login without cache (for tests that need a fresh token, e.g. logout, refresh) */
async function loginFresh(username = 'admin', password = 'admin123') {
  const res = await request(BASE_URL)
    .post('/api/auth/login')
    .send({ username, password });
  if (res.status !== 200) throw new Error(`loginFresh(${username}) got ${res.status}: ${JSON.stringify(res.body)}`);
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    user: res.body.user,
  };
}

/** Shorthand: create authenticated supertest agent */
function authed(token) {
  return {
    get: (url) => request(BASE_URL).get(url).set('Authorization', `Bearer ${token}`),
    post: (url) => request(BASE_URL).post(url).set('Authorization', `Bearer ${token}`),
    put: (url) => request(BASE_URL).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url) => request(BASE_URL).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url) => request(BASE_URL).delete(url).set('Authorization', `Bearer ${token}`),
  };
}

async function registerUser(username, password = 'TestPass123') {
  const email = `${username}@test.com`;
  const res = await request(BASE_URL)
    .post('/api/auth/register')
    .send({ username, password, email });

  // 201 = created, 409 = already exists
  if (![201, 409].includes(res.status)) {
    throw new Error(`registerUser(${username}) failed with ${res.status}`);
  }

  return { username, password, email };
}

/** Register a new user and login. For non-admin role tests, use the pre-cached E2E_USER_TOKEN. */
async function registerAndLogin(username, password = 'TestPass123') {
  // Use pre-created test user from globalSetup to avoid rate limiting
  if (!username && process.env.E2E_USER_TOKEN) {
    return {
      username: process.env.E2E_USER_NAME,
      password,
      accessToken: process.env.E2E_USER_TOKEN,
      user: { username: process.env.E2E_USER_NAME, role: 'user' },
    };
  }
  const name = username || `e2e_user_${Date.now()}`;
  await registerUser(name, password);
  const auth = await login(name, password);
  return { username: name, password, ...auth };
}

/** Unauthenticated request */
function anon() {
  return {
    get: (url) => request(BASE_URL).get(url),
    post: (url) => request(BASE_URL).post(url),
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
 *  Without ?cascade=true the API returns 400 if building has controllers. */
async function deleteBuilding(token, id) {
  const res = await request(BASE_URL)
    .delete(`/api/buildings/${id}?cascade=true`)
    .set('Authorization', `Bearer ${token}`)
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
