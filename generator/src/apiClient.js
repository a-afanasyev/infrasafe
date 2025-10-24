import axios from 'axios';

let cachedToken = null;

async function loginIfNeeded() {
  if (process.env.API_STATIC_TOKEN) {
    cachedToken = process.env.API_STATIC_TOKEN;
    return cachedToken;
  }
  if (cachedToken) return cachedToken;

  const base = process.env.API_BASE_URL;
  const username = process.env.API_USERNAME;
  const password = process.env.API_PASSWORD;

  if (!base || !username || !password) {
    throw new Error('Не заданы API_BASE_URL и/или учётные данные');
  }

  const url = `${base}/auth/login`;
  const resp = await axios.post(url, { username, password });
  const token = resp?.data?.accessToken || resp?.data?.token;
  if (!token) throw new Error('Не удалось получить JWT токен');
  cachedToken = token;
  return cachedToken;
}

export async function postMetric(metric) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error('Не задан API_BASE_URL');

  const token = await loginIfNeeded();
  const url = `${base}/metrics`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const { data } = await axios.post(url, metric, { headers });
  return data;
}

export async function getBuildingsWithControllers() {
  const base = process.env.API_BASE_URL;
  const { data } = await axios.get(`${base}/buildings-metrics`);
  const buildings = data?.data || data;
  return Array.isArray(buildings) ? buildings.filter(b => b.controller_id) : [];
}
