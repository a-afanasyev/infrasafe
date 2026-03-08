# План: Фиксация оставшихся багов после default-deny

**Дата:** 2026-03-08
**Ветка:** fix/p0-p1-security-and-hygiene
**Предыдущий коммит:** ef979e3 (P0: default-deny)

---

## Баг 1: XSS через небезопасную вставку HTML в popup callback (Medium)

**Файлы:**
- `public/map-layers-control.js` ~строки 1793-1801
- `public/script.js` ~строка 2321

**Проблема:**
Числовые поля из API вставляются через небезопасный метод вставки HTML без DOMPurify.
`buildingsCount` берётся через `|| 0`, что не защищает от строк.

**Правило:** Никакого `innerHTML` для данных из API. Все значения из ответов сервера вставлять только через `textContent` или DOM API (`createElement` + `textContent`). DOMPurify допустим для статических шаблонов, но не для динамических данных.

**Исправление:**

1. Найти все места где данные из API попадают в `innerHTML` (grep по `innerHTML.*data\.`, `innerHTML.*\$\{`).
2. Переписать каждое на DOM API:
   ```javascript
   // Было:
   // el.innerHTML = `<strong>Мощность:</strong> ${data.total_power_kw} кВт`;
   // Стало:
   el.textContent = '';
   const strong = document.createElement('strong');
   strong.textContent = 'Мощность:';
   el.appendChild(strong);
   el.appendChild(document.createTextNode(` ${parseFloat(data.total_power_kw) || 0} кВт`));
   ```
3. Числовые значения всегда приводить через `parseFloat()`/`parseInt()` с fallback `|| 0`.

**Оценка:** ~15 минут

---

## Баг 2: Meta CSP в index.html противоречит серверному (Medium)

**Файл:** `index.html`, строки 13-22

**Проблема:**
Meta-тег CSP содержит `'unsafe-inline'` для `script-src`, серверный CSP через helmet — нет. В браузере приоритет у серверного заголовка, но meta-тег сбивает при аудите и может ослабить CSP в edge-cases.

**Исправление:**
Удалить meta CSP из `index.html`. Единый CSP — через helmet в `src/server.js`.

**Оценка:** ~5 минут

---

## Баг 3: Двойной запрос к /water-lines (Low)

**Файл:** `public/map-layers-control.js`, строки 1437-1527

**Проблема:**
`loadColdWaterLines()` и `loadHotWaterLines()` оба делают fetch к `/water-lines`, затем фильтруют по `line_type`. Двойная нагрузка на API.

**Исправление:**

1. Объединить `loadColdWaterLines` и `loadHotWaterLines` в один метод `loadWaterLines(headers)`.
2. Загружать данные одним запросом, фильтровать в памяти.
3. Нормализовать `line_type` перед фильтрацией — API может вернуть значения в разном регистре или формате (`ХВС`, `хвс`, `cold_water`). Использовать `.trim().toUpperCase()`:

```javascript
async loadWaterLines(headers) {
    const response = await fetch(`${this.apiBaseUrl}/water-lines`, { headers });
    if (response.status === 401) throw new Error('401 Unauthorized');
    if (!response.ok) { /* handle */ }

    const result = await response.json();
    const allLines = result.data || [];

    // Нормализация line_type
    const normalize = (type) => (type || '').trim().toUpperCase();
    const coldLines = allLines.filter(l => normalize(l.line_type) === 'ХВС');
    const hotLines = allLines.filter(l => normalize(l.line_type) === 'ГВС');

    // Отрисовка ХВС (синий #0066FF) и ГВС (красный #FF0000)
    // ...
    this.updateLayerCount("...", coldLines.length + hotLines.length);
}
```

4. Обновить вызовы в `loadLayerData` и `loadLayerDataSilent`.

**Оценка:** ~20 минут

---

## Баг 4: Нет интеграционного теста на default-deny (Low)

**Файл:** `tests/jest/integration/` (новый файл)

**Проблема:**
SQL injection тест создаёт собственный Express app без глобального middleware. Если глобальный middleware случайно удалят, тесты продолжат проходить.

**Исправление:**
Создать `tests/jest/integration/default-deny.test.js`:

- Импортировать реальный router из `src/routes/index.js`
- Мокнуть только БД
- Защищённые маршруты без токена -> 401:
  - `GET /buildings` -> 401
  - `GET /controllers` -> 401
  - `GET /alerts` -> 401
  - `POST /auth/logout` -> 401 (не в allowlist)
- Публичные маршруты без токена -> не 401:
  - `GET /buildings-metrics` -> 200 (урезанные данные, в allowlist)
  - `POST /auth/login` -> не 401 (в allowlist)
  - `GET /` -> 200
- Защищённые маршруты с валидным токеном -> 200:
  - `GET /buildings` -> 200

**Оценка:** ~30 минут

---

## Баг 5: Устаревшие Swagger-комментарии (Low)

**Файлы:**
- `src/routes/buildingRoutes.js` — `security: []` на GET
- `src/routes/controllerRoutes.js` — аналогично
- `src/routes/metricRoutes.js` — аналогично
- Другие route files с `security: []`

**Проблема:**
Swagger комментарии утверждают что GET-маршруты не требуют авторизации, хотя теперь глобальный middleware требует JWT.

**Исправление:**
Заменить `security: []` (без авторизации) на корректный Swagger YAML:

```yaml
# Было (неверно — утверждает что авторизация не нужна):
#     security: [] # Без авторизации

# Стало (верно — требует Bearer token):
#     security:
#       - bearerAuth: []
```

Применить ко всем GET-маршрутам, кроме публичных (`/buildings-metrics`, `/`).
Grep-паттерн для поиска: `security: \[\]` в `src/routes/*.js`.

**Оценка:** ~15 минут

---

## Порядок выполнения

```
Баг 2 (meta CSP)          — 5 мин, независимый
Баг 1 (XSS)               — 15 мин, независимый
Баг 5 (Swagger)            — 15 мин, независимый
Баг 3 (двойной fetch)      — 20 мин, независимый
Баг 4 (интеграционный тест) — 30 мин, зависит от стабильного API
```

Баги 1-3 и 5 полностью независимы — можно параллелить через агентов.
Баг 4 лучше делать последним (нужен стабильный API-контракт).

**Общее время:** ~1.5 часа
