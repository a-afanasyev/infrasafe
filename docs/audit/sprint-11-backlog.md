# Sprint 11 Backlog

> Carry-overs из Sprint 10, накопленные мелкие проблемы, UX/tech-debt пункты.
> Каждый пункт: **что** + **почему** + **trigger to ship** (когда становится приоритетным).
> Создан 2026-05-25 после закрытия Sprint 10 + INT-120.
> Обновлён 2026-05-28 после deploy 4 PR'ов на прод (см. P0 — production infra drift).
> Обновлён 2026-05-30: закрыты B-014/B-015/B-017/B-020 + security audit (#69) + ротации секретов + P-PENTEST-4; перепроверена актуальность открытых пунктов (блок ниже).

---

## Статус на 2026-05-30 — обновление + анализ актуальности

### Закрыто с прошлого обновления (перенесено в Closed-секцию)
| Пункт | PR / способ | Статус |
|---|---|---|
| B-014 — healthcheck `localhost`→IPv6 | #65 (`836e1be`) + app-side активирован в deploy 05-30 | ✅ |
| B-017 — CSP/SRI test baseline | #66 (`21c731e`) | ✅ |
| B-020 — `resolved_verifying` orphan | #68 (`a836fdc`) + migration 031, deployed 05-29 | ✅ |
| B-015 — orphan network `site-content` | удалена (подтверждено `docker network ls`) | ✅ |
| **Security audit** — SEC-1..12, P-PENTEST-1/2/3 | #69 (`3c23225`), deployed 05-30, 2232 теста + CodeQL | ✅ |
| **SEC-3 ротации** — JWT / DB / UK-secret / TOTP + admin-пароль | 05-30, проверено на проде | ✅ |
| **P-PENTEST-4** — UK-порты на `0.0.0.0` | закрыто UK (loopback + удаление), проверено снаружи | ✅ |

### Анализ актуальности открытых пунктов (сверено с прод/кодом 2026-05-30)
| Пункт | Проверка | Вердикт |
|---|---|---|
| **B-011** alias collision | app теперь только в `infrasafe`+`leaflet` (B-010) | **актуален, но latent** — рванёт лишь при re-attach app в `uk-network`; обычный путь безопасен |
| **B-012** nginx single-file mount | `inspect`: `nginx.production.conf -> /etc/nginx/nginx.conf` всё ещё одиночный файл | **актуален** (recreate при каждой правке конфига) |
| **B-013** DB_USER drift | `pg_roles`: `infrasafe_app`=**superuser**+login, `infrasafe_runtime`=login non-super, `postgres`=**НЕТ** | **переосмыслен ↓** — app корректно работает под non-super `infrasafe_runtime`; рекомендация «перейти на `infrasafe_app`» **неверна** (тот superuser — least-privilege нарушение). Остаётся косметика: убрать мёртвый `POSTGRES_USER=postgres` из `.env.prod` + поправить role-заметку в CLAUDE.md |
| **B-003** Redis | SEC-6 (#69) добавил size-cap на обе in-memory Map | **актуален частично** — memory-growth снят; multi-replica bypass (SEC-8) остаётся; single-replica → триггер не наступил |
| **B-004** admin.js split | `wc -l`: admin.js **3826** (+~400 от B-001), script.js **2384** | **актуален**, растёт; триггер 4500 LoC ещё не достигнут |
| **B-016** drift-script | после P-PENTEST-4 | **актуален + расширить**: добавить проверку «нет лишних `0.0.0.0`-публикаций docker» |
| B-021 / B-006 / B-007 / B-008 / B-009 | — | без изменений |

### Рекомендация по следующему спринту
Быстрый пакет: **B-013** (убрать dead `POSTGRES_USER`, ~30мин) + **B-012** (nginx directory-mount, ~2ч) + **B-016** (drift-script с 0.0.0.0-проверкой, ~3ч). Крупное (B-003 / B-004 / B-008) — отдельным спринтом по триггеру.

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

**Известный косметический остаток (не баг):** clean-run всё ещё делает root-retry (WARN), т.к. esbuild
`rmSync(public/dist)` требует write на родителе `/app/public` (owned by `node` uid1000 ≠ контейнерный
`nodejs` uid1001). Функционально безвредно (root-retry → exit 0, все бандлы verified), trap-строки
убраны (PR #80/#81). Полностью убрать WARN можно chown'ом родителя или esbuild per-file cleanup —
вынесено в Future (low).

**Future (low, отдельно):** (a) re-architecture — раздавать dist из образа (убрать host-mount), оценить
против B-012; (b) tracked deploy-entrypoint в `scripts/` вместо host-local `deploy.sh`; (c) bundle
byte-compare в tracked smoke-шаг.

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

### B-024 — Map layer counters show `(0)` until the layer is toggled — PARTIAL (2026-05-31)

> **Status:** фактор 1 (Здания, public) **исправлен** 2026-05-31; фактор 2 (auth-gated слои для anon)
> остаётся OPEN — см. «Остаток» ниже.
>
> **Fix-часть (shipped):** `public/map-layers-control.js` `loadLayerDataSilent` получил недостающий
> `case "🏢 Здания"` → `loadBuildings`. Здания грузятся из **публичного** `/buildings-metrics`, поэтому
> счётчик `🏢 Здания (N)` теперь заполняется при инициализации карты для всех (вкл. anon), а не только
> после ручного toggle. `loadBuildings` делает `clearLayers()` → идемпотентно, double-render нет; маркеры
> на карте по-прежнему рисует `script.js loadData()` (отдельный путь), эта правка трогает только счётчик
> overlay-слоя. Frontend-онли, тестируется в браузере (anon).
>
> **Остаток (OPEN, фактор 2):** auth-gated слои (`⚡ Трансформаторы`, `📊 Контроллеры`, `⚠️ Алерты`, …)
> у анонима остаются `(0)` — их load-fns бьют в эндпоинты, дающие 401 без токена. Это by-design
> (default-deny), но UI показывает фальшивый `0`. Варианты ниже (скрывать `(N)` при 401 / публичные
> count-агрегаты) — брать на map-UX проходе или с `feature/frontend-redesign` (B-008).

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

## Closed / removed

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
**Residual operator step (NOT done here — needs prod `.env.prod` edit + postgres-recreate window):** remove
the dead `POSTGRES_USER=postgres` line from `.env.prod`; the declaration change itself only applies on a
postgres recreate. Documented in the runbook (B-023 note) — do not recreate postgres just for this.
