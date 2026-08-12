const { login, loginFresh, authed, anon, registerUser, BASE_URL } = require('./helpers/e2eHelper');
const request = require('supertest');

const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:3000';

// [#150] Auth contract today: tokens are HttpOnly cookies (NOT echoed in the body),
// and admin login is gated behind mandatory TOTP 2FA. These suites assert that
// contract (Set-Cookie / requires2FA), not the old Bearer/body-token one.
function hasCookie(res, name) {
  return (res.headers['set-cookie'] || []).some((c) => c.startsWith(`${name}=`));
}

describe('E2E: Auth Flow', () => {
  test('POST /api/auth/login — admin login requires 2FA (no tokens in body)', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    // Admin always goes through 2FA — either verify (configured) or setup.
    expect(res.body.requires2FA || res.body.requires2FASetup).toBe(true);
    // [M-4] Промежуточный токен уехал в HttpOnly-куку: в теле его быть НЕ
    // должно, а Set-Cookie на него — должен.
    expect(res.body).not.toHaveProperty('tempToken');
    expect(res.body).not.toHaveProperty('accessToken');
    expect((res.headers['set-cookie'] || []).join(';')).toMatch(/temp_token=/);
  });

  test('POST /api/auth/login — wrong password returns 401', async () => {
    // Fresh user so admin lockout / rate-limit state can't interfere.
    const u = `e2e_wrongpw_${Date.now()}`;
    await registerUser(u);
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ username: u, password: 'definitely-wrong' });

    expect(res.status).toBe(401);
  });

  test('GET /api/auth/profile — with valid session returns user profile', async () => {
    const { accessToken } = await login();
    const res = await authed(accessToken).get('/api/auth/profile');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.user).toHaveProperty('username');
    expect(res.body.user).toHaveProperty('role');
  });

  test('POST /api/auth/refresh — issues a new access cookie', async () => {
    // Use a fresh non-admin session (admin would need the 2FA dance).
    const u = `e2e_refresh_${Date.now()}`;
    await registerUser(u);
    const { refreshToken } = await loginFresh(u);

    const res = await request(BASE_URL)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(hasCookie(res, 'access_token')).toBe(true);
  });

  test('Protected route without session — returns 401', async () => {
    const res = await anon().get('/api/buildings');
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/logout — succeeds and clears cookies', async () => {
    const u = `e2e_logout_${Date.now()}`;
    await registerUser(u);
    const { accessToken } = await loginFresh(u);

    const logoutRes = await authed(accessToken).post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
  });

  test('POST /api/auth/register (admin) + login — sets the auth cookie [R2-01]', async () => {
    const username = `e2e_user_${Date.now()}`;
    const regRes = await request(BASE_URL)
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', process.env.E2E_ADMIN_COOKIE)
      .send({ username, password: 'TestPass123', email: `${username}@test.com` });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user).toHaveProperty('username', username);

    const loginRes = await request(BASE_URL)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ username, password: 'TestPass123' });

    expect(loginRes.status).toBe(200);
    expect(hasCookie(loginRes, 'access_token')).toBe(true);
  });

  test('POST /api/auth/register — anonymous is rejected (admin-only) [R2-01]', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .send({ username: `e2e_anon_${Date.now()}`, password: 'TestPass123', email: 'a@test.com' });

    // No token → default-deny gate returns 401 before the handler.
    expect(res.status).toBe(401);
  });
});

describe('E2E: POST /api/auth/change-password', () => {
  let testUser;
  const ORIG_PWD = 'TestPass123';
  const NEW_PWD = 'NewPass456';

  beforeAll(async () => {
    // A dedicated registered (non-admin) user — admin has mandatory 2FA.
    const username = `pwtest_${Date.now()}`;
    const email = `${username}@test.local`;
    const reg = await request(BASE_URL)
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', process.env.E2E_ADMIN_COOKIE)  // [R2-01] register is admin-only
      .send({ username, email, password: ORIG_PWD, full_name: 'PW Test' });
    if (reg.status !== 201 && reg.status !== 200) {
      throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    testUser = { username, email };
  });

  test('changes password and invalidates old session', async () => {
    const login1 = await loginFresh(testUser.username, ORIG_PWD);
    const access1 = login1.accessToken;
    const refresh1 = login1.refreshToken;
    expect(access1).toBeTruthy();

    // The cutoff middleware uses a 5-second skew to tolerate clock-drift between
    // replicas (JWT_CUTOFF_SKEW_MS). To assert pre-change tokens are rejected, the
    // JWT iat must be < (cutoff - 5s). Wait 6s so the cutoff exceeds iat + skew.
    await new Promise((r) => setTimeout(r, 6100));

    const change = await authed(access1)
      .post('/api/auth/change-password')
      .send({ currentPassword: ORIG_PWD, newPassword: NEW_PWD });
    expect(change.status).toBe(200);
    expect(change.body.success).toBe(true);

    await new Promise((r) => setTimeout(r, 200));

    // Old access session now rejected
    const profileResp = await authed(access1).get('/api/auth/profile');
    expect(profileResp.status).toBe(401);

    // Old refresh token now rejected
    const refreshResp = await request(BASE_URL)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .send({ refreshToken: refresh1 });
    expect(refreshResp.status).toBe(401);

    // Old password rejected
    const oldLogin = await request(BASE_URL)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ username: testUser.username, password: ORIG_PWD });
    expect(oldLogin.status).toBe(401);

    // New password works (cookie issued)
    const newLoginResp = await request(BASE_URL)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ username: testUser.username, password: NEW_PWD });
    expect(newLoginResp.status).toBe(200);
    expect((newLoginResp.headers['set-cookie'] || []).some((c) => c.startsWith('access_token='))).toBe(true);
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

  // [M-5] Пять неверных попыток блокируют АККАУНТ, а не только адрес.
  //
  // До M-5 проверка текущего пароля не считалась в блокировке, и шестую попытку
  // отбивал per-IP лимитер — этот тест ждал 429. Теперь на пятой попытке
  // срабатывает блокировка аккаунта, и шестой запрос отвергает уже
  // auth-middleware: 401 ещё до маршрута.
  //
  // Следствие названо прямо, потому что оно ощутимо: пять опечаток в своём же
  // текущем пароле выкидывают пользователя из приложения на ~15 минут (плюс
  // джиттер). Это та самая плата за закрытие бесплатного оракула пароля —
  // порог тот же, что и на форме входа, отдельного заводить не стали. Лимитер
  // по IP никуда не делся, но на этом маршруте его теперь опережает более
  // сильная защита.
  test('пять неверных попыток блокируют аккаунт, шестая отвергается middleware', async () => {
    const rlUsername = `pwtest_rl_${Date.now()}`;
    const rlPwd = 'TestPass123';
    await registerUser(rlUsername, rlPwd);
    const { accessToken } = await loginFresh(rlUsername, rlPwd);

    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await authed(accessToken)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'wrong', newPassword: 'AnotherNew123' });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
    // 401 — блокировка аккаунта (M-5). 429 — лимитер по IP, если порядок
    // сработавших защит когда-нибудь изменится. Оба ответа означают «дальше
    // подбирать нельзя»; чего быть НЕ должно — это очередной 400.
    expect([401, 429]).toContain(codes[5]);
  });
});
