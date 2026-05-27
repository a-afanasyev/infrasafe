# Sprint 11 Backlog

> Carry-overs из Sprint 10, накопленные мелкие проблемы, UX/tech-debt пункты.
> Каждый пункт: **что** + **почему** + **trigger to ship** (когда становится приоритетным).
> Создан 2026-05-25 после закрытия Sprint 10 + INT-120.
> Обновлён 2026-05-28 после deploy 4 PR'ов на прод (см. P0 — production infra drift).

---

## P0 — Production infra drift (нашли при deploy 2026-05-28)

> Во время раскатки PR #59 / #60 / #61 / #62 / #63 на прод (`95.46.96.105`) вскрылись пять явных drift'ов между декларированным compose-стеком и реальным состоянием контейнеров. Каждый из них стоил debug-петли (auth-fail → migration replay → network диагностика). Чинить пакетно до следующего серьёзного деплоя.

### B-010 — Compose vs runtime network drift (`infrasafe-app-1`)

**Что**. Контейнер `infrasafe-app-1` после `docker compose up -d --build --no-deps app` оказался прикреплён к `infrasafe_leaflet-network` + **`uk-network`**, хотя в `docker-compose.unified.yml` он декларирован только в `infrasafe-network` + `leaflet-network`. Сеть `infrasafe_infrasafe-network` (где живёт `infrasafe-postgres-1`) была недоступна — DNS lookup `postgres` уходил через uk-network к `uk-postgres`.

**Почему**. Compose recreate сохраняет существующие network attachments если они были добавлены руками через `docker network connect`. Никто не помнит когда и зачем app попал в uk-network — но дeploy сегодня показал что compose не отрегулирован.

**Fix во время deploy** (ad-hoc):
```
docker network connect infrasafe_infrasafe-network infrasafe-app-1
docker network disconnect uk-network infrasafe-app-1
docker restart infrasafe-app-1
```

**Trigger**. До следующего PR который трогает compose / network. Иначе ad-hoc fix потеряется при следующем recreate.

**Estimate**. ~1 час: явно прописать `infrasafe-network: {}` для app в compose + написать `--remove-orphans`-like assertion в deploy runbook.

### B-011 — DNS alias collisions между `infrasafe_*` и `uk-network`

**Что**. Несколько алиасов резолвятся к разным контейнерам в зависимости от network attach order:

| Alias | infrasafe_leaflet-network | uk-network | infrasafe_infrasafe-network |
|---|---|---|---|
| `postgres` | — | `uk-postgres` ⚠ | `infrasafe-postgres-1` ✓ |
| `redis` | `infrasafe-redis-1` | `uk-redis` ⚠ | — |
| `frontend` | `infrasafe-frontend-1` | `uk-frontend` ⚠ | — |
| `app` | `infrasafe-app-1` ✓ | `uk-management-bot` ⚠ | — |

Контейнер сидящий в обеих сетях резолвит alias через первый DNS-hit — порядок зависит от docker DNS server и attach sequence. B-010 — именно этот сценарий: app получил `postgres` из uk-network.

**Почему**. Архитектурная утечка: имена сервисов между двумя независимыми compose-проектами collide. Любая будущая ошибка attach → silent routing в чужую DB.

**Fix план**.
- В `uk-management` compose уйти от родовых alias'ов в `uk-network`: использовать `uk-postgres`/`uk-redis`/`uk-frontend`/`uk-app` без короткого alias.
- На нашей стороне аналогично — `infrasafe-postgres` без alias `postgres`, etc. (или оставить, но удостовериться что app только в infrasafe-network).
- Cross-project communication только через nginx public edge (уже так и есть для InfraSafe→UK).

**Trigger**. Перед любым изменением UK compose / network setup. Сейчас работает но fragile — пересечь сети ещё раз = тот же auth-fail сценарий.

**Estimate**. ~3-4 часа: координация с UK side (alias rename ломает их internal references) + smoke на staging.

### B-012 — `nginx.production.conf` single-file bind-mount — та же inode-trap что HTML до B-002

**Что**. `docker-compose.unified.yml` маунтит `./nginx.production.conf:/etc/nginx/nginx.conf:ro` как одиночный файл. После `git pull` (новый inode на хосте) `nginx -s reload` использует старый pinned inode → меняешь config, изменения не подхватываются до `--force-recreate`.

Случилось сегодня: после моего фикса location-приоритета (#63) `git pull` + `nginx -s reload` не сменили serving поведение — пришлось делать полный `up -d --force-recreate --no-deps nginx`.

**Почему**. Симметрично с B-002 проблемой для HTML файлов. Решается тем же приёмом — directory mount.

**Fix план**.
- Создать `nginx-config/` директорию в repo, переехать `nginx.production.conf` и `nginx.dev.conf` туда (или хотя бы prod).
- Маунт `./nginx-config:/etc/nginx/conf.d:ro` + рефакторинг конфига чтобы `include conf.d/*.conf` подцеплял.
- Или проще — маунт parent directory одним файлом в `/etc/nginx/conf.d/`.

**Trigger**. Перед следующим nginx config change (CSP, location, upstream правки). Иначе каждый раз будет recreate.

**Estimate**. ~2 часа: рефакторинг + verify smoke.

### B-013 — `.env.prod` DB_USER drift vs migration 017

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

### B-014 — `infrasafe-frontend-1` healthcheck wget vs curl / port mismatch

**Что**. `infrasafe-frontend-1` отображается как **unhealthy** (52+ min). Внутри контейнера `curl -sI http://localhost:8080/health` → 200 OK, но healthcheck (предположительно из Dockerfile HEALTHCHECK) использует `wget` и получает `Connection refused`.

**Почему**. Контейнер функционально работает (public traffic через nginx идёт, статика отдаётся), но docker отмечает unhealthy → потенциально мешает orchestration / auto-restart policies / Prometheus alerts на наш мониторинг.

**Fix план**.
- Проверить `HEALTHCHECK` директиву в `Dockerfile.frontend-only` — заменить wget на curl (curl уже доступен, см. `RUN apk add --no-cache curl`).
- Или поправить compose-level healthcheck чтобы оверрайдил Dockerfile.

**Trigger**. Косметика, но раздражает в `docker ps`. Перед следующим frontend rebuild.

**Estimate**. ~30 минут.

### B-015 — Orphan network `site-content_leaflet-network`

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
- Diff'ит — printа warnings.
- Можно запускать в CI на staging или вручную перед каждым prod deploy.

**Trigger**. После того как B-010/B-011 чистятся — иначе скрипт сразу зашумит ими.

**Estimate**. ~3 часа.

---

## P2 — Tech debt

### B-003 — Rate-limiter и in-memory cache → Redis для multi-replica

**Что**. `src/middleware/rateLimiter.js` и `src/services/cacheService.js` хранят state в памяти процесса. Для горизонтального scale-out (несколько реплик app) нужен общий Redis.

**Почему**. Уже отмечено как known issue в CLAUDE.md «Known Architecture Issues». Sprint 9 outbox + Sprint 10 verification queue уже multi-replica-safe (DB + advisory_lock). Rate-limiter не safe — DDoS / brute-force с обходом одной реплики через round-robin LB.

**Trigger**. Когда появится решение масштабировать app (текущий single-replica setup это не требует).

**Estimate**. ~6-8 часов: Redis Docker service + два модуля переписать на ioredis + tests.

### B-004 — Monolithic `public/admin.js` (~3,429 LoC) + `public/script.js` (~2,335 LoC) split

**Что**. Phase 12B.4 (Sprint 10-era) активировал esbuild bundling, но НЕ разделил entry points. Оба файла остались монолитами с разнородной логикой.

**Почему**. Уже отмечено в CLAUDE.md «Known Architecture Issues». Каждая новая фича добавляет ещё ~50-200 LoC в эти файлы. Дальше будет хуже — рост код-базы линейно повышает время review + onboarding cost.

**Trigger**. Когда `admin.js` перевалит за 4500 LoC ИЛИ когда `feature/frontend-redesign` merge даст естественный повод переписать.

**Estimate**. ~1-2 дня: разделить на ~6-8 feature-scoped модулей, миграция через esbuild multi-entry config.

---

## P3 — UX / observability

### B-006 — Engineering Kanban column в УК

**Что**. UK сейчас рендерит engineer_required-тикеты в обычной board-view рядом с другими категориями, отмечая amber «⚠ Эскалация» плашкой. Если operator wants отдельную Engineering колонку — это отдельный ticket с их стороны.

**Почему**. Не блокер. Текущее решение функционально (category-filter работает, dispatcher видит плашку). Cosmetic UX иmprovement.

**Trigger**. Если оператор УК запросит — отправить ticket в UK side (НЕ наш PR).

**Owner**. UK side, не InfraSafe.

---

## P3 — Sprint 9.X дольки

### B-007 — `integration_log` cosmetic gap в ukOutboxService

**Что**. `ukOutboxService` (drain worker для outbox) сейчас не обновляет integration_log при retry/dead transitions. Только final success/dead landing в логах.

**Почему**. Уже отмечено в Sprint 10 plan «Out of scope». Cosmetic — debug чуть сложнее когда нужно проследить путь конкретного event_id через retries. Не влияет на correctness.

**Trigger**. Первый случай когда нужно дебажить retry-pattern в проде → станет очевидно что лог разорван.

**Estimate**. ~1-2 часа: добавить `IntegrationLog.upsert` calls в `_drainOne` retry/dead paths.

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

## Closed / removed

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

