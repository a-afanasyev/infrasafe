# InfraSafe Production Readiness — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить 5 CRITICAL-блокеров и 5 операционных пробелов, чтобы поднять production-readiness с 6.5/10 до 8/10.

**Architecture:** Инфраструктурная гигиена без архитектурных изменений. Затрагиваются Docker-файлы, compose-конфигурации, ESLint, CI/CD pipeline, health endpoint, server.js. Код бэкенда изменяется минимально (trust proxy, расширенный health check, Swagger flag, query log truncation).

**Tech Stack:** Node.js 22, Docker Compose, Nginx + TLS, GitHub Actions, ESLint 9, Winston

**Source:** `project-audit.md`, `docs/production/PRODUCTION-UPGRADE-PLAN.md`

---

## File Structure

```
Create:
  .github/workflows/test.yml                  — CI pipeline: lint + audit + test
  eslint.config.mjs                            — ESLint 9 flat config для Node.js
  scripts/backup-db.sh                         — Cron-скрипт бэкапов PostgreSQL
  database/migrations/000_schema_migrations.sql — Таблица трекинга миграций
  database/migrate.sh                          — Bash migration runner

Modify:
  Dockerfile.prod                              — node:18 → node:22, npm ci --omit=dev
  Dockerfile.dev                               — node:18 → node:22
  docker-compose.unified.yml                   — убрать хардкоженные секреты + комментарии
  docker-compose.prod.yml                      — добавить nginx + TLS, убрать порт БД
  package.json                                 — ESLint 9 в devDeps, lint script
  src/server.js                                — trust proxy, Swagger flag, расширенный /health
  src/config/database.js                       — truncate query text в debug-логе
  .env.example                                 — добавить UK Integration и SENTRY_DSN секции
  README.md                                    — обновить кол-во тестов 175 → 677

Delete:
  database/migrations/003_power_calculation_system.sql       — дубликат миграции
  database/migrations/003_power_calculation_system_fixed.sql — дубликат миграции
```

---

### Task 1: Secrets — Убрать хардкоженные пароли из docker-compose.unified.yml

**Files:**
- Modify: `docker-compose.unified.yml:29-39` (app.environment)
- Modify: `docker-compose.unified.yml:51-54` (postgres.environment)
- Modify: `docker-compose.unified.yml:67-202` (удалить закомментированные сервисы)

- [ ] **Step 1: Заменить хардкоженный DB_PASSWORD в секции app**

В `docker-compose.unified.yml` строка 36, заменить:

```yaml
      - DB_PASSWORD=@ppl1c@ti0n
```

на:

```yaml
      - DB_PASSWORD=${DB_PASSWORD:-dev-password-change-in-production}
```

- [ ] **Step 2: Заменить хардкоженный POSTGRES_PASSWORD в секции postgres**

В `docker-compose.unified.yml` строки 51-54, заменить:

```yaml
    environment:
      - POSTGRES_PASSWORD=@ppl1c@ti0n
      - POSTGRES_USER=infrasafe_app
      - POSTGRES_DB=infrasafe
```

на:

```yaml
    environment:
      - POSTGRES_PASSWORD=${DB_PASSWORD:-dev-password-change-in-production}
      - POSTGRES_USER=${DB_USER:-infrasafe_app}
      - POSTGRES_DB=${DB_NAME:-infrasafe}
```

- [ ] **Step 3: Удалить все закомментированные сервисы (строки 67-157)**

Удалить блоки: Mosquitto, InfluxDB, Grafana, Node-RED, WireGuard (строки 67-157 целиком). Эти сервисы содержат реальный IP-адрес сервера `95.46.96.105` и загрязняют файл.

После удаления файл должен содержать только: `frontend`, `app`, `postgres`, `nginx`, `volumes`, `networks`.

- [ ] **Step 4: Проверить корректность compose**

```bash
docker compose -f docker-compose.unified.yml config --quiet
```

Expected: команда завершается без ошибок (exit code 0)

- [ ] **Step 5: Commit**

```bash
git add docker-compose.unified.yml
git commit -m "fix(security): remove hardcoded secrets and dead config from unified compose

- Replace DB_PASSWORD=@ppl1c@ti0n with env variable reference
- Replace POSTGRES_PASSWORD with env variable reference
- Remove 90 lines of commented-out services (Mosquitto, InfluxDB, Grafana, Node-RED, WireGuard)
- Remove leaked server IP address 95.46.96.105 from WireGuard comment"
```

---

### Task 2: Node.js Version — Обновить Dockerfiles с 18 на 22

**Files:**
- Modify: `Dockerfile.prod:1-2,10`
- Modify: `Dockerfile.dev:1`

- [ ] **Step 1: Обновить Dockerfile.prod — builder stage**

Строка 2, заменить:

```dockerfile
FROM node:18-alpine AS builder
```

на:

```dockerfile
FROM node:22-alpine AS builder
```

- [ ] **Step 2: Обновить Dockerfile.prod — npm install → npm ci**

Строка 10, заменить:

```dockerfile
RUN npm install --only=production && \
    npm cache clean --force
```

на:

```dockerfile
RUN npm ci --omit=dev && \
    npm cache clean --force
```

- [ ] **Step 3: Обновить Dockerfile.prod — production stage**

Строка 14, заменить:

```dockerfile
FROM node:18-alpine AS production
```

на:

```dockerfile
FROM node:22-alpine AS production
```

- [ ] **Step 4: Обновить Dockerfile.dev**

Строка 1, заменить:

```dockerfile
FROM node:18-alpine
```

на:

```dockerfile
FROM node:22-alpine
```

- [ ] **Step 5: Проверить сборку**

```bash
docker build -f Dockerfile.prod -t infrasafe-prod-test .
docker run --rm infrasafe-prod-test node --version
```

Expected: `v22.x.x`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.prod Dockerfile.dev
git commit -m "chore: upgrade Node.js 18 → 22 LTS in Dockerfiles

- node:18-alpine → node:22-alpine (Node 18 EOL Apr 2025)
- npm install --only=production → npm ci --omit=dev (deterministic, faster)"
```

---

### Task 3: ESLint — Создать конфигурацию и обновить зависимости

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json:9,63` (lint script + eslint version)

- [ ] **Step 1: Создать `eslint.config.mjs`**

```javascript
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      }
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_|^next$|^req$|^res$|^err$',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'warn',
      'no-undef': 'error',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
    }
  },
  {
    ignores: [
      'node_modules/',
      'public/libs/',
      'generator/',
      '.worktrees/',
      'tests/',
      'coverage/',
      'logs/',
      'backup/',
    ]
  }
];
```

- [ ] **Step 2: Обновить зависимости**

```bash
npm install --save-dev eslint@^9 @eslint/js globals
```

- [ ] **Step 3: Обновить lint script в package.json**

В `package.json`, строка 9, заменить:

```json
"lint": "eslint src/",
```

на:

```json
"lint": "eslint src/ public/ --ignore-pattern 'public/libs/'",
```

- [ ] **Step 4: Запустить lint и исправить CRITICAL ошибки**

```bash
npm run lint
```

Если есть ошибки `no-undef` или `eqeqeq` — исправить. `no-unused-vars` warnings допустимы на этом этапе.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json
git commit -m "chore: add ESLint 9 config with Node.js rules

- Create eslint.config.mjs (flat config)
- Upgrade eslint ^8.56 → ^9, add @eslint/js + globals
- Lint scope: src/ + public/ (excluding libs)"
```

---

### Task 4: TLS Nginx — Добавить в docker-compose.prod.yml

**Files:**
- Modify: `docker-compose.prod.yml:1,77-121` (добавить nginx, убрать порт БД, убрать version)

- [ ] **Step 1: Убрать deprecated `version` ключ**

В `docker-compose.prod.yml`, удалить строку 1:

```yaml
version: '3.8'
```

(Docker Compose v2+ не требует version)

- [ ] **Step 2: Добавить nginx-сервис с TLS**

Перед секцией `volumes:` (перед строкой 113) добавить:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.production.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt/live/infrasafe.aisolutions.uz/fullchain.pem:/etc/nginx/ssl/fullchain.pem:ro
      - /etc/letsencrypt/live/infrasafe.aisolutions.uz/privkey.pem:/etc/nginx/ssl/privkey.pem:ro
      - /etc/letsencrypt/live/infrasafe.aisolutions.uz/chain.pem:/etc/nginx/ssl/chain.pem:ro
      - ./index.html:/usr/share/nginx/html/index.html:ro
      - ./admin.html:/usr/share/nginx/html/admin.html:ro
      - ./about.html:/usr/share/nginx/html/about.html:ro
      - ./contacts.html:/usr/share/nginx/html/contacts.html:ro
      - ./documentation.html:/usr/share/nginx/html/documentation.html:ro
      - ./css:/usr/share/nginx/html/css:ro
      - ./public:/usr/share/nginx/html/public:ro
      - ./data:/usr/share/nginx/html/data:ro
    depends_on:
      app:
        condition: service_healthy
      frontend:
        condition: service_healthy
    networks:
      - infrasafe-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Убрать публичный порт PostgreSQL**

В секции `postgres:`, закомментировать или удалить:

```yaml
    ports:
      - "5432:5432"
```

БД должна быть доступна только через docker network.

- [ ] **Step 4: Проверить корректность compose**

```bash
docker compose -f docker-compose.prod.yml config --quiet
```

Expected: exit code 0

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(infra): add nginx TLS reverse proxy to prod compose

- Add nginx service with Let's Encrypt SSL certs
- Mount nginx.production.conf (already exists)
- Remove public PostgreSQL port (5432) for security
- Remove deprecated version: '3.8' key"
```

---

### Task 5: CI/CD — GitHub Actions pipeline

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Создать директорию**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Создать `.github/workflows/test.yml`**

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint & Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm audit --audit-level=high || true

  test:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    needs: lint
    services:
      postgres:
        image: postgis/postgis:15-3.3
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: infrasafe
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci

      - name: Initialize database
        env:
          PGPASSWORD: postgres
        run: |
          psql -h localhost -U postgres -d infrasafe -f database/init/01_init_database.sql
          psql -h localhost -U postgres -d infrasafe -f database/init/02_seed_data.sql

      - name: Run tests with coverage
        run: npm run test:coverage
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: infrasafe
          DB_USER: postgres
          DB_PASSWORD: postgres
          JWT_SECRET: ci-test-secret-not-for-production-use-only
          JWT_REFRESH_SECRET: ci-test-refresh-secret-not-for-production
          NODE_ENV: test
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions test pipeline

- Lint + npm audit on every PR/push to main
- Unit/integration/security tests with PostGIS service container
- Concurrency: cancel in-progress on same branch
- Node.js 22, npm ci for deterministic installs"
```

---

### Task 6: Server Hardening — trust proxy, Swagger flag, expanded health

**Files:**
- Modify: `src/server.js:17,24,57-65,70-103`

- [ ] **Step 1: Добавить `trust proxy` после создания app**

В `src/server.js`, после строки 17 (`const app = express();`), добавить:

```javascript
// Trust first proxy (Nginx) — нужно для корректной работы rate limiter за reverse proxy
app.set('trust proxy', 1);
```

- [ ] **Step 2: Заменить Swagger условие на явный флаг**

В `src/server.js`, строка 71, заменить:

```javascript
if (process.env.NODE_ENV !== 'production') {
```

на:

```javascript
if (process.env.SWAGGER_ENABLED === 'true') {
```

- [ ] **Step 3: Расширить health check endpoint**

В `src/server.js`, заменить текущий health check (строки 57-65):

```javascript
// Health check endpoint для Docker
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'healthy', db: 'connected' });
    } catch {
        res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
    }
});
```

на:

```javascript
// Health check endpoint для Docker и мониторинга
app.get('/health', async (req, res) => {
    const checks = {};
    let healthy = true;

    // Database connectivity
    try {
        const start = Date.now();
        await db.query('SELECT 1');
        checks.database = { status: 'up', latency_ms: Date.now() - start };
    } catch {
        checks.database = { status: 'down' };
        healthy = false;
    }

    // Memory usage
    const mem = process.memoryUsage();
    checks.memory = {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    };

    // Uptime
    checks.uptime_seconds = Math.round(process.uptime());

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        version: require('../package.json').version,
        timestamp: new Date().toISOString(),
        checks,
    });
});
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test
```

Expected: все тесты проходят (некоторые unit-тесты могут мокать health endpoint — проверить)

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "feat(server): add trust proxy, Swagger flag, expanded health check

- app.set('trust proxy', 1) for correct IP behind Nginx
- Swagger gated by SWAGGER_ENABLED env var (not NODE_ENV)
- /health returns DB latency, memory usage, uptime, version"
```

---

### Task 7: Database — Truncate query log, migration runner, cleanup

**Files:**
- Modify: `src/config/database.js:45`
- Create: `database/migrations/000_schema_migrations.sql`
- Create: `database/migrate.sh`
- Delete: `database/migrations/003_power_calculation_system.sql`
- Delete: `database/migrations/003_power_calculation_system_fixed.sql`

- [ ] **Step 1: Truncate SQL query text в debug-логе**

В `src/config/database.js`, строка 45, заменить:

```javascript
        logger.debug(`Выполнен запрос: ${text}, длительность: ${duration}ms, строк: ${result.rowCount}`);
```

на:

```javascript
        logger.debug(`Query: ${text.substring(0, 80).replace(/\s+/g, ' ')}..., ${duration}ms, ${result.rowCount} rows`);
```

- [ ] **Step 2: Создать таблицу трекинга миграций**

Создать `database/migrations/000_schema_migrations.sql`:

```sql
-- Schema migrations tracking table
-- Used by database/migrate.sh to track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 3: Создать migration runner скрипт**

Создать `database/migrate.sh`:

```bash
#!/bin/bash
# Usage: ./database/migrate.sh [container_name] [db_user] [db_name]
# Example: ./database/migrate.sh infrasafe-postgres-1 infrasafe_app infrasafe

set -euo pipefail

DB_CONTAINER="${1:-infrasafe-postgres-1}"
DB_USER="${2:-postgres}"
DB_NAME="${3:-infrasafe}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"

echo "=== InfraSafe Migration Runner ==="
echo "Container: $DB_CONTAINER"
echo "Database:  $DB_NAME"
echo "User:      $DB_USER"
echo ""

# Ensure schema_migrations table exists
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());" \
  2>/dev/null

applied=0
skipped=0
failed=0

for file in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$file" ] || continue
    version=$(basename "$file")

    # Check if already applied
    result=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT 1 FROM schema_migrations WHERE version = '$version'" 2>/dev/null || echo "")

    if [ "$result" = "1" ]; then
        echo "SKIP: $version (already applied)"
        skipped=$((skipped + 1))
        continue
    fi

    echo -n "APPLY: $version ... "
    if docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$file" > /dev/null 2>&1; then
        docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
          "INSERT INTO schema_migrations (version) VALUES ('$version')" > /dev/null 2>&1
        echo "OK"
        applied=$((applied + 1))
    else
        echo "FAILED"
        failed=$((failed + 1))
        echo "ERROR: Migration $version failed. Stopping."
        exit 1
    fi
done

echo ""
echo "=== Summary: $applied applied, $skipped skipped, $failed failed ==="
```

- [ ] **Step 4: Сделать скрипт исполняемым**

```bash
chmod +x database/migrate.sh
```

- [ ] **Step 5: Удалить дублирующие миграции 003**

```bash
rm database/migrations/003_power_calculation_system.sql
rm database/migrations/003_power_calculation_system_fixed.sql
```

Оставить только `database/migrations/003_power_calculation_v2.sql` — актуальную версию.

- [ ] **Step 6: Commit**

```bash
git add src/config/database.js database/migrations/000_schema_migrations.sql database/migrate.sh
git rm database/migrations/003_power_calculation_system.sql database/migrations/003_power_calculation_system_fixed.sql
git commit -m "feat(db): add migration runner, truncate debug query log

- Create schema_migrations table for tracking applied migrations
- Add database/migrate.sh — idempotent bash migration runner
- Truncate SQL text in debug log to 80 chars (prevent data leaks)
- Remove duplicate migration files (003_power_calculation_system, 003_...fixed)
- Keep only 003_power_calculation_v2.sql as canonical version"
```

---

### Task 8: Documentation — Обновить .env.example и README

**Files:**
- Modify: `.env.example:76-77`
- Modify: `README.md:182`

- [ ] **Step 1: Добавить UK Integration и Sentry секции в .env.example**

В `.env.example`, после строки 77 (конец файла), добавить:

```bash

# ------------------------------------------
# UK Integration (required if uk_integration_enabled=true in DB)
# ------------------------------------------
# UK_WEBHOOK_SECRET=generate_with_openssl_rand_hex_32
# UK_SERVICE_USER=infrasafe-service
# UK_SERVICE_PASSWORD=CHANGE_ME

# ------------------------------------------
# Error Tracking (optional, recommended for production)
# ------------------------------------------
# SENTRY_DSN=https://xxx@sentry.io/yyy
```

- [ ] **Step 2: Обновить количество тестов в README**

В `README.md`, строка 182, заменить:

```
npm test                  # Все 175 тестов (16 suites)
```

на:

```
npm test                  # Все тесты (~620 unit/integration/security)
npm run test:e2e          # E2E тесты (~57, требует Docker)
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add UK Integration vars to .env.example, update test count in README

- Add UK_WEBHOOK_SECRET, UK_SERVICE_USER, UK_SERVICE_PASSWORD to .env.example
- Add SENTRY_DSN placeholder
- Update README: 175 tests → 620 unit + 57 E2E"
```

---

### Task 9: Backup Script — Автоматические бэкапы PostgreSQL

**Files:**
- Create: `scripts/backup-db.sh`

- [ ] **Step 1: Создать директорию**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Создать `scripts/backup-db.sh`**

```bash
#!/bin/bash
# InfraSafe PostgreSQL Backup Script
# Usage: ./scripts/backup-db.sh [backup_dir] [container_name]
# Cron:  0 2 * * * /path/to/infrasafe/scripts/backup-db.sh >> /var/log/infrasafe-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${1:-/backups/infrasafe}"
CONTAINER="${2:-infrasafe-postgres-1}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-infrasafe}"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/infrasafe_${TIMESTAMP}.dump"

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting backup..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check container is running
if ! docker inspect "$CONTAINER" > /dev/null 2>&1; then
    echo "ERROR: Container $CONTAINER not found or not running"
    exit 1
fi

# Dump with custom format (compressed)
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc \
    > "$BACKUP_FILE"

# Verify backup file exists and has size > 0
if [ ! -s "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file is empty or not created"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup completed: $BACKUP_FILE ($BACKUP_SIZE)"

# Rotate old backups
DELETED=$(find "$BACKUP_DIR" -name "infrasafe_*.dump" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "Rotated $DELETED backups older than $RETENTION_DAYS days"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Done"
```

- [ ] **Step 3: Сделать скрипт исполняемым**

```bash
chmod +x scripts/backup-db.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-db.sh
git commit -m "feat(ops): add PostgreSQL backup script with 14-day rotation

- Custom format dump (compressed, restorable with pg_restore)
- Configurable backup dir, container name, retention period
- Container health check before backup
- Empty file guard
- Ready for cron: 0 2 * * * /path/to/scripts/backup-db.sh"
```

---

### Task 10: Final Verification — Smoke test всех изменений

**Files:** (no new files)

- [ ] **Step 1: Запустить lint**

```bash
npm run lint
```

Expected: 0 errors (warnings допустимы)

- [ ] **Step 2: Запустить все тесты**

```bash
npm test
```

Expected: все ~620 тестов проходят

- [ ] **Step 3: Проверить Docker build**

```bash
docker build -f Dockerfile.prod -t infrasafe-prod-verify .
docker run --rm infrasafe-prod-verify node --version
```

Expected: `v22.x.x`

- [ ] **Step 4: Проверить все compose-файлы**

```bash
docker compose -f docker-compose.dev.yml config --quiet
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.unified.yml config --quiet
```

Expected: все 3 — exit code 0

- [ ] **Step 5: Проверить migration runner (на dev)**

```bash
docker compose -f docker-compose.dev.yml up -d postgres
sleep 10
./database/migrate.sh infrasafe-postgres-1 postgres infrasafe
```

Expected: `=== Summary: N applied, M skipped, 0 failed ===`

- [ ] **Step 6: Финальный коммит (если были lint-фиксы)**

```bash
# Только если были изменения от lint
git add -A
git commit -m "fix: address ESLint findings from initial run"
```

- [ ] **Step 7: Push**

```bash
git push origin main
```

Expected: GitHub Actions pipeline запускается и проходит.
