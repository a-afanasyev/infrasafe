const { login, loginFresh, authed, anon, BASE_URL } = require('./helpers/e2eHelper');
const request = require('supertest');

describe('E2E: Auth Flow', () => {
  test('POST /api/auth/login — valid credentials returns tokens + user', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toHaveProperty('username', 'admin');
    expect(res.body.user).toHaveProperty('role', 'admin');
  });

  test('POST /api/auth/login — wrong password returns 401', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrongpass' });

    expect(res.status).toBe(401);
  });

  test('GET /api/auth/profile — with valid token returns user profile', async () => {
    const { accessToken } = await login();
    const res = await authed(accessToken).get('/api/auth/profile');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.user).toHaveProperty('username');
    expect(res.body.user).toHaveProperty('role');
  });

  test('POST /api/auth/refresh — returns new access token', async () => {
    const { refreshToken } = await loginFresh('admin', 'admin123');
    const res = await request(BASE_URL)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });

  test('Protected route without token — returns 401', async () => {
    const res = await anon().get('/api/buildings');
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/logout — invalidates token', async () => {
    const { accessToken } = await loginFresh('admin', 'admin123');
    const logoutRes = await authed(accessToken).post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
  });

  test('POST /api/auth/register + login — new user flow', async () => {
    const username = `e2e_user_${Date.now()}`;
    const regRes = await request(BASE_URL)
      .post('/api/auth/register')
      .send({ username, password: 'TestPass123', email: `${username}@test.com` });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user).toHaveProperty('username', username);

    const loginRes = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username, password: 'TestPass123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('accessToken');
  });
});
