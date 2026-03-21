---
name: InfraSafe test suite details
description: 175 tests across 16 suites - unit, integration, security; all pass offline with DB mock
type: project
---

175 tests, 16 suites, all passing. Tests run offline using DB mock helper (`tests/jest/helpers/dbMock.js`).

**Why:** Tests must work without a running PostgreSQL instance for CI and local dev.

**How to apply:** When adding new tests, use the dbMock helper for any test that touches the database layer. Run `npm test` before committing.

### Test structure:
- **Unit (10 files):** `tests/jest/unit/` — services, controllers, models, middleware
- **Integration (2 files):** `tests/jest/integration/` — API routes, default-deny auth
- **Security (3 files):** `tests/jest/security/` — SQL injection, XSS, general security
- **Setup:** `tests/jest/setup.js`

### Commands:
- `npm test` — all tests
- `npm run test:unit` / `test:integration` / `test:security`
- `npm run test:coverage` — with coverage report

### Known issue:
Jest worker process force-exit warning due to timer leaks — cosmetic, not a test failure.
