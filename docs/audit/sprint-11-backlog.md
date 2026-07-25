# Бэклог InfraSafe — верифицирован 2026-07-25

> **Как получен этот список.** Каждый пункт перепроверен **тремя независимыми агентами** по трём
> линзам: (A) «код как есть в HEAD», (B) «git-история: что реально смержено и не откачено», (C)
> «адверсариальная — доказать, что пункт ещё открыт». Вердикт — по большинству голосов; при трёх
> разных мнениях пункт помечен `DISPUTED` и разобран вручную. Проверено 105 пунктов
> (R2-01…38, H-1…6 + CVE, M-1…22, L-1…14, carry-over B-/SEC-, остатки AUD, инфра-треки).
>
> **Итог голосования:** 48 CLOSED · 18 PARTIAL · 34 OPEN · 1 SUPERSEDED · 2 UNKNOWN · 2 разобраны вручную.
>
> **История до 2026-07-02** (полные разборы B-001…B-027, SEC-1…34, AUD-001…044, все Closed-секции) —
> в `docs/archive/sprint-11-backlog-history-to-2026-07-02.md`. Здесь только то, что открыто **сегодня**.
>
> **Правило ведения:** ни один пункт не помечается закрытым без `file:line` или sha. Маркеры ✅ в
> старом бэклоге оказались недостоверны в обе стороны — 30 закрытых пунктов числились открытыми,
> и наоборот. Не доверять статусам без доказательства.

**Deploy-контекст.** Репозиторий не может подтвердить состояние продов. Известно из журналов деплоя:
батч #116–#133 задеплоен 2026-07-03 (git `25b70ac`), батч H-1…H-5 + PR-5/PR-6 — 2026-07-12 (`5e73ec0`),
UK-трек (`c794c45`, #145, #146, #147) — 2026-07-23/24, оба прода. Всё, что помечено «код закрыт»,
живёт на продах, если не оговорено иное.

**PR-2 (`d6c0f8e`, #148) — смержен в main 2026-07-25 (`052722f`), на прода ПОКА НЕ задеплоен** ни на
profk, ни на infrasafe.uz. В нём есть frontend-изменение (`map-layers-control.js`), значит нужен ребилд
образа: `public/dist` печётся внутрь по SEC-14 и извлекается `scripts/rebuild-frontend.sh` на деплое.
Снять эту пометку после деплоя на оба хоста.

---

## 1. Открыто — приоритетная очередь

### P1 — есть внешний срок

| ID | Что | Доказательство | Работа |
|---|---|---|---|
| **B-009** | Сезонные HEATING-правила. Схема не знает про сезон: `grep active_from\|active_to` по `database/migrations/` и `src/models/AlertRule.js` — ноль совпадений (последняя миграция 039). `HEATING_FAILURE` срабатывает круглый год | нет колонок окна, нет фильтра по дате в `AlertRule` | Миграция (`active_from`/`active_to` в `alert_rules`) + гейт в `alertService`. Окно Q3 2026 открыто, отопительный сезон — ~середина октября. **M** |

### P2 — security tail аудита 2026-07-11 (код, не ops)

> **PR-2 (`d6c0f8e`, #148) закрыл отсюда семь пунктов** — M-12, M-8-остаток, M-9-остаток, M-17, M-22,
> M-13/R2-36 и prod-половину CVE-гейта. Строки перенесены в §3. Осталось то, что ниже.

| ID | Что | Доказательство | Работа |
|---|---|---|---|
| **M-12b** | Остаток M-12: код-whitelist есть (`WaterLine.assertValidStatus`), **CHECK-констрейнта в БД нет** — прямой SQL/будущий путь записи мимо модели по-прежнему запишет что угодно | `database/init/01_init_database.sql:162` (`status VARCHAR(20) DEFAULT 'active'`, без CHECK) | **PR-2b**, отдельным релизом: это contract change, не expand-only. Плюс доработка `tests/migrate/` harness'а (`run-migrate-tests.sh:72` строит цель на BASELINE_TARGET 003-034, а в `synthetic-baseline-seed.sql:33` у `water_lines` нет колонки `status`). **S** |
| **M-2** | TOTP anti-replay — per-process `Map`; при >1 реплики код, потраченный на A, реплеится на B в окне 120 с | `src/services/totpService.js:39-56`, ни одного обращения к Redis; `git log --since=2026-07-11 -- totpService.js` пуст | Перенести в Redis (шаблон — `webhookVerifier` nonce-dedup). Совпадает с остатком **B-003**. **S** |
| **M-4** | 2FA `tempToken`, TOTP-секрет и recovery-коды по-прежнему в JSON-теле (access/refresh давно в HttpOnly-cookie) | `authController.js:26-32,37-43` (tempToken), `:364-370` (secret + recoveryCodes) | Как минимум tempToken → HttpOnly-cookie; секрет/коды при self-service setup — обсуждаемо. **M** |
| **M-6** | Реплей refresh-токена теперь отдаёт 401 (закрыто), но **invalidate-all-sessions нет**: блокируется только один хэш, украденное семейство живёт до истечения | `authService.js:347-360`; `grep revokeAll\|token_version src/` — ноль | Примитив revoke-all (по `token_version` в `users`). **M** |
| **M-5** | `/auth/disable-2fa` — подбор пароля мимо per-account lockout (`verifyPasswordOnly` намеренно не инкрементит счётчик), тормозит только IP-лимитер | `authService.js:792-800`, `authRoutes.js:309` | Считать неудачи в `AccountLockout` и на этом пути. **S** |
| **M-21** | CSP `img-src 'self' data: https:` остался на `/uk/`-локации обоих эджей (наши блоки сужены до tile-серверов) | `nginx.production.conf:454`, `nginx.profk.conf:453` | Сузить или зафиксировать как осознанное (это чужая SPA). **S** |
| **M-18** | Dev-Postgres пишет `log_statement=all` + `log_min_duration_statement=0` → значения параметров в docker-логи | `docker-compose.dev.yml:180-185` | Только dev; убрать или оставить осознанно. **S** |
| **M-20** | Аноним получает полные адреса + точные координаты зданий (снимали только `external_id`) | `buildingMetricsService.js:88-100` + `routes/index.js:107` | **Продуктовое решение**, не баг. Записи об accepted-risk нигде нет — решение просто не принято. |
| **CVE-остаток** | PR-2 закрыл prod-дерево (`npm audit --omit=dev` = **0**, было 1 low `body-parser`), `generator/` (**0**) и js-yaml. Осталась **одна** advisory на весь dev-tree: `brace-expansion` [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — npm перечисляет её как 28 зависимых записей | `npm audit` → `Will install eslint@10.8.0, which is a breaking change` | Единственный фикс — `npm audit fix --force` → мажор `eslint@10`. Отдельная задача с прогоном линта на всём репо, не «по касанию». **M** |

### P2 — корректность и инфраструктура (остатки, где «наполовину закрыто» опаснее открытого)

| ID | Что осталось | Доказательство | Работа |
|---|---|---|---|
| **R2-16** | Просили общий guard на все `:id`. Сделаны per-entity/alerts/metrics/analytics; **весь admin-роутер (~24 маршрута)**, power-analytics и `:buildingId`/`:transformerId` по-прежнему дают pg-500 вместо 400 | `validateIntParam` есть (`middleware/validators.js`), но не подключён: `adminRoutes.js:119-121,223-225,329-330,533-535,714-716,914-916,952-954,962-964` | Дописать guard на оставшиеся. Admin-only → низкая severity, но поведение неизменно. **S** |
| **R2-23** | Дубль query-параметра → 500 починен. **404 по подстроке русского текста ошибки — нет**: переформулировали сообщение сервиса → 404 молча станет 500 (и наоборот) | `alertController.js:86,112` (`error.message.includes('не найден')`) | Типизированная ошибка вместо матчинга строки. **S** |
| **R2-29** | Закрыт только integration-таб. Общий загрузчик админки по-прежнему глотает ошибку и возвращает `[]` → таблица рисует «Нет данных» вместо ошибки | `public/admin.js:700-742` (`catch → return []`), потребители `:470-474`, `:884-888`, `:933-937` | Пробросить ошибку до рендера. **S** |
| **R2-14** | `migrate:test` на PR — есть. **E2E так и не на PR**: `e2e-nightly.yml:6-9` — только `schedule` + `workflow_dispatch` | `grep pull_request .github/workflows/` → только `ci.yml`, `migrate-test.yml` | Добавить PR-триггер (или отдельный gated-job). **M** |
| **R2-24** | Прямые тесты `AccountLockout` появились, но БД в них замокана — ровно тот failure-mode (AUD-039), из-за которого пункт и завели. Арифметика lockout против живого Postgres не проверена | `tests/jest/unit/AccountLockout.test.js:19-21`, оговорка в шапке `:12-17` | Интеграционный тест на реальной БД. **M** |
| **STAGING-VM / R2-15 Phase B** | Staging собрать из репозитория **нельзя**: `docker-compose.staging.yml:49,53` пинит `nginx.staging.conf`, которого в репо нет; нет `scripts/bootstrap-staging.sh`. Тест `stagingComposeOverride.test.js:28` проверяет только *ссылку* на файл, не его существование → CI зелёный при отсутствующем окружении | `git ls-files nginx-config/` → dev/production/profk | Либо завести конфиг в репо и поднять VM, либо честно записать, что staging'а нет. Пока деплой идёт сразу в два прода. **M**. Закрывает и **M-19** |
| **M-7 / M-11** *(были DISPUTED)* | Разобрано вручную: Redis-путь (лимитер, кэш, webhook-dedup) в коде **есть и предшествует аудиту**, namespace'ы у всех лимитеров фиксированные — счётчики реально общие. Дыра не в коде: `REDIS_URL` нигде не обязателен (`env.js` его не знает, `.env.example:87-88` закомментирован), при недоступном Redis всё тихо (одна строка лога) деградирует в per-process | `rateLimiter.js:105-125,387-483`, `webhookVerifier.js:143-172`, `cacheService.js:22,85,118` | Не рефакторинг, а гарантия: `REDIS_URL` в required (или в preflight деплоя) + алерт на degraded-режим. **S** |

### P3 — техдолг и гигиена (без триггера, брать «по касанию»)

| ID | Остаток | Доказательство |
|---|---|---|
| **R2-04** | 21 прямой `pool.query` в 5 из 9 admin-контроллеров (перенесли только dashboard-статистику). Отложено осознанно: модели урезают shape ответа (`geom`/`created_at`) | `adminWaterLineController.js` (9 шт.), `adminColdWaterSourceController.js:54,73,106`, `adminHeatSourceController.js` (3), `adminLineController.js` (3), `adminTransformerController.js:60,76,112` |
| **AUD-008** | Тот же узел с другой стороны: 4 delete переведены на модели, getById/create-свопы — нет (меняют shape) | `adminTransformerController.js:60,76,112` и т.д. — те же строки, что в R2-04 |
| **R2-05** | Канонизированы 3 контроллера; ещё 5 держат два других конверта (`{success:false,message}` в analytics/power-analytics, плоский `{error}` в auth-middleware — его читает фронт) | `analyticsController.js:12,104,116,151,205,309`; `middleware/auth.js:27-149` |
| **R2-12** | Единым сделан только сетевой слой + QR-валидация (~20 строк из ~200); дублирование оркестрации 2FA между `login.js:80-200` и `script.js:2060-2200` осталось намеренно (боятся вернуть баг порядка условий) | `public/utils/authFlow.js` |
| **R2-34** | README миграций починен (003–039). Ссылки на удалённый `PowerTransformer.js` живы | `PROJECT_CONTEXT.md:57`, `README.md:76` |
| **R2-35** | `trash/` (58 МБ) не удалён, а загнан в `.gitignore` — при тесном диске прода это до сих пор часть исходника деплоя. Четыре корневых `test_*.sh` остаются в индексе и **разошлись** со своими двойниками в `tests/bash/` — теперь неясно, какой канонический | `git ls-files` → `test_alerts_system.sh`, `test_api.sh`, `test_infrastructure_features.sh`, `test_jwt_only.sh` |
| **R2-37** | `LOG_CONSOLE_ONLY` реализован, но по умолчанию выключен и не задокументирован в `.env.example` → поведение по умолчанию байт-в-байт то же, что аудит и ругал | `src/utils/logger.js:14-23,36-52` |
| **INIT-SCHEMA-PT** | Свежий bootstrap создаёт и сеет `power_transformers`, затем 036 переносит строки, 037 таблицу дропает. Результат верный, но канонический init вводит в заблуждение | `database/init/01_init_database.sql:214,281,685-687,755,911,982`; `02_seed_data.sql:35,76,79-82`; `database.sql:38` |
| **AUD-034** | Дублирование живо: два байт-идентичных catch-блока в `alertForwarder` и две независимые копии rate-limiter-классов. Решение `a233a56` — осознанный defer, не фикс | `alertForwarder.js:590-613` и `:655-678`; `rateLimiter.js:33` vs `:233` |
| **B-004** | Сплита не было: `admin.js` **3868** (месяц назад 3826, порог 4500), `script.js` 2190 (уменьшился от вычисток, не от модуляризации) | `wc -l`; `build/esbuild.config.mjs:26-40` |
| **B-003** | Rescoped-ядро закрыто (лимитер/кэш/nonce на Redis). Не закрыт остаток SEC-26: TOTP-стор per-process (= **M-2**), L1-кэш блэклиста без cross-replica инвалидции | `totpService.js:40`; в `unified.yml` нет `replicas:` → сейчас не эксплуатируется |
| **B-011** | Митигация зафиксирована (app вне `uk-network`), корень — нет. Хуже, чем «латентно»: **nginx сидит в обеих сетях** и проксирует по родовому имени `app:3000` | `docker-compose.unified.yml:359-361`; `nginx.production.conf:583`; `grep aliases docker-compose*.yml` → ноль |
| **L-1** | Один IP-бакет 10/15мин на login + refresh + три 2FA-эндпоинта + disable-2fa: трафик одного съедает бюджет остальных | `rateLimiter.js:420-425`; `authRoutes.js:83,255,304,305,306,309` |
| **L-4 / SEC-34e остаток** | `style` остаётся в `ALLOWED_ATTR` DOMPurify в трёх местах; CSP тоже разрешает inline-стили (L-3), т.е. второго рубежа нет. Отложено до CSS-рефактора ~62 инлайн-стилей в popup'ах | `domSecurity.js:42,134`; `infrastructure-line-editor.js:118` |
| **L-5** | Эдж `/health` — статический 200, апстрим не опрашивается: «healthy» при мёртвом Node | `nginx.production.conf:630-634`; `nginx.profk.conf:648-652` |
| **L-6** | Валидация enum `event` для building-вебхука есть в сервисе, но не на роуте → неизвестный event даёт 500 вместо 400 (у `/request` асимметрично починено) | `webhookRoutes.js:78-80` vs `:128`; `isValidBuildingEvent` уже экспортирован (`webhookValidation.js:29`) |
| **L-7** | `Controller.create` без enum на `status`, CHECK в БД тоже нет. Практически недостижимо (оба пути прикрыты валидатором/сервисом), но на admin-пути отказ прилетает как 500 | `models/Controller.js:96-105`; `database/init/01_init_database.sql:98` |

### Принято как есть / информационное (не чинить, но помнить)

- **R2-09** — `SUPERSEDED`: ни миграции 4 моделей, ни удаления фабрики не было; вместо этого зафиксировано архитектурное решение (`createCrudModel.js:21-30` — блок SCOPE с тегом R2-09). Дублирование физически осталось, но формулировка пункта больше не применима.
- **R2-20** — 10k-строчный cap инвентаря не менялся, но эндпоинт больше не анонимный (H-4). Осталось by design.
- **H-6 остаток** — реальная экспозиция (dev-фронт на всех интерфейсах) закрыта; `admin123` в комментарии сида оставлен намеренно (нужен jest + E2E globalSetup, SEC-13 accepted-risk), dev-креды `postgres/postgres` тоже.
- **AUD-040** — эндпоинты `request-counts`/`building-requests` без потребителей: решение 2026-06-13 — оставить. Закроется само при мерже B-008, иначе превратится в задачу на удаление.
- **B-008** — `feature/frontend-redesign` не двигалась с 2026-03-28 (~4 месяца), main ушёл далеко: риск конфликтов растёт. Предусловие (B-004) тоже открыто.
- **L-2** (нет Origin/Referer → пропускаем, митигировано SameSite=strict), **L-3** (`style-src 'unsafe-inline'`), **L-8** (неподписанные cookie при заведённом секрете), **L-9** (Bearer мимо CSRF), **L-10** (любой аутентифицированный читает всю инфраструктуру), **L-11** (dev-fallback `JWT_2FA_SECRET`) — задокументированное поведение, кода не требуют.
- **L-12/L-13/L-14** — положительные проверки (immutable-образ, отсутствие `child_process`/`eval`, app вне uk-network) — подтверждены на HEAD повторно.

### Требует проверки вне репозитория

| ID | Чем закрывается |
|---|---|
| **SEC-34j** | `sshd -T \| grep -E 'passwordauthentication\|permitrootlogin'` + `fail2ban-client status sshd` на обоих продах (.105 и .224) |
| **B-006** | Owner — сторона УК (колонка Engineering в их доске). Из нашего репо неопределимо |
| **R2-15 operator-шаги** | GHCR `read:packages` login на прод-хостах + факт прохождения цепочки Deploy#1(build)→Deploy#2(pull) |
| **REDIS_URL / LOG_CONSOLE_ONLY** | Заданы ли на хостах (`.env.prod` не трекается) — см. M-7/M-11 и R2-37 |

---

## 2. Новое, чего в бэклоге не было (нашла панель)

1. ~~**`WaterLine.js:46-49`** — четвёртый ILIKE-фильтр без эскейпинга~~ — закрыто PR-2 (`d6c0f8e`, #148).
2. ~~**`map-layers-control.js:29-33`** — вторая, fail-open копия санитайзера popup'ов~~ — закрыто PR-2 (`d6c0f8e`, #148).
3. **`admin-coordinate-editor.js:389-390`** — маппинг `infrastructure-line(s)` → `/api/infrastructure-lines`, который не смонтирован (`routes/index.js` монтирует `/lines`). Ветка сейчас недостижима, но это тот же капкан, что чинили в AUD-020/R2-31. Плюс `:177` — единственная admin-форма без guard'а от двойного сабмита (операция идемпотентна, потому не критично).
4. **`stagingComposeOverride.test.js:28`** проверяет, что compose *ссылается* на `nginx.staging.conf`, но не что файл существует → CI зелёный при неработоспособном окружении. Тест-заглушка, дающая ложную уверенность.
5. **`update-production.sh:234-258`** — у `MIGRATE_WIRING_ENABLED` жива ветка `false` («migration-runner wiring DISABLED»), и её пинит `deployWiring.test.js:27-32`. После baseline это foot-gun: экспорт переменной молча пропустит миграции перед подменой образа. Решить как WONTFIX-escape-hatch или удалить ветку.
6. **`alertController.js:86,112`** — 404 из подстроки русского сообщения (вторая половина R2-23, заведена выше).
7. ~~Advisory **js-yaml расширился** на корневой 4.2.0~~ — закрыто PR-2 (`d6c0f8e`, #148); остаток CVE-гейта переформулирован выше.
8. **Catch-блоки admin-контроллеров глушат 4xx модели** (найдено при работе над M-12). `next(createError('Internal server error', 500))` без разбора статуса превращает валидационный 400 в 500 — то есть любой whitelist/guard в модели становится для клиента «сервером упало». В PR-2 починены только два water-line-контроллера (пропуск ТОЛЬКО 4xx, 5xx по-прежнему схлопывается). Тот же паттерн живёт в остальных: `adminTransformerController.js`, `adminLineController.js`, `adminColdWaterSourceController.js`, `adminHeatSourceController.js`. Сейчас безвреден (в моделях нет 400-гардов), но взводится в момент, когда их добавят. Смежно с R2-05. **S**
9. **`tests/jest/helpers/dbMock.js` матчит запросы по подстроке имени таблицы** — при добавлении ветки `water_lines` широкий матч сломал `GET /api/buildings/:id` (там `water_lines` в LEFT JOIN, `Building.js:43`). Поймано полным прогоном, в PR-2 ветки сделаны узкими по write-формам. Грабли для любого, кто будет расширять мок дальше.

---

## 3. Закрыто и подтверждено с 2026-07-02 (не переоткрывать)

| Пункты | Чем закрыто |
|---|---|
| R2-01, R2-02, R2-03, R2-13, R2-21 | `131a82f` (#116) — register под `isAdmin` + убран из PUBLIC_ROUTES (обе половины), `isAdmin` на write-верб 9 роутеров, batch-заглушки → реальные/501/400 |
| R2-06, R2-16 (ядро), R2-22, R2-26, R2-27 | `bce8dce`, `7ce8f87`, `a78008f`, `5d4ecd2` (#117) |
| R2-10, R2-11, R2-28, R2-30, R2-31, R2-32 | `5ac775e`, `ca39bd0`, `53ec16e`, `a227a3e`, `d3b2438` (#118) |
| R2-05 (3 контроллера), R2-08 | `11dbbc0` (#119), `e4375e6` (#120) |
| R2-25, R2-34 (README), R2-24 (контрактные тесты) | `42b62b4`, `da513b0` (#121) |
| R2-14 (migrate:test на PR) | `0d6610e` (#122) |
| R2-04 (dashboard-stats), R2-09 (решение) | `f4a5497` (#123) |
| R2-33 (lint gate 0 + tests/ в скоупе, прогон чистый) | `f6d6550`, `dbb24aa` (#124/#125) |
| R2-18 (fail-close inbound-секрет), R2-19 (allowlist SSRF) | `003c6a1` (#126), `f1447bf` (#127) |
| R2-17 (nosniff на обоих эджах), R2-37 (флаг), R2-38 (мёртвые load-тесты сняты) | `ae3feb5` (#130), `5e2b382` (#131) |
| R2-15 Phase 1/2/A (сборка в CI→GHCR, деплой pull'ом) | `69833f0` (#132), `6711e76` (#133), `4f48723` (#140) |
| H-1, H-2 (отзыв сессий при lockout/деактивации), H-5 (fail-closed блэклист) | `7f5b46f`, `3594a79` |
| H-3 (HMAC на телеметрию), H-4 (service-token на инвентарь), R2-07/R2-20 как следствие | `ba54a78`, `9584b3f` |
| M-14, hard-fail прод-секретов, `UK_API_ALLOWED_HOSTS` при включённом сендере (M-10) | `5e73ec0` (PR-6) |
| M-1 (`optionalAuth` проверяет is_active/cutoff/lockout uncached), M-8, M-9 (script.js), M-15, M-16, CVE morgan/form-data/uuid, H-6 (loopback) | `0be1250` (PR-5) |
| M-3 (стухший кэш роли больше не влияет на авторизацию), SEC-27, SEC-31, SEC-32, SEC-34a, SEC-34h | подтверждено на HEAD |
| UK-трек целиком: reprocess error-строк, `request.reconcile` + `uk-buildings-metrics`, миграция 039 (widen + архив 7 орфанов), F-08/F-09 эджа | `c794c45`, `f7ab615`/`1192d6b` (#145), `1b49544` (#146), `287c8e9`/`ef52f01` (#147) |
| **M-12** (код-whitelist на всех 5 путях записи `status` + проброс 4xx), **M-8-остаток** (`WaterLine` ILIKE), **M-9-остаток** (`map-layers-control.js` fail-closed), **M-17** (`logRedaction` в цепочке winston), **M-22** (generator на loopback), **M-13/R2-36** (`COOKIE_SIGNING_SECRET` удалён), **CVE prod+generator** (оба дерева = 0) | `d6c0f8e` (#148). Остатки заведены отдельно: **M-12b** (CHECK в БД → PR-2b) и **CVE-остаток** (`brace-expansion`, нужен мажор eslint) |

---

## 4. Рекомендованный порядок

1. **B-009** — единственное с внешним сроком (до отопительного сезона).
2. ~~**Одна security-пачка S-размера:** M-12, M-8-остаток, M-9-остаток, M-22, M-13/R2-36, M-17, CVE~~ — **сделано**, `d6c0f8e` (#148). Хвост: **PR-2b** (M-12b, CHECK-констрейнт + harness миграционных тестов) — берётся отдельным релизом, потому что это contract change.
3. **M-2 (TOTP → Redis)** вместе с гарантией `REDIS_URL` (M-7/M-11) — один узел, закрывает и остаток B-003.
4. **Половинчатые фиксы:** R2-16 (admin-роутер), R2-23 (404 по тексту), R2-29 (глушение ошибок админки) — «наполовину закрыто» опаснее открытого, потому что выглядит сделанным.
5. **STAGING-VM / R2-15 Phase B** — пока его нет, любой деплой идёт сразу в два прода; попутно чинится ложнозелёный тест.
6. **M-4/M-6** (tempToken из JSON, revoke-all) — следующий сессионный слой, требует дизайна.
7. Остальное — по касанию. Спекулятивный рефакторинг alert/UK-домена и admin-слоя противопоказан.

> `docs/internal/tasks.md` от 2025-10-19 дезинформирует (требует «немедленно» чинить SQL-инъекции,
> которых нет) — кандидат на удаление отдельным коммитом.
