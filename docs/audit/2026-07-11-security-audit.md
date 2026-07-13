# Security Audit — InfraSafe

**Дата:** 2026-07-11  
**Область:** backend (`src/`), frontend (`public/`, `frontend-html/`), Docker/Nginx, `scripts/`, зависимости (`package.json`, `generator/`)  
**Режим:** read-only (код не изменялся)  
**Метод:** статический разбор кода + конфигов + `npm audit`  
**Ограничения:** без live exploit; `.env.prod` не читался; ветка `frontend-design/` не углублялась

---

## 1. Вердикт

Критических RCE / классического SQL injection / JWT algorithm confusion / webhook HMAC bypass не найдено. Периметр зрелый: default-deny JWT, HMAC webhooks, nginx SEC-20/22, immutable prod image, whitelist SQL.

Основные риски:

1. **Сессионный отзыв** — lockout / `is_active` не режут уже выданные access JWT
2. **Публичная телеметрия** без device-auth
3. **Публичный UK inventory** без auth/HMAC
4. **Multi-replica gaps** — Redis optional → rate limit / webhook replay / TOTP anti-replay per-process
5. **Dependency CVE** — 1 moderate в prod (morgan); high в generator (form-data)

| Severity | Кол-во (уникальные) |
|----------|---------------------|
| Critical | 0 |
| High | 6 (+ 1 High CVE в generator) |
| Medium | ~15 |
| Low/Info | см. §4–5 |
| CVE (prod app) | 1 moderate |
| CVE (generator) | 1 high + 2 moderate |

---

## 2. High

### H-1. Lockout не отзывает активные JWT

- **Где:** `src/services/authService.js` (checkAccountLockout / recordFailedAttempt), `src/middleware/auth.js:91-96`, `src/models/AccountLockout.js`
- **Суть:** Брутфорс-блокировка пишется в `account_lockout`. Middleware смотрит `users.account_locked_until`, которое при lockout **не обновляется**. Уже выданный access token живёт до expiry (~1 ч).
- **Рекомендация:** Синхронизировать `users.account_locked_until` при lockout **или** в JWT middleware проверять `account_lockout` по username/email; опционально — blacklist токенов пользователя.

### H-2. `is_active=false` не проверяется в JWT middleware

- **Где:** `src/middleware/auth.js:74-100` (`authenticateJWT`, `optionalAuth`)
- **Суть:** `is_active` проверяется при login/refresh, но не в `authenticateJWT`. Деактивированный пользователь с валидным access token продолжает вызывать API.
- **Рекомендация:** `if (!user.is_active) return 401` в `authenticateJWT`, `authenticateRefresh`, `optionalAuth`; инвалидация кэша при деактивации.

### H-3. Публичная телеметрия без device authentication

- **Где:** `src/routes/index.js:102`, `src/controllers/metricController.js:88-107`, `src/services/metricService.js`
- **Суть:** `POST /api/metrics/telemetry` в PUBLIC_ROUTES. Достаточно знать `serial_number` → подделка метрик → триггер LEAK/VOLTAGE/HEATING → UK pipeline. Rate limit 120/min не заменяет auth. Serial в seed предсказуемы (`CRTL_OL_01`…).
- **Рекомендация:** HMAC / API-key per controller, mTLS или IP allowlist industrial edge.

### H-4. Публичный UK inventory

- **Где:** `src/routes/index.js:109`, `src/controllers/ukRequestsMetricsController.js`
- **Суть:** `GET /api/uk-requests-metrics` без auth: `uk_request_number`, `status`, `building_external_id`, `updated_at` (до 10 000). ARCH-114 by design, но доступно из интернета без HMAC/IP.
- **Рекомендация:** IP allowlist UK, shared secret header, или только internal network.

### H-5. Token blacklist — fail-open при недоступности БД

- **Где:** `src/services/authService.js:655-704`
- **Суть:** При circuit breaker / DB error `isTokenBlacklisted` возвращает `false` — отозванные и reuse refresh принимаются. L1-кэш blacklist не shared между репликами.
- **Рекомендация:** В prod при открытом breaker — fail-closed (503) для auth; Redis-backed shared blacklist; мониторинг деградации.

### H-6. Dev-поверхность (если dev-стек на публичном хосте)

- **Где:** `docker-compose.dev.yml` (ports `8088:8080` без loopback), hardcoded `postgres/postgres`, `database/init/02_seed_data.sql` (`admin` / `admin123`)
- **Суть:** Frontend на всех интерфейсах; известные креды в seed.
- **Рекомендация:** `127.0.0.1:8088:8080`; не поднимать dev-compose на публичных хостах; убрать plaintext-пароль из комментария seed.

---

## 3. Medium

### Auth / сессии

| ID | Finding | Где |
|----|---------|-----|
| M-1 | `optionalAuth` не проверяет `is_active` / `password_changed_at` → полная проекция buildings-metrics | `auth.js`, `buildingMetricsController.js` |
| M-2 | TOTP anti-replay — in-memory Map, не multi-replica safe | `totpService.js:39-56` |
| M-3 | Кэш пользователя 5 мин — задержка отзыва роли/деактивации | `authService.js:464-471` |
| M-4 | `tempToken`, TOTP secret, recovery codes в JSON (XSS-окно) | `authController.js` |
| M-5 | `disable-2fa` — пароль без per-account lockout | `authController.js`, `verifyPasswordOnly` |
| M-6 | `TOKEN_REUSE` → 500 вместо 401; нет invalidate-all-sessions | `authService.js`, `authController.js` |
| M-7 | Rate limiter без Redis — лимиты per-replica (`10×N`) | `rateLimiter.js`, `server.js` |

### Injection / XSS / SSRF / validation

| ID | Finding | Где |
|----|---------|-----|
| M-8 | ILIKE без `validateSearchString` (wildcard abuse, не SQLi) | `Line.js`, `Transformer.js`, `WaterSupplier.js` |
| M-9 | Popup sanitize условный — fail-open без DOMSecurity | `public/script.js:1779-1782` |
| M-10 | `UK_API_ALLOWED_HOSTS` опционален — DNS rebinding риск | `urlValidation.js`, `env.js` |
| M-11 | Webhook replay dedup без Redis — не shared | `webhookVerifier.js:159-186` |
| M-12 | Batch water_lines status без enum whitelist | `adminWaterLineController.js:204-209` |

### Infra / secrets / disclosure

| ID | Finding | Где |
|----|---------|-----|
| M-13 | `COOKIE_SIGNING_SECRET` не в `validateEnv()` | `env.js`, `server.js` |
| M-14 | `INFRASAFE_WEBHOOK_SECRET` — warn, не fail-fast | `env.js:116-120` |
| M-15 | App `/health` раскрывает `db: connected/disconnected` | `server.js:116-122` |
| M-16 | Публичный `GET /api/` — карта эндпоинтов | `routes/index.js:169-191` |
| M-17 | Winston без redaction password/token/secret | `logger.js` |
| M-18 | Dev Postgres `log_statement=all` — PII в логах | `docker-compose.dev.yml` |
| M-19 | Staging: `nginx.staging.conf` отсутствует в репо | `docker-compose.staging.yml` |
| M-20 | Anonymous buildings-metrics: адреса + координаты | `buildingMetricsService.js` (product risk) |
| M-21 | UK SPA CSP: широкий `img-src https:` | `nginx.production.conf` |
| M-22 | Generator порт `8081` на всех интерфейсах | `docker-compose.generator.yml` |

---

## 4. Low / Info

| ID | Severity | Finding |
|----|----------|---------|
| L-1 | Low | Общий rate-limit bucket login + 2FA + disable-2fa |
| L-2 | Low | CSRF: allow если нет Origin/Referer (mitigated SameSite=strict) |
| L-3 | Low | CSP `style-src 'unsafe-inline'` |
| L-4 | Low | DOMPurify `ALLOWED_ATTR` включает `style` |
| L-5 | Low | Edge `/health` — static 200 без upstream |
| L-6 | Low | Webhook building `event` не валидируется на route (есть в service) |
| L-7 | Low | `Controller.create` — status без enum на create |
| L-8 | Info | Cookies не signed, хотя cookieParser с секретом |
| L-9 | Info | Bearer обходит CSRF (by design) |
| L-10 | Info | Auth-user читает всю инфраструктуру; isAdmin только на мутациях |
| L-11 | Info | Dev: JWT_2FA_SECRET fallback на JWT_SECRET (prod защищён) |
| L-12 | Info | SEC-14 immutable image — подтверждён для prod app |
| L-13 | Info | Нет child_process/eval в `src/` |
| L-14 | Info | Network isolation UK (app не в uk-network) — verified |

---

## 5. Dependency CVE (`npm audit`, 2026-07-11)

### 5.1 App — production (`npm audit --omit=dev`)

| Пакет | Severity | Advisory | Риск | Fix |
|-------|----------|----------|------|-----|
| **morgan** `1.10.1` (direct) | moderate | [GHSA-4vj7-5mj6-jm8m](https://github.com/advisories/GHSA-4vj7-5mj6-jm8m) — log forging via `:remote-user` | Низкий (Basic Auth почти не используется; safepath без query) | bump >1.10.1 / `npm audit fix` |

**Итого prod app:** 0 critical, 0 high, **1 moderate**.

### 5.2 App — dev-only

| Пакет | Severity | Где | Риск |
|-------|----------|-----|------|
| **js-yaml** `<3.15.0` | moderate | Jest → `@istanbuljs/load-nyc-config` | DoS при YAML merge keys; нет в prod image (`omit=dev`) |

### 5.3 Generator (`generator/`)

| Пакет | Severity | Advisory | Fix |
|-------|----------|----------|-----|
| **form-data** `4.0.0–4.0.5` | **high** | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) CRLF multipart | `npm audit fix` |
| **uuid** `<11.1.1` (via node-cron) | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | `npm audit fix --force` → node-cron@4.x (breaking) |

---

## 6. Сильные контроли (verified)

| Область | Реализация |
|---------|------------|
| Default-deny JWT + PUBLIC_ROUTES | `src/routes/index.js` |
| Register только admin | `authRoutes.js` |
| HS256 + issuer/audience + scope guard | `auth.js` |
| Отдельный JWT_2FA_SECRET (prod) | `env.js` |
| Обязательный 2FA для admin | `authController`, `totpService` |
| Refresh rotation + blacklist | `authService` |
| password_changed_at cutoff | `authService`, `auth.js` |
| Cookies HttpOnly + Secure + SameSite=strict | `authCookies.js` |
| CSRF Origin/Referer guard | `csrfOriginGuard.js` |
| bcrypt 12 + persistent lockout + timing equalizer | `authService`, `AccountLockout` |
| Webhook HMAC fail-close + timingSafeEqual + replay 300s | `webhookVerifier.js` |
| SQL whitelist / IDENT_RE / parameterized | `adminQueryBuilder`, `dynamicUpdateBuilder`, `queryValidation` |
| Telemetry field allowlist SEC-25 | `metricService.js` |
| UK outbound SSRF guards | `urlValidation.js` |
| Nginx SEC-20/22, deny `.map`, Swagger 404, HSTS/CSP | `nginx.production.conf` |
| Immutable prod image SEC-14 | `Dockerfile.unified`, compose |
| Least-privilege `infrasafe_runtime` | migration 017 |
| App не в uk-network (B-010/B-011) | `docker-compose.unified.yml` |
| Prod loopback ports; Postgres без published ports | compose |
| DOMPurify / textContent на admin/map | `domSecurity.js`, `admin.js` |
| Security Jest suite | `tests/jest/security/` |

---

## 7. Приоритетный план remediation

1. **H-1 + H-2** — сессионный отзыв: `is_active` + lockout в JWT middleware
2. **H-3** — device auth на телеметрию
3. **H-4** — ограничить `/uk-requests-metrics`
4. **H-5 + Redis** — fail-closed blacklist; обязательный `REDIS_URL` при multi-replica
5. **CVE** — bump `morgan`; в generator — `form-data` (+ осторожно uuid/node-cron)
6. **Prod env hard-fail** — `COOKIE_SIGNING_SECRET`, `UK_API_ALLOWED_HOSTS`, webhook secret при включённой интеграции
7. **Frontend** — fail-close popup без DOMPurify; ILIKE → `validateSearchString`
8. **Dev hygiene** — loopback 8088; staging nginx conf; урезать health/API root disclosure

---

## 8. Что не проверялось / follow-up

- [ ] Live penetration / fuzzing
- [ ] Runtime `.env.prod` secrets review (оператор)
- [ ] `frontend-design/` (feature branch)
- [ ] Полный SBOM / Dependabot policy
- [ ] Нагрузочный тест rate limits с multi-replica

---

## 9. Источники этого аудита

- Статический разбор auth, injection/XSS/SSRF, infra (2026-07-11)
- `npm audit` / `npm audit --omit=dev` / `generator/` npm audit (2026-07-11)
- Подтверждение ключевых High по файлам: `auth.js`, `authService.js`, `routes/index.js`

**Связанные документы:** `docs/audit/2026-05-29-security-audit.md`, `docs/audit/2026-06-01-security-pentest.md`
