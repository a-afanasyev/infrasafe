const { login, authed, anon, factory, deleteBuilding } = require('./helpers/e2eHelper');

describe('E2E: Buildings CRUD', () => {
  let token;
  const createdIds = [];

  beforeAll(async () => {
    const auth = await login();
    token = auth.accessToken;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteBuilding(token, id);
    }
  });

  test('GET /api/buildings — returns paginated list', async () => {
    const res = await authed(token).get('/api/buildings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/buildings — creates building with real DB persistence', async () => {
    const data = factory.building();
    const res = await authed(token).post('/api/buildings').send(data);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('building_id');
    createdIds.push(res.body.building_id);

    // Verify persisted
    const getRes = await authed(token).get(`/api/buildings/${res.body.building_id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe(data.name);
  });

  test('PUT /api/buildings/:id — updates building', async () => {
    const data = factory.building();
    const createRes = await authed(token).post('/api/buildings').send(data);
    createdIds.push(createRes.body.building_id);
    const id = createRes.body.building_id;

    const res = await authed(token).put(`/api/buildings/${id}`).send({
      ...data,
      name: 'Updated E2E Building',
    });
    expect(res.status).toBe(200);

    const getRes = await authed(token).get(`/api/buildings/${id}`);
    expect(getRes.body.name).toBe('Updated E2E Building');
  });

  test('DELETE /api/buildings/:id?cascade=true — deletes building with related data', async () => {
    const createRes = await authed(token).post('/api/buildings').send(factory.building());
    const id = createRes.body.building_id;

    const delRes = await authed(token).delete(`/api/buildings/${id}?cascade=true`);
    expect(delRes.status).toBe(200);

    const getRes = await authed(token).get(`/api/buildings/${id}`);
    expect(getRes.status).toBe(404);
  });

  test('DELETE /api/buildings/:id — without cascade on building with controllers returns 400', async () => {
    const bRes = await authed(token).post('/api/buildings').send(factory.building());
    const bId = bRes.body.building_id;
    createdIds.push(bId);
    await authed(token).post('/api/controllers').send(factory.controller(bId));

    const delRes = await authed(token).delete(`/api/buildings/${bId}`);
    expect([400, 409]).toContain(delRes.status);
  });

  test('GET /api/buildings-metrics — public access (no token)', async () => {
    const res = await anon().get('/api/buildings-metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('GET /api/buildings/:id — non-existent returns 404', async () => {
    const res = await authed(token).get('/api/buildings/999999');
    expect(res.status).toBe(404);
  });
});
