import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getAllRanges, setBuildingRange, deleteBuildingRange, loadConfig } from './store.js';
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

// Импорт конфигураций из JSON (массовая загрузка)
// ВАЖНО: Этот маршрут должен быть ПЕРЕД /api/ranges/:buildingId, 
// иначе Express будет интерпретировать "import" как buildingId
app.post('/api/ranges/import', (req, res) => {
  try {
    console.log('[Импорт API] Получен запрос на импорт');
    console.log('[Импорт API] Тело запроса:', {
      hasRanges: !!req.body.ranges,
      rangesType: typeof req.body.ranges,
      rangesKeys: req.body.ranges ? Object.keys(req.body.ranges) : null,
      rangesCount: req.body.ranges ? Object.keys(req.body.ranges).length : 0
    });
    
    const { ranges } = req.body || {};
    
    if (!ranges || typeof ranges !== 'object') {
      console.error('[Импорт API] Некорректный формат данных:', {
        ranges: ranges,
        rangesType: typeof ranges,
        body: req.body
      });
      return res.status(400).json({ success: false, message: 'Некорректный формат данных. Ожидается объект ranges.' });
    }
    
    let imported = 0;
    let errors = [];
    
    /**
     * Валидация структуры диапазонов
     * Проверяет, что объект содержит массивы [min, max] для всех фаз
     */
    function validateRangeGroup(group, groupName) {
      if (!group || typeof group !== 'object') {
        return `отсутствует группа ${groupName}`;
      }
      
      // Проверяем все поля в группе
      for (const [key, value] of Object.entries(group)) {
        if (!Array.isArray(value) || value.length !== 2) {
          return `${groupName}.${key} должен быть массивом [min, max]`;
        }
        const [min, max] = value;
        if (typeof min !== 'number' || typeof max !== 'number') {
          return `${groupName}.${key} должен содержать числа`;
        }
        if (min > max) {
          return `${groupName}.${key}: min (${min}) больше max (${max})`;
        }
      }
      
      return null;
    }
    
    // Импортируем каждую конфигурацию
    for (const [buildingId, config] of Object.entries(ranges)) {
      try {
        console.log(`[Импорт API] Обработка здания #${buildingId}`);
        
        // Проверяем наличие всех обязательных групп
        if (!config.electricity || !config.amperage || !config.waterPressure || 
            !config.waterTemp || !config.environment) {
          const missing = [];
          if (!config.electricity) missing.push('electricity');
          if (!config.amperage) missing.push('amperage');
          if (!config.waterPressure) missing.push('waterPressure');
          if (!config.waterTemp) missing.push('waterTemp');
          if (!config.environment) missing.push('environment');
          
          console.error(`[Импорт API] Здание #${buildingId}: отсутствуют группы:`, missing);
          errors.push(`Здание #${buildingId}: отсутствуют обязательные группы данных (${missing.join(', ')})`);
          continue;
        }
        
        // Проверяем leakProbability
        if (typeof config.leakProbability !== 'number') {
          console.error(`[Импорт API] Здание #${buildingId}: leakProbability имеет тип ${typeof config.leakProbability}, значение:`, config.leakProbability);
          errors.push(`Здание #${buildingId}: leakProbability должно быть числом (получено: ${typeof config.leakProbability})`);
          continue;
        }
        
        // Валидируем каждую группу диапазонов
        const electricityError = validateRangeGroup(config.electricity, 'electricity');
        if (electricityError) {
          errors.push(`Здание #${buildingId}: ${electricityError}`);
          continue;
        }
        
        const amperageError = validateRangeGroup(config.amperage, 'amperage');
        if (amperageError) {
          errors.push(`Здание #${buildingId}: ${amperageError}`);
          continue;
        }
        
        const waterPressureError = validateRangeGroup(config.waterPressure, 'waterPressure');
        if (waterPressureError) {
          errors.push(`Здание #${buildingId}: ${waterPressureError}`);
          continue;
        }
        
        const waterTempError = validateRangeGroup(config.waterTemp, 'waterTemp');
        if (waterTempError) {
          errors.push(`Здание #${buildingId}: ${waterTempError}`);
          continue;
        }
        
        const environmentError = validateRangeGroup(config.environment, 'environment');
        if (environmentError) {
          errors.push(`Здание #${buildingId}: ${environmentError}`);
          continue;
        }
        
        // Ограничение leakProbability в [0,1]
        const lp = Math.max(0, Math.min(1, Number(config.leakProbability)));
        
        // Сохраняем конфигурацию
        setBuildingRange(String(buildingId), {
          electricity: config.electricity,
          amperage: config.amperage,
          waterPressure: config.waterPressure,
          waterTemp: config.waterTemp,
          environment: config.environment,
          leakProbability: lp
        });
        
        imported++;
      } catch (error) {
        errors.push(`Здание #${buildingId}: ${error.message}`);
      }
    }
    
    if (imported === 0 && errors.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Не удалось импортировать ни одной конфигурации',
        errors 
      });
    }
    
    return res.json({ 
      success: true, 
      imported,
      total: Object.keys(ranges).length,
      errors: errors.length > 0 ? errors : undefined,
      data: getAllRanges() 
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка при импорте: ' + (error?.message || 'Неизвестная ошибка') 
    });
  }
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

// Удалить диапазоны для здания
app.delete('/api/ranges/:buildingId', (req, res) => {
  const buildingId = String(req.params.buildingId);
  
  // Проверяем, существует ли конфигурация
  const all = getAllRanges();
  if (!all[buildingId]) {
    return res.status(404).json({ success: false, message: `Конфигурация для здания #${buildingId} не найдена` });
  }

  // Удаляем конфигурацию
  deleteBuildingRange(buildingId);
  
  return res.json({ success: true, message: `Конфигурация для здания #${buildingId} удалена`, data: getAllRanges() });
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
