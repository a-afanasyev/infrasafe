# Sprint 11 Backlog

> Carry-overs из Sprint 10, накопленные мелкие проблемы, UX/tech-debt пункты.
> Каждый пункт: **что** + **почему** + **trigger to ship** (когда становится приоритетным).
> Создан 2026-05-25 после закрытия Sprint 10 + INT-120.
> Обновлён 2026-05-28 после deploy 4 PR'ов на прод (см. P0 — production infra drift).
> Обновлён 2026-05-30: закрыты B-014/B-015/B-017/B-020 + security audit (#69) + ротации + P-PENTEST-4.
> Обновлён 2026-06-01: закрыты B-012/B-013/B-016/B-023/B-025/B-026/B-027 + B-007; B-024 partial. Шапка переписана.
> Обновлён 2026-06-01 (Трек A): закрыт B-024 auth-gated half (#88 public /map-layer-counts) + B-027 косметика (#87 esbuild clear-contents) + B-023 op-step (.env.prod) + B-027-followup (#89 no-cache бандлов) + backlog (#90). Трек A завершён.
> Обновлён 2026-06-01 (вычитка #91): синхронизированы детальные секции B-024/B-027/B-023 с фактом закрытия (были stale после Трек-A мержей).
> Обновлён 2026-06-02: добавлен батч **SEC-13..SEC-34** (security pentest round 2, 2026-06-01/02) — см. секцию «Security pentest 2026-06-01/02» + отчёт `docs/audit/2026-06-01-security-pentest.md`. Активно-эксплуатируемых CRITICAL — 0 (JWT-секреты ротированы, подтв. live-forge→401).
> **Phase 1 закрыт (2026-06-02):** SEC-18/24/25/29/33 + `npm audit fix` смержены (PR #96 / `59ae6a6`) и задеплоены на прод (SEC-18/24 live-verified). Dep-патч qs/express активируется только с пересборкой образа → едет на SEC-14 (`--renew-anon-volumes`). Открыто: SEC-13..17, 19..23, 26..32, 34.
> Обновлён 2026-06-06: закрыт **UK-URGENCY** — каноничные ключи `urgency` (PR #97 / `94c7ddd`, migration 032), задеплоен + прод-верифицирован, контракт подтверждён УК с обеих сторон. См. Closed-секцию + `docs/audit/2026-06-05-uk-urgency-canonical-keys.md`.
> Обновлён 2026-06-07: **Phase 2 quick-wins смержены** — SEC-16/26/28/30 (PR #98 / `9b9537b`), чистый код+TDD, прод не затронут (2309 тестов зелёные). Открыто из round 2: SEC-13/14/15 (HIGH deploy/compose), SEC-17/19..23/27/31/32 (MED), SEC-34 (LOW).
> Обновлён 2026-06-07: **SEC-14/15 смержены** (PR #99 / `25c3679`) — immutable app-образ + extracted static (C-extract): убраны dev-watcher/nodemon+devDeps и `.:/app` bind-mount. CI docker-image job + image-composition green, 2313 тестов.
> Обновлён 2026-06-07: **SEC-14/15 ЗАДЕПЛОЕНЫ на прод** через `update-production.sh` (HEAD `899d533` + guard-фикс симлинка `.env`). Прод-верификация: контейнер без `.env*`/`.git`/`scripts/`/`build/`, mount только `app_logs` (нет `.:/app`); процесс `npm start` (не nodemon), нет nodemon/esbuild; NODE_ENV=production; **qs@6.15.2** (SEC-34k dep-патч доехал с rebuild → закрыт); edge `/`,`/health` 200, `/api/buildings` 401, `/api/buildings-metrics` 200×6. **One-time миграция:** legacy `public/dist` был owned uid1001 → chown 1000:1000 (rename dir требует write на dir для `..`); первый publish сначала упал на этом → rollback сработал штатно (app вернулся, dist verify зелёный) → chown → redeploy ✓. Открыто: SEC-13 (HIGH), SEC-17/19..23/27/31/32 (MED), SEC-34 a–j (LOW).

---

## Статус на 2026-06-01 — актуализация

### Закрыто (полная история — в Closed-секции внизу)
| Пункт | Как | Статус |
|---|---|---|
| B-012 nginx config single-file mount | #72 directory-mount + `nginx -c`, deployed 05-31 | ✅ |
| B-013 DB-role doc correctness | #70 (CLAUDE.md/prod.yml/runbook) | ✅ |
| B-016 compose drift-check | #70 `scripts/compose-drift-check.sh` (host-wide) + #71 baseline | ✅ |
| B-023 POSTGRES_PASSWORD footgun | #72 (декларация) + op-step выполнен 06-01 (dead `POSTGRES_USER` удалён из `.env.prod`, бэкап `.env.prod.bak-b023`, `compose config`→`infrasafe_app`) | ✅ |
| B-025 LEAK coercion | #75 `coerceBoolish`, deployed 05-31, e2e-verified на проде | ✅ |
| B-026 acknowledged-alerts невидимо блокируют | #76 `getActiveAlerts` default→`('active','acknowledged')`, deployed | ✅ |
| B-027 frontend dist не доезжал до прода (P0) | #78–83 `rebuild-frontend.sh` + wire в `update-production.sh`, deployed 06-01 | ✅ |
| B-007 integration_log retry/dead sync | #74 `updateStatusByEventId` + `_syncIntegrationLog` | ✅ |
| B-024 map counters `(0)` | #74 Здания-счётчик при init + публичный `/map-layer-counts` для auth-gated слоёв (anon видит реальные числа) | ✅ |
| B-027 косметика (esbuild root-retry WARN) | #87 — `rmSync(dist)` → clear-contents (не трогает родитель `public/`) | ✅ |
| B-021 durability hardening verification | #92 (client-scoped tick+txn, headline lock-leak) + #93 (reopen-реконсиляция из БД + client-scoped listener) + #94 (advisory-lock+txn в system-resolveAlert) | ✅ |
| B-022 ukOutboxService advisory-lock-via-pool | #95 — client-scoped `_tick` (lock+drain+unlock+release на одном client'е); копия паттерна B-021 #92 | ✅ |
| (ранее 05-30) B-014/B-015/B-017/B-020 + security audit #69 + ротации + P-PENTEST-4 | — | ✅ |

### Открытые пункты (сверено с прод/кодом 2026-06-01)
| Пункт | P | Проверка | Вердикт / триггер |
|---|---|---|---|
| **B-011** alias collision | P2 | app только в `infrasafe`+`leaflet` (B-010); B-010-фикс закреплён | **latent** — рванёт лишь при re-attach app в `uk-network`; полный fix = координация с UK |
| **B-003** Redis (multi-replica) | P2 | SEC-6 снял memory-growth; SEC-8 multi-replica bypass остаётся | **не наступил** — single-replica setup |
| **B-004** admin.js split | P2 | `wc -l`: admin.js **3826**, script.js **2384** | **не достигнут** — триггер 4500 LoC; растёт |
| **B-006** Engineering Kanban | P3 | — | **owner UK side**, не наш PR |
| **B-008** frontend-redesign merge | P4 | — | после стабилизации + B-004 split |
| **B-009** seasonal HEATING rules | P4 | — | **Q3 2026** (до отопит. сезона) |
| ~~SEC-18/24/25/29/33~~ (MEDIUM) | — | **✅ CLOSED** PR #96 / `59ae6a6` (2026-06-02) | CSP-CDN / correlation-id / telemetry-allowlist / UkOutbox-interval / pagination-clamp — задеплоены + live-verified |
| ~~SEC-16~~ backup-creds (HIGH) | — | **✅ CLOSED** PR #98 / `9b9537b` (2026-06-07) | env + PGPASSWORD, убран хардкод `postgres/postgres` |
| ~~SEC-14/15~~ (HIGH) | — | **✅ CLOSED + DEPLOYED** PR #99 / `25c3679`, прод 2026-06-07 | immutable app (npm start, --omit=dev) + extracted static; `.:/app` убран. Прод-verified (нет секретов/.git/scripts; npm start; qs-патч SEC-34k доехал) |
| **SEC-13** (HIGH) | P1 | pentest round 2, present-в-коде | `admin123` seed (`database/init/02_seed_data.sql:168`) — нужен bootstrap-провижен, см. фаза F |
| ~~SEC-26/28/30~~ (MEDIUM) | — | **✅ CLOSED** PR #98 / `9b9537b` (2026-06-07) | TOTP TTL 120с / idempotent recovery (cache) / building_id sanitize |
| **SEC-17/19..23/27/31/32** (MEDIUM) | P2-P3 | pentest round 2 | scrub / uk-metrics leak / nginx-rl / Redis-pass / CSRF / stale-cache / blacklist / admin.js-cleanup / … — детали в секции |
| **SEC-34** (LOW/INFO) | P3-P4 | pentest round 2 | hardening-пачка (noopener, SSH key-only, `npm audit fix`, …) |

### Рекомендация
**Ничего не горит.** Трек A («закрыть хвосты») + **B-021 (P1) durability hardening** завершены 06-01.
B-021 закрыт 3 PR (#92/#93/#94): client-scoped tick+txn (реальный advisory-lock-leak), reopen-реконсиляция
из БД, advisory-lock+txn в system-resolveAlert (атомарность UPDATE+enqueue → нет orphan при enqueue-fail).
Тот же lock-баг в ukOutboxService закрыт **B-022** (#95, копия паттерна #92). Остальное открытое —
latent (B-011), ждёт триггера (B-003/B-004/B-008), сезона (B-009) или UK-стороны (B-006). Perf
content-hash бандлов — отдельным PR.

---

## P0 — Production infra drift (нашли при deploy 2026-05-28)

> Во время раскатки PR #59 / #60 / #61 / #62 / #63 на прод (`95.46.96.105`) вскрылись пять явных drift'ов между декларированным compose-стеком и реальным состоянием контейнеров. Каждый из них стоил debug-петли (auth-fail → migration replay → network диагностика). Чинить пакетно до следующего серьёзного деплоя.

### B-027 — фронт-бандлы `public/dist/` не доезжают до прода (rebuild в образ, раздача с хост-mount) — CLOSED (2026-06-01, P0)

**Найдено 2026-05-31** при расследовании «нет кнопки Открыть в УК». Прод раздавал `public/dist/admin.js`
**от 27 мая** (102629 байт, до B-001 #60), хотя source давно с B-001. Кнопки УК не было, потому что её
**физически не было в бандле**, который отдаёт прод.

**Корень — рассинхрон сборки и раздачи фронта:**
- `package.json postinstall` → `npm run build:frontend` собирает `public/dist/` **внутри образа app**
  (на `docker build`).
- nginx раздаёт `public/dist/` из **bind-mount хоста** (`./public:/usr/share/nginx/html/public`,
  `docker-compose.unified.yml:335`).
- `infrasafe-app-1` тоже монтирует весь проект `/home/infrasafe/infrasafe → /app (rw)`, **перекрывая**
  baked-in `dist` образа хостовым.
→ Пересборка образа app **никогда не обновляет** хостовый `dist/`. Все фронт-изменения с конца мая
(B-001 #60, B-024 #74) **не доезжали** до прода, хотя бэкенд деплоился.

**Разовый workaround (применён 2026-05-31, прод исправлен):** пересобрать dist прямо в смонтированном
host-каталоге через контейнер (под root, т.к. `public/dist` принадлежит root, а контейнер бежит под
`nodejs(1001)` → EACCES на `rmSync`):
```bash
docker exec -u 0 infrasafe-app-1 sh -c 'cd /app && node build/esbuild.config.mjs'
```
После этого прод-бандл стал 104896 байт, byte-identical локальному эталону с B-001 ✓.

**Системный fix — выбран вариант 1 (script + runbook), реализован:**
- **NEW `scripts/rebuild-frontend.sh`** (tracked): пересобирает `public/dist` в `infrasafe-app-1` (пишет
  через bind-mount на хост) + **hard-fail byte-verify** — sha256 каждого реально отдаваемого nginx'ом
  бандла обязан совпасть со свежесобранным; mismatch/404/сетевой сбой → exit 1 + баннер «BUNDLE DID NOT
  REACH PROD». По умолчанию verify ВСЕ собранные бандлы (12 entrypoints; HTML грузит все). Unified-only
  (preflight отсекает prod.yml-layout — `Dockerfile.prod` без esbuild). EACCES под root-fallback +
  `FIX_DIST_OWNER=1` для разового chown dist→nodejs.
- **runbook** (`2026-05-30-prod-ops-runbook.md` §1b): обязательный шаг после app/frontend recreate.
- **PRODUCTION-DEPLOYMENT.md**: обязательный шаг в unified-блоке после `up -d`.

**Operator step — ВЫПОЛНЕНО 2026-06-01 (→ полный CLOSED):**
1. ✅ `scripts/rebuild-frontend.sh` задеплоен на прод (`git pull`), первый прогон — все 12 бандлов `✓`,
   exit 0; негатив-тест (несуществующий бандл) → чистый баннер «BUNDLE DID NOT REACH PROD» + exit 1.
2. ✅ **Wired в tracked `update-production.sh`** (PR #82, Шаг 5b: после `up -d`, до smoke, hard-stop при
   exit≠0). Выяснилось, что host-local `deploy.sh`/`deploy-nosudo.sh` на проде **нет** (они были
   local-only на dev-машине) — реальные деплои идут через tracked `update-production.sh` + ручной
   `git pull && docker compose up -d`. Tracked-фикс лучше: доезжает на любой хост через `git pull`.
3. ✅ Разовый `FIX_DIST_OWNER=1` выполнен (chown `public/dist` → nodejs).

**Косметический остаток — ЗАКРЫТ 2026-06-01 (#87):** clean-run раньше делал root-retry (WARN), т.к.
esbuild `rmSync(public/dist)` удалял саму папку → нужен write на родителе `/app/public` (owned `node`
uid1000 ≠ контейнерный `nodejs` uid1001). Фикс #87: esbuild чистит **содержимое** `dist`, не папку →
write нужен только внутри `dist`. На проде разово выполнен `FIX_DIST_OWNER=1` (chown `dist`→`nodejs`);
clean-прогон `rebuild-frontend.sh` теперь без единого root-retry/WARN (verified 06-01).

**Followup (2026-06-01, shipped):** nginx отдавал `*.js/*.css` с `max-age=300, must-revalidate` —
`must-revalidate` срабатывает только ПОСЛЕ `max-age`, поэтому свежий деплой был невидим вернувшимся
клиентам до 5 мин (поймали при браузерной проверке B-024 — старый бандл из 300s-кэша). Переведено на
`no-cache` (revalidate-always; ETag→304 для неизменных, 200 со свежим кодом на следующей навигации сразу
после деплоя). `nginx-config/nginx.production.conf` location `~* \.(css|js)$`.

**Future (low, отдельно):** (a) re-architecture — раздавать dist из образа (убрать host-mount), оценить
против B-012; (b) tracked deploy-entrypoint в `scripts/` вместо host-local `deploy.sh`; (c) bundle
byte-compare в tracked smoke-шаг; (d) **content-hashed имена бандлов** (`script.<sha>.js`) + immutable
long-cache — «правильный» perf-фикс кэша (ноль ревалидаций), убирает 304-round-trip от `no-cache`; требует
build-time HTML-rewrite + manifest, поэтому отдельным perf-PR.

**Разовый workaround истории (применён 2026-05-31, прод исправлен):**
`docker exec -u 0 infrasafe-app-1 sh -c 'cd /app && node build/esbuild.config.mjs'` → прод-бандл стал
104896 байт, byte-identical эталону с B-001. Теперь это автоматизировано в `scripts/rebuild-frontend.sh`.

**Severity P0**: молча блокировал доставку ВСЕХ фронт-фич на прод ~5 недель. Не данные-loss, но
«задеплоили, а на проде старое».

### Re-verification 2026-05-28 (post-deploy, read-only probes)

| ID | Статус | Изменение в формулировке |
|---|---|---|
| B-010 | ✅ verified | Уточнено: source-of-truth = `docker-compose.prod.yml` (не unified.yml); drift был от ручного `network connect uk-network`; решение по топологии — keep app OUT of uk-network |
| B-011 | ✅ verified | `inspect` подтвердил alias `postgres` в обоих контейнерах; mechanism для B-010 |
| B-012 | ✅ verified | bind-mount confirmed single-file |
| B-013 | ✅ verified | `.env.prod` всё ещё имеет `DB_USER=infrasafe_runtime`; обе роли существуют на проде |
| B-014 | 🔄 **re-rooted** | НЕ wget missing — `localhost`→IPv6 vs nginx IPv4 only. FailingStreak=1560 (~13ч) |
| B-015 | ✅ verified | 0 containers, создана 2025-11-23 |
| B-016 | n/a | design item |

**Quick-wins для отдельного PR**:
- B-014: 1-строчная правка в `unified.yml` (`localhost` → `127.0.0.1`).
- B-015: 1 команда `docker network rm site-content_leaflet-network`.

### B-011 — DNS alias collisions между `infrasafe_*` и `uk-network`

**Re-verified 2026-05-28**. ✅ Подтверждена. Inspect показал:
- `uk-postgres` в `uk-network` имеет aliases `[uk-postgres, postgres]`
- `infrasafe-postgres-1` в `infrasafe_infrasafe-network` имеет aliases `[infrasafe-postgres-1, postgres]`

**Что**. Несколько алиасов резолвятся к разным контейнерам в зависимости от network attach order:

| Alias | infrasafe_leaflet-network | uk-network | infrasafe_infrasafe-network |
|---|---|---|---|
| `postgres` | — | `uk-postgres` ⚠ | `infrasafe-postgres-1` ✓ |
| `redis` | `infrasafe-redis-1` | `uk-redis` ⚠ | — |
| `frontend` | `infrasafe-frontend-1` | `uk-frontend` ⚠ | — |
| `app` | `infrasafe-app-1` ✓ | `uk-management-bot` ⚠ | — |

Контейнер сидящий в обеих сетях резолвит alias через первый DNS-hit — порядок зависит от docker DNS server и attach sequence. **B-010 — именно этот сценарий**: app получил `postgres` из uk-network → auth-fail на UK postgres'е.

**Почему**. Архитектурная утечка: имена сервисов между двумя независимыми compose-проектами collide. Любая будущая ошибка attach → silent routing в чужую DB.

**Fix план**.
- В `uk-management` compose уйти от родовых alias'ов в `uk-network`: использовать `uk-postgres`/`uk-redis`/`uk-frontend`/`uk-app` без короткого alias.
- На нашей стороне аналогично — `infrasafe-postgres` без alias `postgres`, etc. (или оставить, но удостовериться что app только в infrasafe-network).
- Cross-project communication только через nginx public edge (уже так и есть для InfraSafe→UK).

**Trigger**. Перед любым изменением UK compose / network setup. Сейчас работает но fragile — пересечь сети ещё раз = тот же auth-fail сценарий.

**Estimate**. ~3-4 часа: координация с UK side (alias rename ломает их internal references) + smoke на staging.

### B-012 — `nginx.production.conf` single-file bind-mount — та же inode-trap что HTML до B-002

**Re-verified 2026-05-28**. ✅ Подтверждена. `docker inspect infrasafe-nginx-1` показал:
```
bind /home/infrasafe/infrasafe/nginx.production.conf -> /etc/nginx/nginx.conf
bind /home/infrasafe/infrasafe/frontend-html -> /srv/frontend-html
```
Frontend-html уже directory (B-002 закрыт), nginx.production.conf — single file (latent B-012).

**Что**. `docker-compose.unified.yml:262` (и аналогично в `prod.yml` через старый deploy script) маунтит `./nginx.production.conf:/etc/nginx/nginx.conf:ro` как одиночный файл. После `git pull` (новый inode на хосте) `nginx -s reload` использует старый pinned inode → меняешь config, изменения не подхватываются до `--force-recreate`.

Случилось сегодня: после моего фикса location-приоритета (#63) `git pull` + `nginx -s reload` не сменили serving поведение — пришлось делать полный `up -d --force-recreate --no-deps nginx`.

**Почему**. Симметрично с B-002 проблемой для HTML файлов. Решается тем же приёмом — directory mount.

**Fix план**.
- Создать `nginx-config/` директорию в repo, переехать `nginx.production.conf` и `nginx.dev.conf` туда (или хотя бы prod).
- Маунт `./nginx-config:/etc/nginx/conf.d:ro` + рефакторинг конфига чтобы `include conf.d/*.conf` подцеплял.
- Или проще — маунт parent directory одним файлом в `/etc/nginx/conf.d/`.

**Trigger**. Перед следующим nginx config change (CSP, location, upstream правки). Иначе каждый раз будет recreate.

**Estimate**. ~2 часа: рефакторинг + verify smoke.

### B-013 — `.env.prod` DB_USER drift vs migration 017

> **⚠️ ПЕРЕОСМЫСЛЕНО 2026-05-30 (severity ↓).** Инвентарь `pg_roles` на проде: `infrasafe_app` = **superuser**+login, `infrasafe_runtime` = login non-super, `postgres` = **не существует**. App корректно работает под non-super `infrasafe_runtime` (least-privilege). **Рекомендация ниже «перейти на `infrasafe_app`» НЕВЕРНА** — это superuser, переключение ухудшит безопасность. Реальный остаток: убрать мёртвый `POSTGRES_USER=postgres` из `.env.prod` + поправить role-заметку в CLAUDE.md. Из P0-bug → cosmetic cleanup.

**Re-verified 2026-05-28**. ✅ Подтверждена. `grep DB_USER ~/infrasafe/.env.prod` показал `DB_USER=infrasafe_runtime`. App при этом сейчас healthy → значит роль `infrasafe_runtime` всё ещё существует в `infrasafe-postgres-1` (миграция 017 НЕ дропнула старую при создании новой, либо seed создаёт обе).

**Что**. `.env.prod` имеет `DB_USER=infrasafe_runtime`, миграция 017 переименовала runtime role в `infrasafe_app`. На проде оба роли существуют (`infrasafe_app` для migrations/admin, `infrasafe_runtime` для app), но рассинхрон паролей вылез сегодня — app не мог auth.

**Fix во время deploy** (ad-hoc): `ALTER USER infrasafe_runtime WITH PASSWORD <value из .env.prod>;` через `docker exec ... node + pipe SQL` (избегая shell expansion со спецсимволами в пароле).

**Почему**. CLAUDE.md упоминает migration 017 → `infrasafe_app`. По логике migration хотел сделать `infrasafe_app` единственным runtime role. На проде сейчас обе живут, что и привело к сегодняшнему confusion.

**Fix план**.
- Решить какая роль canonical для app (рекомендация: `infrasafe_app`, согласно migration 017).
- Обновить `.env.prod` → `DB_USER=infrasafe_app`.
- Drop role `infrasafe_runtime` если она больше не нужна.
- ИЛИ keep `infrasafe_runtime`, but reapply migration 017 to clarify which is which.

**Trigger**. До следующего деплоя который трогает DB credentials / pg_hba.

**Estimate**. ~1 час: тестовый flow на staging (если есть), apply, restart, verify.

### B-014 — `infrasafe-frontend-1` healthcheck `localhost` resolves to IPv6, nginx слушает только IPv4

> **✅ ЗАКРЫТО 2026-05-30** — PR #65 (`836e1be`), app-side активирован в deploy 05-30. Секция оставлена для истории; см. Closed.

**Re-verified 2026-05-28**. 🔄 **Re-rooted**. Изначальная гипотеза (wget missing / curl needed) НЕВЕРНА — `wget` есть в alpine. Реальная причина:

```bash
# Внутри infrasafe-frontend-1:
$ wget -qO- http://localhost:8080/health
wget: can't connect to remote host: Connection refused
$ wget -qO- http://127.0.0.1:8080/health
healthy
```

Healthcheck использует hostname `localhost` который в современном alpine резолвится **сначала в `::1` (IPv6)**, но nginx в контейнере слушает только `0.0.0.0:8080` (IPv4). FailingStreak — 1560 (13ч на 30s interval) с момента старта контейнера.

**Что**. `infrasafe-frontend-1` отображается как **unhealthy** (12+ часов). Все 1560 health-проб упали с "Connection refused" — реальный сервис работает (`127.0.0.1:8080/health` отвечает `healthy`), но `localhost` lookup упирается в IPv6.

**Почему**. Контейнер функционально работает (public traffic через nginx идёт, статика отдаётся), но docker отмечает unhealthy → потенциально мешает orchestration / auto-restart policies / любые мониторинг alerts на этот healthcheck.

**Fix план** (тривиальный).
- В `docker-compose.unified.yml:26` заменить:
  ```diff
  - test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
  + test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/health"]
  ```
- Аналогично для `app` service line 93: `http://localhost:3000/health` → `http://127.0.0.1:3000/health`.
- Альтернатива (если хочется keep `localhost`): добавить в nginx config `listen [::]:8080;` — но IPv4 explicit проще.

**Trigger**. Косметика, но раздражает в `docker ps` и портит любой мониторинг. Включить в следующий compose-touch PR.

**Estimate**. ~10 минут (edit + verify).

### B-015 — Orphan network `site-content_leaflet-network`

> **✅ ЗАКРЫТО 2026-05-30** — сеть удалена (подтверждено `docker network ls`: site-content отсутствует). См. Closed.

**Re-verified 2026-05-28**. ✅ Подтверждена. `docker network inspect site-content_leaflet-network` → `0 containers, created 2025-11-23 23:20:04` (~6 месяцев назад).

**Что**. Сеть `site-content_leaflet-network` (172.18.0.0/16) существует на проде но пустая (нет контейнеров). Остаток от какого-то предыдущего compose проекта `site-content`.

**Почему**. Не блокер, но занимает 172.18.0.0/16 IP range и засоряет `docker network ls`.

**Fix**:
```
docker network rm site-content_leaflet-network
```

**Trigger**. При следующем cleanup-проходе по проду.

**Estimate**. 1 минута.

### B-016 — Compose drift audit (`docker compose config` vs `docker inspect` reality)

**Что**. Не отдельный bug, а **процесс**: добавить в deploy-runbook шаг сравнения декларированного compose-стека с реальностью. B-010..B-015 — это просто примеры того что drift накапливается без detection.

**Fix план**. Скрипт `scripts/compose-drift-check.sh` который:
- Парсит `docker compose -f docker-compose.unified.yml config` (rendered spec).
- Для каждого сервиса проверяет: сети контейнера = декларированным.
- **(добавлено 2026-05-30 по следам P-PENTEST-4)** проверка публикаций: ни один контейнер не должен слушать `0.0.0.0`/`::` кроме whitelist (`nginx 80/443`, `wireguard 51820`); всё прочее обязано быть на `127.0.0.1`.
- Diff'ит — printа warnings.
- Можно запускать в CI на staging или вручную перед каждым prod deploy.

**Trigger**. После того как B-010/B-011 чистятся — иначе скрипт сразу зашумит ими.

**Estimate**. ~3 часа.

---

## P1 — Correctness

### B-026 — `acknowledged`-тревоги невидимо блокируют новые (dedup-индекс ⊋ список тревог) — CLOSED (2026-05-31)

**Найдено 2026-05-31** при e2e-проверке B-025 на проде: новые leak-метрики на controller 1 доходили до
INSERT (B-025 уже работал), но падали на UNIQUE `idx_active_alert_dedup` → «Duplicate suppressed», а в
админке оператор **не мог найти** блокирующую тревогу (alert 27).

**Корень — рассинхрон наборов статусов:**
| Механизм | Статусы | Где |
|---|---|---|
| Dedup-индекс `idx_active_alert_dedup` | `('active','acknowledged')` | migration 027:52 |
| Список тревог `getActiveAlerts` (дефолт) | **только `'active'`** | `alertService.js:1056` (было) |

Тревога в статусе `acknowledged` («Подтверждена») сидит **в** dedup-индексе (→ блокирует создание новой
о той же проблеме), но **отсутствует** в дефолтном списке (→ оператор её не видит и не может закрыть).
«Невидимая блокировка». Прод-доказательство: alert 27 acknowledged 2026-05-31 10:53 → блокировал
controller 1; controller 2 (без acknowledged) отработал чисто (alert 36 прошёл весь цикл).

**Fix** (`alertService.getActiveAlerts`): когда явного `filters.status` нет → дефолт
`ia.status IN ('active','acknowledged')` (совпадает с dedup-индексом). Явный фильтр статуса
по-прежнему делает exact-match (`= $1`). Frontend менять не нужно — `admin.js` уже имеет
статус-бейдж + label `'acknowledged': 'Подтверждена'` + опцию фильтра «Подтверждённые»
(`frontend-html/admin.html:1333`); они просто не получали acknowledged-строки с бэка.

**Тесты** (TDD): 2 в `alertServiceTest.test.js` — дефолт выбирает `IN (active, acknowledged)`; явный
`status='resolved'` остаётся exact-match. Полный прогон 2257/2257 зелёный, lint чисто.

**Не затронуто**: `loadActiveAlerts` (cooldown-restore, отдельный запрос с `status='active'`) — у него
своя семантика «только активные для cooldown-проекции», расширять не нужно. `resolveAlert`/`acknowledge`
guard'ы (`IN ('active','acknowledged')`) уже корректны.

**Operational**: на проде alert 27 уже разблокирован вручную (acknowledged → resolved, 2026-05-31 12:17)
в ходе расследования. Деплой фикса — код-онли, без миграции.

### B-025 — LEAK auto-trigger пропускал тревогу при `leak_sensor` ≠ строгого boolean `true` — CLOSED (2026-05-31)

**Найдено 2026-05-31** по жалобе «метрики с протечкой есть, а тревога не создалась».

**Что**. `metricService.createMetric` эмитил `LEAK_CHECK` только при `metricData.leak_sensor === true`
(строгое равенство). Колонка `metrics.leak_sensor` — **boolean**, и драйвер `pg` коэрсит `1` / `"1"` /
`"true"` / `"t"` в boolean `true` при INSERT → **протечка корректно сохранялась в БД** (и SQL-гейт
`WHERE leak_sensor = true` её бы увидел), **но событие не эмитилось** (`1 === true` → false,
`"true" === true` → false). Итог: контроллер, шлющий `leak_sensor` числом/строкой (типично для IoT),
писал метрику без тревоги. `checkLeak` никогда не вызывался.

**Корень**. Рассинхрон между БД-типом (boolean, лояльная коэрция) и JS-guard'ом (строгое `=== true`).
Коэрции `leak_sensor` нигде по пути не было (`validateMetricData` его не трогает).

**Fix**. Хелпер `coerceBoolish(v)` в `metricService` нормализует `leak_sensor` к реальному boolean
**один раз, до** insert и emit — БД и решение об эмите теперь согласованы. Принимает
`true/1/"1"/"true"/"t"/"yes"/"on"` → `true`; `false/0/"0"/"false"/"f"/"no"/"off"/""` → `false`;
`null/undefined`/нераспознанная строка → `null` (сохраняет «нет показания», не угадывает). Применяется
только если поле передано (не навязывает false отсутствующему показанию).

**Тесты** (TDD): 15 в `metricServiceTest.test.js` — 7 truthy-вариантов эмитят LEAK_CHECK, 8 falsy не
эмитят. Полный прогон 2255/2255 зелёный, lint чисто.

**Не затронуто**: VOLTAGE/HEATING auto-trigger используют `!= null` guard на числовых полях — у них
этой проблемы нет (только boolean `leak_sensor` со строгим `=== true`).

**Деплой**. Код-онли, без миграции. Эффект сразу при следующем деплое — новые leak-метрики с любым
boolean-ish значением начнут триггерить тревогу. Уже записанные «немые» протечки в БД не
ретроактивны (тревога создаётся только на новой телеметрии); при необходимости — разовый replay/manual
alert для уже залогированных, по триажу оператора.

### B-020 — `resolved_verifying` alerts осиротевают (нет write-back в `infrastructure_alerts.status`)

> **✅ ЗАКРЫТО 2026-05-29** — PR #68 (`a836fdc`) + migration 031 (backfill alerts 25/26 → resolved), deployed. Секция оставлена для истории; см. Closed. Durability-остаток вынесен в B-021.

**Найдено 2026-05-29** при анализе alert-lifecycle (#25 завис на 5 дней).

**Что**. `infrastructure_alerts.status = 'resolved_verifying'` — транзитное состояние, из которого НЕТ ни одного перехода обратно. `alertService.js:926` — единственное место, которое пишет этот статус (вход в verification cycle). Все 5 terminal-методов `AlertVerification` (`markPassed`/`markReopened`/`markSuppressed`/`markEngineerRequired`/`markSkipped`) обновляют только таблицу `alert_verifications` — родительский `infrastructure_alerts.status` не трогается. Результат: каждый авто-resolved алерт, прошедший verification, навсегда застревает в `resolved_verifying`.

**Прод-доказательство** (2026-05-29):
| alert | status | verification | осиротел |
|---|---|---|---|
| 25 | `resolved_verifying` (05-24 22:32) | id=2 **passed** 22:47 | 5 дней |
| 26 | `resolved_verifying` (05-28 17:25) | id=3 **passed** 17:40 | сегодня |

**Почему это важно**. Систематический (не единичный) баг. Затронуты все 5 terminal-путей:
- `passed` (сенсор восстановился — частый кейс) → должен `resolved`, застревает
- `reopened` (создан новый alert) → старый должен `resolved` (вытеснен), застревает
- `suppressed` → должен `resolved`, застревает
- `engineer_required` (превышена reopen-квота) → должен `engineer_required` (enum есть с migration 027), застревает → **эскалация на инженера не видна в alert UI**
- `skipped` (window истёк) → должен `resolved`, застревает

Смягчающие факторы: `getActiveAlerts` дефолтит на `status='active'` (стр.1049) → осиротевшие не засоряют дефолтный список; dedup-индекс исключает `resolved_verifying` → новые алерты не блокируются. Поэтому не аварийный P0, но: lifecycle не завершается, аналитика по resolved теряет их, `resolveAlert` SELECT-guard `IN ('active','acknowledged')` не даёт закрыть вручную → truly stuck.

**Где потерялось**. `alertVerificationService.js:28-30` комментарий обещал «PR-3 adds the post-window passed/reopened reconciliation» — reconciliation на сторону `alert_verifications` сделали, но write-back в `infrastructure_alerts.status` забыли. Hotfix 2026-05-24 (alert 24) добавил только env-gate входа, не выход.

**Fix план**.
- Новый метод `alertService.finalizeVerification(originalAlertId, outcome)`: один `UPDATE infrastructure_alerts SET status=$2 WHERE alert_id=$1 AND status='resolved_verifying'` (guard на verifying = идемпотентность). Mapping: passed/reopened/suppressed/skipped → `resolved`; engineer_required → `engineer_required`.
- Вызов из `alertVerificationService._drainOne` (после mark*) + из `ALERT_REOPENED` listener (после markReopened).
- Backfill: одноразовый SQL для застрявших 25/26 на проде → `resolved`.
- Тесты: 5 outcome→status переходов + идемпотентность guard'а.

**Сопутствующие (Low)**:
- L1: stale comment `alertVerificationService.js:221-224` («suppressions table doesn't exist yet») — таблица есть с migration 026; `MODULE_NOT_FOUND`-ветка мертва.
- L2: `reopen_sequence` инкремент разнесён (`resolveAlert:953` vs `alertVerificationService.js:299`) — риск рассинхрона.

**Trigger**. Сейчас — реальный correctness gap, влияет на каждый verified alert.

**Estimate**. ~2-3 часа (TDD + backfill + dev smoke).

---

## P2 — Tech debt

### B-003 — Rate-limiter и in-memory cache → Redis для multi-replica

> **Обновлено 2026-05-30 (#69 / SEC-6):** добавлен FIFO size-cap на обе in-memory Map (`SimpleRateLimiter` + `SimpleSlowDown`) → риск unbounded memory-growth при IP-флуде **снят**. Остаётся multi-replica bypass (**SEC-8**): per-process rate-limit + webhook-nonce при N репликах без Redis. Single-replica → не эксплуатируется. SEC-8 ⊂ этот пункт.

**Что**. `src/middleware/rateLimiter.js` и `src/services/cacheService.js` хранят state в памяти процесса. Для горизонтального scale-out (несколько реплик app) нужен общий Redis.

**Почему**. Уже отмечено как known issue в CLAUDE.md «Known Architecture Issues». Sprint 9 outbox + Sprint 10 verification queue уже multi-replica-safe (DB + advisory_lock). Rate-limiter не safe — DDoS / brute-force с обходом одной реплики через round-robin LB.

**Trigger**. Когда появится решение масштабировать app (текущий single-replica setup это не требует).

**Estimate**. ~6-8 часов: Redis Docker service + два модуля переписать на ioredis + tests.

### B-004 — Monolithic `public/admin.js` (~3,826 LoC) + `public/script.js` (~2,384 LoC) split

> **Обновлено 2026-05-30:** `admin.js` вырос 3,429 → **3,826** (+~400 от B-001 «Открыть в УК»), `script.js` 2,335 → **2,384**. Триггер 4,500 LoC ещё не достигнут, но приближается.

**Что**. Phase 12B.4 (Sprint 10-era) активировал esbuild bundling, но НЕ разделил entry points. Оба файла остались монолитами с разнородной логикой.

**Почему**. Уже отмечено в CLAUDE.md «Known Architecture Issues». Каждая новая фича добавляет ещё ~50-200 LoC в эти файлы. Дальше будет хуже — рост код-базы линейно повышает время review + onboarding cost.

**Trigger**. Когда `admin.js` перевалит за 4500 LoC ИЛИ когда `feature/frontend-redesign` merge даст естественный повод переписать.

**Estimate**. ~1-2 дня: разделить на ~6-8 feature-scoped модулей, миграция через esbuild multi-entry config.

### B-021 — Durability hardening verification reconciliation (carve-out из B-020 review)

**Найдено 2026-05-29** adversarial-ревью workflow'ом фикса B-020. Три pre-existing (НЕ внесённых B-020) архитектурных слабости в reconciliation между `alert_verifications` и `infrastructure_alerts`. Все три смягчены B-020 (finalize-first self-healing), но не устранены полностью.

**1. ALERT_REOPENED — ephemeral EventEmitter без replay.** `createAlert` emit'ит `ALERT_REOPENED` в in-process emitter; listener в `alertVerificationService` делает finalize + markReopened. Если процесс упадёт после emit но до завершения listener'а — событие потеряно, не реплеится при рестарте. B-020 finalize-first гарантирует что alert не осиротеет (verification остаётся `pending` → `_drainOne` подберёт по window-expired), но verification закончит `passed` вместо `reopened` (минорная audit-неточность). **Полный fix**: durable outbox для reopen-событий по образцу `ukOutboxService` (Sprint 9).

**2. Нет explicit transaction вокруг двух UPDATE в `_drainOne`/listener.** `_finalizeAlertStatus` (table infrastructure_alerts) и `mark*` (table alert_verifications) — два отдельных autocommit-стейтмента. Атомарности нет; полагаемся на finalize-first + idempotent guard'ы (`status='resolved_verifying'` / `status='pending'`) + self-heal на следующем тике. Работает, но хрупко. **Полный fix**: обернуть в `BEGIN/COMMIT` на одном checked-out client'е (`db.query` сейчас pool-based — нужен `pool.connect()`).

**3. Advisory-lock не защищает system-`resolveAlert` от гонки с `_drainOne`.** `_drainOne` держит `pg_try_advisory_lock(849608648)`, но `resolveAlert` его не берёт. Оператор/UK-feedback может вызвать resolve пока verifier finalize'ит. Data-safe (idempotent guard), но возможен confusing «alert not found or already closed». **Полный fix**: брать тот же advisory-lock в `resolveAlert` при `userId === null`.

**Почему не в B-020**: всё pre-existing (reconciliation на EventEmitter построена в Sprint 10 PR-2/PR-3), каждый — самостоятельное изменение архитектуры. B-020 закрыл функциональный orphan-bug + finalize-first crash-safety; durability-hardening вынесен чтобы PR оставался focused/reviewable.

**Trigger**. Перед multi-replica scale-out (B-003) ИЛИ если в проде увидим verification, закончившуюся `passed` там где ожидался `reopened` (признак потери ALERT_REOPENED при рестарте).

**Estimate**. ~4-6 часов (outbox для reopen) + ~2ч (transaction wrap) + ~1ч (advisory-lock в resolveAlert).

---

## P3 — UX / observability

### B-024 — Map layer counters show `(0)` until the layer is toggled — CLOSED (2026-06-01)

> **Status:** ОБА фактора закрыты.
> - Фактор 1 (Здания, public): #74 — `loadLayerDataSilent` получил `case "🏢 Здания"` → `loadBuildings`
>   из публичного `/buildings-metrics`, счётчик заполняется при init для всех.
> - Фактор 2 (auth-gated слои для anon): **#88 (2026-06-01)** — выбран вариант 3 (публичные count-only
>   агрегаты). Новый PUBLIC `GET /api/map-layer-counts` (`src/models/MapLayerCounts.js` +
>   `mapLayerCountsController` + route в default-deny allowlist) отдаёт **только целые числа** (без
>   координат/имён/статусов). `public/map-layers-control.js` `loadPublicLayerCounts()` сидит счётчики
>   auth-gated слоёв для anon при init (best-effort). **Verified end-to-end на проде 06-01**: аноним
>   видит Здания(2)/Трансформаторы(1)/Контроллеры(2)/Алерты(1) вместо стены `(0)`; пустые слои —
>   честный `(0)`. Тесты: model 4 + controller 2 + default-deny integration +1.
>
> Историческая диагностика ниже оставлена для контекста.

**Найдено 2026-05-31** при браузерном QA прода (post-B-012 deploy; **НЕ регрессия** — деплой
`3c23225..26f206f` тронул только тестовые файлы, ноль изменений в `public/`/JS). Диагноз уточнён
admin-QA того же дня (см. ниже).

**Что**. В панели «Объекты инфраструктуры» все слои стартуют как `🏢 Здания (0)`, `📊 Контроллеры (0)`,
`⚠️ Алерты (0)` и т.д., **хотя маркеры на карте отрисованы**. Подтверждено в браузере:
- **Anon:** счётчики остаются `(0)` даже после клика на чекбокс слоя.
- **Admin (залогинен):** при старте тоже `(0)`, но **клик на чекбокс слоя → `0` превращается в реальное
  число** (наблюдение оператора, admin-QA 2026-05-31).

**Почему так** (`public/map-layers-control.js`). `updateLayerCount(layer, N)` вызывается **внутри
функции загрузки каждого слоя** (`updateLayerCount("🏢 Здания", buildings.length)` на :531,
`"📊 Контроллеры"` на :1379, и т.д.), а эти load-функции выполняются **лениво — при включении слоя**, не
все на старте. Отсюда два фактора:
1. **Lazy init (касается всех, вкл. admin):** пока слой не тронут, счётчик показывает дефолтный `(0)`.
   Toggle → load-fn → реальное число. То есть начальный `(0)` ≠ «пусто», а «ещё не загружено».
2. **Auth gate (касается anon):** load-функции счётчиков бьют в auth-gated эндпоинты (`/api/buildings`,
   `/api/controllers`, `/api/transformers`, `/api/alerts` → **401 для anon**; проверено curl'ом), поэтому
   у анонима даже после toggle остаётся `(0)`. Маркеры при этом берутся из публичного
   `/api/buildings-metrics` (200) — отсюда рассинхрон «маркеры есть, счётчик 0».

**Severity**. Низкая, cosmetic. Данные не теряются, карта функциональна. Но вводит в заблуждение:
стартовый `(0)` читается как «слой пуст».

**Fix-варианты** (выбрать при взятии в работу):
1. **Eager init счётчиков** при загрузке карты (а не только при toggle) — устраняет фактор 1 для всех.
2. Для anon — показывать число слоёв из того же `buildings-metrics` payload'а (что и маркеры) или
   скрывать `(N)` когда fetch вернул 401 (честнее, чем фальшивый `0`) — фактор 2.
3. Публичные count-only агрегаты (без чувствительных полей) — больше работы, даёт реальные числа anon.

**Trigger**. Косметика; брать на map-UX проходе или вместе с `feature/frontend-redesign` merge (B-008).

**Estimate**. ~1-2 часа (вариант 1 покрывает основное; +1ч на anon-ветку варианта 2) + dev smoke anon/auth.

### B-006 — Engineering Kanban column в УК

**Что**. UK сейчас рендерит engineer_required-тикеты в обычной board-view рядом с другими категориями, отмечая amber «⚠ Эскалация» плашкой. Если operator wants отдельную Engineering колонку — это отдельный ticket с их стороны.

**Почему**. Не блокер. Текущее решение функционально (category-filter работает, dispatcher видит плашку). Cosmetic UX иmprovement.

**Trigger**. Если оператор УК запросит — отправить ticket в UK side (НЕ наш PR).

**Owner**. UK side, не InfraSafe.

---

## P3 — Sprint 9.X дольки

### B-007 — `integration_log` cosmetic gap в ukOutboxService — CLOSED (2026-05-31)

**Что было**. `ukOutboxService._drainOne` обновлял только outbox-таблицу + AlertRequestMap; строка
`integration_log` (пишется при enqueue в `alertForwarder` → `webhookVerifier.logEvent`) не отражала
retry/dead/success transitions — лог event_id «разрывался».

**Fix** (`a` коммит сессии):
- Новый метод `IntegrationLog.updateStatusByEventId(eventId, status, errorMessage)` — UPDATE по `event_id`
  (idempotency key), возвращает null если строки нет.
- `_drainOne` вызывает best-effort `_syncIntegrationLog` на каждом исходе: success → `success`,
  retry → `retrying`, dead / retry-at-MAX → `failed`. **Best-effort**: ошибка записи лога НЕ ломает drain
  (outbox-row transition остаётся source of truth; это observability).
- Тесты (TDD): 5 в `ukOutboxService.test.js` (success/retry/dead/escalation/log-write-failure) + 3 в
  `integrationLog.test.js` (params/null/default). Полный прогон 2240/2240 зелёный, lint чисто.

**Не сделано** (вне scope): `skip`-исход НЕ синкается в integration_log (это конфиг-проблема, не прогресс
event'а — строка остаётся `pending`, что корректно). Деплой обычный (код-онли, миграции нет); реально
проявится только при `UK_USE_WEBHOOK_SENDER=true`.

---

## P4 — Будущие планы

### B-008 — `feature/frontend-redesign` merge

**Что**. Параллельная ветка с полным редизайном фронтенда (Inter font, design tokens, dark/light themes, sidebar layout, новые dashboard pages). Не merge'нута в main с момента основной работы Sprint'ов 7-10.

**Почему**. UX долго отставал от backend feature growth. Sprint 11/12 candidate для merge.

**Trigger**. Когда Sprint 10 stabilization window закроется (нет regressions в течение 2 недель) + B-001/B-004 split admin.js в main, чтобы было что merge'ить без conflict storm.

**Estimate**. ~1 week effort (conflict resolution, regression testing, gradual page-by-page rollout).

### B-009 — Seasonal HEATING rules (active_from/_to in alert_rules)

**Что**. HEATING_FAILURE alert rule должен быть active только в отопительный сезон (~Oct-Apr). Сейчас активен круглый год — летом fires на ремонтных работах.

**Почему**. Sprint 10 plan «Out of scope: Q4 2026». Минорный, но реальный noise источник.

**Trigger**. Q3 2026 (август-сентябрь), чтобы успеть до start отопительного сезона.

**Estimate**. ~4-6 часов: миграция (`active_from`, `active_to` columns) + AlertRule filter + admin UI.

---

## Security pentest 2026-06-01/02 — SEC-13..SEC-34 (round 2)

> Источник: `docs/audit/2026-06-01-security-pentest.md` (статика 5 доменов + unauth/authenticated
> динамика на проде, admin-MFA + созданный low-priv аккаунт). **Активно-эксплуатируемых CRITICAL — 0**:
> JWT-секреты утекали в git, но **ротированы** (live-forge access+refresh → 401; alg:none → 401).
> Authorization-модель чистая (BFLA/privesc/mass-assignment роли — всё заблокировано).
> Все пункты ниже **подтверждены present-в-коде** (file:line). Продолжение SEC-нумерации прошлого
> аудита (SEC-1..12 + P-PENTEST-1..4, закрыт 2026-05-30 #69).
>
> **Реконсиляция с закрытым батчем:** SEC-17 ⊃ остаток SEC-3 (rotation done, нужен только scrub);
> SEC-18 — остаток P-PENTEST-1 (app-CSP всё ещё несёт CDN); SEC-19 ≠ P-PENTEST-3 (другой эндпоинт);
> SEC-25 ≠ P-PENTEST-2 (тот закрыл 400-on-missing-serial, mass-assignment spread остался);
> SEC-20 ⟂ SEC-6 (nginx-слой vs app-слой).

### HIGH

- **SEC-13 · HIGH · `admin123` в git-tracked seed** — `database/init/02_seed_data.sql:168`.
  *Что/Почему:* seed создаёт admin (user_id 55) с bcrypt-хешем пароля `admin123`; `database/init`
  монтируется в `/docker-entrypoint-initdb.d` → каждый fresh-deploy/DR-rebuild поднимается с известным
  паролём. *Fix:* убрать admin-строку из seed (или заведомо невалидный placeholder-hash); admin
  заводить out-of-band с операторским паролём; runbook-шаг обязательной смены. *Trigger:* до следующего
  fresh-deploy/DR. *Est:* ~1ч.
- **SEC-14 · ✅ CLOSED код (PR #99 / `25c3679`, 2026-06-07; прод-деплой отдельно) · HIGH · `Dockerfile.unified` гонит dev-watcher в проде** — `Dockerfile.unified:39`
  `CMD ["npm","run","dev"]` (nodemon) + `:17` `npm install --ignore-scripts` (без `--omit=dev`).
  **Closed:** backend-стейдж разбит на `app-builder` (devDeps→bake dist) + `app` runtime (`npm ci --omit=dev`, `npm start`, NODE_ENV=production, apk add curl); esbuild/nodemon отсутствуют в runtime (CI image-composition). Прод деплой = rebuild через `update-production.sh`.
  *Почему:* в проде крутится dev-watcher с devDependencies; file-watcher перезапускает сервер на любую
  запись в `/app` (см. SEC-15). `Dockerfile.prod` корректен — unified не унаследовал. *Fix:*
  `CMD ["npm","start"]` + `npm ci --omit=dev --ignore-scripts`. **Сначала verify на проде, какой
  образ/CMD реально бежит** (решает HIGH↔INFO). *Trigger:* до следующего image-rebuild. *Est:* ~1ч.
- **SEC-15 · ✅ CLOSED код (PR #99 / `25c3679`, 2026-06-07; прод-деплой отдельно) · HIGH · весь проект bind-mount в прод-app** — `docker-compose.unified.yml:59-63` `- .:/app`.
  **Closed:** убраны `- .:/app` и anon `- /app/node_modules`; код/deps/public только из immutable-образа (CI проверяет отсутствие `.env*`/`.git`/`scripts/`/`build/`). Frontend dist доставляется C-extract (`scripts/rebuild-frontend.sh prepare|publish`, staging `.deploy/`). Прод деплой = rebuild через `update-production.sh` (phased switch + health-wait + rollback).
  *Почему:* контейнер app читает `.env.prod` (JWT/TOTP/DB/UK-секреты), `.git/` (вся история), deploy-скрипты
  → любой RCE в Node = мгновенный доступ ко всем секретам без эскалации. (B-027 уже зафиксировал этот mount
  как факт прод-реальности.) *Fix:* в проде убрать `- .:/app`, копировать только нужное (как
  `Dockerfile.prod`); hot-reload-mount оставить только в `docker-compose.dev.yml`/override. *Trigger:* при
  следующем compose-touch проде. *Est:* ~2-3ч + smoke.
- **SEC-16 · ✅ CLOSED (PR #98 / `9b9537b`, 2026-06-07) · HIGH · `backup-database.sh` хардкод `postgres/postgres`** — `backup-database.sh:16-18`
  (git-tracked). *Fix:* читать из env (`${DB_PASSWORD:?}`); ротировать если совпадает с прод; либо
  gitignore. *Trigger:* следующий backup-touch. *Est:* ~30мин.
  **Closed:** `DB_USER`/`DB_PASSWORD` из env (defaults `infrasafe_app`/empty, опц. source `.env.prod`/`.env`); пароль в pg_dump через `PGPASSWORD` env, не argv; хардкод `postgres/postgres` убран. Regression `tests/jest/security/backupScript.test.js`.

### MEDIUM

- **SEC-17 · MEDIUM · git-history scrub секретов/кредов** (поглощает прежние M-0 + H-2) —
  `623a059:.env.prod` (`DB_PASSWORD,JWT_SECRET,JWT_REFRESH_SECRET,SESSION_SECRET`),
  `da44ed4:generator/.env` (`admin/Admin123`), `.env`. *Статус:* JWT/refresh **ротированы** (SEC-3,
  подтв. live-forge→401), `SESSION_SECRET` не используется, БД снаружи закрыта (port-scan: 80/443/SSH) →
  активного вектора нет; остаток — физический scrub. *Fix:*
  `git filter-repo --path .env --path .env.prod --path generator/.env --invert-paths` + force-push +
  уведомить клонировавших; CI `trufflehog`/`git-secrets` (есть `docs/audit/secret-hygiene-checklist.md`);
  подтвердить ротацию generator-admin-пароля. *Trigger:* при готовности переписать историю. *Est:* ~2ч.
- **SEC-18 · ✅ CLOSED (PR #96 / `59ae6a6`, deployed+verified live 2026-06-02) · MEDIUM · split-brain CSP — helmet всё ещё несёт CDN** — `src/server.js:54-56`
  `scriptSrc [... 'https://cdn.jsdelivr.net', 'https://unpkg.com']` (подтв. live на `/api/*`). Остаток
  P-PENTEST-1. *Fix:* убрать оба CDN-хоста из helmet `scriptSrc` (мертвы после self-host DOMPurify;
  edge-CSP их уже не несёт — B-017). *Trigger:* любой CSP-touch. *Est:* ~30мин.
  **Closed:** prod `scriptSrc 'self'` (CDN ушли), live-verified на `/api/*`, regression `serverTest.test.js`.
- **SEC-19 · MEDIUM · публичный `/api/uk-requests-metrics` отдаёт `infrasafe_alert_id`** —
  `src/routes/index.js:104` (PUBLIC_ROUTES) + `src/models/AlertRequestMap.js:144-148`. Подтв. live (боевые
  данные без auth). *Fix:* strip `infrasafe_alert_id` из SELECT (UK нужен только `uk_request_number`+
  `status`) ИЛИ сервис-аккаунт/HMAC/IP-allowlist. *Trigger:* спринт. *Est:* ~1-2ч.
- **SEC-20 · MEDIUM · нет rate-limit на nginx-слое** — `nginx-config/nginx.production.conf` (нет
  `limit_req`). Ортогонально app-слою (SEC-6). *Fix:* `limit_req_zone $binary_remote_addr` для `/api/` +
  жёстче для `/api/auth/`. *Trigger:* edge-hardening спринт. *Est:* ~1-2ч.
- **SEC-21 · MEDIUM · Redis без `--requirepass`** — `docker-compose.unified.yml:134`; сеть общая с
  UK-стеком. *Fix:* `--requirepass <secret>` + `REDIS_URL` с паролём. *Trigger:* при включении Redis в
  проде / multi-replica (B-003). *Est:* ~1ч.
- **SEC-22 · MEDIUM · `/uk/api/*` — открытый proxy на весь UK-API** —
  `nginx-config/nginx.production.conf:193-207` (rewrite `^/uk/api/(.*)`, без auth_request/allow/deny).
  *Fix:* сузить до нужных путей; `auth_request`/HMAC/IP-allowlist. *Trigger:* координация с UK. *Est:* ~2-3ч.
- **SEC-23 · MEDIUM · CSRF — бэкенд не валидирует `X-CSRF-Token`** (только клиентский
  `public/utils/csrf.js`; реальная защита = `SameSite=Strict`). *Fix:* серверная проверка
  `Origin`/double-submit для мутаций, либо убрать вводящий в заблуждение код и задокументировать SameSite
  как единственную защиту. *Trigger:* спринт. *Est:* ~2-3ч.
- **SEC-24 · ✅ CLOSED (PR #96 / `59ae6a6`, deployed+verified live 2026-06-02) · MEDIUM · log-injection через сырой `x-correlation-id`** — `src/middleware/correlationId.js:5-9`
  (header используется как есть). *Fix:* валидировать как UUID, иначе `crypto.randomUUID()`. *Trigger:*
  спринт / при SIEM-ingest. *Est:* ~30мин.
  **Closed:** UUID-regex gate; evil header → сгенерированный UUID (live-verified `754cff2e…`), regression `correlationId.test.js`.
- **SEC-25 · ✅ CLOSED (PR #96 / `59ae6a6`, deployed 2026-06-02) · MEDIUM · mass-assignment `...metrics` spread в публичном telemetry** —
  `src/services/metricService.js:283-287`. Отлично от P-PENTEST-2 (тот закрыл 400-on-missing-serial;
  spread остался). *Fix:* allowlist полей метрик (proto-pollution/log-injection; SQL-пути нет). *Trigger:*
  спринт. *Est:* ~1ч.
  **Closed:** `ALLOWED_METRIC_FIELDS` allowlist (15 сенсорных полей); `__proto__`/unknown отброшены; `leak_sensor`/LEAK_CHECK сохранён; no-`metrics` regression-guard.
- **SEC-26 · ✅ CLOSED (PR #98 / `9b9537b`, 2026-06-07) · MEDIUM · TOTP anti-replay TTL 60с < окна валидности ~90с** — `src/services/totpService.js:39`
  (+ in-memory, теряется на рестарте/мульти-реплике). *Fix:* TTL≥120с + Redis-backing. *Trigger:* спринт /
  multi-replica. *Est:* ~30мин.
  **Closed:** TTL 60→120с (`REPLAY_WINDOW_MS`); sweep вынесен в экспортируемый `sweepExpiredCodes()` для детерминированного теста границы. **Остаток (Redis-backing для multi-replica) → B-003** (single-replica не эксплуатируется). Regression `totpService.test.js`.
- **SEC-27 · MEDIUM · stale user-cache 5мин на смену роли/деактивацию** — `src/services/authService.js`
  (`findUserById` cache, key `auth:user:<id>`). *Fix:* инвалидация кэша в любом пути мутации
  `users.role/is_active`. *Trigger:* при появлении user-mgmt mutation API. *Est:* ~1ч.
- **SEC-28 · ✅ CLOSED (PR #98 / `9b9537b`, 2026-06-07) · MEDIUM · recovery-коды перегенерируются на каждый `setup-2fa` с тем же tempToken** —
  `src/services/totpService.js` (~119). *Fix:* идемпотентная генерация recovery в рамках одного tempToken.
  *Trigger:* спринт. *Est:* ~1ч.
  **Closed:** подход «stable via cache» — на resume pending-setup recovery-коды переиспользуются из `cacheService` (`totp:setup:recovery:<uid>`, TTL 15 мин), форма API не меняется; fallback на регенерацию при cache-miss; очистка при confirm. Tradeoff: plaintext-коды кратковременно в in-memory кэше (они и так в ответе клиенту). Существующий «коды разные»-тест переписан под новое поведение + fallback-тест. Regression `totpService.test.js`.
- **SEC-29 · ✅ CLOSED (PR #96 / `59ae6a6`, deployed 2026-06-02) · MEDIUM · `UkOutbox` INTERVAL через string-concat** — `src/models/UkOutbox.js:128,173`
  (`($N || ' seconds')::interval`). Сейчас не эксплойтится (caller coercion), паттерн неверный. *Fix:*
  `NOW() + ($N * INTERVAL '1 second')`. *Trigger:* при следующем touch UkOutbox. *Est:* ~30мин.
  **Closed:** оба метода (`markFailed`+`resetForSkip`) → `$N * INTERVAL '1 second'`, integer-параметр `Math.max(1, Math.floor())`, regression `ukOutboxModel.test.js`.
- **SEC-30 · ✅ CLOSED (PR #98 / `9b9537b`, 2026-06-07) · MEDIUM · `building_id` без эскейпа в HTML-атрибуты/fetch-URL Leaflet-попапа** —
  `public/script.js:~1921-1931` (нужна компрометация БД/API для эксплойта). *Fix:* `parseInt`+валидация
  перед использованием. *Trigger:* map-UX проход / B-008. *Est:* ~30мин.
  **Closed:** `safeBuildingId = /^\d+$/.test(...) ? ... : ''` перед HTML `id=""` и URL fetch'а; power-fetch пропускается без валидного id. Бандл пересобирается на деплое (`public/dist` gitignored). Regression `tests/jest/security/sec30-building-id.test.js`.
- **SEC-31 · MEDIUM · blacklist fail-open при недоступности БД (by-design)** — `src/services/authService.js:633`.
  *Fix:* принято by-design; при multi-replica перенести L1 в Redis. *Trigger:* multi-replica (B-003,
  входит туда). *Est:* — (в B-003).
- **SEC-32 · MEDIUM · `admin.js` шлёт `Bearer null` ×32 + мёртвые localStorage-ключи** — `public/admin.js`.
  Спасает cookie-fallback; гигиена/защита от регрессий XSS-token-theft. *Fix:* убрать ручные
  `Authorization`-заголовки (идти через interceptor), вычистить мёртвые localStorage-пути. *Trigger:*
  admin.js split (B-004) или раньше. *Est:* ~2ч.
- **SEC-33 · ✅ CLOSED (PR #96 / `59ae6a6`, deployed 2026-06-02) · MEDIUM · системный 500 на невалидной пагинации** (подтв. live Round 3) —
  `src/controllers/buildingController.js:9`, `metricController.js:9` (+ др. list-контроллеры): `parseInt`
  без clamp → `limit=-1`/`abc`, `page=-5`/`abc` дают 500 на `/buildings`,`/controllers`,`/metrics`,
  `/alerts`,`/transformers`. `validatePagination` есть в `src/utils/queryValidation.js:177-200`, но не
  используется. Ошибка чистая (без leak), достижимо любым авторизованным. *Fix:* применить
  `validatePagination` во всех list-контроллерах (NaN/neg → **clamp к безопасным значениям, 200**, не 500/400). Поглощает L-11. *Trigger:* спринт
  (быстрый). *Est:* ~1-2ч.
  **Closed:** `validatePagination(page,limit,defaultLimit)` применён во всех list-контроллерах + `waterSupplierRoutes` + `createCrudController`; `validateSortOrder`-whitelist; NaN/neg → clamp [1,200], 200 не 500. CodeQL diff-gate: 8 FP dismissed (LIMIT/OFFSET параметризованы, sort/order whitelisted).

### LOW / INFO

- **SEC-34 · LOW/INFO · hardening-пачка** (бывшие L-1..L-13 + INFO):
  | # | Находка | Где |
  |---|---|---|
  | a | `target="_blank"` без `rel="noopener"` (reverse-tabnabbing) | `frontend-html/index.html`, `contacts.html` |
  | b | мёртвые `validateToken`/`getValidToken` (ссылаются на `localStorage.admin_token`) | `public/utils/domSecurity.js` |
  | c | `createSecureTableRow` innerHTML-bypass через `field.secure===false` | `public/utils/domSecurity.js` |
  | d | `flip-trace` debug-лог в `localStorage` в проде | `public/admin-auth.js`, `admin-head-probe.js`, `login.js` |
  | e | сузить CSP `img-src` + DOMPurify `style`/`img` | nginx CSP + `public/utils/domSecurity.js` |
  | f | dev-порты `3000`/`5435` на `0.0.0.0` + `postgres/postgres` | `docker-compose.dev.yml` |
  | g | `/api-docs/` nginx без prod-guard | `nginx-config/nginx.production.conf` (`return 404;`) |
  | h | отдельный `JWT_2FA_SECRET` для temp-токенов (сейчас общий, спасает scope-guard) | `src/services/authService.js` |
  | i | прод IP/SSH/username в git-tracked `connect.sh` | `connect.sh` |
  | j | **SSH 32323 открыт снаружи** (подтв. port-scan) → key-only (`PasswordAuthentication no`) + fail2ban + allowlist | host sshd |
  | k | `npm audit`: 3× moderate (qs/body-parser/express DoS, GHSA-q8mj-m7cp-5q26) → `npm audit fix` | `package.json` |

  *Trigger:* cleanup-проходы. *Est:* суммарно ~1 день.

### Рекомендованный порядок устранения (round 2)
1. ~~**Быстрые безопасные код-правки** (без прод-доступа, чистый код+тесты): SEC-18, SEC-24, SEC-25, SEC-33, SEC-29 + `npm audit fix`.~~ **✅ DONE (PR #96 / `59ae6a6`, deployed 2026-06-02).** Код-фиксы 18/24/25/29/33 живут на проде; `npm audit fix` (qs/express dep-патч) лежит в package-lock, но **активируется только с пересборкой образа** (анон node_modules-volume) → отложен на SEC-14 (`--renew-anon-volumes`).
1b. ~~**Quick-wins batch 2** (чистый код+тесты): SEC-16, SEC-26, SEC-28, SEC-30.~~ **✅ DONE (PR #98 / `9b9537b`, 2026-06-07).** TOTP TTL/recovery + backup-creds + building_id sanitize; 2309 тестов зелёные; прод не затронут.
2. ~~**HIGH деплой/compose:** SEC-14/15 re-arch (multi-stage immutable + extracted static).~~ **✅ DONE код (PR #99 / `25c3679`, 2026-06-07)** — прод-деплой отдельным шагом (`update-production.sh`). Остаётся **SEC-13** (admin123 seed — в фазе F, нужен bootstrap-провижен). *(SEC-16 закрыт в 1b.)*
3. **Edge/infra:** SEC-20, SEC-21, SEC-22, SEC-19.
4. **Остальные MEDIUM** (SEC-23/27/31/32) + SEC-17 scrub + SEC-34 пачка.

---

## Closed / removed

### ✅ UK-URGENCY — каноничные ключи `urgency` (closed 2026-06-06)

**Контракт (от УК):** `urgency` → каноничные ключи `low | medium | high | critical` (ранее рус.
`Обычная/Средняя/Срочная/Критическая`). (а) наш outbound `uk_urgency_override` шлём ключом;
(б) их outbound `request.created/status_changed` приходит ключом. Severity→urgency маппинг — внутренний
для УК, контракта не касается.

**Shipped:** PR [#97](https://github.com/a-afanasyev/infrasafe/pull/97) (`94c7ddd`) + migration 032
(`alert_rules.uk_urgency` backfill рус.→ключ, idempotent) + seed `03_uk_integration.sql` на ключах.
- (а) `src/services/uk/alertForwarder.js` — `toUrgencyKey()`/`bumpUrgency()` нормализуют на границе
  (принимают и легаси-рус., и ключи; неизвестное→null); `uk_urgency_override` теперь всегда ключ.
- (б) **намеренно no-op** — InfraSafe не потребляет входящий `urgency` (`requestProcessor` читает только
  `status`); добавлять парсинг неиспользуемого поля = YAGNI. Нормализатор готов к переиспользованию.
- Тесты: блок «uk_urgency_override → canonical key» в `ukIntegrationServiceTest.test.js`, 2215/2215 зелёный.

**Прод-верификация (2026-06-06):** деплой `94c7ddd` + migration 032 (UPDATE 7) + rebuild бандлов
(byte-verified) + restart, health=healthy. Reopen-синтетика через реальный mapped outbound-путь →
`uk_urgency_override="critical"` (ключ), event_id `83a415c3-7984-41a7-bca2-fa7111d9d68c`, drain→УК **202**,
ticket **260605-001**. **УК подтвердил с обеих сторон** (parse OK `webhook_inbox.outcome=accepted`, без
фоллбэка; их outbound тоже ключи). Синтетик-строки на проде вычищены (outbox 12 / map 10 / ilog 5875,5876
/ alert 39). Контракт по `urgency` закрыт. Детали — `docs/audit/2026-06-05-uk-urgency-canonical-keys.md`.

**Остаток (отдельный пункт, не блокер):** admin-UI «открыть в УК» reopen-meta passthrough — поля есть с
PR-3, нужен UI-проброс + использование UK `onOpenRelated` prop. Берётся на map/admin-UX проходе.

### ✅ Security audit 2026-05-29/30 — SEC-1..12 + P-PENTEST-1/2/3/4 + ротации (closed 2026-05-30)

**Shipped**: PR [#69](https://github.com/a-afanasyev/infrasafe/pull/69) (`3c23225`) + doc-commits `3a31f30`..`ab5dd19`. Deployed на прод 2026-05-30; пост-деплой смоук 14/14; 2232 теста + CodeQL зелёные.

**Код (все TDD + adversarial re-audit, 3 раунда workflow):**
- **SEC-1/4** (CRITICAL 2FA-bypass): `authenticateJWT` режет токены со `scope`; `optionalAuth` degrade-to-anon; `verifyTempToken` async + issued-before-cutoff. **Live-replay на проде подтверждён** (temp-token → 401).
- **SEC-5** SSRF: валидация `UK_API_URL` + allowlist optional + IPv6 bracket/mapped/compat normalization.
- **SEC-6** size-cap на обе rate-limiter Map (→ B-003 annotation). **SEC-7** bounded `json_agg`. **SEC-10** ReDoS→linear. **SEC-11** lockout-oracle (status+latency). **SEC-12** NODE_ENV assert.
- **P-PENTEST-2** telemetry→400. **P-PENTEST-3** anon `external_id` removed.
- Compose: **SEC-2** DB-pw в env_file, **SEC-9** dev-fallbacks removed, **P-PENTEST-1** app/frontend → `127.0.0.1`.

**Ротации (SEC-3) — все проверены на проде:** JWT + refresh; DB-пароль (`infrasafe_runtime` self-ALTER); UK webhook secret (общий, обе переменные); **TOTP_ENCRYPTION_KEY** (Strategy B — полный сброс + ре-энролл admin); + засветившийся admin-пароль (старый → 401).

**P-PENTEST-4** (найдено при проверке P-PENTEST-1): 3 контейнера UK-стека (`8085 uk-management-api`, `8000 uk-web-registration`, `3002 uk-frontend`) торчали на `0.0.0.0` plaintext, в обход TLS+nft (docker FORWARD bypass). UK-сторона закрыла (loopback + удаление 8000); проверено снаружи CLOSED, `/uk/` через TLS работает.

**Docs:** `2026-05-29-security-audit.md`, `2026-05-30-prod-ops-runbook.md`, `2026-05-30-totp-key-rotation-plan.md`, `secret-hygiene-checklist.md`.

**Урок:** host-nft `input policy drop` НЕ ловит docker-проброшенные порты (идут через `nat`/`FORWARD`) — защита публикаций только через `127.0.0.1`-bind в compose или TLS-edge. Зафиксировано в P-PENTEST-4 + B-016.

### ✅ B-020 — `resolved_verifying` alerts orphan write-back (closed 2026-05-29)

**Shipped**: PR [#68](https://github.com/a-afanasyev/infrasafe/pull/68) (`a836fdc`) + migration 031 (backfill 25/26 → resolved), deployed 2026-05-29. `alertVerificationService._finalizeAlertStatus` (finalize-first, idempotent) во всех 5 terminal-путях + ALERT_REOPENED listener. Durability-остаток → B-021.

### ✅ B-017 — CSP/SRI test baseline (closed 2026-05-28)

**Shipped**: PR [#66](https://github.com/a-afanasyev/infrasafe/pull/66) (`21c731e`) — обновлены тесты под HTML→`frontend-html/` + self-hosted DOMPurify; CodeQL unanchored-regex fix через `new URL().hostname` parsing.

### ✅ B-015 — Orphan network `site-content_leaflet-network` (closed 2026-05-30)

Удалена; `docker network ls` подтверждает отсутствие. На `0.0.0.0` остались только edge (80/443) + WireGuard (51820).

### ✅ B-014 — healthcheck `localhost`→IPv6 (closed 2026-05-30)

**Shipped**: PR [#65](https://github.com/a-afanasyev/infrasafe/pull/65) (`836e1be`) — `localhost`→`127.0.0.1` в healthcheck'ах `unified.yml`/`Dockerfile.prod`. Frontend задеплоен 05-28; app-side активирован при recreate в security-deploy 05-30 (app healthy).

### ✅ B-010 — Compose vs runtime network drift (`infrasafe-app-1`) (closed 2026-05-28)

**Shipped**: PR [#67](https://github.com/a-afanasyev/infrasafe/pull/67) (`8eeafe7`) `chore(compose): detach app from uk-network, declare infrasafe-network as external`.

**Что сделано**.
- `docker-compose.unified.yml` (app.networks L80-92): убрали `uk-network`, явно добавили `infrasafe-network` (external, ссылка на существующий `infrasafe_infrasafe-network`). Теперь app сидит только в `[infrasafe-network, leaflet-network]` — общая шина с postgres сохраняется, а DNS `postgres` детерминированно резолвится в `infrasafe-postgres-1`.
- `docker-compose.unified.yml` (networks block L312-327): добавлено объявление `infrasafe-network: external: true, name: infrasafe_infrasafe-network` с комментарием о наследии prod.yml топологии.
- `CLAUDE.md` (Network topology paragraph): удалена устаревшая «If you ever need to restore» парентеза; заменена явным запретом re-attach app в uk-network + ссылкой на B-011 alias collision как причину.

**Verified**.
- R3 pre-deploy check: postgres только в `infrasafe_infrasafe-network` — потому external ref в unified.yml корректная.
- Post-merge prod deploy: `git pull` + `docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app`. App пересоздан, остался в `[infrasafe_infrasafe-network, infrasafe_leaflet-network]`, не вернулся в uk-network. healthy через ~60 сек. B-014 healthcheck IPv4 fix активирован одновременно (Dockerfile.prod HEALTHCHECK CMD).
- Public site продолжает отвечать (`/api/health` → 401 ожидаемо для default-deny).

**Связь с B-011**. Теперь app физически не в uk-network → alias collision на `postgres` не может произойти даже теоретически. Но B-011 остаётся как latent risk для будущих add-network операций; полное закрытие через alias rename — отдельный PR с UK координацией.

### ✅ B-005-VOLTAGE + B-005-HEATING — auto-trigger checkers (closed 2026-05-28, deployed 2026-05-28 ~00:33 UTC)

**Shipped**: PR [#59](https://github.com/a-afanasyev/infrasafe/pull/59) `feat(alerts): B-005 — VOLTAGE + HEATING auto-trigger checkers` (commit `03a46b9` в main; на проде с `97d59b7` pull).

**Что сделано**.
- `VOLTAGE_CHECK` + `HEATING_CHECK` events добавлены в `src/events/alertEvents.js` (отличаются от `VERIFY_VOLTAGE`/`VERIFY_HEATING` — те из Sprint 10 для verification cycle).
- `src/services/metricService.js` эмитит после успешного insert метрики:
  - VOLTAGE_CHECK — если любое `electricity_ph1..3` non-null;
  - HEATING_CHECK — если `hot_water_in_temp` non-null.
- `alertService.checkVoltage(controllerId)` с severity-разбиением: 1 фаза out-of-range → WARNING, 2+ фазы или глубокая просадка ([180,260]) → CRITICAL. Severity определяется через `_classifyVoltageSeverity` SQL aggregation за 600s lookback.
- `alertService.checkHeating(controllerId)` с hardcoded CRITICAL severity (для ГВС полу-критичных порогов нет — substation либо работает, либо нет). Threshold `heating.hot_water_in_critical = 40°C` в `thresholds.js`.
- `_checkPersistenceGate` расширен ветками для VOLTAGE_ANOMALY (severity-aware filterClause: WARNING — 4 SQL params, CRITICAL — 6 с deep-band) + HEATING_FAILURE.
- 30 unit-тестов (checkVoltage 8 + checkHeating 7 + persistenceGate extension 6).

**Bug найден во время dev smoke 2026-05-27** (`docker compose -f docker-compose.dev.yml`):
- `bind message supplies 6 parameters, but prepared statement requires 4` — WARNING SQL имел только 4 placeholder'а, но я всегда передавал 6. Fix `2b1b1e4` (param array branches per severity) + 2 regression-теста с явным `gateParams.length` assertion.

**Verified end-to-end (dev compose, prod deploy не triggered yet — нет реальной просадки voltage сегодня)**:
- `CRTL_OL_08` + `electricity_ph1=195` × 3 метрики через 7 сек → VOLTAGE_ANOMALY WARNING alert id=33 ✓
- `CRTL_OL_30` + `hot_water_in_temp=35` × 3 метрики → HEATING_FAILURE CRITICAL alert id=34 ✓
- Gate behaviour видна в логах: `'Alert skipped by persistence gate: HEATING_FAILURE/CRITICAL — only 1 sub-threshold samples'` на 1-м sample → `'Создан алерт HEATING_FAILURE для controller 45, severity: CRITICAL'` на 2-м (span ≥5s).

**Carry-over**: B-005 cooldown invariant (`bump только on success`, см. checkLeak B-005-LEAK) повторён в обоих новых checker'ах + regression-тестах. Critical для persistence-gate behavior — не повторить bug `e15436f`.

---

### ✅ B-002 — Nginx HTML directory mount (closed 2026-05-28, deployed 2026-05-28 ~00:45 UTC)

**Shipped**: PR [#62](https://github.com/a-afanasyev/infrasafe/pull/62) + follow-up [#63](https://github.com/a-afanasyev/infrasafe/pull/63) (location priority fix). Merge commits `97d59b7` + `1320e0a`.

**Что сделано**.
- HTML файлы переехали `git mv` в новую директорию `frontend-html/`:
  - `index.html`, `admin.html`, `about.html`, `contacts.html`, `documentation.html`, `uk-unavailable.html` (root) → `frontend-html/`
  - `public/login.html` → `frontend-html/login.html`
- `docker-compose.unified.yml` (prod) + `docker-compose.dev.yml` (dev): убрали 7 individual file mounts, заменили на `./frontend-html:/srv/frontend-html:ro` (отдельный target, не overlay с `/usr/share/nginx/html` где live css/public/data).
- `nginx.production.conf` + `nginx.dev.conf`: добавили `root /srv/frontend-html;` в `location ~* \.(html|htm)$` блок (locationPriority fix #63 — directive должна быть в EXISTING regex location, не в новом дубликате).
- `Dockerfile.frontend-only` + `Dockerfile.unified`: `COPY frontend-html/ /srv/frontend-html/` — image-baked и bind-mounted layouts консистентны.

**Verified end-to-end на проде 2026-05-28 ~00:55 UTC**:
```
$ curl https://infrasafe.uz/admin.html | head -c 40
<!DOCTYPE html>
<html lang="ru">

$ sed -i '1s|.*|<!-- B-002 prod inode test sentinel -->|' frontend-html/admin.html
# (без docker restart, без compose recreate)

$ curl https://infrasafe.uz/admin.html | head -c 40
<!-- B-002 prod inode test sentinel -->
```

Inode-pinning ушёл — `git pull` обновляет HTML мгновенно.

**Подводный камень обнаружен после deploy** (см. B-012):
- `nginx.production.conf` сам всё ещё mounted как одиночный файл → имеет ту же inode-trap. После моего fix-PR `git pull && nginx -s reload` НЕ подхватили новый config; пришлось делать `--force-recreate nginx`. Отдельный backlog item B-012.

---

### ✅ B-001 — Admin-UI «Открыть в УК» link (closed 2026-05-28, deployed 2026-05-28 ~00:40 UTC)

**Shipped**: PR [#60](https://github.com/a-afanasyev/infrasafe/pull/60) — `feat(admin-ui): B-001 — «Открыть в УК» deep-link on alerts page`. Merge commit `0ff6aea`.

**Что сделано**.
- Backend: `alertService.getActiveAlerts` теперь делает `LEFT JOIN alert_request_map` + `json_agg(json_build_object('uk_request_number', 'building_external_id', 'status'))` + `COALESCE(... '[]'::json)`. Один SQL вместо N+1 lazy fetches.
- Migration 030 (`uk_request_url_template` config seed). Default template: `${uk_frontend_url}/dashboard?request=${uk_request_number}`.
- Frontend (`public/admin.js`): третья action button «Открыть в УК» в alerts table — показывается только когда `uk_requests.length > 0` + `uk_frontend_url` задан. `buildUkRequestUrl` substitutes template. Single ticket → `window.open` new tab; multiple (mass outage) → mini popover с N линками.
- `loadAlerts` eagerly pre-loads integration config, чтобы кнопка работала даже если оператор не открывал «Интеграция УК» tab.

**UK contract** (закреплён 2026-05-27 от UK team):
- URL: `${uk_frontend_url}/dashboard?request=${uk_request_number}` (REST-style, не query).
- UK side добавит `useSearchParams` в `KanbanPage` для auto-open модалки — до тех пор link ведёт на `/dashboard` без открытой modal (acceptable).

**Bugs пойманы dev smoke 2026-05-27**:
- `integration_config` schema (key, value, updated_at) — нет колонки `description` (моя migration предполагала её). Fix `84d5754`.
- `ia.updated_at` doesn't exist в `infrastructure_alerts` — мой explicit SELECT list имел эту колонку. Fix `5882d94`: вернул к `SELECT ia.*` (Postgres допускает с GROUP BY ia.alert_id через functional-dependency rule).

**Verified end-to-end (Playwright dev smoke 2026-05-27)**:
- Login admin + 2FA setup → admin.html → alerts tab → alert 35 с ARM mapping показал кнопку, остальные алерты — нет.
- Click → `window.open` captured с `https://infrasafe.uz/uk/dashboard?request=260527-001`, `_blank`, `noopener,noreferrer`.

**Prod config 2026-05-28**: `uk_frontend_url=https://infrasafe.uz/uk` + `uk_request_url_template=${uk_frontend_url}/dashboard?request=${uk_request_number}` — оба set.

---

### ✅ PR #61 — Dockerfile postinstall fix (closed 2026-05-27)

**Shipped**: PR [#61](https://github.com/a-afanasyev/infrasafe/pull/61) — `fix(docker): unbreak app builds — postinstall now skipped at install time`. Merge `fffb7fc`.

**Что сделано**.
- `Dockerfile.dev` + `Dockerfile.unified`: `RUN npm install --ignore-scripts` (postinstall `npm run build:frontend` падал т.к. `build/` + `public/` ещё не скопированы в layer).
- `Dockerfile.unified` дополнительно: bump `node:18-alpine` → `node:20-alpine` (CLAUDE.md requires Node 20+); `as`→`AS` casing.
- `docker-compose.dev.yml`: defaults `MV_REFRESH_ENABLED=false`, `ALERT_VERIFICATION_ENABLED=false`, `UK_USE_WEBHOOK_SENDER=false` (dev schema не имеет prod функций; Sprint 10 worker dormant; не дёргать реальный UK webhook из dev).

**Verified**: `docker compose -f docker-compose.dev.yml up -d --build` — все три healthy; API/frontend/proxy работают.

---

### ✅ B-005-LEAK — LEAK auto-trigger (closed 2026-05-26)

**Shipped**: commits `cb31e71` (initial) + `e15436f` (cooldown bugfix). Live на проде 2026-05-26 ~03:30 МСК.

**Что сделано**:
- `LEAK_CHECK` event добавлен в `src/events/alertEvents.js`
- `metricService.createMetric` эмитит `LEAK_CHECK` после успешного insert'а метрики с `leak_sensor=true`
- `alertService.checkLeak(controllerId)` — listener: cooldown + in-memory dedup + delegate в `createAlert`, который дальше через существующий persistence-gate (≥2 samples за 10 мин, span ≥10 сек для CRITICAL)
- Severity hardcoded CRITICAL в v1 (реальная протечка по определению критическая)

**Verified end-to-end в проде** (двумя независимыми run'ами):

1. **2026-05-24 22:31 UTC — alert 25 → ticket `260524-005`** — initial smoke сразу после deploy. 4 telemetry сэмпла id=6,7,8,9 для controller_id=1. End-to-end ~5 сек до УК HTTP 202.
   - Также подтверждена downstream lifecycle через Sprint 10: УК выпустила `Отменена` → auto-resolve → verification chain `fe83b418` sequence→2 → markPassed (no reopen в window). Все state transitions автономно, без ручного вмешательства.

2. **2026-05-26 10:54 UTC — alert 26 → ticket `260526-001`** — repeat verification по запросу УК после расхождения (они не видели inbound 24h+, что было ожидаемо: real-world telemetry с `leak_sensor=true` не поступала с момента 22:31 UTC 24 мая). 3 telemetry сэмпла с интервалом 7s. Persistence-gate сработал чётко — первые 2 sample'а отсечены ("only 1 sample" + "condition 8s, need 10s"), 3-й прошёл (span 15s). End-to-end от 3-го sample'а до УК HTTP 202: ~0.3 сек; до их `request.created` callback: ~6 сек. УК подтвердили payload byte-for-byte match с их `webhook_inbox`.

**Lesson learned / cooldown bugfix**:
В первой ревизии `lastChecks.set(checkKey, now)` стоял безусловно ПОСЛЕ `createAlert` — это значит persistence-gate denial (вернулся null потому что недостаточно samples в окне) тут же ставил 15-мин cooldown, маскируя дальнейшие telemetry. Фикс: bump cooldown ТОЛЬКО на success. Sensor-spam protection остаётся через in-memory dedup + DB partial unique index.

Этот же паттерн нужно перенести в `checkVoltage` / `checkHeating` когда будем делать B-005 (VOLTAGE + HEATING).


---

## Sprint 11 — docs/tooling closures (2026-05-30, rev 2)

### B-013 — DB-role documentation correctness — CLOSED
Corrected the false "migration 017 *renamed* the runtime role to `infrasafe_app`" story.
Reality: `infrasafe_app` = SUPERUSER bootstrap (created from `POSTGRES_USER` at container init);
`infrasafe_runtime` = non-super LOGIN role the app connects as (`DB_USER`), **created** — not renamed —
by `017_runtime_role.sql`; the `postgres` role is absent on prod.
- `CLAUDE.md` — already accurate on main (DB-roles bullet, verified).
- `docker-compose.prod.yml` — postgres healthcheck comment rewritten (was "017 renamed … to infrasafe_app").
- `docs/audit/2026-05-30-prod-ops-runbook.md` §3b — **real bug fixed**: DB-password rotation said
  `ALTER USER infrasafe_app`; it must target `infrasafe_runtime` (the app credential / `DB_PASSWORD`),
  which is what the live 2026-05-30 rotation actually did. Clarified it is distinct from
  `POSTGRES_PASSWORD` (the bootstrap-superuser secret).

### B-016 — compose drift-check tooling — CLOSED
`scripts/compose-drift-check.sh` — read-only deploy-host diagnostic.
- **Check A (network drift):** per declared service, DECLARED vs RUNTIME compared on **real** Docker
  network names (declared keys resolved via top-level `networks.<key>.name`), so logical
  (`leaflet-network`) vs runtime (`infrasafe_leaflet-network`) cannot false-positive. Container→service
  mapping strictly via the `com.docker.compose.service` label. Running-but-undeclared = informational.
- **Check B (publish drift): HOST-WIDE** — scans every running container (no project filter), so it
  covers the separate UK compose stack. Flags any `0.0.0.0`/`[::]` publish whose host port ∉
  `ALLOWED_PUBLIC_PORTS` (default `80 443 51820`). This is the class P-PENTEST-4 fell into; the host-wide
  scope is the standing guard against recurrence in **any** stack. (The script did not exist when
  P-PENTEST-4 was found — UK closed those ports manually; this is the forward guard, not a detection
  credit.)
- **Companion fix:** `docker-compose.unified.yml` postgres `networks:` aligned `leaflet-network` →
  `infrasafe-network` to match prod runtime (declaration-only; removes a real Check-A drift; no recreate
  needed since runtime already matches).
- Runbook §0 / pre-deploy bullet added.

### B-012 — nginx config single-file mount (inode-trap) — CLOSED (2026-05-31)
`nginx.production.conf` + `nginx.dev.conf` were full top-level configs mounted as single files
(`/etc/nginx/nginx.conf`) → after `git pull`, `nginx -s reload` kept the inode captured at container start,
so config edits needed a `--force-recreate` (same class as B-002 for HTML).
**Fix:** `git mv` both into `nginx-config/`; mount the **directory** (`./nginx-config:/etc/nginx/custom:ro`)
and run `nginx -c /etc/nginx/custom/<conf>` with a matching `nginx -t -c …` healthcheck.
- `docker-compose.unified.yml` (nginx) + `docker-compose.dev.yml` (frontend): directory mount + `command` + healthcheck.
- `Dockerfile.frontend.dev`: bakes `nginx-config/nginx.dev.conf` at the same `-c` path (image self-contained).
- Tests repointed: `p1-3-csp-sri.test.js`, `xss-protection.test.js`, `cspHeaders.e2e.test.js` comment.
- `Dockerfile.unified`/`Dockerfile.frontend-only` bake a different file (`nginx.conf`) — untouched.
**Verified:** `nginx -t -c …/nginx.dev.conf` on the dev network → "syntax is ok / test is successful";
prod config parses (only missing-cert off-prod, expected); full suite 2232/2232 green; lint clean.
**Deploy:** one final `--force-recreate nginx` (mount target file→dir) — see runbook B-012 note; after that
config changes ride `git pull` + `nginx -s reload`.

### B-023 — POSTGRES_PASSWORD env_file-vs-interpolation footgun — CLOSED (2026-05-31, decl) + 1 operator step
`docker-compose.unified.yml` postgres carried `environment: - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
resolved by **compose interpolation from shell / root `.env`** (NOT `env_file`) → "variable not set,
defaulting to a blank string" warning, and the empty `environment:` value could override the correct
env_file value → postgres bootstraps blank.
**Fix:** removed the `${POSTGRES_PASSWORD}` line; password now flows from `env_file: .env.prod`.
`POSTGRES_USER=infrasafe_app` / `POSTGRES_DB` kept as **literals** (shield against a stale
`POSTGRES_USER=postgres` in `.env.prod`; literals raise no warning). `docker compose config` now renders
with **zero** warnings.
**Residual operator step — DONE 2026-06-01:** removed the dead `POSTGRES_USER=postgres` line from prod
`.env.prod` (backup `.env.prod.bak-b023-20260601`; `grep -c` 1→0). No postgres recreate needed — the line
was already shadowed by the literal `POSTGRES_USER=infrasafe_app` in compose, and `docker compose config`
still resolves to `infrasafe_app`. B-023 fully closed.
