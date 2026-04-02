# InfraSafe — План обновления для вывода в Production

**Дата:** 2026-04-02
**Основание:** Полный аудит проекта (`project-audit.md`)
**Текущая оценка:** 6.5/10 — НЕ готов к production

---

## Философия плана

Проект архитектурно зрелый: трёхслойный бэкенд, 677 тестов, 90% coverage, default-deny JWT. Основные проблемы — **операционные**, не архитектурные. Поэтому план фокусируется на инфраструктурной гигиене, а не на переписывании кода.

**Принцип:** минимальные изменения кода, максимальный эффект на production-readiness.

---

## Фаза 0: CRITICAL блокеры (1-2 дня)

> Без этих исправлений деплоить нельзя. Все задачи — обязательные.

### 0.1 Ротация и вынос секретов из git

**Проблема:** `docker-compose.unified.yml` содержит `DB_PASSWORD=@ppl1c@ti0n` (строки 36, 52), что закоммичено в историю git.

**Действия:**

1. **Вынести секреты в `.env.prod`** (уже в `.gitignore`):

```bash
# Создать .env.prod на сервере (НИКОГДА не коммитить)
cat > .env.prod << 'EOF'
NODE_ENV=production
PORT=3000

# Database — СГЕНЕРИРОВАТЬ НОВЫЙ ПАРОЛЬ
DB_HOST=postgres
DB_PORT=5432
DB_NAME=infrasafe
DB_USER=infrasafe_app
DB_PASSWORD=$(openssl rand -base64 32)

# JWT — ОБЯЗАТЕЛЬНО СГЕНЕРИРОВАТЬ
JWT_SECRET=$(openssl rand -base64 64)
JWT_REFRESH_SECRET=$(openssl rand -base64 64)

# CORS — указать домен production
CORS_ORIGINS=https://infrasafe.aisolutions.uz

# UK Integration
UK_WEBHOOK_SECRET=$(openssl rand -hex 32)
UK_SERVICE_USER=infrasafe-service
UK_SERVICE_PASSWORD=$(openssl rand -base64 32)

# Logging
LOG_LEVEL=warn
EOF
```

2. **Исправить `docker-compose.unified.yml`** — убрать хардкоженные значения:

```yaml
# Было:
- DB_PASSWORD=@ppl1c@ti0n
# Стало:
- DB_PASSWORD=${DB_PASSWORD}
```

3. **Ротировать пароль БД на сервере** (если unified compose использовался в production):

```bash
# Подключиться к PostgreSQL и сменить пароль
docker exec -it infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe \
  -c "ALTER USER infrasafe_app PASSWORD 'НОВЫЙ_ПАРОЛЬ';"
```

4. **Опционально: очистить историю git** (если репозиторий публичный):

```bash
# Через BFG Repo-Cleaner
bfg --replace-text passwords.txt repo.git
```

**Оценка трудоёмкости:** 1-2 часа

---

### 0.2 Обновить Node.js в Dockerfiles

**Проблема:** `Dockerfile.prod` и `Dockerfile.dev` используют `node:18-alpine`, а в README заявлен Node.js 20+. Node 18 EOL — апрель 2025 (уже не поддерживается).

**Действия:**

Файлы: `Dockerfile.prod`, `Dockerfile.dev`

```dockerfile
# Было:
FROM node:18-alpine AS builder
FROM node:18-alpine AS production

# Стало (Node 22 LTS — поддержка до апреля 2027):
FROM node:22-alpine AS builder
FROM node:22-alpine AS production
```

Дополнительно заменить deprecated флаг:

```dockerfile
# Было:
RUN npm install --only=production && npm cache clean --force

# Стало:
RUN npm ci --omit=dev && npm cache clean --force
```

> `npm ci` лучше `npm install` для CI/Docker: строгое соответствие lock-файлу, быстрее, детерминистичнее.

**Оценка трудоёмкости:** 30 минут + тестирование

---

### 0.3 Создать конфигурацию ESLint

**Проблема:** `npm run lint` работает с пустой конфигурацией, фактически ничего не проверяет.

**Действия:**

Создать `eslint.config.mjs` (ESLint 9 flat config):

```javascript
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
      'no-console': 'warn',
      'no-undef': 'error',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
    }
  },
  {
    ignores: ['node_modules/', 'public/libs/', 'tests/', 'generator/', '.worktrees/']
  }
];
```

Обновить devDependencies:

```bash
npm install --save-dev eslint@^9 @eslint/js
```

Обновить скрипт в `package.json`:

```json
"lint": "eslint src/ public/ --ignore-pattern 'public/libs/'"
```

**Оценка трудоёмкости:** 1-2 часа (включая исправление ошибок lint)

---

### 0.4 Добавить TLS в prod docker-compose

**Проблема:** `docker-compose.prod.yml` не содержит nginx с TLS. Приложение слушает чистый HTTP.

**Действия:**

Добавить nginx-сервис в `docker-compose.prod.yml`:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.prod.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt/live/infrasafe.aisolutions.uz/fullchain.pem:/etc/nginx/ssl/fullchain.pem:ro
      - /etc/letsencrypt/live/infrasafe.aisolutions.uz/privkey.pem:/etc/nginx/ssl/privkey.pem:ro
    depends_on:
      app:
        condition: service_healthy
      frontend:
        condition: service_healthy
    networks:
      - infrasafe-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Создать `nginx.prod.conf` с SSL:

```nginx
server {
    listen 80;
    server_name infrasafe.aisolutions.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name infrasafe.aisolutions.uz;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # ... (остальная конфигурация из nginx.conf)
}
```

> **Альтернатива (проще):** Если перед Docker стоит reverse proxy на хосте (Caddy, Traefik), TLS можно настроить там. Caddy — самый простой вариант: автоматический Let's Encrypt без настройки.

**Оценка трудоёмкости:** 2-3 часа

---

### 0.5 Минимальный CI/CD pipeline

**Проблема:** Тесты запускаются только вручную. Нет автоматической проверки при push/PR.

**Действия:**

Создать `.github/workflows/test.yml`:

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
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm audit --audit-level=high
      - run: npm test
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: infrasafe
          DB_USER: postgres
          DB_PASSWORD: postgres
          JWT_SECRET: ci-test-secret-not-for-production
          JWT_REFRESH_SECRET: ci-test-refresh-secret-not-for-production
          NODE_ENV: test
```

**Оценка трудоёмкости:** 1-2 часа

---

## Фаза 1: Операционная готовность (3-5 дней)

> Без этих мер система работает, но слепо — вы не увидите проблем до того, как они станут инцидентами.

### 1.1 Бэкапы PostgreSQL

**Проблема:** Нет автоматических бэкапов. Потеря данных при сбое PostgreSQL — потеря всей системы.

**Решение:** Cron-скрипт + ротация:

```bash
#!/bin/bash
# backup-db.sh — запускать через cron: 0 2 * * *
BACKUP_DIR="/backups/infrasafe"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CONTAINER="infrasafe-postgres-1"

mkdir -p "$BACKUP_DIR"

# Дамп с сжатием
docker exec "$CONTAINER" pg_dump -U infrasafe_app -d infrasafe -Fc \
  > "$BACKUP_DIR/infrasafe_${TIMESTAMP}.dump"

# Ротация: хранить 14 дней
find "$BACKUP_DIR" -name "*.dump" -mtime +14 -delete

echo "Backup completed: infrasafe_${TIMESTAMP}.dump"
```

Добавить в crontab сервера:

```
0 2 * * * /opt/infrasafe/backup-db.sh >> /var/log/infrasafe-backup.log 2>&1
```

**Проверка восстановления:**

```bash
docker exec -i infrasafe-postgres-1 pg_restore -U infrasafe_app -d infrasafe_test \
  < /backups/infrasafe/infrasafe_20260402_020000.dump
```

**Оценка трудоёмкости:** 2-3 часа

---

### 1.2 Error tracking (Sentry)

**Проблема:** Ошибки пишутся только в лог-файлы. Нет агрегации, нет алертов, нет stack trace с контекстом.

**Решение:** Подключить Sentry (бесплатный план: 5K ошибок/мес):

```bash
npm install @sentry/node
```

В `src/server.js` (до всех middleware):

```javascript
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1, // 10% трейсов для performance
  });
  app.use(Sentry.Handlers.requestHandler());
}

// ... все middleware ...

// Перед errorHandler:
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}
app.use(errorHandler);
```

Добавить в `.env.example`:

```bash
# SENTRY_DSN=https://xxx@sentry.io/yyy
```

**Оценка трудоёмкости:** 2 часа

---

### 1.3 Migration runner

**Проблема:** 11 SQL-файлов применяются вручную. 3 варианта миграции 003 — непонятно какой актуален. Нет записи о том, какие миграции уже применены.

**Решение (простое, без ORM):** Создать таблицу `schema_migrations` + bash-скрипт:

```sql
-- database/migrations/000_schema_migrations.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

```bash
#!/bin/bash
# database/migrate.sh
DB_CONTAINER="${1:-infrasafe-postgres-1}"
DB_USER="${2:-infrasafe_app}"
DB_NAME="${3:-infrasafe}"

MIGRATIONS_DIR="$(dirname "$0")/migrations"

for file in "$MIGRATIONS_DIR"/*.sql; do
    version=$(basename "$file")

    # Проверяем, применена ли миграция
    applied=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT 1 FROM schema_migrations WHERE version = '$version'" 2>/dev/null)

    if [ "$applied" = "1" ]; then
        echo "SKIP: $version (already applied)"
        continue
    fi

    echo "APPLY: $version"
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$file"

    if [ $? -eq 0 ]; then
        docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
          "INSERT INTO schema_migrations (version) VALUES ('$version')"
        echo "  OK"
    else
        echo "  FAILED — stopping"
        exit 1
    fi
done
```

Удалить дубликаты: оставить только `003_power_calculation_v2.sql`, удалить `003_power_calculation_system.sql` и `003_power_calculation_system_fixed.sql`.

**Оценка трудоёмкости:** 3-4 часа

---

### 1.4 Дополнить `.env.example` UK-переменными

**Проблема:** UK Integration требует 3 секрета, но они не задокументированы в `.env.example`.

**Действия:** Добавить секцию в `.env.example`:

```bash
# ------------------------------------------
# UK Integration (required if uk_integration_enabled=true in DB)
# ------------------------------------------
# UK_WEBHOOK_SECRET=generate_with_openssl_rand_hex_32
# UK_SERVICE_USER=infrasafe-service
# UK_SERVICE_PASSWORD=CHANGE_ME
```

**Оценка трудоёмкости:** 15 минут

---

### 1.5 Обновить README

**Проблема:** Указано "175 тестов" — устарело (сейчас 677).

**Оценка трудоёмкости:** 30 минут

---

## Фаза 2: Hardening (1-2 недели)

> Повышение устойчивости. Не блокирует запуск, но критично для стабильной работы под нагрузкой.

### 2.1 Логирование: не писать query text в production

**Проблема:** `src/config/database.js:45` логирует `text` SQL-запроса на уровне `debug`. В production при `LOG_LEVEL=debug` это утечка данных и нагрузка на I/O.

**Решение:** Убедиться, что `LOG_LEVEL=warn` или `info` в production `.env.prod`. Рассмотреть обфускацию параметров:

```javascript
logger.debug(`Query executed: ${text.substring(0, 80)}..., duration: ${duration}ms, rows: ${result.rowCount}`);
```

---

### 2.2 PostgreSQL: убрать публичный порт в production

**Проблема:** `docker-compose.prod.yml:80` — `ports: "5432:5432"` — БД доступна с хоста напрямую.

**Решение:** Убрать маппинг портов в prod (оставить только docker network):

```yaml
  postgres:
    # ports:              # ← УБРАТЬ в production
    #   - "5432:5432"     # БД доступна только внутри docker network
```

Если нужен доступ для бэкапов/мониторинга — использовать `docker exec` или SSH-туннель.

---

### 2.3 Очистить docker-compose.unified.yml

**Проблема:** 100+ строк закомментированных сервисов (Mosquitto, InfluxDB, Grafana, Node-RED, WireGuard), включая реальный IP-адрес сервера.

**Решение:** Удалить все закомментированные сервисы. Если нужны — создать отдельный `docker-compose.monitoring.yml`.

---

### 2.4 Rate limiter: учесть reverse proxy

**Проблема:** Rate limiter использует `req.ip`, но за Nginx все запросы приходят с IP nginx-контейнера.

**Решение:** Добавить в `src/server.js`:

```javascript
// После создания app:
app.set('trust proxy', 1); // Доверяем первому proxy (Nginx)
```

Nginx уже передаёт `X-Real-IP` и `X-Forwarded-For` (видно в `nginx.conf:119-120`), но Express не использует эти заголовки без `trust proxy`.

---

### 2.5 Закрыть Swagger UI в production

**Проблема:** Swagger отключается через `NODE_ENV !== 'production'`, но лучше иметь явный флаг.

**Решение:** Уже есть `SWAGGER_ENABLED` в `.env.example`. Использовать его:

```javascript
// src/server.js
if (process.env.SWAGGER_ENABLED === 'true') {
  // ... swagger setup
}
```

---

### 2.6 Merge feature-веток

Две фичи готовы, но не влиты в main:

| Ветка | Содержимое | Действие |
|-------|-----------|----------|
| `feature/uk-integration-phase3-5` | Alert pipeline, request feedback, map layer | Merge (5 phases complete) |
| `feature/frontend-redesign` | Новый дизайн фронтенда | Оценить готовность отдельно |

---

## Фаза 3: Observability (1-2 недели)

> Без observability вы не знаете, что происходит в production. Это не роскошь — это необходимость для IoT-системы.

### 3.1 Health check endpoint: расширить

Текущий `/health` проверяет только БД. Для production полезнее:

```javascript
app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Database
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    checks.database = { status: 'up', latency_ms: Date.now() - start };
  } catch {
    checks.database = { status: 'down' };
    healthy = false;
  }

  // Memory
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
    version: '1.0.1',
    timestamp: new Date().toISOString(),
    checks,
  });
});
```

### 3.2 Prometheus metrics endpoint

Добавить `prom-client` для сбора метрик:

```bash
npm install prom-client
```

Создать `src/middleware/metrics.js`:

```javascript
const client = require('prom-client');

// Default metrics (CPU, memory, event loop)
client.collectDefaultMetrics({ prefix: 'infrasafe_' });

// Custom: HTTP request duration
const httpDuration = new client.Histogram({
  name: 'infrasafe_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

// Custom: active DB connections
const dbConnections = new client.Gauge({
  name: 'infrasafe_db_pool_active',
  help: 'Number of active database connections',
});

module.exports = { client, httpDuration, dbConnections };
```

Endpoint `/metrics` (protect с isAdmin или отдельным bearer token).

### 3.3 Uptime monitoring

Рекомендация: **Uptime Kuma** (self-hosted, 1 Docker-контейнер) или **Better Stack** (SaaS, бесплатный план).

Мониторить:
- `https://infrasafe.aisolutions.uz/api/` — 200
- `https://infrasafe.aisolutions.uz/health` — 200 + `status: healthy`
- Настроить алерт в Telegram при downtime

---

## Фаза 4: Tech Debt (по мере ресурсов)

> Эти пункты не блокируют production, но улучшают maintainability.

| # | Задача | Усилие | Влияние |
|---|--------|--------|---------|
| T1 | Разбить `admin.js` (2977 строк) на ES-модули | 3-5 дней | Maintainability |
| T2 | Разбить `script.js` (2066 строк) на ES-модули | 2-3 дня | Maintainability |
| T3 | Объединить `transformers` + `power_transformers` | 1-2 дня | Schema clarity |
| T4 | Удалить `buildings.hot_water` (дубль `has_hot_water`) | 1 час | Schema clarity |
| T5 | MQTT для IoT вместо HTTP POST telemetry | 1-2 недели | IoT standard |
| T6 | WebSocket/SSE для real-time dashboard | 1 неделя | UX |
| T7 | TypeScript migration | 2-3 недели | Type safety |

---

## Сводная дорожная карта

```
Неделя 1 (Фаза 0):
├── День 1: Секреты (0.1) + Node.js version (0.2) + ESLint (0.3)
├── День 2: TLS nginx (0.4) + CI/CD (0.5)
└── День 2: Тестирование всех изменений на dev

Неделя 2 (Фаза 1):
├── День 1-2: Бэкапы (1.1) + Sentry (1.2)
├── День 3: Migration runner (1.3) + cleanup миграций
├── День 4: .env.example UK (1.4) + README (1.5)
└── День 5: Merge feature/uk-integration-phase3-5

Неделя 3-4 (Фаза 2):
├── Hardening: trust proxy, закрыть порт БД, Swagger флаг
├── Очистка unified compose
└── Production deploy + smoke testing

Неделя 5-6 (Фаза 3):
├── Расширенный health check
├── Prometheus + Grafana (или Uptime Kuma)
└── Alerting (Telegram/email)
```

---

## Чеклист перед первым production deploy

```
Pre-deploy:
[ ] .env.prod создан с уникальными секретами (НЕ дефолтные)
[ ] DB_PASSWORD ≠ @ppl1c@ti0n, ≠ postgres (сгенерирован openssl)
[ ] JWT_SECRET и JWT_REFRESH_SECRET сгенерированы (openssl rand -base64 64)
[ ] UK_WEBHOOK_SECRET сгенерирован (openssl rand -hex 32)
[ ] TLS сертификат установлен и nginx настроен
[ ] PostgreSQL порт НЕ экспонирован на хост
[ ] NODE_ENV=production в .env.prod
[ ] LOG_LEVEL=warn (не debug!)
[ ] CORS_ORIGINS = только production домен
[ ] Swagger отключён (SWAGGER_ENABLED отсутствует или false)
[ ] npm audit --audit-level=high проходит без critical/high

Deploy:
[ ] docker compose -f docker-compose.prod.yml up --build -d
[ ] Health check: curl https://infrasafe.aisolutions.uz/health → 200
[ ] API check: curl https://infrasafe.aisolutions.uz/api/ → 200
[ ] Auth check: POST /api/auth/login с admin/admin123 → токен
[ ] Тестовый логин через браузер
[ ] Бэкап-скрипт установлен в cron
[ ] Sentry получает test-ошибку

Post-deploy:
[ ] Сменить пароль admin (admin123 → сложный)
[ ] Сменить пароль testuser или деактивировать
[ ] Проверить бэкап: pg_restore test
[ ] Настроить uptime monitoring
```

---

## Оценка трудоёмкости

| Фаза | Трудоёмкость | Результат |
|------|-------------|-----------|
| Фаза 0 (CRITICAL) | 1-2 дня | Можно деплоить |
| Фаза 1 (Operations) | 3-5 дней | Устойчивая работа |
| Фаза 2 (Hardening) | 1-2 недели | Защита от edge cases |
| Фаза 3 (Observability) | 1-2 недели | Видимость проблем |
| **Итого до production** | **~2-3 недели** | **Production-ready (7.5-8/10)** |

> После выполнения Фаз 0-1 (~1 неделя) система готова к **ограниченному production** (internal users, beta). Фазы 2-3 поднимают до полноценного production-grade.
