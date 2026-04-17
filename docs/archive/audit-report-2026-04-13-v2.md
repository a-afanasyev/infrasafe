# Code Quality Report — InfraSafe (v2: Deep Audit)

**Дата:** 2026-04-13
**Аудитор:** Claude Opus 4.6
**Режим:** read-only (код не изменялся)
**v2:** Верификация v1 + глубокий архитектурный и security аудит

---

## Верификация отчёта v1

| Claim v1 | Статус | Комментарий |
|----------|--------|-------------|
| SEC-001 CRITICAL: `.env` с реальным секретом в git | **УТОЧНЕНИЕ** | `git ls-files .env` = пусто (файл НЕ отслеживается). Но `git log --diff-filter=A -- ".env"` показывает коммит `7a685040` — файл был закоммичен ранее, потом удалён из tracking. Секрет в истории git. Файл `.env` существует на диске с реальным `UK_WEBHOOK_SECRET`. Severity остаётся HIGH (не CRITICAL — файл не в текущем tree, но в истории) |
| PERF-001: N+1 в controllerService:254 | **ПОДТВЕРЖДЕНО** | Строки 255-264: `findAll(1, 10000)` → `for...of` → `Metric.findByControllerId` + `Controller.updateStatus` per controller |
| PERF-002: Sequential checkAllTransformers | **ПОДТВЕРЖДЕНО** | Строки 432-434: `for...of transformers` → `this.checkTransformerLoad(transformer.id)` |
| KISS-003: jwt.verify callback в async | **ПОДТВЕРЖДЕНО** | `auth.js:44` — `jwt.verify(token, secret, async (err, decoded) => {...})` внутри async функции |
| SEC-002: Metric.findByControllerId без LIMIT | **ПОДТВЕРЖДЕНО** | `Metric.js:94-115` — сигнатура `(controllerId, startDate, endDate)`, 4-й аргумент `1` из `controllerService.js:264` игнорируется |
| ARCH-009: activeAlerts in-memory Map | **ПОДТВЕРЖДЕНО** | `alertService.js:21` — `this.activeAlerts = new Map()` |
| ARCH-010: Rate limiter in-memory Map | **ПОДТВЕРЖДЕНО** | `rateLimiter.js:16` — `this.store = new Map()` |
| ARCH-007: Circular dep alertService ↔ ukIntegration | **ПОДТВЕРЖДЕНО** | Deferred `require()` в обоих файлах |
| KISS-008: Threshold divergence 85% vs 80% | **ПОДТВЕРЖДЕНО** | `alertService.js:12` = 85, `analyticsService.js` = 80 |

**Вывод:** Все ключевые claims v1 подтверждены. SEC-001 уточнён (HIGH, не CRITICAL).

---

## ЧАСТЬ I: ГЛУБОКИЙ SECURITY AUDIT

### Новые критические и высокие находки

---

**SEC-101 | HIGH | `src/middleware/auth.js:266` + `src/routes/authRoutes.js:279-281`**
**Temp-токен 2FA не инвалидируется после использования**

`authenticateTempToken` проверяет подпись токена но никогда не добавляет его в blacklist после успешной верификации. Три эндпоинта: `/verify-2fa`, `/setup-2fa`, `/confirm-2fa`. После успешного `verify-2fa` accessToken выдан, но tempToken остаётся действующим на остаток 5-минутного TTL.

Если tempToken перехвачен (MitM, XSS, утечка логов), атакующий может вызвать `/verify-2fa` повторно и получить новый accessToken, минуя 2FA. Для `setup-2fa` повторный вызов генерирует новый QR-код, перезаписывая уже установленный секрет.

Рекомендация: После успешной верификации — `authService.blacklistToken(req.body.tempToken)`. В `authenticateTempToken` — проверять blacklist до `verifyTempToken`.

---

**SEC-102 | HIGH | `src/routes/authRoutes.js:284`**
**Отсутствует rate limiting на `/auth/disable-2fa`**

Все auth-маршруты защищены `authLimiter` (10 попыток / 15 мин). Единственное исключение — `POST /auth/disable-2fa` (строка 284: `router.post('/disable-2fa', authController.disable2FA)` — нет `authLimiter.middleware()`).

Этот маршрут принимает `password` и вызывает `authService.authenticateUser()`, что является полноценной проверкой пароля. Без rate limiting — brute-force пароля возможен со скоростью сети.

**Дополнительный вектор**: `authenticateUser()` вызывает `recordFailedAttempt(login)`. Атакующий, зная username, может отправить 5 запросов с любым паролем → аккаунт жертвы заблокирован на 15 минут (DoS на уровне аккаунта).

Рекомендация: `router.post('/disable-2fa', authLimiter.middleware(), authController.disable2FA)`

---

**SEC-103 | HIGH | `src/config/env.js:5-12` + `src/services/totpService.js:15-21`**
**`TOTP_ENCRYPTION_KEY` не проверяется при старте, не в `.env.example`**

`TOTP_ENCRYPTION_KEY` отсутствует в `REQUIRED_VARS` (`env.js:5-12`). Приложение стартует успешно без неё. Ошибка "TOTP_ENCRYPTION_KEY must be at least 32 characters" возникнет только при первой попытке пользователя настроить 2FA — в продакшне, перед реальным пользователем.

**Сценарий lockout**: Admin-аккаунты обязаны настроить 2FA (`authController.js:32-39`). Если переменная не задана → login требует 2FA setup → setup бросает 500 → admin не может войти. Полная блокировка admin-доступа.

Переменная также полностью отсутствует в `.env.example`.

Рекомендация: Добавить в `REQUIRED_VARS` и в `.env.example` с комментарием `# Generate: openssl rand -base64 32`.

---

**SEC-104 | HIGH | `src/services/totpService.js:15-21`**
**Слабое получение AES-ключа: SHA-256 без соли, одна итерация**

```javascript
return crypto.createHash('sha256').update(key).digest();
```

Если `TOTP_ENCRYPTION_KEY` — человекочитаемая фраза (вероятно в реальных deployments), одна итерация SHA-256 без соли уязвима к офлайн-атаке по словарю. При утечке БД → злоумышленник перебирает вероятные значения ключа → расшифровывает все TOTP-секреты → обход 2FA для всех аккаунтов.

Проверка `key.length < 32` (строка 17) валидирует длину строки, не энтропию. `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` (32x 'a') пройдёт проверку.

Рекомендация: Использовать HKDF (`crypto.hkdfSync('sha256', key, 'infrasafe-totp-v1', '', 32)`) или документировать что значение ОБЯЗАТЕЛЬНО должно быть случайным (`openssl rand -base64 32`).

---

### Средние находки

---

**SEC-105 | MEDIUM | `src/controllers/authController.js:328`**
**disable-2FA: атака блокировки аккаунта через `authenticateUser()`**

`disable2FA` вызывает `authService.authenticateUser(user.username, password)`. Неудачные попытки инкрементируют общий lockout-счётчик. 5 неудачных попыток → аккаунт заблокирован 15 мин. Атакующий без знания пароля может заблокировать любой аккаунт, зная только username. (Связано с SEC-102 — rate limiter митигирует до 10 попыток / 15 мин, но не устраняет.)

Рекомендация: Для верификации пароля в disable-2fa использовать отдельный путь без lockout-логики, или отдельный счётчик.

---

**SEC-106 | MEDIUM | `src/services/totpService.js:137`**
**TOTP: нет защиты от повтора кода в пределах 30-секундного окна**

`verifyCode` проверяет код через otplib но не хранит использованные коды. Один 6-значный код действителен до 30 секунд и может быть использован несколько раз. Стандартная проблема TOTP без single-use enforcement.

Рекомендация: Хранить хэш использованного кода в кеше с TTL=30s, отклонять повтор.

---

**SEC-107 | MEDIUM | `src/middleware/auth.js:27,44`**
**Race condition: blacklist check перед jwt.verify**

1. Строка 27: `await isTokenBlacklisted(token)` — проверка blacklist
2. Строка 44: `jwt.verify(token, ..., callback)` — проверка подписи

Если между шагами другой запрос (logout) добавит токен в blacklist, текущий запрос пройдёт с отозванным токеном. Окно — миллисекунды, практическая эксплуатация сложна.

Рекомендация: Переместить blacklist check ВНУТРЬ callback jwt.verify, после декодировки.

---

### Позитивные находки (security)

1. **AES-256-GCM реализован правильно**: IV = `crypto.randomBytes(16)`, authTag сохраняется и верифицируется (`totpService.js:23-43`)
2. **Recovery-коды через bcrypt**: 12 раундов, после использования удаляются (`totpService.js:54-58`)
3. **Admins не могут отключить 2FA**: проверка роли в `totpService.disable()` (строка 175)
4. **Все SQL-запросы параметризованы**: ни одного случая конкатенации строк в SQL не обнаружено
5. **errorHandler корректно скрывает 500**: для `statusCode >= 500` клиент получает только "Внутренняя ошибка сервера"
6. **npm audit = 0 уязвимостей**: все зависимости актуальны
7. **Webhook HMAC**: timing-safe, replay protection 300s, rawBody корректен
8. **SSRF-защита UK API**: приватные IP заблокированы, allowlist через env

---

## ЧАСТЬ II: ГЛУБОКИЙ АРХИТЕКТУРНЫЙ AUDIT

### Новые высокие находки

---

**ARCH-101 | HIGH | `src/services/alertService.js:195-241`**
**Alert creation + UK forwarding НЕ атомарны, нет retry/outbox**

Alert INSERT-ится в БД (строка 217), Map обновляется (223), затем `sendNotifications()` (230). Если процесс упадёт между INSERT и UK API call → алерт в БД, но UK request не создан. Нет retry queue, нет outbox pattern, нет periodic reconciliation.

Impact: Алерты могут быть навсегда потеряны из UK forwarding pipeline.

Рекомендация: Outbox pattern: при создании алерта, matching alert_rule → INSERT `pending_uk_forward` в той же транзакции. Periodic job подбирает unfulfilled записи.

---

**ARCH-102 | HIGH | `src/middleware/auth.js:27` + `src/services/authService.js:505-538`**
**DB down → auth middleware блокирует ВСЕ запросы**

Когда PostgreSQL недоступен:
1. `authenticateJWT` → `isTokenBlacklisted(token)` → cache miss → `db.query()` → timeout (5s)
2. Каждый authenticated endpoint возвращает 500 с задержкой 5+ секунд

Нет circuit breaker на auth path. Health check (`/health`) работает корректно (отдельный mount).

Impact: При DB outage все API запросы не fail-fast а ждут 5 секунд timeout.

Рекомендация: Wrap blacklist DB lookup в circuit breaker. При open state — пропускать blacklist check (fail-open для доступности, accept risk of revoked token working briefly).

---

**ARCH-103 | HIGH | `database/init/01_init_database.sql:345-369`**
**`metrics` table: нет partitioning, нет retention policy**

Таблица `metrics` не партиционирована. `metricService.cleanupOldMetrics()` (строка 288-307) — **stub**: логирует "функция в разработке", не удаляет ничего. С IoT-датчиками, отправляющими метрики каждую минуту, таблица растёт неограниченно.

Единственный индекс: B-tree на `timestamp`. При миллионах записей — деградация запросов.

Рекомендация: Range partitioning по месяцу + retention policy (drop partitions > N месяцев). Как interim — реализовать `cleanupOldMetrics()`.

---

**ARCH-104 | HIGH | `src/services/totpService.js:15-21` (= SEC-103)**
**`TOTP_ENCRYPTION_KEY` не валидируется при старте → admin lockout**

Дублирует SEC-103. Включён в архитектурный раздел из-за системного impact: полная блокировка admin-доступа при отсутствии переменной.

---

### Средние находки

---

**ARCH-105 | MEDIUM | `src/services/authService.js:237-269`**
**Refresh token rotation: race window позволяет повторное использование**

В `refreshToken()` строка 259: старый refresh token blacklist-ится ПОСЛЕ верификации. Два concurrent запроса с одним refresh token оба пройдут `isTokenBlacklisted()` check до того, как любой из них blacklist-ит токен. Оба сгенерируют новые token pairs.

Рекомендация: `INSERT ... ON CONFLICT` в `token_blacklist` — atomic consume-and-invalidate.

---

**ARCH-106 | MEDIUM | `src/services/alertService.js:157-223`**
**Alert deduplication race: нет DB UNIQUE constraint**

`activeAlerts.has(alertKey)` (строка 158) — in-memory check. Два concurrent запроса оба пройдут проверку, оба INSERT-ят алерт. Нет `UNIQUE INDEX ON infrastructure_alerts (infrastructure_type, infrastructure_id, type) WHERE status = 'active'`.

Impact: Дубликаты алертов в БД. Каждый дубликат триггерит свой UK request pipeline.

Рекомендация:
```sql
CREATE UNIQUE INDEX idx_active_alert_dedup
ON infrastructure_alerts (infrastructure_type, infrastructure_id, type)
WHERE status = 'active';
```

---

**ARCH-107 | MEDIUM | `database/init/01_init_database.sql:829-858`**
**Materialized view использует legacy `power_transformers`, не активную `transformers`**

`mv_transformer_load_realtime` джойнит `power_transformers pt` через `pt.id::VARCHAR = b.power_transformer_id::VARCHAR`. Активная таблица — `transformers` (строка 107), UI и CRUD пишут в неё. Трансформатор, добавленный через admin UI, НЕ появится в materialized view analytics.

Impact: Аналитика по нагрузке может быть неполной для новых трансформаторов.

---

**ARCH-108 | MEDIUM | `database/init/01_init_database.sql` vs `migrations/007`**
**Compound index `idx_metrics_ctrl_ts` отсутствует в init SQL**

Migration 007 создаёт `idx_metrics_ctrl_ts(controller_id, timestamp DESC)`. Init SQL НЕ включает его. На fresh Docker setup без migrations → LATERAL join в `buildingMetricsService.js:36-42` делает sequential scan.

Рекомендация: Добавить индекс в init SQL.

---

**ARCH-109 | MEDIUM | `src/services/alertService.js:24`**
**`lastChecks` Map lost on restart → alert burst**

При рестарте все cooldown-ы (15 мин, `lastChecks`) теряются. Следующий `checkAllTransformers()` проверит все трансформаторы без cooldown → burst дубликатов алертов. `loadActiveAlerts()` (строка 83) восстанавливает `activeAlerts` из БД, но НЕ cooldown для проверок, которые не создали алертов.

---

**ARCH-110 | MEDIUM | `src/clients/ukApiClient.js:14-43`**
**UK API token refresh race condition**

Если два concurrent запроса видят expired token → оба вызовут UK API `/auth/login` одновременно → лишний auth traffic. При UK API rate limiting → failures.

Рекомендация: Promise deduplication: `this._authPromise` — if auth in-flight, return same promise.

---

**ARCH-111 | MEDIUM | `src/models/IntegrationConfig.js`**
**DB-stored config без кеша, запрашивается на каждый webhook**

`isEnabled()` → `SELECT value FROM integration_config WHERE key = $1` на каждый webhook. `ukApiClient.authenticate()` дополнительно запрашивает `uk_api_url`.

Рекомендация: Cache с TTL=60s (паттерн `_requestCountsCache` уже есть в ukIntegrationService).

---

**ARCH-112 | MEDIUM | `src/services/alertService.js:230`**
**`sendNotifications` silently swallows все ошибки**

Строки 264-266: outer catch логирует но не отслеживает failure. Критические алерты могут быть созданы в БД без уведомления оператора.

---

**ARCH-113 | MEDIUM | Multiple services**
**4 сервиса bypass model layer для direct SQL**

| Service | Описание |
|---------|----------|
| `authService.js` | Все user queries (64, 295, 322, 353, 385, 465, 490, 518) |
| `buildingMetricsService.js` | Complex LATERAL join (строка 89) |
| `powerAnalyticsService.js` | CTE queries (65, 71, 152, 158) |
| `totpService.js` | User table mutations (72, 87, 111, 121, 151, 166, 179) |

`totpService.js` особенно рискован: мутирует `users` таблицу, не инвалидируя user cache в `authService.findUserById()` (кеш 5 мин). При введении User model эти мутации обойдут его.

---

### Низкие / Информационные

| ID | Location | Finding |
|----|----------|---------|
| ARCH-114 LOW | `webhookRoutes.js:86-90` | `isDuplicateEvent()` — избыточный SELECT; service layer уже dedup через UNIQUE |
| ARCH-115 LOW | `Building.js:331` / init SQL:80 | UK buildings могут fail на NOT NULL latitude constraint если init SQL без migration 011 |
| ARCH-116 LOW | `cacheService.js:6-8` | Cache memory unbounded per-entry size, нет LRU |
| ARCH-117 LOW | `server.js:148-171` | Graceful shutdown без deadline для in-flight requests |
| ARCH-118 LOW | `analyticsService.js:86-97` | `setImmediate(async)` — unhandled rejection при sync throw может crash процесс |
| ARCH-119 LOW | `ukIntegrationService.js:54-67` | Config `uk_integration_enabled` принимает любую строку; "True" (capital T) = disabled |
| ARCH-120 LOW | `migration 011:50-59` | Missing indexes: `alert_request_map(infrasafe_alert_id)`, `alert_request_map(uk_request_number)` |

---

## Обновлённая сводная таблица (v1 + v2)

### Security Findings (v2)

| ID | Sev | OWASP | Location | Description |
|----|-----|-------|----------|-------------|
| SEC-001 | HIGH | A05 | `.env` (git history) | UK_WEBHOOK_SECRET в git истории (не в current tree) |
| SEC-101 | **HIGH** | A07 | `auth.js:266`, `authRoutes.js:279-281` | TempToken 2FA не инвалидируется после использования |
| SEC-102 | **HIGH** | A04 | `authRoutes.js:284` | Нет rate limiting на `/disable-2fa` → brute-force + account lockout |
| SEC-103 | **HIGH** | A05 | `env.js:5-12`, `totpService.js:15-21` | `TOTP_ENCRYPTION_KEY` не валидируется при старте → admin lockout |
| SEC-104 | **HIGH** | A02 | `totpService.js:15-21` | SHA-256 без соли для AES-ключа → словарная атака при DB leak |
| SEC-002 | MEDIUM | — | `Metric.js:94` | `findByControllerId` без LIMIT |
| SEC-105 | MEDIUM | A07 | `authController.js:328` | disable-2fa инкрементирует lockout-счётчик → DoS per account |
| SEC-106 | MEDIUM | A07 | `totpService.js:137` | TOTP replay в 30-секундном окне |
| SEC-107 | MEDIUM | A07 | `auth.js:27,44` | Blacklist check TOCTOU race window |
| SEC-003 | MEDIUM | — | `AlertType.js:12`, `AlertRule.js:8` | Unbounded SELECT |

### Architecture Findings (v2)

| ID | Sev | Category | Location | Description |
|----|-----|----------|----------|-------------|
| ARCH-101 | **HIGH** | Data Flow | `alertService.js:195-241` | Alert+UK forward не atomic, нет outbox |
| ARCH-102 | **HIGH** | Resilience | `auth.js:27` | DB down → 5s timeout на каждый authenticated request |
| ARCH-103 | **HIGH** | Database | init SQL:345-369 | metrics table без partition/retention |
| ARCH-104 | **HIGH** | Config | `totpService.js:15-21` | TOTP key не проверяется при старте |
| ARCH-007 | HIGH | Coupling | `ukIntegration ↔ alertService` | Circular dep через deferred require() |
| ARCH-009 | HIGH | State | `alertService.js:21` | activeAlerts Map per-process |
| ARCH-010 | HIGH | State | `rateLimiter.js:4` | Rate limiter Map per-process |
| ARCH-105 | MEDIUM | Concurrency | `authService.js:237-269` | Refresh token reuse race |
| ARCH-106 | MEDIUM | Concurrency | `alertService.js:157-223` | Alert dedup race, нет UNIQUE constraint |
| ARCH-107 | MEDIUM | Database | init SQL:829-858 | MV uses legacy power_transformers |
| ARCH-108 | MEDIUM | Database | init SQL vs migration 007 | Compound index missing |
| ARCH-109 | MEDIUM | State | `alertService.js:24` | lastChecks lost → alert burst |
| ARCH-110 | MEDIUM | Concurrency | `ukApiClient.js:14-43` | Token refresh race |
| ARCH-111 | MEDIUM | Config | `IntegrationConfig.js` | Uncached DB query per webhook |
| ARCH-112 | MEDIUM | Resilience | `alertService.js:230` | sendNotifications silently swallows errors |
| ARCH-113 | MEDIUM | Coupling | Multiple services | 4 services bypass model layer |

---

## Приоритизация исправлений (v2)

### P0 — Fix immediately

| # | ID | Description | Effort |
|---|-----|-------------|--------|
| 1 | SEC-102 | Добавить `authLimiter.middleware()` на `/disable-2fa` | 1 строка |
| 2 | SEC-103 / ARCH-104 | Добавить `TOTP_ENCRYPTION_KEY` в `REQUIRED_VARS` + `.env.example` | 3 строки |
| 3 | SEC-001 | Ротировать `UK_WEBHOOK_SECRET` + `git filter-repo` для очистки истории | 30 мин |

### P1 — Fix this sprint

| # | ID | Description | Effort |
|---|-----|-------------|--------|
| 4 | SEC-101 | Blacklist tempToken после использования в verify-2fa/setup-2fa/confirm-2fa | Low |
| 5 | SEC-104 | Заменить `SHA-256` на `hkdfSync` в `getEncryptionKey()` | Low |
| 6 | ARCH-102 | Circuit breaker на `isTokenBlacklisted()` DB fallback | Medium |
| 7 | ARCH-106 | Partial UNIQUE index на active alerts для deduplication | Low |
| 8 | ARCH-103 | Реализовать `cleanupOldMetrics()` (хотя бы базовый DELETE > 90 дней) | Low |
| 9 | PERF-001 | Fix N+1 в `updateControllersStatusByActivity` → single SQL с CTE | Medium |
| 10 | ARCH-108 | Добавить compound index `metrics(controller_id, timestamp DESC)` в init SQL | 1 строка |

### P2 — Technical debt

| # | ID | Description | Effort |
|---|-----|-------------|--------|
| 11 | ARCH-101 | Outbox pattern для alert → UK forwarding | Medium |
| 12 | ARCH-107 | Переписать materialized view на активную таблицу transformers | Medium |
| 13 | ARCH-007 | Event emitter вместо circular require() | Medium |
| 14 | SEC-106 | Anti-replay для TOTP (кеш использованных кодов, TTL=30s) | Low |
| 15 | DRY-003 | Извлечь `adminQueryBuilder.js` из 7 copy-paste controllers | Medium |
| 16 | ARCH-009/010 | Redis для rate limiter + activeAlerts (при масштабировании) | High |
| 17 | ARCH-105 | Atomic refresh token rotation (`INSERT ... ON CONFLICT`) | Low |

### P3 — Nice to have

| # | ID | Description |
|---|-----|-------------|
| 18 | SEC-107 | Переместить blacklist check внутрь jwt.verify callback |
| 19 | ARCH-111 | Cache для IntegrationConfig (TTL=60s) |
| 20 | ARCH-112 | Tracking notification failures для retry |
| 21 | DOC-001 | Обновить README (тесты 677, порт 8088, migration 011) |
| 22 | YAGNI-001/2/3 | Удалить 3 orphaned root-level scripts |

---

## Code Health Score (v2 — updated)

| Criterion | v1 | v2 | Comment |
|-----------|-----|-----|---------|
| Readability | 7 | 7 | Без изменений |
| Maintainability | 5 | 5 | DRY + circular deps не изменились |
| Testability | 6 | 5.5 | totpService (security-critical, 198 строк) = 0 unit tests |
| Simplicity | 6 | 6 | Без изменений |
| Consistency | 5 | 5 | Без изменений |
| Security | 7 | **5.5** | 2FA implementation имеет 4 HIGH issues; TOTP key derivation слабый |
| Performance | 6 | 6 | N+1 + metrics retention подтверждены |
| Documentation | 5 | 5 | Без изменений |
| **OVERALL** | **5.9** | **5.6 /10** | **2FA implementation снизила security score; остальное стабильно** |

---

## Итого: v1 → v2

- **v1**: 94 findings (1 critical, 20 high, 26 medium)
- **v2 новые**: 4 HIGH security + 4 HIGH architecture + 8 MEDIUM + 7 LOW = **23 новых**
- **v1 уточнения**: SEC-001 downgraded CRITICAL → HIGH (файл не в current tree)
- **Общий итого**: **117 findings** (0 critical, 28 high, 34 medium, 32 low, 23 info)
- **Самый рискованный компонент**: `src/services/totpService.js` — 4 отдельных security issues, 0 unit tests
