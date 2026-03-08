# InfraSafe API — Матрица аутентификации маршрутов

**Дата:** 2026-03-08
**Ветка:** fix/p0-p1-security-and-hygiene
**Статус:** Реализовано (default-deny)

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

Allowlist (публичные маршруты):
- `POST /auth/login` — вход
- `POST /auth/register` — регистрация
- `POST /auth/refresh` — обновление токена
- `POST /metrics/telemetry` — приём телеметрии от устройств
- `GET /buildings-metrics` — данные для карты (optionalAuth, урезанные для анонимов)
- `GET /` — информация об API

Route-level `authenticateJWT` удалён из всех файлов (глобальный middleware обеспечивает защиту).
`isAdmin` middleware сохранён на всех admin-операциях.

---

## Матрица маршрутов по модулям

| Модуль | Доступ | RL |
|--------|--------|----|
| `POST /auth/login` | Public | Au |
| `POST /auth/register` | Public | R |
| `POST /auth/refresh` | Refresh | — |
| `GET /auth/profile` | JWT | — |
| `POST /auth/logout` | JWT | — |
| `POST /auth/change-password` | JWT | — |
| `POST /metrics/telemetry` | Public | T |
| `GET /buildings-metrics` | **Public (optionalAuth, урезанные данные)** | — |
| `GET /` | Public | — |
| `/buildings` (GET/POST/PUT/DELETE) | JWT | C |
| `/controllers` (GET/POST/PUT/PATCH/DELETE) | JWT | C |
| `/metrics` (GET/POST/DELETE) | JWT | C |
| `/transformers` (GET/POST/PUT/DELETE) | JWT | C |
| `/lines` (GET/POST/PUT/DELETE) | JWT | C |
| `/cold-water-sources` (GET/POST/PUT/DELETE) | JWT | C |
| `/heat-sources` (GET/POST/PUT/DELETE) | JWT | C |
| `/water-lines` (GET/POST/PUT/DELETE) | JWT | C |
| `/water-suppliers` (GET/POST/PUT/DELETE) | JWT | C |
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
| Public GET бизнес-данных | 1 (`/buildings-metrics`, урезанный) |
| Public write endpoints | 1 (`/metrics/telemetry`) |
| JWT защищённые эндпоинты | все API, кроме явного allowlist |
| Риск утечки инфраструктурных данных | низкий |
