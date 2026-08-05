const db = require('../config/database');
const cacheService = require('./cacheService');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 5000;

// [AR-7] Публичный эндпоинт до этого шёл в БД на каждый запрос: LATERAL
// «последняя метрика» на каждый контроллер под LIMIT 5000, без кэша и без
// прикладного лимитера. 15 с выбраны так, чтобы кэш не стал самым старым
// звеном в цепочке: интервал обновления MV аналитики — 60 с.
const CACHE_TTL_SECONDS = 15;

// Кэшируется ТОЛЬКО анонимная выдача, и на то две причины.
//
// 1. Свежесть там, где она нужна. Авторизованный вызов — это операторская
//    консоль: карта, по которой смотрят протечки и перегрузки, и админ,
//    который только что подвинул маркер и ждёт, что тот останется на месте
//    (админский путь записи кэши вообще не инвалидирует — см. adminService).
//    Пятнадцать секунд «правка не сохранилась» здесь дороже, чем экономия
//    одного запроса.
// 2. Изоляция аудиторий становится структурной, а не договорной. Анонимная
//    проекция урезана намеренно (`mapAnonymousRow` не отдаёт external_id —
//    P-PENTEST-3 — и никаких метрик). Раз авторизованный ответ в кэш не
//    попадает вовсе, утечь через него нечему — это сильнее, чем «мы не забыли
//    добавить аудиторию в ключ».
//
// Нагрузку это снимает там, где она есть: публичная карта — единственный
// источник трафика, который никто не ограничивает по числу клиентов.
const buildCacheKey = (bbox, limit) => {
    const box = bbox
        ? `${bbox.latMin},${bbox.latMax},${bbox.lngMin},${bbox.lngMax}`
        : 'all';
    return `buildings-metrics:anon:${box}:${limit}`;
};

/**
 * Query with optional bbox filter and hard LIMIT.
 * bbox params are nullable: when NULL the BETWEEN condition passes.
 */
const BUILDINGS_METRICS_QUERY = `
    SELECT
        b.building_id,
        b.name as building_name,
        b.address,
        b.town,
        b.latitude,
        b.longitude,
        b.region,
        b.management_company,
        b.external_id,
        b.has_hot_water,
        c.controller_id,
        c.serial_number as controller_serial,
        c.status as controller_status,
        m.timestamp,
        m.electricity_ph1,
        m.electricity_ph2,
        m.electricity_ph3,
        m.amperage_ph1,
        m.amperage_ph2,
        m.amperage_ph3,
        m.cold_water_pressure,
        m.cold_water_temp,
        m.hot_water_in_pressure,
        m.hot_water_out_pressure,
        m.hot_water_in_temp,
        m.hot_water_out_temp,
        m.air_temp,
        m.humidity,
        m.leak_sensor
    FROM buildings b
    LEFT JOIN controllers c ON b.building_id = c.building_id
    LEFT JOIN LATERAL (
        SELECT *
        FROM metrics m2
        WHERE m2.controller_id = c.controller_id
        ORDER BY m2.timestamp DESC
        LIMIT 1
    ) m ON true
    WHERE ($1::float8 IS NULL OR b.latitude  BETWEEN $1 AND $2)
      AND ($3::float8 IS NULL OR b.longitude BETWEEN $3 AND $4)
    ORDER BY b.building_id
    LIMIT $5
`;

const mapAuthenticatedRow = (row) => ({
    building_id: row.building_id,
    building_name: row.building_name,
    address: row.address,
    town: row.town,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    region: row.region,
    management_company: row.management_company,
    external_id: row.external_id || null,
    has_hot_water: row.has_hot_water,
    controller_id: row.controller_id,
    controller_serial: row.controller_serial,
    controller_status: row.controller_status,
    timestamp: row.timestamp,
    electricity_ph1: row.electricity_ph1 ? parseFloat(row.electricity_ph1) : null,
    electricity_ph2: row.electricity_ph2 ? parseFloat(row.electricity_ph2) : null,
    electricity_ph3: row.electricity_ph3 ? parseFloat(row.electricity_ph3) : null,
    amperage_ph1: row.amperage_ph1 ? parseFloat(row.amperage_ph1) : null,
    amperage_ph2: row.amperage_ph2 ? parseFloat(row.amperage_ph2) : null,
    amperage_ph3: row.amperage_ph3 ? parseFloat(row.amperage_ph3) : null,
    cold_water_pressure: row.cold_water_pressure ? parseFloat(row.cold_water_pressure) : null,
    cold_water_temp: row.cold_water_temp ? parseFloat(row.cold_water_temp) : null,
    hot_water_in_pressure: row.hot_water_in_pressure ? parseFloat(row.hot_water_in_pressure) : null,
    hot_water_out_pressure: row.hot_water_out_pressure ? parseFloat(row.hot_water_out_pressure) : null,
    hot_water_in_temp: row.hot_water_in_temp ? parseFloat(row.hot_water_in_temp) : null,
    hot_water_out_temp: row.hot_water_out_temp ? parseFloat(row.hot_water_out_temp) : null,
    air_temp: row.air_temp ? parseFloat(row.air_temp) : null,
    humidity: row.humidity ? parseFloat(row.humidity) : null,
    leak_sensor: row.leak_sensor
});

const mapAnonymousRow = (row) => ({
    building_id: row.building_id,
    building_name: row.building_name,
    address: row.address,
    town: row.town,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    // external_id (the UK cross-system reference) is intentionally omitted from
    // the anonymous projection (P-PENTEST-3). Authenticated callers still receive
    // it via mapAuthenticatedRow; the dedicated /uk-requests-metrics endpoint
    // serves the UK reconciliation worker's inventory diff.
    has_controller: !!row.controller_id
});

/**
 * Parse a bbox string "lat_min,lng_min,lat_max,lng_max" into tuple.
 * Returns null if unset, throws Error on invalid format.
 */
const parseBbox = (raw) => {
    if (!raw) return null;
    // Phase 12 follow-up: guard against very long strings before allocating.
    // A well-formed bbox fits in ~60 chars; 200 is a generous upper bound.
    if (typeof raw !== 'string' || raw.length > 200) {
        throw new Error('bbox value too long');
    }
    const parts = raw.split(',').map(s => s.trim());
    if (parts.length !== 4) {
        throw new Error('bbox must be 4 comma-separated numbers: lat_min,lng_min,lat_max,lng_max');
    }
    const nums = parts.map(Number);
    if (nums.some(n => !Number.isFinite(n))) {
        throw new Error('bbox values must be finite numbers');
    }
    const [latMin, lngMin, latMax, lngMax] = nums;
    if (latMin < -90 || latMax > 90 || latMin > latMax) {
        throw new Error('bbox latitude out of range or inverted');
    }
    if (lngMin < -180 || lngMax > 180 || lngMin > lngMax) {
        throw new Error('bbox longitude out of range or inverted');
    }
    return { latMin, lngMin, latMax, lngMax };
};

/**
 * Clamp a limit param.
 */
const parseLimit = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
};

const getBuildingsWithMetrics = async (isAuthenticated, options = {}) => {
    const { bbox = null, limit = DEFAULT_LIMIT } = options;
    const cacheKey = isAuthenticated ? null : buildCacheKey(bbox, limit);

    // Кэш — ускоритель, а не зависимость: его отказ переводит запрос в БД,
    // а не в 500. Карта — публичная страница, падение Redis не должно её гасить.
    if (cacheKey) {
        try {
            const cached = await cacheService.get(cacheKey, { ttl: CACHE_TTL_SECONDS });
            if (cached) {
                return cached;
            }
        } catch (error) {
            logger.warn(`buildings-metrics: чтение кэша не удалось (${error.message}), идём в БД`);
        }
    }

    const params = [
        bbox ? bbox.latMin : null,
        bbox ? bbox.latMax : null,
        bbox ? bbox.lngMin : null,
        bbox ? bbox.lngMax : null,
        limit,
    ];

    const result = await db.query(BUILDINGS_METRICS_QUERY, params);

    const buildings = isAuthenticated
        ? result.rows.map(mapAuthenticatedRow)
        : result.rows.map(mapAnonymousRow);

    logger.info(`Retrieved ${buildings.length} buildings with metrics for map (limit=${limit}, bbox=${bbox ? 'set' : 'none'})`);

    const payload = {
        data: buildings,
        pagination: {
            total: buildings.length,
            page: 1,
            limit,
            totalPages: 1
        }
    };

    if (cacheKey) {
        try {
            await cacheService.set(cacheKey, payload, { ttl: CACHE_TTL_SECONDS });
        } catch (error) {
            logger.warn(`buildings-metrics: запись в кэш не удалась (${error.message})`);
        }
    }

    return payload;
};

module.exports = {
    getBuildingsWithMetrics,
    parseBbox,
    parseLimit,
    buildCacheKey,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    CACHE_TTL_SECONDS,
};
