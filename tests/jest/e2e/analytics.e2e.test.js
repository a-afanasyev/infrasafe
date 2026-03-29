const { login, authed } = require('./helpers/e2eHelper');

describe('E2E: Analytics & Power Analytics', () => {
  let token;

  beforeAll(async () => {
    const auth = await login();
    token = auth.accessToken;
  });

  test('GET /api/analytics/status — system overview', async () => {
    const res = await authed(token).get('/api/analytics/status');
    expect(res.status).toBe(200);
  });

  test('GET /api/analytics/transformers — transformer list', async () => {
    const res = await authed(token).get('/api/analytics/transformers');
    expect(res.status).toBe(200);
  });

  test('GET /api/analytics/transformers/overloaded — overloaded list', async () => {
    const res = await authed(token).get('/api/analytics/transformers/overloaded');
    expect(res.status).toBe(200);
  });

  test('GET /api/analytics/transformers/statistics — stats', async () => {
    const res = await authed(token).get('/api/analytics/transformers/statistics');
    expect(res.status).toBe(200);
  });

  test('GET /api/power-analytics/buildings — building power data', async () => {
    const res = await authed(token).get('/api/power-analytics/buildings');
    expect(res.status).toBe(200);
  });

  test('GET /api/power-analytics/transformers — transformer power', async () => {
    const res = await authed(token).get('/api/power-analytics/transformers');
    expect(res.status).toBe(200);
  });

  test('GET /api/power-analytics/lines — line power', async () => {
    const res = await authed(token).get('/api/power-analytics/lines');
    expect(res.status).toBe(200);
  });
});
