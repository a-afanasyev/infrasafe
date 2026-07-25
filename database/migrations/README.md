# Database Migrations

Инкрементальные миграции PostgreSQL-схемы InfraSafe. Полная схема для свежей БД — в `../init/01_init_database.sql`, тестовый seed — в `../init/02_seed_data.sql`.

## Миграционный раннер (PR-1a / AUD-002)

Источник истины — таблица `schema_migrations` в БД (`filename` PK + `checksum`).
Раннер `scripts/migrate.sh` применяет миграции из **закреплённого git-коммита**
(`MIGRATE_TARGET_COMMIT`), а не из рабочего дерева, через `docker compose exec`
в контейнер postgres (он работает на хосте, вне immutable-образа app).

```bash
# env: MIGRATE_COMPOSE_FILE, MIGRATE_PG_USER, MIGRATE_TARGET_COMMIT
#      (опц.) MIGRATE_PG_SERVICE=postgres, MIGRATE_PG_DB=infrasafe
#      (опц.) MIGRATE_NODE_MODE=auto|host|image, MIGRATE_NODE_SERVICE=app
scripts/migrate.sh status        # applied / pending / drift (+ ACL-инвариант)
scripts/migrate.sh up            # применить pending под row-mutex'ом
scripts/migrate.sh baseline      # one-time: пометить 003-034 applied (см. ниже)
scripts/migrate.sh force-unlock  # снять застрявший migrate_lock (явно)
scripts/migrate.sh repair-acl    # восстановить REVOKE на runner-таблицах
```

Коды выхода `status`/`up`: `0` чисто · `2` нет `schema_migrations` (fail-close) ·
`5` drift (checksum-mismatch или DB-only).

**Node на хосте не требуется.** `migrate.sh` host-run, но логика discovery/checksum
живёт в `scripts/lib/migrate-discover.js`. Прод-хосты не имеют `node` на хосте (node
есть только внутри образа `app`, а `scripts/` в immutable-образ не запекается). Поэтому
`MIGRATE_NODE_MODE=auto` (по умолчанию) сам определяет: есть host-`node` → использует
его; нет → `docker run` node из образа сервиса `MIGRATE_NODE_SERVICE` (default `app`) с
bind-mount `scripts/lib` (скрипт самодостаточен — только stdin/argv + builtin crypto).
Образ резолвится через `docker compose images -q <service>` (service-scoped, нужен
поднятый контейнер сервиса) — НЕ через `config --images`, который подмешивает образы
зависимостей. Можно зафиксировать образ явно: `MIGRATE_NODE_IMAGE=<image>`.
`MIGRATE_NODE_MODE=host|image` форсируют режим явно.

### Свежая БД (чистый volume)

PostgreSQL-контейнер выполняет `../init/*.sql` по алфавиту. Файлы `01-09`
запекают кумулятивный эффект миграций **003-017**:

| Init-файл | Источник | Что делает |
| --- | --- | --- |
| `01_init_database.sql` | стабильная итоговая схема (003–010 + 012_fix_mv интегрированы) | базовые таблицы, индексы, триггеры, MV |
| `02_seed_data.sql` | дамп от 2025-11-15 | тестовые данные (17 buildings, 34 metrics, admin user) |
| `03_uk_integration.sql` | копия `011_uk_integration.sql` | UK Integration Foundation |
| `04_totp_2fa.sql` | копия `012_totp_2fa.sql` | 2FA-колонки в `users` |
| `05_account_lockout.sql` | копия `013_account_lockout.sql` | persistent account lockout |
| `06_performance_indexes.sql` | копия `014_performance_indexes.sql` | PERF-002 / PERF-010 |
| `07_alert_dedup.sql` | `015_alert_dedup_constraint.sql` + idempotent pre-cleanup | partial UNIQUE для активных alerts |
| `08_password_changed_at.sql` | копия `016_password_changed_at.sql` | колонка для аудита смены пароля + JWT-cutoff |
| `09_runtime_role.sql` | копия `017_runtime_role.sql` | least-privilege роль `infrasafe_runtime` |
| `99_schema_migrations_baseline.sql` | **NEW (PR-1a)** | создаёт runner-таблицы + self-declare 003-017 |

`99_` запускается **последним**: создаёт `schema_migrations`/`migrate_lock`,
ревокает у `infrasafe_runtime` DML на них, и объявляет 003-017 как applied.
**Поэтому свежая БД готова не «полностью»** — миграции **018-034** доносит
`scripts/migrate.sh up`. Если любой init-файл упал раньше `99_`, таблиц нет →
`up` fail-close (оператор реконсилит), а не replay на полусобранную схему.

> ⚠️ После fresh-init роль `infrasafe_runtime` создаётся **NOLOGIN** — оператор
> обязан `ALTER ROLE infrasafe_runtime LOGIN PASSWORD '<strong>'` до старта app.

**Unified `database.sql` (DR-only)** НЕ несёт self-declare и НЕ создаёт
runner-таблицы — это неполный legacy-снимок (не запекает 011-034). Fresh-unified
**намеренно fail-close**; см. футер `database.sql`.

### Существующая БД (живой volume, production)

Прод бутстрапился давно и накатывался вручную. Онбординг в раннер — **one-time**
`scripts/migrate.sh baseline`: создаёт runner-таблицы, прогоняет sentinel-матрицу
(≥1 проверка на каждую миграцию 003-034 — что её эффект реально есть в БД) одной
транзакцией, и помечает frozen-allowlist 003-034 (33 файла) applied **без
выполнения**. Любой sentinel-fail → ROLLBACK → таблиц не остаётся.

### Roll-forward-only (политика, AUD-043)

Down-скриптов нет. **Применённые миграции неизменяемы** — отредактированный файл
даёт checksum-drift и `up`/`status` падают (это и есть защита). НЕ все ранние
миграции идемпотентны (003 — `CREATE INDEX` без guard; 006 — DROP), поэтому
повторное «ручное» выполнение запрещено — реконсиляция только через раннер.
Новые миграции (035+) **обязаны** быть транзакционны (свой `BEGIN/COMMIT`) и
backward-compatible (expand-only).

## Список миграций

| # | Файл | Дата | Назначение |
| --- | --- | --- | --- |
| 003 | `003_power_calculation_v2.sql` | 2025-11-02 | Система расчёта мощности — каноническая итерация. Исторические `_system` и `_system_fixed` варианты перемещены в [`_superseded/`](./_superseded/README.md) (см. P1-V4). |
| 004 | `004_add_coordinates_and_extended_fields.sql` | 2025-10-23 | Координаты зданий (PostGIS) и расширенные поля |
| 005 | `005_add_paths_to_lines.sql` | 2025-10-23 | Геометрия путей для `power_lines` и `water_lines` |
| 006 | `006_cleanup_infrastructure_lines.sql` | 2025-10-23 | Очистка дублей в `infrastructure_lines` |
| 007 | `007_add_metrics_compound_index.sql` | 2026-03-07 | Compound index `metrics(controller_id, timestamp)` — оптимизация частых выборок |
| 008 | `008_remove_duplicate_hot_water.sql` | 2026-03-07 | Удаление дублирующегося поля `hot_water` из `buildings` |
| 009 | `009_token_blacklist_hash_index.sql` | 2026-03-08 | Индексы на `token_blacklist` для быстрого lookup и cleanup |
| 010 | `010_add_missing_indexes.sql` | 2026-03-10 | FK-индексы и индексы на `status`-фильтры |
| 011 | `011_uk_integration.sql` | 2026-04-15 | UK Integration Foundation — `external_id` на `buildings`, таблицы `integration_config`, `integration_log`, `alert_rules`, `alert_request_map` |
| 012 | `012_totp_2fa.sql` | 2026-04-12 | 2FA: `users.totp_secret`, `totp_enabled`, `recovery_codes` |
| 012 | `012_fix_materialized_view.sql` | 2026-04-15 | ARCH-107: починка `mv_transformer_load_realtime` (использовать активную таблицу `transformers`) |
| 013 | `013_account_lockout.sql` | 2026-04-17 | Persistent account lockout — таблица `account_lockout` (заменяет in-memory `Map`, Phase 12B.3) |
| 014 | `014_performance_indexes.sql` | 2026-04-17 | PERF-002/PERF-010 — индексы на основе EXPLAIN ANALYZE (Phase 12C.2) |
| 015 | `015_alert_dedup_constraint.sql` | 2026-04-17 | Phase 4.1 / ARCH-106 — partial UNIQUE index для дедупликации активных alerts |
| 016 | `016_password_changed_at.sql` | 2026-05-03 | Phase 13 — `users.password_changed_at` column (fixes latent service bug + enables JWT-cutoff for bulk session invalidation) |
| 017 | `017_runtime_role.sql` | 2026-05-21 | [P0-5] Least-privilege `infrasafe_runtime` role + SECURITY DEFINER on `refresh_transformer_analytics()`. Operator runbook: [`../../docs/p0-5-runtime-role-2026-05-21.md`](../../docs/p0-5-runtime-role-2026-05-21.md). |
| 018 | `018_alert_request_map_fk.sql` | 2026-05-21 | Sprint 5 — FK `alert_request_map.infrasafe_alert_id → infrastructure_alerts` |
| 019 | `019_buildings_fk_indexes.sql` | 2026-05-21 | Sprint 5 — FK-индексы на `buildings` (transformer/controller/water/heat refs) |
| 020 | `020_mv_refresh_definer_wrapper.sql` | 2026-05-22 | Sprint 6 / P0-6 — SECURITY DEFINER wrapper `refresh_mv_transformer_load()` для планировщика MV-refresh |
| 021 | `021_alerts_metric_id_fk.sql` | 2026-05-22 | Sprint 7 — FK `infrastructure_alerts.metric_id → metrics` |
| 022 | `022_uk_outbox.sql` | 2026-05-22 | Sprint 9 / FIX-007 — таблица `uk_outbox` (персистентный outbox для HMAC-webhook отправки в УК) |
| 023 | `023_alert_request_map_counter_idx.sql` | 2026-05-22 | Sprint 9 — partial index на `alert_request_map` для агрегации счётчиков заявок |
| 024 | `024_alert_rules_extensions.sql` | 2026-05-23 | Sprint 10 PR-1 — колонки политики эскалации на `alert_rules` (persistence/reopen policy) |
| 025 | `025_alert_verifications.sql` | 2026-05-23 | Sprint 10 PR-2 — очередь верификации `alert_verifications` |
| 026 | `026_alert_suppressions.sql` | 2026-05-23 | Sprint 10 PR-4 — таблица `alert_suppressions` (operator escape hatch) |
| 027 | `027_alert_lifecycle_v2.sql` | 2026-05-23 | Sprint 10 PR-2 — lifecycle v2: status enum (`resolved_verifying`/`engineer_required`) + `reopen_chain_id` |
| 028 | `028_drop_alert_types_catalog.sql` | 2026-05-23 | Sprint 10 PR-1.5 — удаление каталога `alert_types` (тип теперь CHECK на `alert_rules.alert_type`) |
| 029 | `029_alert_rule_changes.sql` | 2026-05-23 | Sprint 10 PR-5 — аудит-лог `alert_rule_changes` (по строке на изменённое поле) |
| 030 | `030_uk_request_url_template.sql` | 2026-05-27 | Sprint 11 B-001 — seed `uk_request_url_template` в `integration_config` |
| 031 | `031_b020_backfill_orphaned_verifying.sql` | 2026-05-29 | Sprint 11 B-020 — backfill осиротевших `resolved_verifying` alerts (застрявших до finalize-fix) |
| 032 | `032_uk_urgency_canonical_keys.sql` | 2026-06-06 | Sprint 11 — канонические ключи `uk_urgency` |
| 033 | `033_alert_verifications_last_checked.sql` | 2026-06-10 | Sprint 11 AUD-001 PR-B — `alert_verifications.last_checked_at` (checked-ack для verify-режима) |
| 034 | `034_alert_verifications_dispatch.sql` | 2026-06-11 | Sprint 11 AUD-001 PR-C — dispatch/lease/sweep колонки + partial index (durable-доставка + crash-recovery) |
| 035 | `035_voltage_critical_rule.sql` | 2026-06-11 | AUD-006 — CRITICAL `VOLTAGE_ANOMALY` rule (voltage escalate-in-place). **Первая миграция, накатанная раннером** (не baseline). |
| 036 | `036_canonicalize_transformers.sql` | 2026-06-13 | AUD-039 Phase 1 EXPAND — канонизация на `transformers` (порт 4 реальных строк, drop test-строки `'1111'`, building 5 → Олмазор-1, INTEGER-перегрузка `find_nearest_buildings_to_transformer`). Expand-only. |
| 037 | `037_drop_power_transformers.sql` | 2026-06-13 | AUD-039 Phase 2 CONTRACT — DROP `power_transformers` + `buildings.power_transformer_id` + VARCHAR-перегрузки `find_nearest`; фикс arity-регрессии Phase 1 (правильная 3-арг INTEGER функция). Rollback target = Phase-1 образ. |
| 038 | `038_uk_requests.sql` | 2026-07-23 | request.reconcile (контракт УК 2026-07-23) — таблица `uk_requests` для заявок, заведённых на стороне УК (в `alert_request_map` им нельзя: `infrasafe_alert_id NOT NULL`); upsert-ключ `uk_request_number`; инвентаризация и счётчики карты — ARM ∪ uk_requests. Плюс индекс `idx_arm_building_status` под ARM-ветку счётчиков (закрыт pre-existing gap Sprint 9). Expand-only. |
| 039 | `039_arm_widen_and_archive.sql` | 2026-07-24 | ARM: `uk_request_number` VARCHAR(20)→(50) (валидатор пускал до 50 → `markSent` падал бы на 21+; выравнивание с `uk_requests`) + колонка `archived_at` + архивация 7 UK-подтверждённых orphan-строк (синтетики мая-июня, УК их удалила; вечный шум в их orphan-диффе). Архивные строки скрыты из инвентаризации и счётчиков (`archived_at IS NULL` во всех ARM-ветках), аудит сохранён. No-op на profk/fresh. Expand-only. |

| 040 | `040_water_lines_status_check.sql` | 2026-07-25 | M-12b (PR-2b) — CHECK на `water_lines.status` (`active`/`maintenance`/`inactive`, NULL разрешён явно). Вторая половина M-12: PR-2 закрыл приложение (`WaterLine.assertValidStatus` на всех 5 путях записи), БД принимала что угодно ≤20 символов. Констрейнт **сразу валидный**, не NOT VALID: таблица пуста на обоих продах (проверено 2026-07-25). **Contract change, не expand-only** — едет отдельным релизом ПОСЛЕ PR-2, чтобы образ отката уже содержал тот же whitelist. |

| 041 | `041_alert_rules_season_window.sql` | 2026-07-25 | B-009 — сезонное окно правила: `season_from`/`season_to` в формате `MM-DD` (рекуррентное, без года; DATE «протухал» бы 1 января). Оба NULL = круглый год, поэтому миграция **не меняет поведение** — окно включает оператор через админку. Переход через Новый год (`10-15` → `04-15`) поддержан логикой гейта. CHECK'и на формат и на парность (одно поле без второго запрещено). Expand-only. |

## Примечание про `003_*` и `012_*`

- **003** — каноническая версия `003_power_calculation_v2.sql`. Исторические попытки (`_system`, `_system_fixed`) перенесены в [`_superseded/`](./_superseded/README.md) и **не должны** применяться. Раннер исключает `_superseded/` строгой regex (`^database/migrations/[0-9]{3}_…\.sql$`).
- **012** имеет два независимых файла с одинаковым номером (`_totp_2fa`, `_fix_materialized_view`) — оба применяются, порядок между ними не важен. Раннер ключует по **filename**, поэтому обе строки трекаются независимо; лексикографически `012_fix…` идёт перед `012_totp…`. (`[P2-11]` / **AUD-043 — resolved** в PR-1a.)

## Добавление новой миграции

1. Имя файла: `NNN_snake_case_description.sql`, где `NNN` — следующий свободный номер (035, 036 …). Charset строго `[A-Za-z0-9._-]` (раннер отвергает пробелы/кавычки).
2. Начать с комментария, кратко описывающего цель и связанный тикет/фазу.
3. **Обернуть в свою транзакцию** (`BEGIN; … COMMIT;`) — частичный сбой откатывается целиком, re-apply чист. Исключение — только когда нужен `CREATE INDEX CONCURRENTLY` (нельзя в txn): тогда каждый statement обязан быть идемпотентным и crash-safe.
4. **Backward-compatible (expand-only)**: схема применяется ДО нового app, а rollback оставляет старый app против новой схемы. Только additive (ADD COLUMN/TABLE/INDEX); деструктив (DROP/RENAME колонки) — отдельным contract-релизом.
5. Дополнить эту таблицу одной строкой. Раннер подхватит файл автоматически (`up`); ручной накат больше не нужен.
6. Если меняется init-схема для свежего volume — синхронизировать `../init/01_init_database.sql`. Файлы 003-017 уже задекларированы в `../init/99_schema_migrations_baseline.sql`; новые миграции (018+) доносит `up`.
