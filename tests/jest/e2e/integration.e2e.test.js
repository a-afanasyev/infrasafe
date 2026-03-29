const { login, registerAndLogin, authed } = require('./helpers/e2eHelper');

describe('E2E: UK Integration Admin', () => {
  let adminToken;

  beforeAll(async () => {
    const auth = await login('admin', 'admin123');
    adminToken = auth.accessToken;
  });

  test('GET /api/integration/config — returns config (admin)', async () => {
    const res = await authed(adminToken).get('/api/integration/config');
    expect(res.status).toBe(200);
  });

  test('GET /api/integration/logs — returns logs (admin)', async () => {
    const res = await authed(adminToken).get('/api/integration/logs');
    expect(res.status).toBe(200);
  });

  test('GET /api/integration/rules — returns alert rules (admin)', async () => {
    const res = await authed(adminToken).get('/api/integration/rules');
    expect(res.status).toBe(200);
  });

  test('Non-admin gets 403 on integration routes', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await authed(accessToken).get('/api/integration/config');
    expect(res.status).toBe(403);
  });
});
