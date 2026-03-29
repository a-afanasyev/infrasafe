const { login, registerAndLogin, authed } = require('./helpers/e2eHelper');

describe('E2E: Admin Operations', () => {
  let adminToken;

  beforeAll(async () => {
    const auth = await login('admin', 'admin123');
    adminToken = auth.accessToken;
  });

  test('GET /api/admin/stats — admin dashboard stats', async () => {
    const res = await authed(adminToken).get('/api/admin/stats');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/search?q=test — global search', async () => {
    const res = await authed(adminToken).get('/api/admin/search?q=test');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/buildings — optimized building list', async () => {
    const res = await authed(adminToken).get('/api/admin/buildings');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/controllers — optimized controller list', async () => {
    const res = await authed(adminToken).get('/api/admin/controllers');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/metrics — optimized metrics list', async () => {
    const res = await authed(adminToken).get('/api/admin/metrics');
    expect(res.status).toBe(200);
  });

  test('Non-admin user gets 403 on admin routes', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await authed(accessToken).get('/api/admin/stats');
    expect(res.status).toBe(403);
  });
});
