import axios from 'axios';

/**
 * Глобальное хранилище токена и информации о нем
 */
let cachedToken = null;
let tokenExpiresAt = null;

/**
 * Декодировать JWT токен и получить время истечения (exp)
 * @param {string} token - JWT токен
 * @returns {number|null} - timestamp истечения токена или null
 */
function getTokenExpiration(token) {
  try {
    // JWT состоит из 3 частей разделенных точкой: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    // Декодируем payload (вторая часть)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    
    // Возвращаем exp (в секундах) или null
    return payload.exp ? payload.exp * 1000 : null; // Конвертируем в миллисекунды
  } catch (error) {
    console.warn('[apiClient] Ошибка декодирования JWT токена:', error.message);
    return null;
  }
}

/**
 * Проверить актуален ли текущий токен
 * @returns {boolean} - true если токен валиден и не истек
 */
function isTokenValid() {
  if (!cachedToken) return false;
  if (!tokenExpiresAt) return true; // Если нет времени истечения, считаем валидным
  
  // Проверяем истек ли токен (с запасом 5 минут)
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 минут в миллисекундах
  
  return now < (tokenExpiresAt - bufferTime);
}

/**
 * Сбросить кэшированный токен (принудительный перелогин)
 */
function resetToken() {
  console.log('[apiClient] Сброс токена - будет выполнен новый логин');
  cachedToken = null;
  tokenExpiresAt = null;
}

/**
 * Выполнить логин и получить JWT токен
 * Кэширует токен и сохраняет время его истечения
 */
async function loginIfNeeded() {
  // Если задан статический токен - используем его
  if (process.env.API_STATIC_TOKEN) {
    if (!cachedToken) {
      cachedToken = process.env.API_STATIC_TOKEN;
      tokenExpiresAt = getTokenExpiration(cachedToken);
      console.log('[apiClient] Использован статический токен');
    }
    return cachedToken;
  }
  
  // Проверяем актуальность текущего токена
  if (isTokenValid()) {
    const timeLeft = Math.round((tokenExpiresAt - Date.now()) / 1000 / 60);
    console.log(`[apiClient] Использован кэшированный токен (истекает через ${timeLeft} мин)`);
    return cachedToken;
  }

  // Токен отсутствует или истек - выполняем логин
  const base = process.env.API_BASE_URL;
  const username = process.env.API_USERNAME;
  const password = process.env.API_PASSWORD;

  if (!base || !username || !password) {
    throw new Error('Не заданы API_BASE_URL и/или учётные данные');
  }

  console.log(`[apiClient] Выполняется логин пользователя: ${username}`);
  const url = `${base}/auth/login`;
  const resp = await axios.post(url, { username, password });
  const token = resp?.data?.accessToken || resp?.data?.token;
  
  if (!token) {
    throw new Error('Не удалось получить JWT токен');
  }
  
  // Сохраняем токен и время истечения
  cachedToken = token;
  tokenExpiresAt = getTokenExpiration(token);
  
  if (tokenExpiresAt) {
    const expiresIn = Math.round((tokenExpiresAt - Date.now()) / 1000 / 60);
    console.log(`[apiClient] ✅ Новый токен получен (истекает через ${expiresIn} мин)`);
  } else {
    console.log('[apiClient] ✅ Новый токен получен (время истечения неизвестно)');
  }
  
  return cachedToken;
}

/**
 * Отправить метрику в API
 * Автоматически обрабатывает ошибки 401 (невалидный токен) и повторяет запрос
 * @param {Object} metric - Объект с данными метрики
 * @param {boolean} isRetry - Флаг повторной попытки (для предотвращения бесконечной рекурсии)
 * @returns {Object} - Ответ от API
 */
export async function postMetric(metric, isRetry = false) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error('Не задан API_BASE_URL');

  const token = await loginIfNeeded();
  const url = `${base}/metrics`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  
  try {
    const { data } = await axios.post(url, metric, { headers });
    return data;
  } catch (error) {
    // Если получили 401 (Unauthorized) - токен устарел
    if (error.response?.status === 401 && !isRetry) {
      console.warn('[apiClient] Получена ошибка 401 - токен невалиден, выполняется повторный логин');
      
      // Сбрасываем токен и пробуем снова
      resetToken();
      return postMetric(metric, true); // Повторная попытка
    }
    
    // Для других ошибок - пробрасываем дальше
    throw error;
  }
}

export async function getBuildingsWithControllers() {
  const base = process.env.API_BASE_URL;
  const { data } = await axios.get(`${base}/buildings-metrics`);
  const buildings = data?.data || data;
  return Array.isArray(buildings) ? buildings.filter(b => b.controller_id) : [];
}
