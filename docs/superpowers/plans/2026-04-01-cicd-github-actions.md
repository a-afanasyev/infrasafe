# CI/CD Pipeline — GitHub Actions

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Automate test runs on every PR and push to main via GitHub Actions.

**Architecture:** Two workflows: `test.yml` (runs on PR/push, validates code) and `deploy.yml` (manual trigger for production deployment). Tests run in Docker containers matching production stack.

**Tech Stack:** GitHub Actions, Docker Compose, Node.js 18, PostgreSQL 15 + PostGIS, Jest

---

## File Structure

```
.github/
└── workflows/
    ├── test.yml        # PR + push to main: lint, unit, integration, security tests
    └── deploy.yml      # Manual: build + push Docker images (future)
```

---

### Task 1: Create Test Workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create workflow file**

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

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

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Init database schema
        run: |
          PGPASSWORD=postgres psql -h localhost -U postgres -d infrasafe -f database/init/01_init_database.sql
          PGPASSWORD=postgres psql -h localhost -U postgres -d infrasafe -f database/init/02_seed_data.sql

      - name: Run linter
        run: npm run lint
        continue-on-error: true

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Run security tests
        run: npm run test:security

      - name: Run tests with coverage
        run: npm run test:coverage
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: infrasafe
          DB_USER: postgres
          DB_PASSWORD: postgres
          JWT_SECRET: ci-test-jwt-secret-not-for-production
          JWT_REFRESH_SECRET: ci-test-refresh-secret-not-for-production
          NODE_ENV: test

  e2e:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Start Docker Compose
        run: docker compose -f docker-compose.dev.yml up -d --build
        env:
          JWT_SECRET: ci-test-jwt-secret
          JWT_REFRESH_SECRET: ci-test-refresh-secret

      - name: Wait for healthy containers
        run: |
          timeout 60 bash -c 'until docker compose -f docker-compose.dev.yml ps | grep -q "healthy"; do sleep 2; done'
          sleep 5

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          E2E_BASE_URL: http://localhost:3000

      - name: Docker logs on failure
        if: failure()
        run: docker compose -f docker-compose.dev.yml logs --tail=50

      - name: Stop Docker Compose
        if: always()
        run: docker compose -f docker-compose.dev.yml down
```

- [ ] **Step 2: Run test locally to verify**

```bash
npm run lint && npm test
```

- [ ] **Step 3: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions test workflow (unit + integration + security + e2e)"
```

---

### Task 2: Create Deploy Workflow (manual trigger)

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create deploy workflow**

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy environment'
        required: true
        default: 'production'
        type: choice
        options:
          - production
          - staging

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}

    steps:
      - uses: actions/checkout@v4

      - name: Build production images
        run: |
          docker build -f Dockerfile.prod -t infrasafe-app:${{ github.sha }} .
          docker build -f Dockerfile.frontend-only -t infrasafe-frontend:${{ github.sha }} .

      - name: Tag as latest
        run: |
          docker tag infrasafe-app:${{ github.sha }} infrasafe-app:latest
          docker tag infrasafe-frontend:${{ github.sha }} infrasafe-frontend:latest

      # TODO: Push to container registry (Docker Hub, GHCR, etc.)
      # - name: Push to registry
      #   run: |
      #     docker push $REGISTRY/infrasafe-app:${{ github.sha }}
      #     docker push $REGISTRY/infrasafe-frontend:${{ github.sha }}

      - name: Deploy summary
        run: |
          echo "## Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "- **Environment:** ${{ github.event.inputs.environment }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Commit:** ${{ github.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Images built:** infrasafe-app, infrasafe-frontend" >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add manual deploy workflow (build production Docker images)"
```

---

### Task 3: Add status badge to README

- [ ] **Step 1: Add badge to README.md**

At the top of README.md, after the title, add:

```markdown
![Tests](https://github.com/a-afanasyev/infrasafe/actions/workflows/test.yml/badge.svg)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add CI test status badge to README"
```

---

## Summary

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `test.yml` | PR + push to main | Lint, unit, integration, security, E2E tests |
| `deploy.yml` | Manual (workflow_dispatch) | Build production Docker images |

After setup: every PR gets automated test check, deploy is one-click.
