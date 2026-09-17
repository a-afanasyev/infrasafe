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
    // [A-23] Раньше здесь была безликая «Не удалось получить JWT токен», и
    // самая частая причина оставалась неназванной: у администратора вход
    // двухшаговый (обязательная 2FA), тело ответа несёт requires2FA и tempToken,
    // а сам доступ выдаётся КУКАМИ. Генератор такого входа не умеет — и должен
    // сказать об этом прямо, а не выглядеть сломанным.
    if (resp?.data?.requires2FA || resp?.data?.requires2FASetup) {
      throw new Error(
        'Вход требует второго фактора (2FA) — генератор этого не умеет. ' +
        'Используйте сервисную учётную запись без 2FA или задайте API_STATIC_TOKEN.'
      );
    }
    throw new Error(
      'В ответе логина нет токена. Если API выдаёт доступ куками, ' +
      'задайте API_STATIC_TOKEN.'
    );
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

/**
 * [A-23] Список зданий с контроллерами — ТОЛЬКО авторизованно.
 *
 * Запрос шёл БЕЗ заголовка авторизации, даже когда токен был задан. На
 * `/buildings-metrics` стоит optionalAuth, поэтому аноним получает усечённый
 * DTO — БЕЗ `controller_id`. Фильтр ниже давал пустой список, генератор
 * рапортовал успех и не отправлял НИЧЕГО. Отказ выглядел как штатная работа.
 *
 * Пустой ответ и анонимный ответ теперь различаются: в анонимной проекции поля
 * `controller_id` нет как ключа (есть `has_controller`), и это отдельная,
 * называемая ошибка, а не «зданий нет».
 */
export async function getBuildingsWithControllers() {
  const base = process.env.API_BASE_URL;
  const token = await loginIfNeeded();
  const { data } = await axios.get(`${base}/buildings-metrics`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const buildings = data?.data || data;
  if (!Array.isArray(buildings)) return [];

  const anonymous = buildings.length > 0
    && buildings.every(b => !Object.prototype.hasOwnProperty.call(b, 'controller_id'));
  if (anonymous) {
    throw new Error(
      'API вернул анонимную проекцию (без controller_id) — токен не принят. ' +
      'Проверьте API_STATIC_TOKEN или учётные данные.'
    );
  }

  return buildings.filter(b => b.controller_id);
}
