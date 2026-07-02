# InfraSafe API — Матрица аутентификации маршрутов

**Дата:** 2026-03-08 (обновлено 2026-07-02 — R2-01/R2-02)
**Ветка:** fix/p0-p1-security-and-hygiene
**Статус:** Реализовано (default-deny)

> **Обновление 2026-07-02 (аудит R2-01/R2-02):** `POST /auth/register` больше НЕ публичный —
> он под `isAdmin` (регистрация = admin-операция «админ создаёт пользователей»; UI самрегистрации
> нет). Инфраструктурная запись (POST/PUT/DELETE на `buildings`/`controllers`/`metrics`/`transformers`/
> `lines`/`water-*`/`heat-sources`) переведена с `JWT` на `JWT+Admin`; GET остаётся any-auth. Также
> синхронизирован allowlist (ниже был неполон: не хватало 2FA-эндпоинтов, `/uk-requests-metrics`,
> `/map-layer-counts`, `/webhooks/uk/*`).

## Легенда

| Обозначение | Описание |
|-------------|----------|
| **Public** | Без аутентификации |
| **Public (optionalAuth)** | Без аутентификации, но авторизованные пользователи получают расширенные данные |
| **JWT** | Требуется Bearer token (любой зарегистрированный пользователь) |
| **JWT+Admin** | JWT + роль `admin` |
| **Refresh** | authenticateRefresh middleware |

### Rate Limiters

| Код | Лимитер | Лимит |
|-----|---------|-------|
| Au | authLimiter | 10 req/min |
| R | registerLimiter | 5 req/min |
| C | applyCrudRateLimit | 60 req/min |
| A | applyAnalyticsRateLimit | 30 req/min |
| Ad | applyAdminRateLimit | 20 req/min |
| T | applyTelemetryRateLimit | 120 req/min |
| S | rateLimitStrict | строгий |

---

## Глобальная политика доступа

**Default deny**: все маршруты требуют JWT, кроме явного allowlist в `src/routes/index.js`.

Allowlist (публичные маршруты, `PUBLIC_ROUTES` в `src/routes/index.js`):
- `POST /auth/login` — вход
- `POST /auth/refresh` — обновление токена
- `POST /auth/verify-2fa`, `POST /auth/setup-2fa`, `POST /auth/confirm-2fa` — 2FA-поток (temp-token)
- `POST /metrics/telemetry` — приём телеметрии от устройств
- `GET /buildings-metrics` — данные для карты (optionalAuth, урезанные для анонимов)
- `GET /uk-requests-metrics` — ARCH-114 reconciliation inventory (read-only)
- `GET /map-layer-counts` — B-024 публичные агрегатные счётчики (только целые)
- `GET /` — информация об API
- `POST /webhooks/uk/building`, `POST /webhooks/uk/request` — входящие вебхуки УК (HMAC-verified, без JWT)

`POST /auth/register` **больше НЕ в allowlist** (R2-01) — требует JWT + `isAdmin`.

Route-level `authenticateJWT` удалён из всех файлов (глобальный middleware обеспечивает защиту).
`isAdmin` middleware — на всех admin-операциях И на инфраструктурной записи (R2-02).

---

## Матрица маршрутов по модулям

| Модуль | Доступ | RL |
|--------|--------|----|
| `POST /auth/login` | Public | Au |
| `POST /auth/register` | **JWT+Admin** (R2-01) | R |
| `POST /auth/refresh` | Refresh | — |
| `POST /auth/verify-2fa` / `setup-2fa` / `confirm-2fa` | Public (temp-token) | Au |
| `GET /auth/profile` | JWT | — |
| `POST /auth/logout` | JWT | — |
| `POST /auth/change-password` | JWT | — |
| `POST /metrics/telemetry` | Public | T |
| `GET /buildings-metrics` | **Public (optionalAuth, урезанные данные)** | — |
| `GET /uk-requests-metrics` | Public (read-only, ARCH-114) | — |
| `GET /map-layer-counts` | Public (агрегаты, B-024) | — |
| `POST /webhooks/uk/building` / `/request` | Public (HMAC) | — |
| `GET /` | Public | — |
| `/buildings` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/controllers` (GET) | JWT · (POST/PUT/PATCH/DELETE) **JWT+Admin** | C |
| `/metrics` (GET) | JWT · (POST/DELETE) **JWT+Admin** | C |
| `/transformers` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/lines` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/cold-water-sources` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/heat-sources` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/water-lines` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/water-suppliers` (GET) | JWT · (POST/PUT/DELETE) **JWT+Admin** | C |
| `/alerts` (GET) | JWT | A |
| `/alerts` (POST/PATCH) | JWT | C |
| `/alerts/thresholds` (PUT) | JWT+Admin | Ad |
| `/alerts/check/*` (POST) | JWT+Admin | Ad |
| `/analytics` (GET) | JWT | A |
| `/analytics/transformers` (POST/PUT/DELETE) | JWT+Admin | C |
| `/analytics` (остальные POST/PUT/DELETE) | JWT / JWT+Admin | C, Ad |
| `/power-analytics` (GET) | JWT | C |
| `/power-analytics/refresh` (POST) | JWT+Admin | C |
| `/controllers/update-status-by-activity` (POST) | JWT+Admin | C |
| `/admin/*` | JWT+Admin | S |

---

## Двухуровневый `/buildings-metrics`

| Пользователь | Получает |
|--------------|----------|
| Анонимный (без токена) | `building_id`, `building_name`, `address`, `town`, `latitude`, `longitude`, `has_controller` |
| Авторизованный (с JWT) | Все поля, включая метрики: `electricity_ph1-3`, `cold_water_pressure`, `hot_water_*`, `air_temp`, `humidity`, `leak_sensor` и т.д. |

---

## Сводка

| Показатель | Значение |
|------------|----------|
| Public GET бизнес-данных | 3 (`/buildings-metrics` урезанный, `/uk-requests-metrics`, `/map-layer-counts`) |
| Public write endpoints | 3 (`/metrics/telemetry`, `/webhooks/uk/building`, `/webhooks/uk/request` — последние два HMAC) |
| JWT защищённые эндпоинты | все API, кроме явного allowlist |
| Инфраструктурная запись | `JWT+Admin` (R2-02); `POST /auth/register` тоже `JWT+Admin` (R2-01) |
| Риск утечки инфраструктурных данных | низкий |
