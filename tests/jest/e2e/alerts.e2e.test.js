const { login, authed, factory } = require('./helpers/e2eHelper');

describe('E2E: Alert Lifecycle', () => {
  let adminToken;
  let createdAlertId;

  beforeAll(async () => {
    const auth = await login('admin', 'admin123');
    adminToken = auth.accessToken;
  });

  test('GET /api/alerts — list active alerts', async () => {
    const res = await authed(adminToken).get('/api/alerts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('POST /api/alerts — create alert (requires type, infrastructure_id, infrastructure_type, severity, message)', async () => {
    const res = await authed(adminToken).post('/api/alerts').send(factory.alert());
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('alert_id');
    createdAlertId = res.body.data.alert_id;
  });

  test('PATCH /api/alerts/:alertId/acknowledge — acknowledge active alert', async () => {
    const res = await authed(adminToken).patch(`/api/alerts/${createdAlertId}/acknowledge`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('status', 'acknowledged');
  });

  test('PATCH /api/alerts/:alertId/resolve — resolve acknowledged alert', async () => {
    const res = await authed(adminToken).patch(`/api/alerts/${createdAlertId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('status', 'resolved');
  });

  test('POST /api/alerts — missing required fields returns 400', async () => {
    const res = await authed(adminToken).post('/api/alerts').send({ type: 'MISSING_FIELDS' });
    expect(res.status).toBe(400);
  });

  test('GET /api/alerts/statistics — alert stats', async () => {
    const res = await authed(adminToken).get('/api/alerts/statistics');
    expect(res.status).toBe(200);
  });

  test('GET /api/alerts/status — system status', async () => {
    const res = await authed(adminToken).get('/api/alerts/status');
    expect(res.status).toBe(200);
  });

  test('GET /api/alerts/thresholds — get thresholds', async () => {
    const res = await authed(adminToken).get('/api/alerts/thresholds');
    expect(res.status).toBe(200);
  });
});
