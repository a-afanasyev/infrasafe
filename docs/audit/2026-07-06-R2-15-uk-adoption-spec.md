# R2-15 — спека для UK-команды: CI→GHCR + deploy-by-pull + staging

**Статус:** предложение для UK-команды. **Автор:** InfraSafe (по образцу нашего R2-15).
**Действие от UK:** внедрить у себя в UK-репозитории. **Действие от InfraSafe:** нет —
наш edge и compose не меняются.

Дата: 2026-07-06. Референс-реализация: `update-production.sh`, `.github/workflows/ci.yml`
(job `docker-image`), `docker-compose.staging.yml`, `docs/staging-vm-setup.md` в репо InfraSafe.

---

## 0. Зачем это UK-команде

InfraSafe перевёл свой прод-деплой с «сборки образа на прод-хосте» на «CI собирает +
пушит образ в GHCR, прод его только `docker pull`». Причины ровно те же, что актуальны и
для UK-стека:

1. **Host-build съедает диск и роняет прод (наш OPS-001).** Сборка на едином прод-хосте
   копит build-cache (у нас ~3 ГБ, без авто-prune) → деплой упёрся в 100 % диска на шаге
   извлечения статики, ERR-trap rollback тоже не смог записать в `.git/index.lock`, апп
   ушёл в crash-loop. У UK-хоста тот же класс риска, если их образы собираются на месте.
2. **Нет provenance.** Нельзя доказать, что в проде крутится ровно то, что прошло CI.
   С GHCR прод тянет иммутабельный `sha-<commit>`, собранный и проверенный в CI.
3. **Нет staging-паритета.** Каждое изменение прилетает сразу в прод. Общий GHCR-образ
   позволяет staging-окружению тянуть тот же `sha`, что потом промоутится в прод.

Способ доставки образа **ортогонален рантайм-контракту** (§1): пока запущенные контейнеры
сохраняют те же имена, порты, точки монтирования роутов, сеть и HMAC-поведение — наш edge
`/uk/*` работает без изменений, чем бы образ ни доставлялся.

---

## 1. РАНТАЙМ-КОНТРАКТ (инвариант — это защищает edge InfraSafe)

Наш edge (`infrasafe-nginx-1`, в сети `uk-network`) проксирует `/uk/*` на ваши контейнеры
по **docker-DNS-именам** (отложенный per-request resolver, не at-parse). Смена механизма
доставки образа **не должна менять ничего из перечисленного** — иначе `/uk/*` отвалится.

Источник истины на нашей стороне — `nginx-config/nginx.production.conf`:

| Что | Значение (не менять) | Где в нашем конфиге |
|---|---|---|
| REST-бэкенд | контейнер `uk-management-api`, порт `8080`, роуты под `/api/...` | `:277`, `:279` (rewrite `/uk/api/X`→`/api/X`) |
| WebSocket (основной) | `uk-management-api:8080`, каналы под `/ws/v2/...` | `:296`, `:297` |
| Access-control REST | контейнер `uk-access-api`, порт `8080`, роуты `/api/v1/access/...` | `:327`, `:329` |
| Access-control WS | `uk-access-api:8080`, `/ws/v1/access/...` | `:356`, `:358` |
| SPA/фронт | контейнер `uk-frontend`, порт `80` | `:376`, `:377` |
| Сеть | `uk-network` (external), в ней же наш `infrasafe-nginx-1` | — |
| БД | `uk-postgres` (внутри вашего стека; alias `postgres` в `uk-network`) | внутренний для вас |

**Инвариант для контракта:**
1. **Имена контейнеров и порты стабильны:** `uk-management-api:8080`, `uk-access-api:8080`,
   `uk-frontend:80`. Если pull-модель заставит вас переименовать сервис/контейнер —
   сохраните прежние `container_name`/сетевые alias'ы, либо пред-уведомьте нас, чтобы мы
   поправили edge в отдельном согласованном релизе.
2. **Точки монтирования роутов не двигаются:** FastAPI отдаёт под `/api/`, WS под `/ws/v2/`
   и `/ws/v1/access/`, access-REST под `/api/v1/access/`. Edge срезает префикс `/uk` и
   ждёт именно эти пути.
3. **Членство в `uk-network` сохраняется** — иначе docker-DNS не резолвит имена.
4. **⚠️ Не переименовывайте generic-alias'ы (`postgres`/`redis`/`app`) обратно на shared —
   это вернёт наш B-011** (alias-collision: `uk-postgres` имеет alias `postgres`, и чужой
   контейнер мог зарезолвиться в вашу БД с другим паролем → auth-fail loop). Ваш `postgres`
   должен оставаться внутри `uk-network` и не конфликтовать с нашим.
5. **HMAC обоих направлений не затрагивается доставкой образа:** те же секреты
   (`INFRASAFE_WEBHOOK_SECRET` — вы подписываете, мы проверяем входящее; `UK_WEBHOOK_SECRET`
   — мы подписываем, вы проверяете исходящее). Это ENV-контракт, не связанный с CI/GHCR.
6. **SEC-22 prefix-allowlist:** новые публичные `/uk/api/...`-префиксы у вас по-прежнему
   требуют пред-уведомления — их надо добавить в наш `map $uk_api_allowed`, иначе edge
   вернёт 404 (см. memory `uk-edge-allowlist`). Pull-модель этого не меняет, но помните.

Пока §1 держится, всё ниже — чисто ваша внутренняя механика деплоя.

---

## 2. PHASE 1 — CI собирает + пушит, деплой тянет (по образцу нашего)

Ваш стек — несколько образов (`uk-management-api`, `uk-access-api`, `uk-frontend`, плюс
любые ваши воркеры). Применяйте паттерн к **каждому собираемому** образу; stock-образы
(`postgres`, `redis`) уже pull-only — их не трогаем.

### 2.1 Разовые пререквизиты
- GHCR-пакеты `ghcr.io/<uk-org>/uk-management-api` (+ `-access-api`, `-frontend`) создаются
  на первом push, наследуют видимость репо. Держите **private**.
- На **прод-хосте UK** — токен с правом `read:packages`, вне дерева репо (`~/.uk/ghcr-token`,
  chmod 600), разово: `docker login ghcr.io -u <uk-org> --password-stdin < ~/.uk/ghcr-token`.
- В CI push идёт встроенным `GITHUB_TOKEN` — нужен job-scope `permissions: packages: write`.

### 2.2 CI — пушить именно проверенный образ (не пересобирать)
На каждый merge в основную ветку, **после** ваших тестов/проверок, тем же образом, что
прошёл проверки:
```yaml
permissions: { contents: read, packages: write }
# ...
- name: Login to GHCR
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  uses: docker/login-action@v3
  with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
- name: Tag + push
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  run: |
    set -e
    for svc in uk-management-api uk-access-api uk-frontend; do
      IMG=ghcr.io/<uk-org>/$svc
      docker tag $svc:latest "$IMG:sha-${{ github.sha }}"   # тот же image ID, что тестировали
      docker tag $svc:latest "$IMG:main"
      docker push "$IMG:sha-${{ github.sha }}"
      docker push "$IMG:main"
    done
```
- **Пушьте ровно тот образ, что прошёл проверки** — через `docker tag`+`push`, а НЕ через
  `build-push-action` (иначе пересоберёте другой образ, чем валидировали).
- **PR билдят+проверяют, но НЕ пушат** (гейт `github.event_name == 'push' && ref == main`).

### 2.3 Deploy — pull как ПРЕФЛАЙТ до любых необратимых шагов
Ключевые свойства, которые мы выстрадали (повторите их — иначе грабли):

1. **Тег = full 40-char SHA с обеих сторон.** CI пушит `sha-<github.sha>` (полный).
   Деплой резолвит цель `git rev-parse --verify "$TARGET^{commit}"` (тоже полный) и тянет
   `sha-$TARGET`. Короткий/`type=sha`-тег → рассинхрон → каждый деплой падает на pull.
2. **Retag к СТАБИЛЬНОМУ локальному тегу.** Тянете `ghcr.io/...:sha-<...>`, затем локально
   `docker tag` → `uk-management-api:latest` (ваш прежний стабильный тег). Всё ниже по
   потоку (compose `image:`, healthcheck, **rollback-trap**) резолвит один локальный тег и
   **не меняется**. Не подставляйте `sha`-ref прямо в `image:` — иначе rollback-trap
   пересоздаст сломанный ref. У нас это load-bearing решение (наименьший blast radius).
3. **Pull — ПРЕФЛАЙТ до необратимого.** Сначала `docker pull` всех целевых образов; если
   любого нет в GHCR (CI не закончил) — abort ДО миграций/переключения, БД и контейнеры не
   тронуты. `--no-build` на пересоздании гарантирует отсутствие host-сборки.
4. **`APP_IMAGE_SOURCE=build` как escape-hatch** (break-glass): если GHCR/CI недоступны —
   собрать на хосте (с `builder prune -af` + проверкой `df -h`). Помните: build-mode НЕ
   pre-migrate-safe (собирает merged-worktree ПОСЛЕ применения схемы).
5. **Bounded retention, только success-path, никогда `prune --all`** (снёс бы rollback-образ):
   `docker image prune -f` (dangling) + удалить всё, кроме новейших 3 тегов на образ.
6. **Промоушен staging→prod:** прод тянет пиннутый `DEPLOY_TARGET_COMMIT=<sha, проверенный
   на staging>`, а не «tip ветки» — иначе прод уедет на новый merge, который staging не
   валидировал. Гварды: target — потомок HEAD (ff-only) И предок tip'а ветки (не unmerged).

Скелет — см. наш `update-production.sh:117-243` (case-валидация источника, префлайт-pull,
retag, `--no-build`, retention). Портируется почти дословно; на каждый ваш образ — свой
`PULL_REF` + retag.

7. **Если у вас есть host-run migration-runner без node на хосте** (как наш AUD-002): он
   резолвит node-образ через `docker compose images -q <svc>` — а это ПУСТО на свежем хосте
   без контейнера. Пиньте `MIGRATE_NODE_IMAGE=$PULL_REF` (уже потянутым образом), иначе
   `migrate status/up` не стартует на первом bootstrap'е.

### 2.4 Первый cutover (тонкость порядка)
Скрипт деплоя выполняется из **до-merge** чекаута, и `git merge` внутри него ставит новый
pull-скрипт → pull-режим оживает на **следующем** деплое:
1. Влить 2.2–2.3 в main; merge-run пушит первый `sha-<...>` + `main`. **Убедиться, что
   пакет появился в GHCR, прежде чем трогать прод.**
2. Прод: разово `docker login ghcr.io`; dry-run `docker pull ...:main`.
3. **Deploy #1 (переходный):** старый скрипт последний раз собирает на хосте (сначала
   `docker builder prune -af` + `df -h`), merge ставит новый скрипт.
4. **Deploy #2:** новый скрипт тянет `sha-<target>`, retag, переключение. Дальше — pull-режим.

---

## 3. PHASE 2 — staging-зеркало UK

Цель: `staging.<uk-domain>` тянет тот же GHCR-образ и гоняет полный UK-стек до прода.
Механика — как в нашем `docs/staging-vm-setup.md` + `docker-compose.staging.yml`:

- Отдельная VM (2 vCPU / 2–4G / ≥20G), DNS `A`-запись, свой certbot-серт, тот же
  `read:packages` GHCR-login.
- **Тот же retag-к-`latest` + exact-`sha` pull**, что в §2.3 — НЕ деплоить moving-тег
  `:main`; резолвить target-commit → тянуть `sha-<full>`. `:main` оставить только для
  ручного dry-run.
- **Compose-override** (не форк базового compose): отдельный `docker-compose.staging.yml`,
  накатываемый `-f base -f staging`, переопределяющий edge (`server_name`, серты,
  healthcheck на staging-конфиг), сети (external→bridge, чтобы свежая VM создавала их сама),
  и `env_file` → `.env.staging` последним (перебивает случайный `.env.prod`). У нас проверено
  `docker compose config`, что list-поля мёржатся как ожидалось (same-target volume ЗАМЕНЯЕТ
  source, different-target ДОБАВЛЯЕТ; top-level `networks.external:false` ЗАМЕНЯЕТ base).
- **Свежая staging-БД:** если ваш bootstrap-snapshot не несёт migration-манифеста —
  засеивать через ваш init-путь (аналог нашего `database/init/` + baseline), не через
  legacy-snapshot, иначе runner fail-close'ит.
- **Deploy-скрипт параметризовать `DEPLOY_ENV=prod|staging`** (выбор `.env.<env>`, набора
  `-f`, health-URL, base-URL для verify, `COMPOSE_PROJECT_NAME`); прод-путь — байт-идентичен
  дефолту.

---

## 4. Опционально на будущее: UK-стек в staging InfraSafe (полный prod-parity)

Если InfraSafe захочет, чтобы **наш** staging тоже гонял `/uk/*` (сейчас на staging
`uk-network` — пустой локальный bridge, `/uk/*` → 502, UK-интеграция выключена), нам от вас
понадобится:
1. Ваши образы, доступные для pull из реестра, к которому у нашего staging есть доступ
   (тот же GHCR-пакет, `read:packages`, или ваш публичный тег).
2. Compose-фрагмент ваших сервисов (`uk-management-api`, `uk-access-api`, `uk-frontend`,
   `uk-postgres`) с сохранением §1-инварианта, чтобы мы вписали его в наш
   `docker-compose.staging.yml` + edge.

Это отдельная договорённость, не входит в текущий scope — просто фиксируем зависимость.

---

## 5. Кто что делает

| | InfraSafe | UK-команда |
|---|---|---|
| Наш edge `/uk/*` | **не меняем** (при соблюдении §1) | — |
| CI→GHCR ваших образов | — | внедряете (§2.2) |
| Pull-деплой + retag + retention | — | внедряете (§2.3) |
| UK staging VM | — | поднимаете (§3) |
| Изменение имён/портов/роутов UK | пред-уведомить нас → правим edge отдельным релизом | пред-уведомляете |
| Новый публичный `/uk/api/`-префикс | добавляем в SEC-22 allowlist | пред-уведомляете |

Вопросы по контракту/edge — к InfraSafe. Референс-код всех паттернов выше — в нашем репо
(файлы перечислены в шапке).
