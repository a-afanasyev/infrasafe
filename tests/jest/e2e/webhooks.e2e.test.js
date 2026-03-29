const { BASE_URL, login, authed } = require('./helpers/e2eHelper');
const request = require('supertest');
const crypto = require('crypto');

function signPayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('E2E: UK Webhooks', () => {
  const WEBHOOK_SECRET = process.env.UK_WEBHOOK_SECRET || '';
  const ENABLE_FULL_WEBHOOK_E2E = process.env.E2E_ENABLE_UK_INTEGRATION === 'true';
  let adminToken;

  beforeAll(async () => {
    if (ENABLE_FULL_WEBHOOK_E2E) {
      const auth = await login('admin', 'admin123');
      adminToken = auth.accessToken;
      await authed(adminToken)
        .put('/api/integration/config')
        .send({ uk_integration_enabled: 'true' });
    }
  });

  test('POST /api/webhooks/uk/building — guard returns 503 when disabled or 401 when signature missing', async () => {
    const res = await request(BASE_URL)
      .post('/api/webhooks/uk/building')
      .send({
        event_id: crypto.randomUUID(),
        event: 'building.created',
        building: { id: 900001, name: 'Guard Building', address: 'ул. Тестовая 1', town: 'Ташкент' },
      });

    expect([401, 503]).toContain(res.status);
  });

  test('POST /api/webhooks/uk/building — invalid signature returns 401 (or 503 when disabled)', async () => {
    const res = await request(BASE_URL)
      .post('/api/webhooks/uk/building')
      .set('X-Webhook-Signature', 'invalid')
      .send({
        event_id: crypto.randomUUID(),
        event: 'building.created',
        building: { id: 900002, name: 'Invalid Sig Building', address: 'ул. Тестовая 2', town: 'Ташкент' },
      });

    expect([401, 503]).toContain(res.status);
  });

  const canTestHmac = WEBHOOK_SECRET.length > 0 && ENABLE_FULL_WEBHOOK_E2E;
  const hmacTest = canTestHmac ? test : test.skip;

  hmacTest('POST /api/webhooks/uk/building — with valid HMAC creates building', async () => {
    const payload = {
      event_id: crypto.randomUUID(),
      event: 'building.created',
      building: {
        id: 900003,
        name: 'E2E Webhook Building',
        address: 'ул. Тестовая 1',
        town: 'Ташкент',
      },
    };

    const signature = signPayload(payload, WEBHOOK_SECRET);
    const res = await request(BASE_URL)
      .post('/api/webhooks/uk/building')
      .set('X-Webhook-Signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });
});
