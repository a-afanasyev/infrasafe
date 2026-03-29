const { login, authed } = require('./helpers/e2eHelper');

describe('E2E: Infrastructure Endpoints', () => {
  let token;

  beforeAll(async () => {
    const auth = await login();
    token = auth.accessToken;
  });

  test('GET /api/transformers — list', async () => {
    const res = await authed(token).get('/api/transformers');
    expect(res.status).toBe(200);
  });

  test('GET /api/lines — list', async () => {
    const res = await authed(token).get('/api/lines');
    expect(res.status).toBe(200);
  });

  test('GET /api/cold-water-sources — list', async () => {
    const res = await authed(token).get('/api/cold-water-sources');
    expect(res.status).toBe(200);
  });

  test('GET /api/heat-sources — list', async () => {
    const res = await authed(token).get('/api/heat-sources');
    expect(res.status).toBe(200);
  });

  test('GET /api/water-lines — list', async () => {
    const res = await authed(token).get('/api/water-lines');
    expect(res.status).toBe(200);
  });

  test('GET /api/water-suppliers — list', async () => {
    const res = await authed(token).get('/api/water-suppliers');
    expect(res.status).toBe(200);
  });
});
