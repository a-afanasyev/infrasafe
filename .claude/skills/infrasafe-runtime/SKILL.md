---
name: infrasafe-runtime
description: Устройство рантайма InfraSafe — состав docker-сервисов (nginx, app, postgres, redis), боевой docker-compose.unified.yml, роли БД infrasafe_app против infrasafe_runtime, неизменяемый образ приложения (SEC-14/15) и доставка public/dist извлечением из образа. Вызывать при правке compose-файлов, при разборе «почему изменение бэкенда не подхватилось», при вопросах про DB_USER и права, про redis-пароль и про то, что на выкатке горячее, а что требует пересборки образа.
---

# Рантайм и боевая сборка

Перенесено из корневого `CLAUDE.md` (2026-08-13). Сама процедура выкатки — в
`update-production.sh`; здесь то, что из скрипта не читается.

Профиль площадки задаётся `DEPLOY_ENV` или файлом `.deploy-env` на хосте
(`/opt/infrasafe/.deploy-env` = `prod`, `/home/infrasafe/infrasafe/.deploy-env` =
`infrasafe`). Умолчания нет намеренно — см. «Enforced rules» в корневом `CLAUDE.md`.

## Сервисы docker

- **frontend**: nginx на порту 8088 (статика + проксирование API)
- **app**: Node.js Express на порту 3000
- **postgres**: PostGIS на порту 5435 (проброшен с 5432 контейнера)
- **redis**: есть в обоих compose (`docker-compose.dev.yml:136`,
  `docker-compose.unified.yml:139`). Не опциональная деталь: на нём держатся
  ограничитель запросов, кэш и дедуп nonce вебхуков — при заданном `REDIS_URL`
  они координируются между репликами, без него молча падают на in-memory Map.
  На проде требует пароля (см. память `prod-redis-auth`).

## Боевой рантайм (`docker-compose.unified.yml`)

AUD-022 (2026-06-13): устаревшая связка `docker-compose.prod.yml` +
`Dockerfile.prod` + `Dockerfile.frontend-only` + `nginx-frontend-only.conf` +
`.dockerignore.frontend` удалена — прод работает исключительно на unified,
локальная разработка на `docker-compose.dev.yml`. Живая топология сетей
задокументирована в самом `docker-compose.unified.yml` (комментарии B-010/B-016).

### Роли БД (проверено на проде 2026-05-30)

- `infrasafe_app` — SUPERUSER, роль bootstrap и миграций (создаётся из
  `POSTGRES_USER` при инициализации контейнера).
- `infrasafe_runtime` — не-суперпользовательская LOGIN-роль, создаётся миграцией
  `017_runtime_role.sql`. **Именно под ней подключается приложение**
  (`DB_USER=infrasafe_runtime`, минимальные права).

Миграция 017 *создаёт* `infrasafe_runtime`, она НЕ переименовывает
`infrasafe_app`. Не переключайте `DB_USER` на `infrasafe_app` — это
суперпользователь.

`POSTGRES_USER` в `.env.prod` — мёртвый конфиг: сервис postgres в
`docker-compose.unified.yml` жёстко задаёт `POSTGRES_USER=infrasafe_app`,
перекрывая значение из `.env` (см. `docker-compose.unified.yml:183`).

### Неизменяемый образ приложения (SEC-14/15, PR #99)

Боевой `app` — **неизменяемый образ**. `docker-compose.unified.yml` больше не
монтирует `- .:/app` (это открывало `.env.prod`, `.git` и `scripts/` любому RCE
в Node) и не держит анонимный `- /app/node_modules`. Рантайм-стадия запускает
`npm start` (НЕ nodemon), ставит `npm ci --omit=dev` (в образе нет ни esbuild, ни
nodemon), копирует только `src/` и `public/` (многостадийный `app-builder`
запекает `public/dist`).

**Следствие: изменения бэкенда теперь требуют пересборки образа**
(`docker compose -f docker-compose.unified.yml build app`) — одного `git pull`
больше недостаточно, чтобы код бэкенда стал живым. В разработке по-прежнему
nodemon через `docker-compose.dev.yml`.

### Доставка dist (C-extract)

`public/dist` запекается в образ; на выкатке
`scripts/rebuild-frontend.sh prepare|publish` ИЗВЛЕКАЕТ его из нового образа в
хостовый `public/dist` (почти атомарная подмена через промежуточный `.deploy/`,
он в gitignore и dockerignore), а `verify` побайтово сверяет отданный бандл по
HTTPS. Периметровый nginx по-прежнему отдаёт `/public` из хостового монтирования
`./public` — это не менялось.

Выкатка — `./update-production.sh` (явный unified compose; жёсткий отказ без
`.env`; поэтапное переключение → ожидание здоровья приложения → publish →
verify с откатом по флагу, возвращающим образ приложения, отслеживаемую статику
и dist).

### Что горячее, а что нет

HTML (`frontend-html/`), `css/`, `data/` остаются **директорными**
bind-монтированиями (B-002) — подхватываются через `git pull` +
`nginx -s reload`; конфиг nginx тоже директорное монтирование (B-012).

Инвариант выкатки: периметр отдаёт отслеживаемую статику из хостовых
монтирований, которые `git pull` обновляет немедленно, поэтому фронтенд и
бэкенд обязаны оставаться совместимыми **в обе стороны** на всё окно выкатки.
