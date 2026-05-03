# Database Migrations

Инкрементальные миграции PostgreSQL-схемы InfraSafe. Полная схема для свежей БД — в `../init/01_init_database.sql`, тестовый seed — в `../init/02_seed_data.sql`.

## Как применяются

**Свежая БД (чистый volume):**
PostgreSQL Docker-контейнер автоматически выполняет все файлы из `../init/` в алфавитном порядке (стандартный `/docker-entrypoint-initdb.d`-механизм):

| Init-файл | Источник | Что делает |
| --- | --- | --- |
| `01_init_database.sql` | стабильная итоговая схема (003–010 + 012_fix_mv интегрированы) | базовые таблицы, индексы, триггеры, MV |
| `02_seed_data.sql` | дамп от 2025-11-15 | тестовые данные (17 buildings, 34 metrics, admin user) |
| `03_uk_integration.sql` | копия `011_uk_integration.sql` | UK Integration Foundation |
| `04_totp_2fa.sql` | копия `012_totp_2fa.sql` | 2FA-колонки в `users` |
| `05_account_lockout.sql` | копия `013_account_lockout.sql` | persistent account lockout |
| `06_performance_indexes.sql` | копия `014_performance_indexes.sql` | PERF-002 / PERF-010 |
| `07_alert_dedup.sql` | `015_alert_dedup_constraint.sql` + idempotent pre-cleanup для seed-дубликатов | partial UNIQUE для активных alerts |

После запуска `docker compose up` чистая БД будет полностью готова — никаких ручных шагов не нужно.

**Существующая БД (живой volume, production):**
Миграции применяются вручную в порядке нумерации:

```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe \
  -f /database/migrations/NNN_description.sql
```

Все миграции **идемпотентны** (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`) — безопасно выполнять повторно.

## Список миграций

| # | Файл | Дата | Назначение |
| --- | --- | --- | --- |
| 003 | `003_power_calculation_system.sql` (+ `_fixed`, `_v2`) | 2025-11-02 | Система расчёта мощности (исторически — три файла, использовать только `_v2`) |
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

## Примечание про `003_*` и `012_*`

- **003** существует в трёх вариантах (`_system`, `_system_fixed`, `_v2`). Использовать только `003_power_calculation_v2.sql`; остальные сохранены для истории и не применяются в новых окружениях.
- **012** имеет два независимых файла с одинаковым номером (`_totp_2fa`, `_fix_materialized_view`) — оба должны быть применены, порядок между ними не важен.

## Добавление новой миграции

1. Имя файла: `NNN_snake_case_description.sql`, где `NNN` — следующий свободный номер (016, 017 …).
2. Начать с комментария, кратко описывающего цель и связанный тикет/фазу.
3. Использовать идемпотентные конструкции (`IF NOT EXISTS`, `IF EXISTS`).
4. Дополнить эту таблицу одной строкой.
5. Если меняется init-схема — синхронизировать `../init/01_init_database.sql`, чтобы свежий volume получил итоговую схему без обхода миграций.
