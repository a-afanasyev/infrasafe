import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getAllRanges, setBuildingRange, loadConfig } from './store.js';
import { startScheduler, runOnce } from './scheduler.js';

// Инициализация переменных окружения
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

// Папка со статикой UI
app.use('/', express.static(path.join(__dirname, '../public')));

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Получить диапазоны для всех зданий
app.get('/api/ranges', (_req, res) => {
  res.json({ success: true, data: getAllRanges() });
});

// Получить диапазоны по конкретному buildingId
app.get('/api/ranges/:buildingId', (req, res) => {
  const id = String(req.params.buildingId);
  const all = getAllRanges();
  res.json({ success: true, data: all[id] || null });
});

// Установить диапазоны генерации для здания
app.post('/api/ranges/:buildingId', (req, res) => {
  const buildingId = String(req.params.buildingId);
  const { electricity, amperage, waterPressure, waterTemp, environment, leakProbability } = req.body || {};

  // Простая валидация: обязательные группы
  if (!electricity || !amperage || !waterPressure || !waterTemp || !environment || typeof leakProbability !== 'number') {
    return res.status(400).json({ success: false, message: 'Некорректные параметры' });
  }

  // Ограничение leakProbability в [0,1]
  const lp = Math.max(0, Math.min(1, Number(leakProbability)));

  setBuildingRange(buildingId, { electricity, amperage, waterPressure, waterTemp, environment, leakProbability: lp });
  return res.json({ success: true, data: getAllRanges() });
});

// Одноразовый запуск генерации и отправки данных
app.post('/api/generate/run-once', async (_req, res) => {
  try {
    const result = await runOnce();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Ошибка генерации' });
  }
});

const PORT = process.env.PORT || 8081;

// Запуск
loadConfig();
startScheduler();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[generator] service started on port ${PORT}`);
});
