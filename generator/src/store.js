import fs from 'fs';
import path from 'path';

// Файл хранения диапазонов (монтируйте volume для персистентности)
const STORAGE_FILE = path.resolve(process.cwd(), 'generator-data.json');

let config = {
  // { [buildingId]: {
  //   electricity: { ph1:[min,max], ph2:[min,max], ph3:[min,max] },
  //   amperage: { ph1:[min,max], ph2:[min,max], ph3:[min,max] },
  //   waterPressure: { cold:[min,max], hotIn:[min,max], hotOut:[min,max] },
  //   waterTemp: { cold:[min,max], hotIn:[min,max], hotOut:[min,max] },
  //   environment: { airTemp:[min,max], humidity:[min,max] },
  //   leakProbability: number (0..1)
  // } }
  rangesByBuildingId: {}
};

export function loadConfig() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        config = parsed;
      }
    }
  } catch {
    // игнорируем ошибки, оставляем конфиг по умолчанию
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch {
    // в минимальном варианте просто игнорируем
  }
}

export function getAllRanges() {
  return config.rangesByBuildingId;
}

export function setBuildingRange(buildingId, ranges) {
  config.rangesByBuildingId[buildingId] = ranges;
  saveConfig();
}
