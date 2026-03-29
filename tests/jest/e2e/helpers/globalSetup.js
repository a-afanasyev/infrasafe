/**
 * Global setup: login once before all E2E suites, store tokens in env vars
 * so every suite reuses the same token without hitting the rate limiter.
 */
const http = require('http');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(chunks) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function globalSetup() {
  const base = process.env.E2E_BASE_URL || 'http://localhost:3000';

  // Login as admin
  const admin = await post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
  if (admin.status !== 200) {
    throw new Error(`E2E globalSetup: admin login failed (${admin.status}). Is the API running?`);
  }
  process.env.E2E_ADMIN_TOKEN = admin.body.accessToken;
  process.env.E2E_ADMIN_REFRESH = admin.body.refreshToken;

  // Register and login as regular user
  const testUser = `e2e_testuser_${Date.now()}`;
  await post(`${base}/api/auth/register`, { username: testUser, password: 'TestPass123', email: `${testUser}@test.com` });
  const user = await post(`${base}/api/auth/login`, { username: testUser, password: 'TestPass123' });
  if (user.status !== 200) {
    throw new Error(`E2E globalSetup: test user login failed (${user.status})`);
  }
  process.env.E2E_USER_TOKEN = user.body.accessToken;
  process.env.E2E_USER_NAME = testUser;
};
