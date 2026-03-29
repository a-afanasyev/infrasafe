const { login, authed, factory, deleteBuilding, BASE_URL } = require('./helpers/e2eHelper');
const request = require('supertest');

describe('E2E: Metrics & Telemetry', () => {
  let token, buildingId, controllerId, serialNumber;

  beforeAll(async () => {
    const auth = await login();
    token = auth.accessToken;
    const bRes = await authed(token).post('/api/buildings').send(factory.building());
    buildingId = bRes.body.building_id;
    serialNumber = `E2E-TELE-${Date.now()}`;
    const cRes = await authed(token).post('/api/controllers').send(
      factory.controller(buildingId, { serial_number: serialNumber })
    );
    controllerId = cRes.body.controller_id;
  });

  afterAll(async () => {
    await deleteBuilding(token, buildingId);
  });

  test('GET /api/metrics — list metrics', async () => {
    const res = await authed(token).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('POST /api/metrics/telemetry — ingest telemetry for known controller (public, no auth)', async () => {
    const res = await request(BASE_URL)
      .post('/api/metrics/telemetry')
      .send(factory.telemetry(serialNumber));

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('controller_id', controllerId);
    expect(res.body).toHaveProperty('metric');
    expect(res.body.metric).toHaveProperty('controller_id', controllerId);
  });

  test('POST /api/metrics/telemetry — unknown serial returns 404', async () => {
    const res = await request(BASE_URL)
      .post('/api/metrics/telemetry')
      .send(factory.telemetry('NONEXISTENT-SERIAL-999'));

    expect(res.status).toBe(404);
  });

  test('GET /api/metrics — returns paginated metric list', async () => {
    const res = await authed(token).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
