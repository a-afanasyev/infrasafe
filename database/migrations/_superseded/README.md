# Superseded migrations

This directory holds historical migration files that were **replaced by a
later iteration** and **MUST NOT be applied** on new or existing databases.

They are preserved here for archeology, not for execution.

## Files

| File | Superseded by | Notes |
| --- | --- | --- |
| `003_power_calculation_system.sql` | `../003_power_calculation_v2.sql` | Initial attempt (2025-11-02). Replaced by `_fixed`, then by `_v2`. |
| `003_power_calculation_system_fixed.sql` | `../003_power_calculation_v2.sql` | Interim fix. Replaced by `_v2`. |

## Why move them here

Previously these three `003_*` files lived alongside the active migration
directory. Any naive automated runner (e.g. `node-pg-migrate`, `dbmate`,
`flyway`) scanning `database/migrations/*.sql` in alphabetical order would
have executed all three — producing conflicts (duplicate object errors,
half-applied state, or one undoing the previous).

The fresh-install path is **not** affected: containers initialize from
`../../init/01_init_database.sql`, which already incorporates the v2 logic.

For existing databases the operator applies migrations manually per the
[root README](../README.md), so only `003_power_calculation_v2.sql` is
actually executed.

See [P1-V4] in `docs/audit-backlog-2026-05-20.md`.
