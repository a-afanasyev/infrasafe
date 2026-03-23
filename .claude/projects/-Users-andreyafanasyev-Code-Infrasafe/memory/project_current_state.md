---
name: InfraSafe current state (March 2026)
description: Current project state - branch, test status, architecture after 6-phase refactor
type: project
---

InfraSafe is on branch `fix/p0-p1-security-and-hygiene` with ~190 changed files vs `main`. This branch implements P0-P2 security/hygiene fixes from the March 2026 audit.

**Why:** The project underwent a comprehensive security audit (AUDIT-REPORT-2026-03-06.md) that identified P0-P3 issues. This branch addresses the critical ones.

**How to apply:** This is the active development branch. All new work should be based on or merged into this branch before going to `main`.

## Key changes in this branch:
- Default-deny JWT auth (all routes require auth by default, explicit allowlist for public routes)
- Admin controller split from monolithic 1831-line adminController.js into 9 domain-specific files in `src/controllers/admin/`
- New services extracted: buildingMetricsService, powerAnalyticsService, adminService
- New models: ColdWaterSource, HeatSource (previously inline)
- Rate limiter applied to all routes
- DB migrations 007-010 (indexes, dedup, token blacklist)
- Replaced `uuid` with `crypto.randomUUID()`
- Frontend port changed to 8088 in dev docker-compose
- 175 tests passing across 16 suites (unit, integration, security)
- CSS extracted to `css/style.css`
- Archived ~40 obsolete docs to `docs/archive/`
