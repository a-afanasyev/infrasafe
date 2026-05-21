# Sprint 1.0.1 — Track A follow-ups + Phase 2 cleanup (2026-05-21)

> Post-merge review of `sprint1-security/all-2026-05-21` raised 11
> follow-ups (5 MEDIUM + 6 LOW). This sprint closes 9 cleanly, defers
> 2 with explicit rationale. Result: P1-2 cookie auth now actually
> delivers XSS protection — Phase 1 was just the server-side preamble.

## Headline

| Metric | Value |
|---|---|
| Follow-ups closed | 9 of 11 |
| Follow-ups deferred | 2 (with rationale) |
| Branch | `fix/sprint1.0.1-followups` |
| Base | `sprint1-security/all-2026-05-21` (Track A integration) |
| Commits | 4 (logical groups) |
| New tests | 27 (4 + 5 + 8 + 5 + 5) |
| Test suite | 96 suites, 1933 tests, all green |
| Lint | clean |

## Per-item status

| ID | Title | Status | Commit |
|---|---|---|---|
| **[1A-FU-C-M1]** | localStorage cleanup in 3 client files | ✅ done | `bc40c23` |
| **[1A-FU-S-L4]** | extractAccessToken/Refresh cookie-first | ✅ done | `bc40c23` |
| **[1A-FU-C-L1]** | secure cookie via SECURE_COOKIES env | ✅ done | `bc40c23` |
| **[1A-FU-S-L5]** | `__Host-` cookie prefix | 🟡 deferred | — |
| **[1A-FU-S-L3]** | Cookie path /api scope | 🟡 superseded | — |
| **[1A-FU-C-M2]** | Migration `current_database()` | ✅ done | `396b11d` |
| **[1A-FU-C-L3]** | Migration NOLOGIN initially | ✅ done | `396b11d` |
| **[1A-FU-S-L2]** | search_path = pg_catalog, public | ✅ done | `396b11d` |
| **[1A-FU-S-M1]** | Runbook pg_hba trust warning | ✅ done | `396b11d` |
| **[1A-FU-C-M3]** | login.js qrCodeUrl scheme guard | ✅ done | `c941ff2` |
| **[1A-FU-C-L2]** | login.js normalize server errors | ✅ done | `c941ff2` |
| **[1A-FU-S-L1]** | fonts.googleapis off script-src | ✅ done | `f2fc616` |
| **[1A-FU-S-M2]** | CSP report-uri + /api/csp-report | ✅ done | `f2fc616` |
| **[1A-FU-C-M4]** | Live CSP header e2e test | ✅ done | `f2fc616` |

## What was deferred and why

### `[1A-FU-S-L5]` `__Host-` cookie prefix

The browser enforces `__Host-` cookies must carry `Secure` + `Path=/` + no `Domain`. We already set those attributes in production. The prefix is a browser-enforced contract — it stops the server from accidentally relaxing the constraints later.

The problem: in `NODE_ENV=development`, `secure: false` (unless `SECURE_COOKIES=true`). A `__Host-` cookie without `Secure` is rejected by the browser, breaking the dev workflow. Conditionally using the prefix between dev and prod means different cookie names between environments — messy.

**Path forward**: when dev HTTPS becomes the default workflow (or `SECURE_COOKIES=true` becomes a dev-default), flip the prefix on. Tracked as `[1A-FU-S-L5]` open.

### `[1A-FU-S-L3]` Cookie path `/api` scoping

This was a reviewer-suggested follow-up to scope cookies to `/api` so they aren't sent on static-file requests. With `[1A-FU-S-L4]` cookie-first precedence and the path staying `/`, this is now redundant — cookies are sent on all paths but the only auth-sensitive code is `/api/*` anyway, and HttpOnly+SameSite=Strict means there's no XSS or CSRF surface from broader send.

Marked **superseded by L4** rather than open. If we ever introduce a non-`/api/*` endpoint that should NOT receive auth, revisit.

## Carry-over noted (NOT in this PR)

### `public/admin.js` localStorage references

27+ `localStorage.getItem('admin_token')` calls baked into `Authorization` headers across `admin.js`. With localStorage now empty (admin-auth.js scrubs it on load), these emit `'Authorization: Bearer null'` headers. The server's cookie-first precedence (L4) ignores these in favor of the cookie, so functionally fine — just noisy in logs.

Full refactor would touch 3,430 LoC of monolithic admin.js. Tracked under `[P2-7]` (monolithic admin bundle split) — addressing one without the other adds churn.

## Verification commands

```bash
git checkout fix/sprint1.0.1-followups
npm test -- --silent              # 96 suites, 1933 tests, all green
npm run lint                      # clean

# Per-track targeted runs:
npm test -- --testPathPattern="migration017RuntimeRole"   # 15 tests (+4 new)
npm test -- --testPathPattern="authCookies"                # 27 tests (+4 new)
npm test -- --testPathPattern="loginUxHardening"           # 8 tests (new file)
npm test -- --testPathPattern="cspReportRoute"             # 7 tests (new file)
npm test -- --testPathPattern="p1-3-csp-sri"               # 20 tests (+5 new)

# E2E (requires docker compose -f docker-compose.dev.yml up):
npm run test:e2e -- --testPathPattern="cspHeaders"         # 5 tests (new file)
```

## Operator deploy notes

The previous Track A integration branch (`sprint1-security/all-2026-05-21`) has not been deployed yet. Once this branch merges in, the integration becomes `sprint1-security/all-2026-05-21 + fix/sprint1.0.1-followups`. Deploy order is unchanged:

1. **P1-3 nginx CSP** (now also has `report-uri`) — nginx restart only
2. **P1-2 cookie auth** (now with cookie-first precedence and SECURE_COOKIES env support) — app restart only
3. **P0-5 runtime role** (now NOLOGIN-first, `current_database()`-portable, `pg_catalog` search_path) — backup + migration + atomic ALTER ROLE LOGIN PASSWORD + env swap + restart, per `docs/p0-5-runtime-role-2026-05-21.md`

**New for the operator**:
- Deploying the cookie auth change DOES NOT preserve existing browser sessions. Phase 1 left localStorage on as a fallback; Phase 2 removes it. Any admin with a tab open at deploy time gets logged out on next request and must re-login (and will then ride on the HttpOnly cookie). Communicate the forced re-login.
- `/api/csp-report` becomes a publicly-reachable endpoint as soon as nginx + app restart. Make sure rate-limiting works (100/min/IP) — if the first deploy produces a stream of CSP violations, that's a useful signal that something on the pages still expects `unsafe-inline`.

## Items NOT done in this session that should be next

Recommended next track (in priority order):

1. **Deploy Sprint 1 Track A + 1.0.1** to prod — until deployed, all this code is local-only
2. **`[P0-4]` rotation** — runbook ready since Sprint 0; backup + runtime role + cookies now provide a strong safety net
3. **Backend scale-out**: `[P1-1]` Redis rate-limiter + `[P1-15]` cache unification + `[P0-2]` webhook nonce dedup via Redis — unblocks N>1 replica
4. **CI hardening**: `[P1-V7]` E2E in CI + `[P1-V9]` husky + `[P1-V10]` Dependabot — automates the prevention of class-of-bugs we keep finding manually
5. **Quick wins sweep**: `[P1-4]` AlertService init guard, `[P2-V3]` CORS_ORIGINS trim, `[P2-V4]` AccountLockout case-sensitivity, `[P1-V14]` alerts.metric_id FK, `[P2-11]` renumber double-012 migrations — ~30min each, mixed areas, good for breaking up larger tracks
