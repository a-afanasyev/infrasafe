# Инженерный рефакторинг-план (AUD-008/010/011/012/033/036p3) — на ревью

> Составлен 2026-06-14 по факту чтения кода (3 параллельных агента-исследователя).
> Каждый пункт: scope · что делаем / что НЕ делаем · file:line · риск · тесты · effort.
> Источники находок проверены в коде, не по памяти.

## TL;DR — рекомендации

| Задача | Вердикт | Effort |
|---|---|---|
| **AUD-033** | **ДЕЛАТЬ ПЕРВЫМ — это баг, не чистка** (карта показывает анонимный режим залогиненному) | S |
| **AUD-036 p3** | **ЗАКРЫТЬ как wontfix** — COUNT уже дёшев (index + cooldown-gated), prefilter маргинален и рискован | — |
| **AUD-008** | Делать только узкий безопасный subset (8 trivial getById/delete → модели) | S-M |
| **AUD-010** | Hand-written контроллеры (фабрика не подходит — mismatch сигнатур) | S-M |
| **AUD-011** | By-touch, НЕ sweep; сначала error-path; исключить auth + map/UK-metrics | S/touch |
| **AUD-012** | НЕ class-split из аудита; delegate-only извлечение в `src/services/alert/*` | S-M |

**Порядок:** AUD-033 (баг) → AUD-012 (изолирован, delegate-only) → backend-батч AUD-011+AUD-010+AUD-008 (вместе, один проход по water/admin). AUD-036p3 — закрыть документально.

---

## AUD-033 (+SEC-34b) — cookie/interceptor рефактор карты ⚠️ СОДЕРЖИТ БАГ

**Находка важнее, чем «чистка»:** `public/admin-auth.js` (глобальный `window.fetch`-перехватчик) **на карте не грузится** — он только в `frontend-html/admin.html:1526`; `index.html:261-262` грузит лишь `map-layers-control.js` + `script.js`. На карте нет глобального интерсептора. При этом:
- `map-layers-control.js isAuthenticated()` (`:52-57`) читает `DOMSecurity.getValidToken()` → `localStorage('admin_token')`, который **скрапится на каждом load** (`script.js:188-191`, `admin-auth.js:36-40`) и никем не пишется (логин кладёт только httpOnly-cookie). → **всегда `null` → `isAuthenticated()` всегда false → `init()` (`:121`) грузит только публичные счётчики, инфра-слои не подгружаются даже залогиненному.** Это SEC-34b по сути.
- Auth по факту уже работает через cookie: same-origin `fetch()` шлёт httpOnly-cookie автоматически; `Authorization: Bearer ${token}` везде мёртв (token null → `?? undefined` убирает header).

**Что делаем:**
1. **Фикс гейта** (`:52-57`):
   ```js
   isAuthenticated() { return !!(window.apiClient && window.apiClient.isAuthenticated); }
   ```
   `apiClient.isAuthenticated` (`script.js:185`) — источник истины, ставится boot-пробой `GET /api/auth/profile` (`script.js:2130-2141`) + флипается на login/logout. **Проверить, что `apiClient` экспонирован на `window`** (грубо: `window.mapLayersControl` ставится `script.js:1275` — `apiClient` нужно тоже). Из-за async-пробы безопаснее: `init()` грузит только public-counts, а инфра-слои подтягивает существующий хук `handleAuthChange(true)` (`:60-68`, вызывается `script.js:2220` на login + на boot после пробы) — убирает init-time race.
2. **Удалить 4 мёртвых token-блока** (`:150-154, 511-515, 1094-1098, 1180-1184`) + ключ `Authorization` из header-объектов. Raw `fetch` с дефолтным same-origin уже шлёт cookie → поведение для залогиненного не меняется.
3. **(Опц.)** провести fetch'и карты через `window.apiClient.fetch` (единый 401-handling + rate-limit) ИЛИ явный `credentials:'same-origin'` для defense-in-depth.
4. **Follow-up:** после (1)+(2) `DOMSecurity.getValidToken`/`validateToken` (`domSecurity.js:165-214` + экспорты `:226-227`) становятся мёртвыми → удалить (паттерн как csrf.js).

**Deploy-window:** JS — bundled dist (bake в образ, extract на деплое); `index.html` — bind-mount (hot via git pull). Script-теги НЕ меняются → skew-риска нет. НО: бандл нужно пересобрать (`npm run build:frontend`), и **добавить `?v=` cache-bust** к `map-layers-control.js`/`script.js` в `index.html` (сейчас его там нет → браузер может отдать stale-бандл).

**Тесты:** добавить jsdom-юнит на `isAuthenticated()` (apiClient true/false/absent); регресс что `handleAuthChange(true)` грузит инфра-слои. **Прод-verify:** залогиненный оператор видит инфра-слои на карте (сейчас НЕ видит — это и есть фикс-доказательство).

**Effort: S.** **Риск:** низкий, но это меняет видимое поведение карты (к лучшему) → прод-smoke обязателен.

---

## AUD-036 p3 — voltage COUNT-600s → РЕКОМЕНДАЦИЯ ЗАКРЫТЬ (wontfix)

**Опровержение премисы аудита:** COUNT **не** бежит на каждый insert. `checkVoltage` (`:564`) применяет cooldown-гейт ПЕРВЫМ (`:580-585`, 15 мин) и возвращается до `_classifyVoltageSeverity` (`:601`). Per-insert COUNT случается только когда (a) cooldown истёк (≤1/15мин/контроллер), или (b) есть открытый sub-CRITICAL voltage-алерт (escalate-in-place, AUD-006) — т.е. только во время активного инцидента.

**Стоимость:** есть индекс `idx_metrics_ctrl_ts ON metrics(controller_id, timestamp DESC)` (`007`, `014:26-27`, `init 01:514`). COUNT = index-range scan последних 600с одного контроллера (~20-120 строк, sub-ms). **Не дорого.**

**Почему prefilter опасен:** voltage severity **динамическая** (WARNING vs CRITICAL по подсчёту фаз/полос, `:748-769`) — `LIMIT 1` существование-чек её не воспроизведёт; и семантика окна — «**любой** сэмпл в 600с вне полосы», а не «последний». Наивный `ORDER BY timestamp DESC LIMIT 1` → недо-детект (восстановившийся 90с назад контроллер классифицируется null) на safety-пути с escalate-in-place — **недопустимо**.

**Если всё же делать (S):** только prefilter с **тем же any-sample-окном** (без `ORDER BY/latest`): `SELECT 1 ... WHERE ctrl=$1 AND ts>=NOW()-600s AND (any phase NOT BETWEEN warn) LIMIT 1` → null если пусто, иначе full COUNT. Семантика-preserving, но экономит только в zero-anomaly случае, где cooldown обычно уже отсёк. **Reward ≈ 0, risk > 0.**

**Рекомендация: закрыть AUD-036 как done (p1+p2) + p3 wontfix** с этим обоснованием в бэклоге. Если возьмём — обязателен регресс-тест на recovered-90s-ago→non-null.

---

## AUD-012 — split alertService (2082 LoC) → delegate-only извлечение

**НЕ делать class-split из аудита** (`alertMonitors.js`/`alertGates.js` как модули-методов): чекеры и гейты взаимно сцеплены через `this.activeAlerts`/`this.lastChecks`/`this.dbBreaker`/`this.thresholds` (61+57 мутаций Map в тестах!), `_escalateAlert` сидит на стыке monitor/gate. Вынос методов требует протаскивания `this`/контекста везде — реальный риск на свежехарденном (AUD-001 PR-A/B/C + AUD-006) verification-критичном коде. Payoff ноль (синглтон всё равно один).

**Жёсткое ограничение:** тесты лезут в приватные методы (`_escalateAlert` ×10, `_recentVoltageMetric` ×3, `_build*`/`_findActiveAlert`/`_evaluateGates` ×2, …) + `activeAlerts`/`lastChecks`/`initialized` напрямую. → **split обязан быть pure move + re-export**: каждая вынесенная функция получает тонкий instance-метод-делегатор с тем же именем/сигнатурой; `module.exports` остаётся синглтоном. Тесты зелёные без правок.

**Что извлекаем (near-zero risk, no `this`) → `src/services/alert/`:**
1. **P1 (XS):** константы (`:17,27-33,37`) → `alertConstants.js`; re-export `singleton.COOLDOWN_SUFFIX_BY_TYPE`/`SEVERITY_RANK`.
2. **P2 (S):** builders `_buildLeakAlertData`(:424)/`_buildVoltageAlertData`(:669)/`_buildHeatingAlertData`(:843)/`_applyReopenContext`(:449)/`_evaluateVerifyFaultWindow`(:1258) → `alertDataBuilders.js`; методы → 1-строчные делегаторы.
3. **P3 (S-M):** stateless SQL-хелперы `_getTransformerLoadSince`(:304)/`_latestProfileSampleAnomalous`(:512)/`_recentVoltageMetric`(:702)/`_classifyVoltageSeverity`(:738)/`_recentHeatingMinTemp`(:872)/`_hasRecentHeatingAnomaly`(:890) → `alertQueries.js`.
4. **P4 (M, highest-care):** тела гейтов `_checkPersistenceGate`(:1057)/`_checkVerifyPersistenceGate`(:1181)/`_checkAffectedBuildingsGate`(:1280) → `alertGates.js` как `(db, alertData, rule, …)`-функции; `_evaluateGates`/`createAlert` зовут через делегаторы. Гейтить полным `test:unit` + persistenceGate/verifyMode/escalate сьютами.

**STOP после P4.** Остаются в классе: `_escalateAlert`, 4×`check*`, весь CRUD/resolve, init-lifecycle, синглтон, event-wiring (`:1967-2077`) — нередуцируемое state-coupled ядро.

**Require-граф:** новые модули зависят ТОЛЬКО от листьев (`config/database`, `utils/logger`, `config/thresholds`, `alertConstants`) — никогда от `alertService`/`./uk/*` на top-level. Сохранить ВСЕ lazy-require (`:264,491,956,1032,1035,1286,1319,1608,1658,1660,2071`). Синглтон + wiring остаются в основном файле (load-side-effects + export identity неизменны).

**Итог:** ~560-620 строк вынесено → класс ~750-800 (под гайдлайном 800), hot-path escalate/verify байт-в-байт.

**Effort: S-M.** **Риск:** «не сохранил test-visible имя / lazy-require» — ловится существующим ~2128-юнит сьютом (diff = 0).

---

## Backend-батч: AUD-011 + AUD-010 + AUD-008 (один проход, вместе)

**Почему вместе:** все три пересекаются на water/admin-контроллерах. AUD-010 создаёт `waterLineController`/`waterSupplierController` → в момент создания выбираешь response-shape (AUD-011). AUD-008 консолидирует SQL в admin-контроллерах, которые — те же AUD-011 envelope-нарушители. Делать раздельно = двойное касание файлов.

### AUD-011 — envelope (by-touch, НЕ sweep)
- Стандарт: `src/utils/apiResponse.js` (`sendSuccess`/`sendError`/`sendNotFound`). Используют **4 из 25** контроллеров; **183** ручных `res.json`; **≥6 разных форм** (`error:'string'` vs `error:{message,status}` vs `message:'string'` vs raw object vs `{data,pagination}`).
- **НЕ sweep:** blanket-обёртка = breaking для фронта (`script.js`/`admin.js` читают `.data`?) + UK-контракта (`/integration/*`, `/buildings-metrics`, `/uk-requests-metrics`). **Исключить:** auth (`{accessToken,requires2FA,tempToken}` — намеренно без envelope, ломает login), map/UK-metrics (raw, потребители — фронт+УК).
- **План:** (1) error-path нормализация везде через `sendError` (низкий фронт-риск) — лучший consistency/risk; (2) success-path — только в файлах, которые и так трогаем (couple с AUD-008/010); (3) public/map/auth/UK raw-shapes не трогать без coordination.

### AUD-010 — water-роуты → контроллеры
- `waterLineRoutes.js` (6 inline-хендлеров, `WaterLine.*` напрямую; raw без envelope `:13,:31,:75,:94`; sub-route `/:id/supplier` `:44-69`) + `waterSupplierRoutes.js` (5 inline; inline SEC-33 pagination `:13-23`; raw `:24,:43,:59,:78`).
- **Фабрика НЕ подходит:** `createCrudController.getAll` зовёт `Model.findAll(page,limit,sort,order)`, а `WaterLine`/`WaterSupplier.findAll(page,limit,filters)` — **mismatch сигнатур** + extra-методы (`findSuppliersForLine`, `findByBuildingId`). → **hand-written** `waterLineController.js`/`waterSupplierController.js` по образцу `lineController.js`/`lineRoutes.js` (чистый эталон). Перенести sub-route + inline-pagination в контроллер.
- **⚠️ Развилка (см. ниже):** текущие эндпоинты возвращают **raw** (без `success`). Обёртка в envelope = breaking для фронта.

### AUD-008 — admin SQL → модели (узкий subset)
- **Делаем (low risk):** 8 trivial getById/delete (`adminTransformerController:75-78,129-131`, `adminLineController:126-128`, `adminColdWaterSourceController:72,123-126`, `adminHeatSourceController:72,123-126`) → существующие `Model.findById`/`delete` (байт-эквивалент).
- **НЕ делаем (bespoke, correct as-is):** `adminGeneralController:15-22` stats-агрегация; JOIN-getById (`adminLineController:73` transformer_name, `adminWaterLineController:94` connected_buildings_count) — нет в моделях; WaterLine delete dependency-check (`:165-168`) + batch (`:195-214`); все batch-ops (через `adminService`).
- **НЕ трогаем без явного решения:** create-сайты —
  - cold-water/heat-source create (`:46-56`) используют `gen_random_uuid()` в SQL, а фабричные модели ждут caller-`id` → консолидация вставит NULL id (регресс) без фикса фабрики.
  - **WaterLine create (`:76`) — ЕДИНСТВЕННАЯ реальная дивергенция:** `branches ? JSON.stringify : '[]'` (admin) vs model omit→PG-default. Консолидация **меняет хранимое значение**. Решить явно + тест.

---

## Развилки — нужны решения перед стартом backend-батча

1. **AUD-010/011 envelope для water+admin-list эндпоинтов:**
   - **(A) Сохранить raw-shapes** (zero behavior change) — извлечь контроллеры, но НЕ оборачивать success в envelope. Безопасно, но consistency-выигрыш только по error-path.
   - **(B) Обернуть в envelope** (breaking) — единообразие, но требует верификации `public/script.js`/`admin.js` (читают `.data`?) + smoke. **Рекомендую (A)** + error-path normalization; полную обёртку — отдельным осознанным contract-шагом если нужно.
2. **AUD-008 WaterLine `'[]'` дивергенция:** какое поведение каноним — admin `'[]'` или model PG-default? (рекомендую: выровнять на model-omit→PG-default, добавить column-default если нужно, тест).
3. **AUD-036 p3:** закрыть wontfix (рекомендую) или всё же реализовать safe-prefilter + регресс-тест?

---

## Предлагаемая разбивка на PR (каждый: TDD → зелёный CI → авторизация → деплой)

- **PR-1 · AUD-033** (frontend, S) — фикс auth-гейта карты + удаление dead-token + `?v=`-bust. Image rebuild. Прод-smoke: залогиненный видит инфра-слои. *Самый ценный — чинит реальный баг.*
- **PR-2 · AUD-012** (backend, S-M) — delegate-only извлечение P1→P4, full `test:unit` diff=0. Image rebuild. Без поведенческих изменений.
- **PR-3 · backend-батч AUD-011+010+008** (backend, M) — error-path envelope + 2 water-контроллера + 8 trivial admin getById/delete. TDD на изменённые. Решения по развилкам 1-2 ДО старта.
- **AUD-036 p3** — docs-only закрытие (wontfix-обоснование).

## Reuse / эталоны
- `src/routes/lineRoutes.js` + `src/controllers/lineController.js` — чистый router+controller эталон для AUD-010.
- `src/utils/dynamicUpdateBuilder.js`/`adminQueryBuilder.js` — уже консолидированный слой (AUD-009).
- `script.js APIClient.fetch` (`:182-284`) — cookie-fetch эталон для AUD-033.
- `_hasRecentHeatingAnomaly` — prefilter-прецедент (для понимания почему voltage-prefilter иной).
