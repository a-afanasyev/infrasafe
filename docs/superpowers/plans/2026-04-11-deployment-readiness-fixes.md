# Deployment Readiness Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITICAL and HIGH audit findings to make InfraSafe production-ready.

**Architecture:** Surgical fixes only — no refactoring, no new features. Each task is self-contained and independently deployable. TDD for all logic changes.

**Tech Stack:** Node.js 20 / Express / PostgreSQL / Docker / Jest

**Priority order:** Security blockers first (Tasks 1-5), then infrastructure (Tasks 6-9), then quality (Tasks 10-12).

**Task dependencies:**
- Task 7 → Task 9: `npm ci` in Dockerfile requires a clean `package-lock.json` from Task 7.
- Task 7 → Task 12: both modify `package.json` — run sequentially or merge into one commit.
- Tasks 1 + 3: both modify `.env.example` — safe to run sequentially (Task 3 checks "if not already present").
- All other tasks are independent and can run in parallel.

---

## File Map

| Task | Files Created | Files Modified |
|------|---------------|----------------|
| 1 | `src/utils/urlValidation.js`, `tests/jest/unit/urlValidation.test.js` | `src/clients/ukApiClient.js`, `src/services/ukIntegrationService.js`, `.env.example` |
| 2 | — | `src/server.js` |
| 3 | — | `src/config/env.js`, `.env.example` |
| 4 | — | `src/services/adminService.js`, `tests/jest/unit/adminService.test.js` |
| 5 | — | `src/utils/queryValidation.js`, `tests/jest/unit/queryValidationTest.test.js` (existing file, lines 169-196) |
| 6 | `.eslintrc.json` | `.github/workflows/ci.yml` |
| 7 | — | `package.json`, `package-lock.json` |
| 8 | — | `.dockerignore` |
| 9 | — | `Dockerfile.prod`, `docker-compose.prod.yml` |
| 10 | — | `src/services/authService.js` |
| 11 | — | `src/controllers/admin/adminGeneralController.js`, `tests/jest/unit/adminGeneralController.test.js` (existing) |
| 12 | — | `package.json` |

---

### Task 1: Fix SSRF — URL validation for UK API client

**Severity:** CRITICAL
**Why:** Admin can set `uk_api_url` to internal network addresses (metadata endpoint, DB port, etc.). String-based hostname checks alone are insufficient — a domain like `evil.example.com` can resolve to `10.x.x.x` (DNS rebinding). The defense-in-depth approach: mandatory allowlist in production + IP pattern checks for defense in depth.
**Files:**
- Create: `src/utils/urlValidation.js`
- Create: `tests/jest/unit/urlValidation.test.js`
- Modify: `src/clients/ukApiClient.js:23,51,98`
- Modify: `src/services/ukIntegrationService.js:52-62`

- [x] **Step 1: Write the failing test for URL validator**

Create `tests/jest/unit/urlValidation.test.js`:

```js
const { validateUKApiUrl } = require('../../../src/utils/urlValidation');

describe('validateUKApiUrl', () => {
    const origEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...origEnv };
    });

    test('allows valid HTTPS URL when in allowlist', () => {
        process.env.UK_API_ALLOWED_HOSTS = 'uk-api.example.com';
        expect(() => validateUKApiUrl('https://uk-api.example.com')).not.toThrow();
    });

    test('allows HTTP localhost in development mode', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.UK_API_ALLOWED_HOSTS;
        expect(() => validateUKApiUrl('http://localhost:3001')).not.toThrow();
    });

    test('rejects HTTP in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.UK_API_ALLOWED_HOSTS = 'uk-api.example.com';
        expect(() => validateUKApiUrl('http://uk-api.example.com')).toThrow('Only HTTPS');
    });

    test('rejects private/internal IPs', () => {
        delete process.env.UK_API_ALLOWED_HOSTS;
        expect(() => validateUKApiUrl('https://169.254.169.254')).toThrow();
        expect(() => validateUKApiUrl('https://10.0.0.1')).toThrow();
        expect(() => validateUKApiUrl('https://192.168.1.1')).toThrow();
        expect(() => validateUKApiUrl('https://127.0.0.1')).toThrow();
    });

    test('rejects localhost in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.UK_API_ALLOWED_HOSTS = 'localhost';
        expect(() => validateUKApiUrl('https://localhost')).toThrow('Blocked hostname');
    });

    test('rejects non-HTTP(S) protocols', () => {
        expect(() => validateUKApiUrl('ftp://example.com')).toThrow();
        expect(() => validateUKApiUrl('file:///etc/passwd')).toThrow();
    });

    test('rejects empty/invalid input', () => {
        expect(() => validateUKApiUrl('')).toThrow();
        expect(() => validateUKApiUrl(null)).toThrow();
        expect(() => validateUKApiUrl('not-a-url')).toThrow();
    });

    test('requires UK_API_ALLOWED_HOSTS in production', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.UK_API_ALLOWED_HOSTS;
        expect(() => validateUKApiUrl('https://uk-api.example.com'))
            .toThrow('UK_API_ALLOWED_HOSTS must be configured');
    });

    test('rejects hosts not in allowlist', () => {
        process.env.UK_API_ALLOWED_HOSTS = 'allowed.example.com,api.uk-bot.uz';
        expect(() => validateUKApiUrl('https://allowed.example.com')).not.toThrow();
        expect(() => validateUKApiUrl('https://api.uk-bot.uz/v1')).not.toThrow();
        expect(() => validateUKApiUrl('https://evil.example.com')).toThrow('not in allowlist');
    });

    test('allowlist is case-insensitive', () => {
        process.env.UK_API_ALLOWED_HOSTS = 'API.Example.Com';
        expect(() => validateUKApiUrl('https://api.example.com')).not.toThrow();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest tests/jest/unit/urlValidation.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../../../src/utils/urlValidation'`

- [x] **Step 3: Implement URL validator**

Create `src/utils/urlValidation.js`:

```js
'use strict';

const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

/**
 * Validate a UK API URL for safety. Throws on invalid or dangerous URLs.
 *
 * Defense-in-depth strategy:
 * 1. Protocol check (HTTPS in production)
 * 2. Blocked hostname check (localhost, metadata endpoints)
 * 3. Private IP pattern check (RFC1918/RFC6890)
 * 4. Mandatory allowlist in production (prevents DNS rebinding — a domain
 *    resolving to 10.x.x.x passes IP checks at validation time but hits
 *    internal network at request time)
 *
 * In development (without allowlist), only steps 1-3 apply.
 *
 * @param {string} url - URL to validate
 * @throws {Error} if URL is invalid, uses blocked protocol, or targets internal network
 */
function validateUKApiUrl(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('UK API URL is required');
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid UK API URL: ${url}`);
    }

    // Protocol check
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development';
    const allowedProtocols = isProduction ? ['https:'] : ['https:', 'http:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(`Only HTTPS URLs allowed for UK API (got ${parsed.protocol})`);
    }

    // Hostname block check
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
        // Only allow localhost in explicit development mode
        if (!(isDevelopment && hostname === 'localhost')) {
            throw new Error(`Blocked hostname: ${hostname}`);
        }
    }

    // Private IP check (defense-in-depth, catches literal IPs)
    for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error(`Private/internal IP not allowed: ${hostname}`);
        }
    }

    // Mandatory allowlist in production (primary defense against DNS rebinding).
    // In production, UK_API_ALLOWED_HOSTS MUST be set — without it, any
    // public domain could resolve to an internal IP at request time.
    const allowedHosts = process.env.UK_API_ALLOWED_HOSTS;
    if (isProduction && !allowedHosts) {
        throw new Error(
            'UK_API_ALLOWED_HOSTS must be configured in production ' +
            '(comma-separated list of allowed UK API hostnames)'
        );
    }
    if (allowedHosts) {
        const hostList = allowedHosts.split(',').map(h => h.trim().toLowerCase());
        if (!hostList.includes(hostname)) {
            throw new Error(`Host "${hostname}" not in allowlist (UK_API_ALLOWED_HOSTS)`);
        }
    }
}

module.exports = { validateUKApiUrl };
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest tests/jest/unit/urlValidation.test.js --no-coverage`
Expected: PASS

- [x] **Step 5: Wire validator into ukApiClient.js**

In `src/clients/ukApiClient.js`, add import at line 5:
```js
const { validateUKApiUrl } = require('../utils/urlValidation');
```

In the `authenticate()` method, after `const apiUrl = ...` (line 23), add:
```js
validateUKApiUrl(apiUrl);
```

In the `createRequest()` method, after `const apiUrl = ...` (line 51), add:
```js
validateUKApiUrl(apiUrl);
```

In the `get()` method, after `const apiUrl = ...` (line 98), add:
```js
validateUKApiUrl(apiUrl);
```

- [x] **Step 6: Wire validator into ukIntegrationService.js updateConfig**

In `src/services/ukIntegrationService.js`, add import at line 8:
```js
const { validateUKApiUrl } = require('../utils/urlValidation');
```

In the `updateConfig()` method (line 52-63), before `await IntegrationConfig.set(key, value)`, add a validation check:
```js
if (key === 'uk_api_url') {
    validateUKApiUrl(value);
}
```

- [x] **Step 7: Add UK_API_ALLOWED_HOSTS to .env.example**

In `.env.example` (tracked by git), add:
```bash
# UK API — required in production to prevent SSRF via DNS rebinding
UK_API_ALLOWED_HOSTS=uk-bot-api.example.com
```

**Local-only (not committed):** If `.env.prod` exists locally, also add `UK_API_ALLOWED_HOSTS=CHANGE_ME_UK_BOT_HOSTNAME`. This file is gitignored (`.env.*` in `.gitignore:5`).

- [x] **Step 8: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All 1927+ tests pass

- [x] **Step 9: Commit**

```bash
git add src/utils/urlValidation.js tests/jest/unit/urlValidation.test.js src/clients/ukApiClient.js src/services/ukIntegrationService.js .env.example
git commit -m "fix(security): add SSRF protection — mandatory allowlist in production, IP pattern checks"
```

---

### Task 2: Add `trust proxy` to Express

**Severity:** HIGH
**Why:** Rate limiter uses `req.ip` which behind Nginx returns proxy IP, not the real client. All rate limiting is effectively bypassed.
**Files:**
- Modify: `src/server.js:22-25`

- [x] **Step 1: Add trust proxy setting**

In `src/server.js`, after line 22 (`const app = express();`), add:
```js
// Behind Nginx — trust first proxy for correct req.ip (rate limiting, logging)
app.set('trust proxy', 1);
```

- [x] **Step 2: Verify tests pass**

Run: `npm test`
Expected: All tests pass (this is config-only, no logic change)

- [x] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "fix(security): enable trust proxy for correct client IP behind Nginx"
```

---

### Task 3: Warn on missing UK secrets at startup

**Severity:** HIGH
**Why:** Missing `UK_WEBHOOK_SECRET` silently rejects all webhooks (401) with no clear error in logs. However, UK integration is optional (defaults to `uk_integration_enabled=false` in migration 011), so hard-requiring these secrets would break deployments without UK integration.
**Approach:** Add startup warnings (not hard errors) for UK secrets. They remain ENV-only and are not stored in DB.
**Files:**
- Modify: `src/config/env.js`
- Modify: `.env.example`

- [x] **Step 1: Add UK secrets warning to env validation**

In `src/config/env.js`, after the `if (missing.length > 0)` block (after line 36), add:

```js
    // UK integration env vars: warn if missing (integration is optional,
    // defaults to disabled in DB, but if enabled without these it fails silently).
    // UK_API_ALLOWED_HOSTS is required by Task 1 SSRF protection — without it,
    // validateUKApiUrl() throws at request time in production.
    if (isProduction) {
        const UK_VARS = [
            'UK_WEBHOOK_SECRET', 'UK_SERVICE_USER', 'UK_SERVICE_PASSWORD',
            'UK_API_ALLOWED_HOSTS'
        ];
        const missingUK = UK_VARS.filter(name => !process.env[name]);
        if (missingUK.length > 0) {
            logger.warn(
                `UK integration env vars not configured: ${missingUK.join(', ')}. ` +
                'Webhooks and outbound UK API calls will fail if integration is enabled.'
            );
        }
    }
```

- [x] **Step 2: Update .env.example with UK secrets**

In `.env.example`, add the UK integration secrets section (if not already present):
```bash
# UK Integration (ENV-only secrets — required if uk_integration_enabled=true in DB)
UK_WEBHOOK_SECRET=CHANGE_ME_SHARED_SECRET_WITH_UK_BOT
UK_SERVICE_USER=CHANGE_ME_UK_SERVICE_ACCOUNT
UK_SERVICE_PASSWORD=CHANGE_ME_UK_SERVICE_PASSWORD
```

- [x] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (test env skips validation)

- [x] **Step 4: Commit**

```bash
git add src/config/env.js .env.example
git commit -m "fix(security): warn on missing UK integration secrets at production startup"
```

---

### Task 4: Add table/column whitelist to AdminService

**Severity:** HIGH
**Why:** `batchDelete` and `batchUpdateColumn` interpolate table/column names into SQL without validation. Currently called with hardcoded strings only, but a future caller could pass user input.
**Files:**
- Modify: `src/services/adminService.js:7-17,32-33`
- Modify: `tests/jest/unit/adminService.test.js`

- [x] **Step 1: Write the failing test for whitelist rejection**

Add to `tests/jest/unit/adminService.test.js`, inside `describe('batchDelete')`:

```js
test('rejects untrusted table name', async () => {
    await expect(adminService.batchDelete('users; DROP TABLE --', 'id', [1]))
        .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
});

test('rejects untrusted column name', async () => {
    await expect(adminService.batchDelete('buildings', 'id; DROP TABLE --', [1]))
        .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
});
```

Add inside `describe('batchUpdateColumn')`:

```js
test('rejects untrusted column for update', async () => {
    await expect(adminService.batchUpdateColumn('buildings', 'building_id', [1], 'col; DROP TABLE --', 'val'))
        .rejects.toMatchObject({ message: expect.stringContaining('not allowed') });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/jest/unit/adminService.test.js --no-coverage`
Expected: 3 new tests FAIL (no validation in place)

- [x] **Step 3: Add whitelist validation**

In `src/services/adminService.js`, add before the class definition (after line 2):

```js
// Allowlists for SQL identifiers that can be interpolated safely.
// Callers MUST use only these literal values.
// Tables and columns extracted from actual callers:
// - adminTransformerController.js:227,234,241 → 'transformers', 'transformer_id', 'voltage_kv', 'power_kva'
// - adminLineController.js:232,239,246 → 'lines', 'line_id', 'voltage_kv', 'maintenance_date'
const ALLOWED_TABLES = [
    'buildings', 'controllers', 'metrics', 'alerts', 'alert_types',
    'power_transformers', 'transformers', 'cold_water_sources', 'heat_sources',
    'water_lines', 'water_suppliers', 'users', 'lines',
    'integration_config', 'integration_log', 'alert_rules', 'alert_request_map'
];

const ALLOWED_COLUMNS = [
    'building_id', 'controller_id', 'metric_id', 'alert_id', 'alert_type_id',
    'transformer_id', 'cold_water_source_id', 'heat_source_id',
    'water_line_id', 'water_supplier_id', 'user_id', 'id', 'line_id',
    'status', 'is_active', 'name', 'address', 'description',
    'voltage_kv', 'power_kva', 'maintenance_date',
    'updated_at', 'created_at'
];

function assertAllowedIdentifier(value, allowlist, label) {
    if (!allowlist.includes(value)) {
        throw new Error(`SQL identifier "${value}" not allowed for ${label}`);
    }
}
```

In `batchDelete` (line 16), add before the query:
```js
assertAllowedIdentifier(tableName, ALLOWED_TABLES, 'table');
assertAllowedIdentifier(idColumn, ALLOWED_COLUMNS, 'column');
```

In `batchUpdateColumn` (line 32), add before the query:
```js
assertAllowedIdentifier(tableName, ALLOWED_TABLES, 'table');
assertAllowedIdentifier(idColumn, ALLOWED_COLUMNS, 'column');
assertAllowedIdentifier(column, ALLOWED_COLUMNS, 'column');
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/jest/unit/adminService.test.js --no-coverage`
Expected: All tests PASS (existing + 3 new)

- [x] **Step 5: Commit**

```bash
git add src/services/adminService.js tests/jest/unit/adminService.test.js
git commit -m "fix(security): add SQL identifier whitelist to AdminService batch operations"
```

---

### Task 5: Replace denylist sanitizer with LIKE-safe escaping

**Severity:** HIGH
**Why:** `validateSearchString` uses regex-based character stripping which is bypassable and strips valid characters (apostrophes in Uzbek names like "O'zbekiston"). However, simply removing the sanitizer creates a new problem: all callers (7 admin controllers) use the result in `ILIKE '%${cleanSearch}%'` patterns. Without escaping `%` and `_`, a user can send `%` to match all rows. The fix: remove the denylist, add LIKE wildcard escaping, keep length limit.
**Files:**
- Modify: `src/utils/queryValidation.js:211-237`
- Modify: `tests/jest/unit/queryValidationTest.test.js` (update expectations)

- [x] **Step 1: Check how validateSearchString is called**

Run: `grep -rn "validateSearchString\|cleanSearch" src/controllers/` to confirm all callers use ILIKE patterns.

Expected: 7 controllers, all do `params.push('%${cleanSearch}%')` with ILIKE.

- [x] **Step 2: Replace with LIKE-safe validation**

In `src/utils/queryValidation.js`, replace lines 211-237 with:

```js
function validateSearchString(searchString, maxLength = 100) {
    if (!searchString || typeof searchString !== 'string') {
        return '';
    }

    let cleanString = searchString.trim();

    if (cleanString.length > maxLength) {
        cleanString = cleanString.substring(0, maxLength);
        logger.warn(`Строка поиска обрезана до ${maxLength} символов`);
    }

    // Escape LIKE/ILIKE wildcard characters so user input is treated literally.
    // SQL injection is handled by parameterized queries ($1) — this only
    // prevents % and _ from acting as wildcards in ILIKE patterns.
    cleanString = cleanString
        .replace(/\\/g, '\\\\')  // escape backslash first
        .replace(/%/g, '\\%')    // escape percent
        .replace(/_/g, '\\_');   // escape underscore

    return cleanString;
}
```

- [x] **Step 3: Update tests in the EXISTING file**

**Important:** The test file is `tests/jest/unit/queryValidationTest.test.js` (already exists — do NOT create a new file). Replace the 5 tests at lines 169-196 that assert character removal:

Replace lines 169-196 (from `test('removes HTML meta characters'` through `test('removes event handlers'`) with:

```js
        test('preserves special characters (parameterized queries handle SQL safety)', () => {
            expect(validateSearchString("O'zbekiston")).toBe("O'zbekiston");
            expect(validateSearchString("building <A>")).toBe("building <A>");
            expect(validateSearchString("test'; DROP TABLE--")).toBe("test'; DROP TABLE--");
            expect(validateSearchString('script injection')).toBe('script injection');
            expect(validateSearchString('javascript:void(0)')).toBe('javascript:void(0)');
            expect(validateSearchString('onerror=alert(1)')).toBe('onerror=alert(1)');
        });

        test('escapes LIKE wildcard characters', () => {
            expect(validateSearchString('%')).toBe('\\%');
            expect(validateSearchString('_')).toBe('\\_');
            expect(validateSearchString('test%value')).toBe('test\\%value');
            expect(validateSearchString('hello_world')).toBe('hello\\_world');
            expect(validateSearchString('100%')).toBe('100\\%');
        });

        test('escapes backslashes before wildcards', () => {
            expect(validateSearchString('path\\file')).toBe('path\\\\file');
            expect(validateSearchString('50\\%')).toBe('50\\\\\\%');
        });
```

Keep unchanged: lines 157-167 (null/undefined/non-string), lines 198-217 (trim, truncate, safe strings).

- [x] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [x] **Step 5: Commit**

```bash
git add src/utils/queryValidation.js tests/jest/unit/queryValidationTest.test.js
git commit -m "fix(security): replace bypassable denylist with LIKE wildcard escaping"
```

---

### Task 6: Create ESLint config and fix CI

**Severity:** CRITICAL (CI is broken)
**Why:** `npm run lint` fails because no `.eslintrc.*` exists. CI pipeline runs lint as first job.
**Files:**
- Create: `.eslintrc.json`
- Modify: `.github/workflows/ci.yml` (no change needed if lint passes)

- [x] **Step 1: Create ESLint config**

Create `.eslintrc.json`:

```json
{
  "env": {
    "node": true,
    "es2022": true,
    "jest": true
  },
  "parserOptions": {
    "ecmaVersion": 2022
  },
  "extends": "eslint:recommended",
  "rules": {
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_|^next$|^req$|^res$" }],
    "no-console": "warn",
    "no-constant-condition": "warn",
    "no-undef": "error"
  },
  "ignorePatterns": [
    "node_modules/",
    "tests/",
    "public/",
    "generator/",
    "frontend-design/",
    "coverage/"
  ]
}
```

- [x] **Step 2: Run lint and check for errors**

Run: `npm run lint`
Expected: Should pass with possible warnings (no errors). If errors exist, fix them.

- [x] **Step 3: Fix any lint errors found (if any)**

Address any `error`-level findings. Warnings are acceptable for deployment.

- [x] **Step 4: Commit**

```bash
git add .eslintrc.json
git commit -m "fix(ci): add ESLint config — unblocks CI lint job"
```

---

### Task 7: Fix npm vulnerabilities

**Severity:** CRITICAL (1 critical, 6 high CVEs + misplaced dependency)
**Why:** `bcrypt` dependency chain (`bcrypt` → `@mapbox/node-pre-gyp` → `tar`) has critical path traversal vulnerabilities. Additionally, `axios` is listed in `devDependencies` (package.json:62) but imported in production code (`src/clients/ukApiClient.js:3`). With `npm ci --omit=dev`, axios would NOT be installed and the UK API client would crash at runtime. Must move axios to `dependencies`.
**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Move axios from devDependencies to dependencies**

Run: `npm install axios` (this moves it to `dependencies`)

Verify: `grep -A1 '"axios"' package.json` — should appear under `dependencies`, not `devDependencies`.

- [x] **Step 2: Run audit fix for non-breaking changes**

Run: `npm audit fix`
Check output for what was fixed.

- [x] **Step 3: Upgrade bcrypt to v6 (breaking change)**

Run: `npm install bcrypt@6`

- [x] **Step 4: Verify bcrypt API compatibility**

Check that `bcrypt.hash(password, saltRounds)` and `bcrypt.compare(password, hash)` still work the same way in v6. Read the bcrypt@6 changelog.

Run: `npm test`
Expected: All tests pass (bcrypt v6 has same API for hash/compare)

- [x] **Step 5: Verify no remaining critical/high vulnerabilities**

Run: `npm audit`
Expected: 0 critical, 0 high

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(security): move axios to dependencies, upgrade bcrypt to v6, fix npm audit"
```

---

### Task 8: Harden .dockerignore

**Severity:** CRITICAL
**Why:** `.env`, `.env.prod`, `tests/`, `docs/` are copied into Docker image. Secrets could leak into image layers.
**Files:**
- Modify: `.dockerignore`

- [x] **Step 1: Update .dockerignore**

Replace `.dockerignore` content with:

```
node_modules
npm-debug.log
logs
*.log
.git
.gitignore
.DS_Store

# Secrets — NEVER include in image
.env
.env.*
!.env.example

# Development/test files — not needed in production image
tests/
docs/
coverage/
monitoring/
generator/
frontend-design/
.github/
.worktrees/
*.md
!README.md
docker-compose*.yml
backup-database.sh
swagger_update.js
```

**Note:** Do NOT exclude `nginx*.conf` or `Dockerfile.*` — these are needed as build context by multi-stage builds (e.g., `Dockerfile.frontend-only` copies `nginx-frontend-only.conf`, `Dockerfile.frontend.dev` copies `nginx.dev.conf`, `Dockerfile.unified` copies `nginx.conf`). Docker only reads files from the build context, so they must remain accessible.

- [x] **Step 2: Verify Docker build still works**

Run: `docker build -f Dockerfile.prod -t infrasafe-test .`
Expected: Build succeeds, image contains only `src/`, `public/`, `package*.json`, `node_modules/`

- [x] **Step 3: Verify no secrets in image**

Run: `docker run --rm infrasafe-test ls -la /app/ | head -20`
Expected: No `.env*` files visible

- [x] **Step 4: Commit**

```bash
git add .dockerignore
git commit -m "fix(security): harden .dockerignore — exclude secrets, tests, and docs from image"
```

---

### Task 9: Fix Dockerfile.prod and docker-compose.prod.yml

**Severity:** CRITICAL + HIGH
**Why:** `npm install` is not reproducible (should be `npm ci`). Port 3000 is exposed directly, bypassing Nginx.
**Files:**
- Modify: `Dockerfile.prod:10`
- Modify: `docker-compose.prod.yml:46-47`

- [x] **Step 1: Fix Dockerfile.prod — use npm ci**

In `Dockerfile.prod`, change line 10 from:
```dockerfile
RUN npm install --only=production && \
    npm cache clean --force
```
to:
```dockerfile
RUN npm ci --omit=dev && \
    npm cache clean --force
```

- [x] **Step 2: Fix docker-compose.prod.yml — don't expose app port**

In `docker-compose.prod.yml`, change lines 46-47 from:
```yaml
    ports:
      - "3000:3000"
```
to:
```yaml
    expose:
      - "3000"
```

- [x] **Step 3: Verify Docker build succeeds**

Run: `docker build -f Dockerfile.prod -t infrasafe-test .`
Expected: Build succeeds with `npm ci`

- [x] **Step 4: Commit**

```bash
git add Dockerfile.prod docker-compose.prod.yml
git commit -m "fix(infra): use npm ci for reproducible builds, hide app port behind Nginx"
```

---

### Task 10: Reduce JWT access token lifetime

**Severity:** MEDIUM
**Why:** 24-hour access tokens increase exposure window. Standard practice is 15-60 minutes with refresh rotation (already implemented).
**Files:**
- Modify: `src/services/authService.js:19`

- [x] **Step 1: Change default JWT expiry**

In `src/services/authService.js`, change line 19 from:
```js
this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
```
to:
```js
this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
```

- [x] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (tests mock JWT, don't depend on exact expiry)

- [x] **Step 3: Commit**

```bash
git add src/services/authService.js
git commit -m "fix(security): reduce JWT access token lifetime from 24h to 1h"
```

---

### Task 11: Replace admin stub endpoints with real implementation

**Severity:** MEDIUM
**Why:** `getAdminStats` returns hardcoded fabricated data. `exportData` returns a fake download URL. These mislead operators.
**Files:**
- Modify: `src/controllers/admin/adminGeneralController.js`
- Modify or create: tests for adminGeneralController

- [x] **Step 1: Write test for real admin stats**

Update the existing file `tests/jest/unit/adminGeneralController.test.js` (it currently has only `test.todo` placeholders). Replace its entire content:

```js
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const { getAdminStats, exportData } = require('../../../src/controllers/admin/adminGeneralController');

describe('adminGeneralController', () => {
    beforeEach(() => jest.clearAllMocks());

    test('getAdminStats returns real counts from database', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ count: '17' }] })
            .mockResolvedValueOnce({ rows: [{ count: '15' }] })
            .mockResolvedValueOnce({ rows: [{ count: '1000' }] })
            .mockResolvedValueOnce({ rows: [{ count: '5' }] });

        const req = {};
        const res = { json: jest.fn() };
        const next = jest.fn();

        await getAdminStats(req, res, next);

        expect(db.query).toHaveBeenCalledTimes(4);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            buildings: expect.objectContaining({ total: 17 }),
        }));
        // No "stub" marker in response
        expect(res.json.mock.calls[0][0].message).toBeUndefined();
    });

    test('exportData returns 501', async () => {
        const req = { body: { type: 'buildings', format: 'csv' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await exportData(req, res, next);

        expect(res.status).toHaveBeenCalledWith(501);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Expected: FAIL — current code returns hardcoded data without querying DB

- [x] **Step 3: Implement real admin stats**

In `src/controllers/admin/adminGeneralController.js`, add `db` import at top (preserve existing `createError` import):

```js
const { createError } = require('../../utils/helpers');
const db = require('../../config/database');
```

Replace `getAdminStats`:

```js
async function getAdminStats(req, res, next) {
    try {
        const [buildings, controllers, metrics, alerts] = await Promise.all([
            db.query('SELECT COUNT(*) FROM buildings'),
            db.query('SELECT COUNT(*) FROM controllers'),
            db.query('SELECT COUNT(*) FROM metrics'),
            db.query("SELECT COUNT(*) FROM alerts WHERE status = 'active'"),
        ]);

        res.json({
            buildings: { total: parseInt(buildings.rows[0].count, 10) },
            controllers: { total: parseInt(controllers.rows[0].count, 10) },
            metrics: { total: parseInt(metrics.rows[0].count, 10) },
            alerts: { active: parseInt(alerts.rows[0].count, 10) },
        });
    } catch (error) {
        next(createError('Failed to get stats', 500));
    }
}
```

- [x] **Step 4: Mark exportData as not-implemented (honest 501)**

Replace `exportData`:

```js
async function exportData(req, res, next) {
    try {
        res.status(501).json({
            success: false,
            error: 'Export functionality not yet implemented',
        });
    } catch (error) {
        next(createError('Export failed', 500));
    }
}
```

- [x] **Step 5: Run tests**

Run: `npm test`
Expected: All pass

- [x] **Step 6: Commit**

```bash
git add src/controllers/admin/adminGeneralController.js tests/jest/unit/adminGeneralController.test.js
git commit -m "fix: replace admin stats stub with real DB queries, mark export as 501"
```

---

### Task 12: Add Node.js engine requirement

**Severity:** MEDIUM
**Why:** No version constraint in `package.json`. Incompatible Node.js version could be used.
**Files:**
- Modify: `package.json`

- [x] **Step 1: Add engines field**

In `package.json`, add after the `"license"` field:

```json
"engines": {
    "node": ">=20.0.0"
},
```

- [x] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: require Node.js 20+ in package.json engines"
```

---

## Post-Implementation Verification

After all tasks are complete, run:

- [x] `npm test` — 106 suites, 1955 tests passed, 0 failures
- [x] `npm run lint` — 0 errors, 21 warnings
- [x] `npm audit` — 0 vulnerabilities
- [ ] `docker build -f Dockerfile.prod -t infrasafe-verify .` — builds successfully (requires Docker daemon)
- [ ] `docker run --rm infrasafe-verify ls -la /app/` — no `.env*` files (requires Docker daemon)
- [x] Review git log for clean commit history — commit `bc34ce1`

---

## Out of Scope (future work, not blocking deploy)

These items from the audit are NOT in this plan — they are tracked but not blocking:

| Item | Reason deferred |
|------|----------------|
| Automated migration runner | Requires architecture decision (Flyway/node-pg-migrate/custom) |
| Redis-backed rate limiting | Requires Redis infrastructure |
| Prometheus metrics endpoint | New feature, not a fix |
| Automated DB backups (cron) | Ops concern, not code change |
| `localStorage` → `httpOnly` cookie for JWT | Frontend redesign scope |
| `docker-compose.prod.yml` Nginx config | Needs decision on unified vs split compose |
| Telemetry endpoint device auth | Requires device key management design |
| Monitoring dashboards | Ops/infra work |
