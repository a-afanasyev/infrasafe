import fs from 'fs';
import path from 'path';

// [A-24] Файл хранения диапазонов лежит в КАТАЛОГЕ, и это не стилистика.
//
// Прежде путь был `<cwd>/generator-data.json`, а compose монтировал туда
// именованный том. Docker в таком случае создаёт по этому пути КАТАЛОГ:
// `existsSync` отвечает true, `readFileSync` падает с EISDIR, `writeFileSync`
// тоже — и обе ошибки глотались пустыми catch. API отвечал «сохранено», а после
// перезапуска конфигурация оказывалась пустой.
//
// Теперь том монтируется на каталог (`/app/data`), а файл лежит внутри него.
// Путь переопределяется переменной — для тестов и нестандартных развёрток.
const STORAGE_DIR = process.env.GENERATOR_DATA_DIR
  || path.resolve(process.cwd(), 'data');
const STORAGE_FILE = process.env.GENERATOR_DATA_FILE
  || path.join(STORAGE_DIR, 'generator-data.json');

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
  } catch (error) {
    // [A-24] Ошибку больше не глотаем молча: именно тишина здесь превращала
    // «том смонтирован не туда» в «настройки просто пропали».
    console.error(`generator/store: не удалось прочитать ${STORAGE_FILE}: ${error.message}`);
  }
}

/**
 * [A-24] Возвращает признак успеха — вызывающий обязан знать, сохранилось ли.
 * Запись атомарная: временный файл рядом + rename, иначе обрыв посреди записи
 * оставил бы усечённый JSON, который потом не прочитается.
 */
function saveConfig() {
  const tmp = `${STORAGE_FILE}.tmp`;
  try {
    fs.mkdirSync(path.dirname(STORAGE_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, STORAGE_FILE);
    return true;
  } catch (error) {
    console.error(`generator/store: не удалось сохранить ${STORAGE_FILE}: ${error.message}`);
    try { fs.unlinkSync(tmp); } catch { /* временного файла может не быть */ }
    return false;
  }
}

export function getAllRanges() {
  return config.rangesByBuildingId;
}

export function setBuildingRange(buildingId, ranges) {
  config.rangesByBuildingId[buildingId] = ranges;
  return saveConfig();
}

/**
 * Удалить конфигурацию диапазонов для здания
 * @param {string} buildingId - ID здания для удаления конфигурации
 */
export function deleteBuildingRange(buildingId) {
  if (config.rangesByBuildingId[buildingId]) {
    delete config.rangesByBuildingId[buildingId];
    return saveConfig();
  }
  return false;
}
