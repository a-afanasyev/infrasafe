# InfraSafe — Security Audit & Pentest (2026-05-29)

> Authorized audit of own infrastructure. Method: 9-dimension multi-agent OWASP code
> review (49 agents, 40 raw → 20 adversarially-confirmed findings) + non-destructive
> production pentest of `infrasafe.uz` / `95.46.96.105`.
>
> **NOT performed** (would risk prod): brute-force (real account lockout exists), DoS/load
> tests, data-mutating payloads, synthetic alerts/UK tickets.
>
> Severities below are **re-triaged by the auditor** against InfraSafe's actual threat model
> (single-org operator tool, currently single-replica + Redis present) — several agent
> ratings were downgraded where they assumed multi-tenancy or multi-replica that don't apply.

---

## Production pentest — results

### Strong (verified good)
- **TLS**: valid Let's Encrypt cert (CN=infrasafe.uz, exp 2026-08-13). Port 80 → 301 → HTTPS.
- **Edge security headers**: HSTS `max-age=31536000; includeSubDomains; preload`; CSP
  `script-src 'self'` (no `unsafe-inline`, DOMPurify self-hosted — B-017 confirmed live);
  `object-src 'none'`; `frame-ancestors 'self'`; nginx version hidden; no `x-powered-by`.
- **Default-deny**: `/api/*` → 401 unauth incl. DELETE; admin/integration → 401.
- **Webhook HMAC**: real path `/api/webhooks/uk/*` → 401 unsigned/bad-sig (enforced).
- **Login**: rate-limited (10/15min/IP), generic error (no user enumeration).
- **TRACE** disabled (405); malformed JSON → 400.
- **Postgres (5435) + Redis (6379) NOT internet-exposed** (filtered).
- Soft-404 returns `index.html` (200) — does NOT leak real files (`/.env`, `/.git/config`,
  `/docker-compose.unified.yml` all return the SPA HTML, not their content). Non-issue.

### P-PENTEST-1 — [HIGH] App (:3000) and frontend (:8080) directly internet-exposed over plaintext HTTP
`nc` scan: ports **3000 (Express) and 8080 (frontend nginx) OPEN** to the internet, bypassing
the TLS-terminating, hardened prod-nginx edge.
- `http://95.46.96.105:3000/api/auth/login` accepts POST over **plaintext** → JWT/credentials
  can transit unencrypted (the 80→443 redirect only protects the edge hostname).
- The app-level Helmet CSP served on :3000 is **weaker + stale**: `script-src 'self'
  https://cdn.jsdelivr.net https://unpkg.com` — the OLD external-CDN policy the edge removed
  in B-017. Anyone hitting :3000 gets the weaker CSP.
- **Fix**: bind container ports to loopback (`127.0.0.1:3000:3000`, `127.0.0.1:8080:8080`) in
  compose, OR block 3000/8080 at the host firewall (ufw/iptables). Only 443/80 (nginx) should
  be internet-facing. Also align the app-level Helmet CSP with the edge (drop jsdelivr/unpkg).

### P-PENTEST-2 — [MEDIUM] `POST /api/metrics/telemetry` (public) returns 500 on missing required fields
Empty/partial body → HTTP 500 (unhandled exception) instead of 400. Body is a clean generic
envelope (`{"success":false,"error":{"message":"Внутренняя ошибка сервера","status":500}}`) —
**no stack-trace leak**. But: missing input validation on a public unauth endpoint; each bad
request burns an exception + likely a DB round-trip + error log (rate-limited 120/window/IP,
so DoS amplification is bounded). **Fix**: validate `controller_id` + payload shape → 400.

### P-PENTEST-3 — [LOW/info] Anonymous `/api/buildings-metrics` exposes all buildings + coords + UK `external_id`
By-design for the public map, but the UK `external_id` (UUID) is the cross-system reference for
the UK integration. Consider omitting `external_id` from the anonymous projection.

### P-PENTEST-4 — [HIGH] UK-stack containers published to `0.0.0.0` over plaintext (shared host) — RESOLVED 2026-05-30
While verifying P-PENTEST-1 we found **three UK-stack containers** (same host `95.46.96.105`)
publishing ports on all interfaces over plaintext HTTP, bypassing both TLS and the host nftables
firewall:
- `8085` `uk-management-api` → :8080 (UK API directly internet-exposed), `8000` `uk-web-registration`,
  `3002` `uk-frontend`. Confirmed externally OPEN (`nc`/`curl` 200/404).
- **Root cause:** Docker publishes via `nat`/PREROUTING→DNAT + the `FORWARD` chain (policy accept),
  bypassing the nft `input` chain (`policy drop`, allows only lo/icmp/established/22323/80/443/51820).
  The host firewall is correct for *host* services but cannot see docker-forwarded traffic. InfraSafe's
  own ports carried `-d 127.0.0.1` in their DNAT rules (loopback-only) and were never exposed; the UK
  rules lacked that restriction.
- **Fix (UK team, their compose):** `8085` and `3002` repinned to `127.0.0.1:`; `8000`
  (`uk-web-registration`) container removed. Public access for residents/dashboard preserved via the
  nginx TLS edge (`/uk/` → `uk-frontend:80`, `/uk/api/` → `uk-management-api:8080` over the internal
  `uk-network` bridge), unaffected.
- **Verified externally 2026-05-30:** `8085/3002/8000` → CLOSED; `https://infrasafe.uz/uk/` → 200,
  `/uk/api/v2/registration/start` → 405 (alive, POST-only). Host `docker ps`: only `nginx 80/443` +
  `wireguard 51820/udp` remain on `0.0.0.0`. DOCKER-USER firewall hardening deemed unnecessary (no
  rogue `0.0.0.0` publishes remain; everything sensitive is loopback-bound).

---

## Code audit — confirmed findings (auditor-triaged)

### 🔴 CRITICAL

**SEC-1 — 2FA bypass: temp-token usable as access-token** · `src/middleware/auth.js:53-85`
`authenticateJWT` verifies signature/blacklist/cutoff/lock but **never checks `decoded.scope`**.
`generateTempToken` (authService.js:170) issues a JWT with `scope:'2fa'` signed with the SAME
`JWT_SECRET`, same issuer/audience, for the admin user — returned to the client BEFORE 2FA
completes. Passing that temp-token as `Authorization: Bearer` on any normal route is accepted:
`findUserById` → `req.user` = admin → `isAdmin` passes → **full admin access without completing
2FA**. Verified: access tokens carry NO `scope` field (authService.js:193-198), so rejecting any
token with a `scope` claim in `authenticateJWT` is a safe, surgical fix. Refresh tokens use a
different secret so are already rejected. **Confirmed by reading the code. Fix immediately.**

### 🟠 HIGH

**SEC-2 — Hardcoded Postgres password committed** · `docker-compose.unified.yml:128`
`POSTGRES_PASSWORD=@ppl1c@ti0n` in a git-tracked compose file. Anyone with repo read access has
the DB password. **Fix**: move to `env_file: .env`/`.env.prod` (as `docker-compose.prod.yml`
already does); rotate the password.

**SEC-3 — Secrets present in git history** · `.env` added in commits `623a059`, `7a68504`
`.env`/`.env.*` are gitignored now (only `.env.example` tracked), but history retains earlier
`.env` additions — real secrets may be recoverable via `git log -p`. **Fix**: rotate ALL
secrets that were ever in `.env` (JWT_SECRET, JWT_REFRESH_SECRET, DB, UK_WEBHOOK_SECRET,
TOTP_ENCRYPTION_KEY); optionally scrub history (git-filter-repo) — but rotation is the priority.

**SEC-4 — Temp-token not invalidated on mid-session password change** · `authService.js` temp-token path
`authenticateJWT`/`authenticateRefresh` apply `_isIssuedBeforeCutoff`, but the temp-token path
doesn't. Pairs with SEC-1. Largely resolved by the SEC-1 fix (reject scoped tokens on normal
routes) + adding the cutoff check to `verifyTempToken`.

**SEC-5 — SSRF: `UK_API_URL` not validated on the runtime/env path** · `src/clients/ukWebhookClient.js:81-88`
`validateUKApiUrl()` (blocks private IPs / metadata / localhost) is called when an admin updates
config via API, but NOT when `_getEndpoint()` reads `process.env.UK_API_URL`. Requires env
compromise to exploit (→ realistically MEDIUM), but the fix is one line: call
`validateUKApiUrl(raw)` in `_getEndpoint()` / at startup. **Recommend fixing (cheap).**

**SEC-6 — In-memory rate-limiter Map has no size cap** · `src/middleware/rateLimiter.js`
Unlike the webhook nonce Map (capped at 10k), rate-limiter Maps are uncapped. High-cardinality
IP flood → memory growth between the 60s cleanup sweeps. Real even single-replica. **Fix**: add
a FIFO/size cap mirroring `webhookVerifier`. (Redis path unaffected.)

**SEC-7 — Unbounded `json_agg` in `getActiveAlerts`** · `src/services/alertService.js:1090-1098`
An alert with thousands of `alert_request_map` rows (mass/transformer outage) builds an
unbounded JSON array → memory spike on an admin endpoint. **Fix**: `LIMIT` the aggregated
sub-array (e.g. 100) or cap mappings per alert.

**SEC-8 (conditional) — Multi-replica bypass: rate-limiter + webhook nonce per-process** · rateLimiter.js / webhookVerifier.js
If scaled to N replicas WITHOUT Redis, per-IP limits and nonce-replay dedup are per-process →
N× bypass + webhook replay. **Not currently exploitable** (single-replica + Redis present on
prod). Tie to B-003 (Redis-back rate-limiter); fail-fast at startup if `REPLICA_COUNT>1` &&
no `REDIS_URL`.

### 🟡 MEDIUM

**SEC-9 — Weak hardcoded secret fallbacks in `docker-compose.dev.yml`** (lines 70-73)
`JWT_SECRET:-dev-secret-key-change-in-production`, `JWT_REFRESH_SECRET:-...`,
`TOTP_ENCRYPTION_KEY:-infrasafe-totp-dev-key-...`. **Dev-only** (prod uses `.env.prod`; `env.js`
requires the vars — but the compose fallback satisfies that check with the public value). The
agents rated #2/#18 *critical* — downgraded to MEDIUM because it cannot reach prod without
explicitly running the dev compose with unset env. **Fix**: remove the fallbacks.

**SEC-10 — ReDoS in `isXSSFree` regex** · `src/middleware/validators.js:26`
Nested-quantifier `script`-tag regex: ~2.2s CPU on a 15k-char adversarial input. Authenticated +
CRUD-rate-limited (60/min). **Fix**: replace with `DOMPurify.sanitize(v) === v` (DOMPurify
already a dep).

**SEC-11 — Account-lockout timing oracle** · `authController.js` / `authService.js`
Returns HTTP **423** on lockout (vs 401 otherwise) + fixed 15-min window (no jitter) → state
oracle for distributed attacks. **Fix**: return 401 uniformly; add ±jitter to lockout.

**SEC-12 — `NODE_ENV=production` not asserted before applying prod security posture**
Helmet CSP / Swagger exposure differ by `NODE_ENV`. If unset on prod, dev posture (incl.
weaker CSP) ships. `.env.prod` sets it, so defense-in-depth. **Fix**: assert at startup.

### ⚪ LOW / by-design / context-dependent (agent over-rated)

The agents flagged several A01 "broken access control / cross-tenant / IDOR" items as HIGH
(SEC list #8-11 in their output): no per-tenant filtering on `/buildings`,`/controllers`;
`/integration/building-requests/:externalId` "cross-tenant leak"; anonymous `/buildings-metrics`.
**InfraSafe is a single-organization operator tool — there is no tenant boundary to cross.**
With that threat model these are LOW/by-design, not HIGH. The genuinely interesting residue is
the anonymous `external_id` exposure (→ P-PENTEST-3) and the *latent* fragility that
alert resolve/ack/suppress rely solely on `isAdmin` with no resource-level check (SEC: fine
today; revisit if/when roles beyond admin are introduced).

---

## Recommended priority order

1. **SEC-1** (2FA bypass) — fix now; 3-line scope guard + test. ⬅ start here
2. **P-PENTEST-1** (close ports 3000/8080 to internet) — prod/compose + firewall.
3. **SEC-2 / SEC-3** (hardcoded DB password + rotate secrets that were in git history).
4. **SEC-5** (UK_API_URL SSRF validation) — one-line, cheap.
5. **SEC-9** (drop dev-compose secret fallbacks), **SEC-12** (NODE_ENV assert) — cheap hardening.
6. **SEC-6 / SEC-7 / SEC-10 / SEC-11 / P-PENTEST-2** — medium hardening, batchable.
7. **SEC-8** — fold into B-003 (Redis-backed rate-limiter) before any scale-out.

## Remediation status (2026-05-30)

All in-repo findings fixed via TDD across 3 multi-agent workflow rounds + 1 manual fix, each
with adversarial re-audit. **Full gate green: `npm run lint` clean, 114/114 suites, 2232 tests.**
13 source files + 2 compose files changed; 11 test files extended + 1 new (`envValidation.test.js`).
Changes are in the working tree — **not yet committed/deployed.**

| Finding | Status | Fix |
|---|---|---|
| **SEC-1** 2FA bypass | ✅ Fixed | `authenticateJWT` rejects any token with a `scope` claim before user lookup; `optionalAuth` degrades scoped tokens to anonymous (consistency) |
| **SEC-4** temp-token cutoff | ✅ Fixed | `verifyTempToken` now async, applies `_isIssuedBeforeCutoff` |
| **SEC-5** UK_API_URL SSRF | ✅ Fixed | `_getEndpoint` validates via `validateUKApiUrl`; allowlist made **optional** (no prod regression); IPv6 bracket-strip + IPv4-mapped **and** IPv4-compatible (`::a.b.c.d`) normalization added |
| **SEC-6** rate-limiter Map cap | ✅ Fixed | FIFO cap on **both** `SimpleRateLimiter` and `SimpleSlowDown` (round-1 missed the sibling) |
| **SEC-7** unbounded json_agg | ✅ Fixed | `LEFT JOIN LATERAL ... LIMIT 100` per alert |
| **SEC-10** ReDoS | ✅ Fixed | nested-quantifier regex replaced with linear-time token checks (no new dep — server-side DOMPurify not present) |
| **SEC-11** lockout oracle | ✅ Fixed | 423→uniform 401 + crypto jitter + **dummy bcrypt compare on locked path** (closes latency oracle); module-load `hashSync` replaced with hardcoded `$2b$12$` literal (was crashing a mocked suite) |
| **SEC-12** NODE_ENV assert | ✅ Fixed | whitelist assert at top of `validateEnv()` |
| **SEC-2** hardcoded DB pw | ✅ Fixed (code) | moved to `env_file` in `docker-compose.unified.yml`; ⏳ **live rotation = prod-ops** |
| **SEC-9** dev secret fallbacks | ✅ Fixed | `:-` fallbacks removed from `docker-compose.dev.yml` |
| **P-PENTEST-1** exposed ports | ✅ Fixed (compose) | `3000`/`8080` bound to `127.0.0.1`; ⏳ **host firewall = prod-ops** |
| **P-PENTEST-2** telemetry 500 | ✅ Fixed | payload validated → 400 before DB |
| **P-PENTEST-3** anon external_id | ✅ Fixed | stripped from anonymous projection |

**Deferred / prod-ops (require operator action, not code):**
- **SEC-3** — rotate all secrets ever in git history (JWT, refresh, DB, UK_WEBHOOK_SECRET, TOTP key).
- **SEC-2 rotation** + **P-PENTEST-1 firewall** — the code/compose half is done; the live rotation + ufw/iptables are prod-ops.
- **SEC-8** — multi-replica rate-limiter/nonce bypass; not exploitable single-replica; fold into B-003 (Redis-backed) before any scale-out.

**Residual low-severity (noted, not blocking):** SEC-7 inner `LIMIT` precedes the `uk_request_number`
FILTER (display under-report only, array stays bounded); `isXSSFree` remains a denylist (defense-in-depth
behind edge CSP); `authService` nonexistent-user path has no bcrypt (separate user-enumeration timing
oracle, pre-existing, out of SEC-11 scope).

## Deploy outcome (2026-05-30, prod `infrasafe.uz` / 95.46.96.105)

PR #69 squash-merged to `main` (`3c23225`), CI fully green (incl. CodeQL after resolving a
false-positive clear-text-logging alert). Deployed via `git pull` (repo is bind-mounted to the
app container) + `--force-recreate --no-deps app frontend`.

- **Step 1 — code/compose:** app+frontend recreated healthy. Ports flipped `0.0.0.0`→`127.0.0.1`
  for `:3000`/`:8080` (P-PENTEST-1 closed — verified `blocked` from the internet). NODE_ENV assert
  (SEC-12) did not block startup.
- **Step 3a — JWT rotation:** `JWT_SECRET` + `JWT_REFRESH_SECRET` rotated (host-generated, `.env.prod`
  backed up), app recreated healthy, auth path works, all prior sessions invalidated.
- **Step 3b — DB password rotation:** app role is `infrasafe_runtime` (not `infrasafe_app`); the
  `.env.prod` `POSTGRES_USER=postgres` references a **non-existent role** (stale — left untouched).
  Rotated only `infrasafe_runtime` via self-`ALTER USER` (gated on `ALTER ROLE` success), updated only
  `DB_PASSWORD`. App reconnected cleanly (no auth-fail loop; DB-backed endpoint 200).
- **Step 4 — post-deploy pentest + smoke: 14/14 green** — ports closed, postgres/redis not exposed,
  HSTS+CSP+no x-powered-by, default-deny 401, telemetry empty-body→400 (P-PENTEST-2), anon
  buildings-metrics has no `external_id` (P-PENTEST-3), unsigned UK webhook→401, TRACE blocked, site
  200, login→401 generic (SEC-11 uniform response live).

**Secret rotation progress (SEC-3):**
- ✅ **JWT_SECRET + JWT_REFRESH_SECRET** — rotated 2026-05-30 (Step 3a).
- ✅ **DB password** (`infrasafe_runtime`) — rotated 2026-05-30 (Step 3b).
- ✅ **UK webhook secret** (`INFRASAFE_WEBHOOK_SECRET` + `UK_WEBHOOK_SECRET`, single shared value) —
  rotated 2026-05-30 with UK team. Verified on prod: app healthy; both vars hold the same 64-char
  value; a request signed with the new secret → 400 (signature accepted, payload rejected), a
  bad-signature request → 401 (verifier enforcing). Full e2e confirmed on next real UK webhook.
- ✅ **TOTP_ENCRYPTION_KEY** — rotated 2026-05-30 via **Strategy B** (full reset, plan in
  `docs/audit/2026-05-30-totp-key-rotation-plan.md`). Blast radius was 1 account (`admin`); snapshot
  taken (`~/totp_users_snapshot.*.csv`). New key generated host-side, all 2FA state cleared, app
  recreated. Admin re-enrolled: `totp_enabled=true` with a fresh secret encrypted under the new key
  (`confirmSetup` success = encrypt+decrypt verified e2e). **SEC-3 secret rotation complete.**

**Still open after deploy (operator action):**
- **Host firewall** (P-PENTEST-1 belt-and-suspenders): `sudo` needs a password; ports are already
  loopback-closed so this is redundant but recommended. Commands handed to operator.
- ✅ **SEC-1 live replay** verified on prod 2026-05-30: a fresh admin `tempToken` (payload
  `role:"admin", scope:"2fa"`, NOT expired, valid signature) replayed as `Authorization: Bearer`
  on `GET /api/buildings` and `/api/integration/config` → **401 "Invalid or expired token"** on both.
  Since the token was unexpired + signature-valid, the 401 comes from the `decoded.scope` guard
  (the SEC-1 fix), not expiry. Pre-fix this token would have returned 200 with admin data. Bypass closed.

## What was checked and found clean
SQL injection (parametrized + IDENT_RE whitelist + ALLOWED_UPDATE_TABLES — solid), XSS/CSP at
the edge (self-hosted DOMPurify, strict CSP), webhook HMAC + replay (timing-safe, 300s window),
TOTP encryption (HKDF, proper key length validated at startup), password hashing, JWT alg
pinning (`algorithms:['HS256']` — no alg=none), refresh-token secret separation.
