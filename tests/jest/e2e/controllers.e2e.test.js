const { login, authed, factory, deleteBuilding } = require('./helpers/e2eHelper');

describe('E2E: Controllers CRUD', () => {
  let token, buildingId;

  beforeAll(async () => {
    const auth = await login();
    token = auth.accessToken;
    const bRes = await authed(token).post('/api/buildings').send(factory.building());
    buildingId = bRes.body.building_id;
  });

  afterAll(async () => {
    await deleteBuilding(token, buildingId);
  });

  test('GET /api/controllers — returns paginated list', async () => {
    const res = await authed(token).get('/api/controllers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
  });

  test('POST /api/controllers — creates controller linked to building', async () => {
    const data = factory.controller(buildingId);
    const res = await authed(token).post('/api/controllers').send(data);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('controller_id');
  });

  test('GET /api/controllers/:id — get by ID', async () => {
    const data = factory.controller(buildingId);
    const createRes = await authed(token).post('/api/controllers').send(data);
    const id = createRes.body.controller_id;

    const res = await authed(token).get(`/api/controllers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.serial_number).toBe(data.serial_number);
  });

  test('GET /api/controllers/building/:buildingId — controllers by building', async () => {
    const res = await authed(token).get(`/api/controllers/building/${buildingId}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/controllers/statistics — controller stats', async () => {
    const res = await authed(token).get('/api/controllers/statistics');
    expect(res.status).toBe(200);
  });
});
