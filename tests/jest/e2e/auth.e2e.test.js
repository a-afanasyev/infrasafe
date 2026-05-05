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

describe('E2E: POST /api/auth/change-password', () => {
  let testUser;
  const ORIG_PWD = 'TestPass123';
  const NEW_PWD = 'NewPass456';

  beforeAll(async () => {
    // Use a dedicated registered user — admin has 2FA mandatory which complicates flow.
    const username = `pwtest_${Date.now()}`;
    const email = `${username}@test.local`;
    const reg = await request(BASE_URL)
      .post('/api/auth/register')
      .send({ username, email, password: ORIG_PWD, full_name: 'PW Test' });
    if (reg.status !== 201 && reg.status !== 200) {
      throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    testUser = { username, email };
  });

  test('changes password and invalidates old tokens', async () => {
    const login1 = await loginFresh(testUser.username, ORIG_PWD);
    const access1 = login1.accessToken;
    const refresh1 = login1.refreshToken;
    expect(access1).toBeTruthy();

    // The cutoff middleware uses a 5-second skew to tolerate clock-drift between
    // replicas (see JWT_CUTOFF_SKEW_MS in authService.js). To assert that the
    // pre-change tokens are actually rejected, the JWT iat must be < (cutoff - 5s).
    // Wait 6 seconds so the post-change cutoff comfortably exceeds iat + skew.
    await new Promise((r) => setTimeout(r, 6100));

    const change = await authed(access1)
      .post('/api/auth/change-password')
      .send({ currentPassword: ORIG_PWD, newPassword: NEW_PWD });
    expect(change.status).toBe(200);
    expect(change.body.success).toBe(true);

    // Allow cache invalidation to propagate
    await new Promise((r) => setTimeout(r, 200));

    // Old access token now rejected
    const profileResp = await authed(access1).get('/api/auth/profile');
    expect(profileResp.status).toBe(401);

    // Old refresh token now rejected
    const refreshResp = await request(BASE_URL)
      .post('/api/auth/refresh')
      .send({ refreshToken: refresh1 });
    expect(refreshResp.status).toBe(401);

    // Old password rejected
    const oldLogin = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: testUser.username, password: ORIG_PWD });
    expect(oldLogin.status).toBe(401);

    // New password works
    const newLoginResp = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: testUser.username, password: NEW_PWD });
    expect(newLoginResp.status).toBe(200);
    expect(newLoginResp.body.accessToken).toBeTruthy();
  }, 30000);

  test('returns 400 for wrong current password', async () => {
    const { accessToken } = await loginFresh(testUser.username, NEW_PWD);
    const resp = await authed(accessToken)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'AnotherNew123' });
    expect(resp.status).toBe(400);
    expect(resp.body.error || resp.body.message || '').toMatch(/Неверный текущий пароль|current/i);
  });

  test('returns 400 for weak new password (INVALID_PASSWORD branch)', async () => {
    const { accessToken } = await loginFresh(testUser.username, NEW_PWD);
    const resp = await authed(accessToken)
      .post('/api/auth/change-password')
      .send({ currentPassword: NEW_PWD, newPassword: 'short' });
    expect(resp.status).toBe(400);
    expect(resp.body.error || resp.body.message).toMatch(/минимум 8|строчные|заглавн/);
  });

  test('rate-limits after 5 attempts within 15 min', async () => {
    // Use a fresh user so the per-user rate-limit bucket is empty.
    const rlUsername = `pwtest_rl_${Date.now()}`;
    const rlEmail = `${rlUsername}@test.local`;
    const rlPwd = 'TestPass123';
    const reg = await request(BASE_URL)
      .post('/api/auth/register')
      .send({ username: rlUsername, email: rlEmail, password: rlPwd, full_name: 'PW RL' });
    if (reg.status !== 201 && reg.status !== 200) {
      throw new Error(`rate-limit user register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    const { accessToken } = await loginFresh(rlUsername, rlPwd);

    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await authed(accessToken)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'wrong', newPassword: 'AnotherNew123' });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
