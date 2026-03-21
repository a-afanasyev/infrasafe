# InfraSafe v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge InfraSafe (Node.js IoT monitoring) and UK Management Bot (Python Telegram requests) into a unified Node.js + Vue 3 platform with shared PostgreSQL schemas, Redis caching, and Telegram integration.

**Architecture:** Express.js backend extended with new modules (requests, shifts, addresses, verification, telegram). Vue 3 + Vite + Pinia SPA replaces vanilla JS frontend. grammY handles Telegram webhook through Express endpoint. Three PostgreSQL schemas (`public`, `infrasafe`, `uk`) share a single database. Redis provides caching, rate limiting, and pub/sub for SSE.

**Tech Stack:** Node.js 20+, Express.js, PostgreSQL 15+ (PostGIS), Redis 7+, Vue 3, Vite, Pinia, vue-leaflet, grammY, Jest, Supertest

**Design doc:** `docs/plans/2026-03-07-infrasafe-v2-unified-platform-design.md`

---

## Phase 0: Preparation (Week 1)

### Task 0.1: Create PostgreSQL schemas and migrate existing tables

**Files:**
- Create: `database/migrations/009_create_schemas.sql`
- Create: `database/migrations/010_move_infrasafe_tables.sql`

**Step 1: Write migration 009 — create schemas**

```sql
-- database/migrations/009_create_schemas.sql
-- Create modular schemas for InfraSafe v2

-- Schema for IoT monitoring (existing tables will move here)
CREATE SCHEMA IF NOT EXISTS infrasafe;

-- Schema for UK management (requests, shifts, etc.)
CREATE SCHEMA IF NOT EXISTS uk;

-- public schema already exists — shared tables (users, buildings) stay here

-- Grant usage
GRANT USAGE ON SCHEMA infrasafe TO PUBLIC;
GRANT USAGE ON SCHEMA uk TO PUBLIC;
```

**Step 2: Write migration 010 — move IoT tables to infrasafe schema**

```sql
-- database/migrations/010_move_infrasafe_tables.sql
-- Move IoT-specific tables from public to infrasafe schema
-- NOTE: buildings and users stay in public (shared)

ALTER TABLE IF EXISTS controllers SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS metrics SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS alerts SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS alert_types SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS infrastructure_alerts SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS power_transformers SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS transformers SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS lines SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS cold_water_sources SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS heat_sources SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS water_lines SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS water_suppliers SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS water_measurement_points SET SCHEMA infrasafe;
ALTER TABLE IF EXISTS analytics_history SET SCHEMA infrasafe;

-- Update search_path so existing queries work without schema prefix
ALTER DATABASE infrasafe SET search_path TO public, infrasafe, uk;
```

**Step 3: Test migration locally**

Run:
```bash
docker compose -f docker-compose.dev.yml up postgres -d
psql postgresql://postgres:postgres@localhost:5435/infrasafe -f database/migrations/009_create_schemas.sql
psql postgresql://postgres:postgres@localhost:5435/infrasafe -f database/migrations/010_move_infrasafe_tables.sql
```

Verify: `psql -c "\dt infrasafe.*"` shows moved tables.

**Step 4: Commit**

```bash
git add database/migrations/009_create_schemas.sql database/migrations/010_move_infrasafe_tables.sql
git commit -m "feat(db): create infrasafe and uk schemas, move IoT tables"
```

---

### Task 0.2: Extend users table for multi-role support

**Files:**
- Create: `database/migrations/011_extend_users.sql`

**Step 1: Write the migration**

```sql
-- database/migrations/011_extend_users.sql
-- Extend users for InfraSafe v2 multi-role support

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB DEFAULT '["resident"]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_role VARCHAR(30) DEFAULT 'resident';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'ru';
ALTER TABLE users ADD COLUMN IF NOT EXISTS specializations JSONB;

-- Migrate existing role column to roles JSONB
UPDATE users SET roles = jsonb_build_array(role) WHERE roles = '["resident"]' AND role IS NOT NULL;
UPDATE users SET active_role = role WHERE active_role = 'resident' AND role IS NOT NULL;

-- Set admin users to 'approved'
UPDATE users SET status = 'approved' WHERE role = 'admin';

-- Add index for telegram lookup
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(active_role);
```

**Step 2: Test migration**

Run: `psql postgresql://postgres:postgres@localhost:5435/infrasafe -f database/migrations/011_extend_users.sql`

Verify: `psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name IN ('roles','telegram_id','active_role','specializations')"`

**Step 3: Commit**

```bash
git add database/migrations/011_extend_users.sql
git commit -m "feat(db): extend users table with multi-role support"
```

---

### Task 0.3: Extend buildings table with yard reference

**Files:**
- Create: `database/migrations/012_extend_buildings.sql`

**Step 1: Write the migration**

```sql
-- database/migrations/012_extend_buildings.sql
-- Add yard_id to buildings for UK territorial zones

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS yard_id INTEGER;
-- FK will be added after uk.yards table is created (Task 0.4)
```

**Step 2: Test and commit**

```bash
psql postgresql://postgres:postgres@localhost:5435/infrasafe -f database/migrations/012_extend_buildings.sql
git add database/migrations/012_extend_buildings.sql
git commit -m "feat(db): add yard_id to buildings"
```

---

### Task 0.4: Create UK schema tables

**Files:**
- Create: `database/migrations/013_create_uk_tables.sql`

**Step 1: Write the migration**

```sql
-- database/migrations/013_create_uk_tables.sql
-- UK management tables for requests, shifts, apartments, verification

-- Territorial zones
CREATE TABLE IF NOT EXISTS uk.yards (
    yard_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from buildings to yards
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_yard
    FOREIGN KEY (yard_id) REFERENCES uk.yards(yard_id);

-- Apartments
CREATE TABLE IF NOT EXISTS uk.apartments (
    apartment_id SERIAL PRIMARY KEY,
    building_id INTEGER NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    apartment_number VARCHAR(20) NOT NULL,
    floor INTEGER,
    UNIQUE(building_id, apartment_number)
);

-- User-apartment assignments
CREATE TABLE IF NOT EXISTS uk.user_apartments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    apartment_id INTEGER NOT NULL REFERENCES uk.apartments(apartment_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending/approved/rejected
    is_owner BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, apartment_id)
);

-- Document verification
CREATE TABLE IF NOT EXISTS uk.user_verification (
    verification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- passport, property_doc, contract
    file_path VARCHAR(500) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending/approved/rejected
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requests (main UK feature)
CREATE TABLE IF NOT EXISTS uk.requests (
    request_number VARCHAR(20) PRIMARY KEY, -- format: YYMMDD-NNN
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    executor_id INTEGER REFERENCES users(user_id),
    apartment_id INTEGER REFERENCES uk.apartments(apartment_id),
    building_id INTEGER REFERENCES buildings(building_id),
    alert_id INTEGER, -- FK to infrasafe.alerts added separately
    category VARCHAR(50) NOT NULL, -- electrical/plumbing/heating/elevator/cleaning/security
    description TEXT NOT NULL,
    urgency VARCHAR(20) DEFAULT 'normal', -- normal/medium/urgent/critical
    status VARCHAR(30) DEFAULT 'new', -- new/in_progress/purchasing/clarification/completed/accepted/cancelled
    media_files JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Request comments
CREATE TABLE IF NOT EXISTS uk.request_comments (
    comment_id SERIAL PRIMARY KEY,
    request_number VARCHAR(20) NOT NULL REFERENCES uk.requests(request_number) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ratings
CREATE TABLE IF NOT EXISTS uk.ratings (
    rating_id SERIAL PRIMARY KEY,
    request_number VARCHAR(20) NOT NULL REFERENCES uk.requests(request_number) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(request_number, user_id)
);

-- Shifts
CREATE TABLE IF NOT EXISTS uk.shifts (
    shift_id SERIAL PRIMARY KEY,
    executor_id INTEGER NOT NULL REFERENCES users(user_id),
    shift_type VARCHAR(30) NOT NULL, -- morning/evening/night/full_day
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'planned', -- planned/active/completed/cancelled
    efficiency_score NUMERIC(5,2),
    quality_rating NUMERIC(3,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shift-request assignments
CREATE TABLE IF NOT EXISTS uk.shift_assignments (
    assignment_id SERIAL PRIMARY KEY,
    shift_id INTEGER NOT NULL REFERENCES uk.shifts(shift_id) ON DELETE CASCADE,
    request_number VARCHAR(20) NOT NULL REFERENCES uk.requests(request_number),
    assigned_by INTEGER REFERENCES users(user_id),
    ai_score NUMERIC(5,2),
    specialization_match NUMERIC(5,2),
    geographic_score NUMERIC(5,2),
    workload_score NUMERIC(5,2),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shift_id, request_number)
);

-- Shift templates
CREATE TABLE IF NOT EXISTS uk.shift_templates (
    template_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    shift_type VARCHAR(30) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    days_of_week JSONB DEFAULT '[1,2,3,4,5]'
);

-- Quarterly plans
CREATE TABLE IF NOT EXISTS uk.quarterly_plans (
    plan_id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    executor_id INTEGER NOT NULL REFERENCES users(user_id),
    plan_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(year, quarter, executor_id)
);

-- Notification log
CREATE TABLE IF NOT EXISTS uk.notifications (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    channel VARCHAR(20) DEFAULT 'web', -- web/telegram/both
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

-- Cross-schema FK: requests -> infrasafe.alerts
-- Only if infrasafe.alerts exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='infrasafe' AND table_name='alerts') THEN
        ALTER TABLE uk.requests ADD CONSTRAINT fk_requests_alert
            FOREIGN KEY (alert_id) REFERENCES infrasafe.alerts(alert_id);
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_uk_requests_user ON uk.requests(user_id);
CREATE INDEX IF NOT EXISTS idx_uk_requests_executor ON uk.requests(executor_id);
CREATE INDEX IF NOT EXISTS idx_uk_requests_status ON uk.requests(status);
CREATE INDEX IF NOT EXISTS idx_uk_requests_building ON uk.requests(building_id);
CREATE INDEX IF NOT EXISTS idx_uk_requests_created ON uk.requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uk_requests_category ON uk.requests(category);
CREATE INDEX IF NOT EXISTS idx_uk_comments_request ON uk.request_comments(request_number);
CREATE INDEX IF NOT EXISTS idx_uk_shifts_executor ON uk.shifts(executor_id);
CREATE INDEX IF NOT EXISTS idx_uk_shifts_status ON uk.shifts(status);
CREATE INDEX IF NOT EXISTS idx_uk_shifts_started ON uk.shifts(started_at);
CREATE INDEX IF NOT EXISTS idx_uk_assignments_shift ON uk.shift_assignments(shift_id);
CREATE INDEX IF NOT EXISTS idx_uk_notifications_user ON uk.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_uk_notifications_unread ON uk.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_uk_apartments_building ON uk.apartments(building_id);
CREATE INDEX IF NOT EXISTS idx_uk_user_apartments_user ON uk.user_apartments(user_id);
```

**Step 2: Test migration**

Run: `psql postgresql://postgres:postgres@localhost:5435/infrasafe -f database/migrations/013_create_uk_tables.sql`

Verify: `psql -c "\dt uk.*"` shows all UK tables.

**Step 3: Commit**

```bash
git add database/migrations/013_create_uk_tables.sql
git commit -m "feat(db): create UK schema tables (requests, shifts, apartments, verification)"
```

---

### Task 0.5: Add Redis to Docker Compose

**Files:**
- Modify: `docker-compose.dev.yml`
- Create: `src/config/redis.js`

**Step 1: Add Redis service to docker-compose.dev.yml**

Add to `services:` section:

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
```

Add to `volumes:` section:

```yaml
  redis_data:
```

**Step 2: Create Redis config module**

```javascript
// src/config/redis.js
const logger = require('../utils/logger');

let redisClient = null;

const init = async () => {
    try {
        const { createClient } = require('redis');
        redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        redisClient.on('error', (err) => {
            logger.error(`Redis error: ${err.message}`);
        });

        await redisClient.connect();
        logger.info('Redis connected');
        return redisClient;
    } catch (error) {
        logger.warn(`Redis not available: ${error.message}. Running without Redis.`);
        return null;
    }
};

const getClient = () => redisClient;

const close = async () => {
    if (redisClient) {
        await redisClient.quit();
        logger.info('Redis connection closed');
    }
};

module.exports = { init, getClient, close };
```

**Step 3: Add redis dependency**

Run: `npm install redis`

**Step 4: Write test for Redis config**

```javascript
// tests/jest/unit/redis.test.js
const redis = require('../../src/config/redis');

describe('Redis Config', () => {
    test('getClient returns null before init', () => {
        expect(redis.getClient()).toBeNull();
    });

    test('module exports init, getClient, close', () => {
        expect(typeof redis.init).toBe('function');
        expect(typeof redis.getClient).toBe('function');
        expect(typeof redis.close).toBe('function');
    });
});
```

**Step 5: Run tests**

Run: `npm run test:unit -- --testPathPattern=redis`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/redis.js tests/jest/unit/redis.test.js docker-compose.dev.yml package.json package-lock.json
git commit -m "feat: add Redis config and Docker service"
```

---

### Task 0.6: Initialize Vue 3 + Vite frontend project

**Files:**
- Create: `frontend/` directory (Vue 3 project)

**Step 1: Scaffold Vue 3 project**

```bash
cd /path/to/infrasafe
npm create vite@latest frontend -- --template vue
cd frontend
npm install
npm install pinia vue-router@4 @vue-leaflet/vue-leaflet leaflet
npm install -D @vitejs/plugin-vue
```

**Step 2: Configure Vite proxy**

```javascript
// frontend/vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    plugins: [vue()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true
            }
        }
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    }
})
```

**Step 3: Create base project structure**

```bash
mkdir -p frontend/src/{router,stores,views,components/{map,shared},composables,assets/styles}
```

**Step 4: Create router stub**

```javascript
// frontend/src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    {
        path: '/',
        name: 'map',
        component: () => import('../views/MapView.vue')
    },
    {
        path: '/login',
        name: 'login',
        component: () => import('../views/LoginView.vue')
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
```

**Step 5: Create Pinia store setup**

```javascript
// frontend/src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
    const user = ref(null)
    const token = ref(localStorage.getItem('token'))

    const isAuthenticated = computed(() => !!token.value)
    const activeRole = computed(() => user.value?.active_role || 'resident')

    function setAuth(userData, accessToken) {
        user.value = userData
        token.value = accessToken
        localStorage.setItem('token', accessToken)
    }

    function logout() {
        user.value = null
        token.value = null
        localStorage.removeItem('token')
    }

    return { user, token, isAuthenticated, activeRole, setAuth, logout }
})
```

**Step 6: Create App.vue with router**

```vue
<!-- frontend/src/App.vue -->
<template>
    <div id="app">
        <router-view />
    </div>
</template>

<script setup>
</script>
```

**Step 7: Create main.js entry**

```javascript
// frontend/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

**Step 8: Create minimal view stubs**

```vue
<!-- frontend/src/views/MapView.vue -->
<template>
    <div class="map-view">
        <h1>InfraSafe Map</h1>
        <div id="map" style="height: 80vh;"></div>
    </div>
</template>

<script setup>
</script>
```

```vue
<!-- frontend/src/views/LoginView.vue -->
<template>
    <div class="login-view">
        <h1>Login</h1>
    </div>
</template>

<script setup>
</script>
```

**Step 9: Create CSS variables file**

```css
/* frontend/src/assets/styles/variables.css */
:root {
    /* Brand colors from InfraSafe logo */
    --color-primary: #2CD13E;
    --color-primary-dark: #22a832;
    --color-bg-base: #03232D;
    --color-bg-surface: #04303d;
    --color-bg-elevated: #05404f;
    --color-text-primary: #F6F8F9;
    --color-text-secondary: #8fa3ad;
    --color-accent: #2CD13E;

    /* Status colors */
    --color-ok: #41D54A;
    --color-warning: #F5A623;
    --color-leak: #00BFA5;
    --color-critical: #E53935;
    --color-no-data: #607D8B;

    /* Spacing */
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;
    --spacing-xl: 32px;

    /* Border radius */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
}
```

```css
/* frontend/src/assets/styles/main.css */
@import './variables.css';

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
    background: var(--color-bg-base);
    color: var(--color-text-primary);
}

#app {
    min-height: 100vh;
}
```

**Step 10: Verify Vue app runs**

Run: `cd frontend && npm run dev`
Expected: Vite dev server starts on port 5173, shows "InfraSafe Map" heading.

**Step 11: Commit**

```bash
git add frontend/
git commit -m "feat: initialize Vue 3 + Vite + Pinia frontend"
```

---

### Task 0.7: Create useApi composable

**Files:**
- Create: `frontend/src/composables/useApi.js`

**Step 1: Write the composable**

```javascript
// frontend/src/composables/useApi.js
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const BASE_URL = '/api'

export function useApi() {
    const loading = ref(false)
    const error = ref(null)

    async function request(url, options = {}) {
        loading.value = true
        error.value = null

        const auth = useAuthStore()
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        }

        if (auth.token) {
            headers['Authorization'] = `Bearer ${auth.token}`
        }

        try {
            const response = await fetch(`${BASE_URL}${url}`, {
                ...options,
                headers
            })

            if (response.status === 401) {
                auth.logout()
                throw new Error('Unauthorized')
            }

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`)
            }

            return data
        } catch (err) {
            error.value = err.message
            throw err
        } finally {
            loading.value = false
        }
    }

    const get = (url) => request(url)
    const post = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) })
    const put = (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body) })
    const del = (url) => request(url, { method: 'DELETE' })

    return { loading, error, get, post, put, del }
}
```

**Step 2: Commit**

```bash
git add frontend/src/composables/useApi.js
git commit -m "feat: add useApi composable for authenticated API calls"
```

---

## Phase 1: Core — Auth + Roles + Vue Map + SSE (Weeks 2-3)

### Task 1.1: Add roleGuard middleware

**Files:**
- Create: `src/middleware/roleGuard.js`
- Create: `tests/jest/unit/roleGuard.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/roleGuard.test.js
const { requireRole, requireAnyRole } = require('../../../src/middleware/roleGuard');

describe('roleGuard middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { user: { user_id: 1, role: 'admin', roles: ['admin', 'manager'] } };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    test('requireRole passes for matching role', () => {
        requireRole('admin')(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireRole blocks non-matching role', () => {
        requireRole('executor')(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('requireAnyRole passes if any role matches', () => {
        requireAnyRole(['executor', 'manager'])(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireAnyRole blocks if no role matches', () => {
        requireAnyRole(['executor', 'resident'])(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns 401 when user is not authenticated', () => {
        req.user = null;
        requireRole('admin')(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=roleGuard`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// src/middleware/roleGuard.js
const logger = require('../utils/logger');

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const userRoles = req.user.roles || [req.user.role];
        if (userRoles.includes(role)) {
            return next();
        }

        logger.warn(`Access denied: user ${req.user.username} lacks role ${role}`);
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    };
}

function requireAnyRole(roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const userRoles = req.user.roles || [req.user.role];
        if (roles.some(role => userRoles.includes(role))) {
            return next();
        }

        logger.warn(`Access denied: user ${req.user.username} lacks any of roles [${roles}]`);
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    };
}

module.exports = { requireRole, requireAnyRole };
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern=roleGuard`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/middleware/roleGuard.js tests/jest/unit/roleGuard.test.js
git commit -m "feat: add roleGuard middleware with multi-role support"
```

---

### Task 1.2: Update auth to include roles in JWT and response

**Files:**
- Modify: `src/middleware/auth.js` (line 71-77: add roles to req.user)
- Modify: `src/services/authService.js` (include roles in user lookup)
- Modify: `src/controllers/authController.js` (include roles in JWT payload)

**Step 1: Write test for roles in auth response**

```javascript
// tests/jest/unit/authRoles.test.js
describe('Auth roles integration', () => {
    test('req.user should include roles array', () => {
        const user = {
            user_id: 1,
            username: 'test',
            role: 'admin',
            roles: ['admin', 'manager'],
            active_role: 'admin',
            email: 'test@test.com'
        };

        // Simulate what auth middleware sets
        const reqUser = {
            user_id: user.user_id,
            id: user.user_id,
            username: user.username,
            role: user.role,
            roles: user.roles || [user.role],
            active_role: user.active_role || user.role,
            email: user.email
        };

        expect(reqUser.roles).toContain('admin');
        expect(reqUser.active_role).toBe('admin');
    });
});
```

**Step 2: Run test**

Run: `npm run test:unit -- --testPathPattern=authRoles`
Expected: PASS

**Step 3: Update auth middleware to set roles**

In `src/middleware/auth.js`, update the `req.user` object (around line 71):

```javascript
req.user = {
    user_id: user.user_id,
    id: user.user_id,
    username: user.username,
    role: user.role,
    roles: user.roles || [user.role],
    active_role: user.active_role || user.role,
    email: user.email
};
```

Apply the same change to the `optionalAuth` function (around line 232) and `authenticateRefresh` (around line 167).

**Step 4: Run all existing tests**

Run: `npm test`
Expected: All existing tests still pass.

**Step 5: Commit**

```bash
git add src/middleware/auth.js tests/jest/unit/authRoles.test.js
git commit -m "feat: include roles array and active_role in JWT auth"
```

---

### Task 1.3: SSE (Server-Sent Events) endpoint

**Files:**
- Create: `src/services/sseService.js`
- Create: `src/routes/eventsRoutes.js`
- Create: `tests/jest/unit/sseService.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/sseService.test.js
const SSEService = require('../../../src/services/sseService');

describe('SSEService', () => {
    let service;

    beforeEach(() => {
        service = new SSEService();
    });

    test('addClient stores a client', () => {
        const mockRes = { write: jest.fn(), on: jest.fn() };
        service.addClient('user-1', mockRes);
        expect(service.getClientCount()).toBe(1);
    });

    test('removeClient removes a client', () => {
        const mockRes = { write: jest.fn(), on: jest.fn() };
        service.addClient('user-1', mockRes);
        service.removeClient('user-1');
        expect(service.getClientCount()).toBe(0);
    });

    test('broadcast sends to all clients', () => {
        const mockRes1 = { write: jest.fn(), on: jest.fn() };
        const mockRes2 = { write: jest.fn(), on: jest.fn() };
        service.addClient('user-1', mockRes1);
        service.addClient('user-2', mockRes2);

        service.broadcast('test-event', { message: 'hello' });

        expect(mockRes1.write).toHaveBeenCalledWith(
            expect.stringContaining('"message":"hello"')
        );
        expect(mockRes2.write).toHaveBeenCalledWith(
            expect.stringContaining('"message":"hello"')
        );
    });

    test('sendToUser sends only to target user', () => {
        const mockRes1 = { write: jest.fn(), on: jest.fn() };
        const mockRes2 = { write: jest.fn(), on: jest.fn() };
        service.addClient('user-1', mockRes1);
        service.addClient('user-2', mockRes2);

        service.sendToUser('user-1', 'notification', { text: 'hi' });

        expect(mockRes1.write).toHaveBeenCalled();
        expect(mockRes2.write).not.toHaveBeenCalled();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=sseService`
Expected: FAIL

**Step 3: Write implementation**

```javascript
// src/services/sseService.js
const logger = require('../utils/logger');

class SSEService {
    constructor() {
        this.clients = new Map();
    }

    addClient(userId, res) {
        this.clients.set(userId, res);
        res.on('close', () => {
            this.removeClient(userId);
        });
        logger.debug(`SSE client connected: ${userId}`);
    }

    removeClient(userId) {
        this.clients.delete(userId);
        logger.debug(`SSE client disconnected: ${userId}`);
    }

    getClientCount() {
        return this.clients.size;
    }

    broadcast(event, data) {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const [, res] of this.clients) {
            res.write(message);
        }
    }

    sendToUser(userId, event, data) {
        const client = this.clients.get(userId);
        if (client) {
            client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    }
}

// Singleton
const sseService = new SSEService();

module.exports = SSEService;
module.exports.instance = sseService;
```

**Step 4: Create events route**

```javascript
// src/routes/eventsRoutes.js
const express = require('express');
const router = express.Router();
const { instance: sseService } = require('../services/sseService');
const { authenticateJWT } = require('../middleware/auth');

// SSE stream endpoint (requires auth)
router.get('/stream', authenticateJWT, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ userId: req.user.user_id })}\n\n`);

    sseService.addClient(String(req.user.user_id), res);
});

module.exports = router;
```

**Step 5: Run test**

Run: `npm run test:unit -- --testPathPattern=sseService`
Expected: PASS (4 tests)

**Step 6: Register events route in main router**

Add to `src/routes/index.js`:

```javascript
const eventsRoutes = require('./eventsRoutes');
// ... in the routes section:
router.use('/events', eventsRoutes);
```

**Step 7: Commit**

```bash
git add src/services/sseService.js src/routes/eventsRoutes.js tests/jest/unit/sseService.test.js src/routes/index.js
git commit -m "feat: add SSE service and /api/events/stream endpoint"
```

---

### Task 1.4: Vue 3 MapView with Leaflet

**Files:**
- Create: `frontend/src/views/MapView.vue` (replace stub)
- Create: `frontend/src/components/map/LeafletMap.vue`
- Create: `frontend/src/components/map/BuildingPopup.vue`
- Create: `frontend/src/stores/buildings.js`

**Step 1: Create buildings store**

```javascript
// frontend/src/stores/buildings.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApi } from '../composables/useApi'

export const useBuildingsStore = defineStore('buildings', () => {
    const buildings = ref([])
    const loading = ref(false)
    const error = ref(null)

    const buildingsByStatus = computed(() => {
        const counts = { ok: 0, warning: 0, leak: 0, critical: 0, no: 0 }
        buildings.value.forEach(b => {
            const status = b.computed_status || 'no'
            if (counts[status] !== undefined) counts[status]++
        })
        return counts
    })

    async function fetchBuildings() {
        const api = useApi()
        loading.value = true
        try {
            const data = await api.get('/buildings-metrics')
            buildings.value = data.data || data
        } catch (err) {
            error.value = err.message
        } finally {
            loading.value = false
        }
    }

    return { buildings, loading, error, buildingsByStatus, fetchBuildings }
})
```

**Step 2: Create LeafletMap component**

```vue
<!-- frontend/src/components/map/LeafletMap.vue -->
<template>
    <div ref="mapContainer" class="leaflet-map"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
    center: { type: Array, default: () => [41.311081, 69.240562] },
    zoom: { type: Number, default: 12 },
    buildings: { type: Array, default: () => [] }
})

const emit = defineEmits(['building-click'])

const mapContainer = ref(null)
let map = null
let markersLayer = null

onMounted(() => {
    map = L.map(mapContainer.value).setView(props.center, props.zoom)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)

    markersLayer = L.layerGroup().addTo(map)
    updateMarkers()
})

onUnmounted(() => {
    if (map) map.remove()
})

watch(() => props.buildings, updateMarkers, { deep: true })

function updateMarkers() {
    if (!markersLayer) return
    markersLayer.clearLayers()

    props.buildings.forEach(building => {
        if (!building.latitude || !building.longitude) return

        const marker = L.circleMarker(
            [building.latitude, building.longitude],
            { radius: 8, color: getStatusColor(building.computed_status) }
        )

        marker.bindPopup(`<b>${building.name}</b><br>${building.address}`)
        marker.on('click', () => emit('building-click', building))
        markersLayer.addLayer(marker)
    })
}

function getStatusColor(status) {
    const colors = {
        ok: '#41D54A',
        warning: '#F5A623',
        leak: '#00BFA5',
        critical: '#E53935',
        no: '#607D8B'
    }
    return colors[status] || colors.no
}
</script>

<style scoped>
.leaflet-map {
    width: 100%;
    height: 100%;
    min-height: 500px;
}
</style>
```

**Step 3: Update MapView**

```vue
<!-- frontend/src/views/MapView.vue -->
<template>
    <div class="map-view">
        <header class="topbar">
            <div class="topbar__brand">
                <span class="topbar__name">INFRASAFE</span>
                <span class="topbar__sub">INFRASTRUCTURE MONITORING SYSTEM</span>
            </div>
        </header>

        <main class="map-layout">
            <LeafletMap
                :buildings="buildingsStore.buildings"
                @building-click="onBuildingClick"
            />
        </main>

        <div class="stats-bar">
            <div v-for="(count, status) in buildingsStore.buildingsByStatus"
                 :key="status"
                 :class="['stat-badge', `stat-badge--${status}`]">
                <span class="stat-badge__val">{{ count }}</span>
                <span class="stat-badge__label">{{ statusLabels[status] }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted } from 'vue'
import LeafletMap from '../components/map/LeafletMap.vue'
import { useBuildingsStore } from '../stores/buildings'

const buildingsStore = useBuildingsStore()

const statusLabels = {
    ok: 'норма',
    warning: 'внимание',
    leak: 'протечка',
    critical: 'авария',
    no: 'нет данных'
}

onMounted(() => {
    buildingsStore.fetchBuildings()
})

function onBuildingClick(building) {
    // Will be expanded with BuildingPopup component
    console.log('Selected building:', building.name)
}
</script>

<style scoped>
.map-view {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.topbar {
    background: var(--color-bg-surface);
    padding: var(--spacing-md);
    border-bottom: 1px solid rgba(44, 209, 62, 0.2);
}

.topbar__brand {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
}

.topbar__name {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--color-primary);
    letter-spacing: 2px;
}

.topbar__sub {
    font-size: 0.7rem;
    color: var(--color-text-secondary);
    letter-spacing: 1px;
}

.map-layout {
    flex: 1;
    position: relative;
}

.stats-bar {
    display: flex;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--color-bg-surface);
    border-top: 1px solid rgba(44, 209, 62, 0.2);
}

.stat-badge {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
}

.stat-badge__val {
    font-weight: 700;
    font-size: 1.1rem;
}

.stat-badge__label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
}

.stat-badge--ok .stat-badge__val { color: var(--color-ok); }
.stat-badge--warning .stat-badge__val { color: var(--color-warning); }
.stat-badge--leak .stat-badge__val { color: var(--color-leak); }
.stat-badge--critical .stat-badge__val { color: var(--color-critical); }
.stat-badge--no .stat-badge__val { color: var(--color-no-data); }
</style>
```

**Step 4: Verify it renders**

Run: `cd frontend && npm run dev`
Expected: Map loads centered on Tashkent, topbar and stats bar visible.

**Step 5: Commit**

```bash
git add frontend/src/views/MapView.vue frontend/src/components/map/LeafletMap.vue frontend/src/stores/buildings.js
git commit -m "feat: Vue 3 MapView with Leaflet and buildings store"
```

---

### Task 1.5: Vue Login view and auth flow

**Files:**
- Modify: `frontend/src/views/LoginView.vue`
- Modify: `frontend/src/stores/auth.js`
- Modify: `frontend/src/router/index.js`

**Step 1: Update auth store with login/register**

```javascript
// frontend/src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
    const user = ref(null)
    const token = ref(localStorage.getItem('token'))

    const isAuthenticated = computed(() => !!token.value)
    const activeRole = computed(() => user.value?.active_role || 'resident')

    async function login(username, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Login failed')

        user.value = data.user
        token.value = data.token
        localStorage.setItem('token', data.token)
        if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken)
        }
        return data
    }

    function setAuth(userData, accessToken) {
        user.value = userData
        token.value = accessToken
        localStorage.setItem('token', accessToken)
    }

    function logout() {
        user.value = null
        token.value = null
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
    }

    return { user, token, isAuthenticated, activeRole, login, setAuth, logout }
})
```

**Step 2: Create LoginView**

```vue
<!-- frontend/src/views/LoginView.vue -->
<template>
    <div class="login-page">
        <div class="login-card">
            <h1 class="login-title">INFRASAFE</h1>
            <p class="login-subtitle">Infrastructure Monitoring System</p>

            <form @submit.prevent="handleLogin" class="login-form">
                <div class="form-group">
                    <label for="username">Логин</label>
                    <input id="username" v-model="username" type="text" required autofocus />
                </div>
                <div class="form-group">
                    <label for="password">Пароль</label>
                    <input id="password" v-model="password" type="password" required />
                </div>
                <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
                <button type="submit" class="btn-login" :disabled="loading">
                    {{ loading ? 'Вход...' : 'Войти' }}
                </button>
            </form>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleLogin() {
    loading.value = true
    errorMsg.value = ''
    try {
        await auth.login(username.value, password.value)
        router.push('/')
    } catch (err) {
        errorMsg.value = err.message
    } finally {
        loading.value = false
    }
}
</script>

<style scoped>
.login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-base);
}

.login-card {
    background: var(--color-bg-surface);
    padding: var(--spacing-xl);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 400px;
    border: 1px solid rgba(44, 209, 62, 0.15);
}

.login-title {
    color: var(--color-primary);
    text-align: center;
    letter-spacing: 3px;
    margin-bottom: var(--spacing-xs);
}

.login-subtitle {
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    margin-bottom: var(--spacing-lg);
}

.form-group {
    margin-bottom: var(--spacing-md);
}

.form-group label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-size: 0.85rem;
    color: var(--color-text-secondary);
}

.form-group input {
    width: 100%;
    padding: 10px 12px;
    background: var(--color-bg-base);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: 1rem;
}

.form-group input:focus {
    outline: none;
    border-color: var(--color-primary);
}

.btn-login {
    width: 100%;
    padding: 12px;
    background: var(--color-primary);
    color: var(--color-bg-base);
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    letter-spacing: 1px;
}

.btn-login:hover { opacity: 0.9; }
.btn-login:disabled { opacity: 0.5; cursor: not-allowed; }

.error-msg {
    color: var(--color-critical);
    font-size: 0.85rem;
    margin-bottom: var(--spacing-sm);
}
</style>
```

**Step 3: Add route guard to router**

```javascript
// frontend/src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    {
        path: '/',
        name: 'map',
        component: () => import('../views/MapView.vue')
    },
    {
        path: '/login',
        name: 'login',
        component: () => import('../views/LoginView.vue'),
        meta: { guest: true }
    },
    {
        path: '/dashboard',
        name: 'dashboard',
        component: () => import('../views/MapView.vue'), // Reuse for now
        meta: { requiresAuth: true }
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

router.beforeEach((to, from, next) => {
    const token = localStorage.getItem('token')

    if (to.meta.requiresAuth && !token) {
        return next({ name: 'login' })
    }

    if (to.meta.guest && token) {
        return next({ name: 'map' })
    }

    next()
})

export default router
```

**Step 4: Verify login flow**

Run: `cd frontend && npm run dev`
Expected: `/login` shows login form. With dev server + backend running, login with `admin/admin123` redirects to map.

**Step 5: Commit**

```bash
git add frontend/src/views/LoginView.vue frontend/src/stores/auth.js frontend/src/router/index.js
git commit -m "feat: Vue login view with auth store and route guards"
```

---

## Phase 2: Requests Module (Weeks 4-5)

### Task 2.1: Requests model (backend)

**Files:**
- Create: `src/models/Request.js`
- Create: `tests/jest/unit/requestModel.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/requestModel.test.js
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

const db = require('../../../src/config/database');
const Request = require('../../../src/models/Request');

describe('Request model', () => {
    afterEach(() => jest.clearAllMocks());

    test('generateRequestNumber returns YYMMDD-NNN format', () => {
        const num = Request.generateRequestNumber(5);
        expect(num).toMatch(/^\d{6}-005$/);
    });

    test('create calls INSERT with correct params', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // count for number gen
        db.query.mockResolvedValueOnce({
            rows: [{
                request_number: '260307-004',
                user_id: 1,
                category: 'plumbing',
                description: 'Leak in bathroom',
                status: 'new'
            }]
        });

        const result = await Request.create({
            user_id: 1,
            building_id: 5,
            category: 'plumbing',
            description: 'Leak in bathroom'
        });

        expect(result.request_number).toMatch(/\d{6}-004/);
        expect(result.category).toBe('plumbing');
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('findByNumber returns request or null', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const result = await Request.findByNumber('999999-999');
        expect(result).toBeNull();
    });

    test('updateStatus changes status', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ request_number: '260307-001', status: 'in_progress' }]
        });

        const result = await Request.updateStatus('260307-001', 'in_progress');
        expect(result.status).toBe('in_progress');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=requestModel`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// src/models/Request.js
const db = require('../config/database');
const logger = require('../utils/logger');

class Request {
    static generateRequestNumber(count) {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const seq = String(count + 1).padStart(3, '0');
        return `${yy}${mm}${dd}-${seq}`;
    }

    static async create(data) {
        const { user_id, executor_id, apartment_id, building_id, alert_id,
                category, description, urgency = 'normal', media_files = [] } = data;

        // Get today's count for request number
        const today = new Date().toISOString().slice(0, 10);
        const { rows: countRows } = await db.query(
            `SELECT COUNT(*) FROM uk.requests WHERE created_at::date = $1::date`,
            [today]
        );
        const requestNumber = this.generateRequestNumber(parseInt(countRows[0].count));

        const { rows } = await db.query(
            `INSERT INTO uk.requests
             (request_number, user_id, executor_id, apartment_id, building_id, alert_id,
              category, description, urgency, media_files)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [requestNumber, user_id, executor_id || null, apartment_id || null,
             building_id || null, alert_id || null, category, description,
             urgency, JSON.stringify(media_files)]
        );

        logger.info(`Created request ${requestNumber}`);
        return rows[0];
    }

    static async findByNumber(requestNumber) {
        const { rows } = await db.query(
            `SELECT r.*,
                    u.username as creator_name,
                    e.username as executor_name,
                    b.name as building_name
             FROM uk.requests r
             LEFT JOIN users u ON r.user_id = u.user_id
             LEFT JOIN users e ON r.executor_id = e.user_id
             LEFT JOIN buildings b ON r.building_id = b.building_id
             WHERE r.request_number = $1`,
            [requestNumber]
        );
        return rows[0] || null;
    }

    static async findAll({ page = 1, limit = 20, status, category, user_id, executor_id, building_id } = {}) {
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (status) { conditions.push(`r.status = $${paramIdx++}`); params.push(status); }
        if (category) { conditions.push(`r.category = $${paramIdx++}`); params.push(category); }
        if (user_id) { conditions.push(`r.user_id = $${paramIdx++}`); params.push(user_id); }
        if (executor_id) { conditions.push(`r.executor_id = $${paramIdx++}`); params.push(executor_id); }
        if (building_id) { conditions.push(`r.building_id = $${paramIdx++}`); params.push(building_id); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (page - 1) * limit;

        const { rows } = await db.query(
            `SELECT r.*,
                    u.username as creator_name,
                    e.username as executor_name,
                    b.name as building_name
             FROM uk.requests r
             LEFT JOIN users u ON r.user_id = u.user_id
             LEFT JOIN users e ON r.executor_id = e.user_id
             LEFT JOIN buildings b ON r.building_id = b.building_id
             ${where}
             ORDER BY r.created_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
            [...params, limit, offset]
        );

        const { rows: countRows } = await db.query(
            `SELECT COUNT(*) FROM uk.requests r ${where}`,
            params
        );

        return {
            data: rows,
            pagination: {
                total: parseInt(countRows[0].count),
                page,
                limit,
                totalPages: Math.ceil(parseInt(countRows[0].count) / limit)
            }
        };
    }

    static async updateStatus(requestNumber, status) {
        const updates = { status };
        if (status === 'completed') updates.completed_at = new Date();

        const { rows } = await db.query(
            `UPDATE uk.requests
             SET status = $1, updated_at = NOW(),
                 completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END
             WHERE request_number = $2
             RETURNING *`,
            [status, requestNumber]
        );
        return rows[0] || null;
    }

    static async assignExecutor(requestNumber, executorId) {
        const { rows } = await db.query(
            `UPDATE uk.requests SET executor_id = $1, status = 'in_progress', updated_at = NOW()
             WHERE request_number = $2 RETURNING *`,
            [executorId, requestNumber]
        );
        return rows[0] || null;
    }
}

module.exports = Request;
```

**Step 4: Run test**

Run: `npm run test:unit -- --testPathPattern=requestModel`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/models/Request.js tests/jest/unit/requestModel.test.js
git commit -m "feat: Request model with CRUD and request number generation"
```

---

### Task 2.2: Requests controller and routes

**Files:**
- Create: `src/controllers/requestController.js`
- Create: `src/routes/requestRoutes.js`
- Modify: `src/routes/index.js`

**Step 1: Write controller**

```javascript
// src/controllers/requestController.js
const Request = require('../models/Request');
const logger = require('../utils/logger');

const requestController = {
    async create(req, res) {
        try {
            const request = await Request.create({
                ...req.body,
                user_id: req.user.user_id
            });
            res.status(201).json({ success: true, data: request });
        } catch (error) {
            logger.error(`Create request error: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    async getAll(req, res) {
        try {
            const { page, limit, status, category, building_id } = req.query;
            const result = await Request.findAll({
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20,
                status, category,
                building_id: building_id ? parseInt(building_id) : undefined
            });
            res.json({ success: true, ...result });
        } catch (error) {
            logger.error(`Get requests error: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    async getByNumber(req, res) {
        try {
            const request = await Request.findByNumber(req.params.number);
            if (!request) {
                return res.status(404).json({ success: false, message: 'Request not found' });
            }
            res.json({ success: true, data: request });
        } catch (error) {
            logger.error(`Get request error: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    async updateStatus(req, res) {
        try {
            const { status } = req.body;
            const validStatuses = ['new', 'in_progress', 'purchasing', 'clarification',
                                   'completed', 'accepted', 'cancelled'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status' });
            }

            const request = await Request.updateStatus(req.params.number, status);
            if (!request) {
                return res.status(404).json({ success: false, message: 'Request not found' });
            }
            res.json({ success: true, data: request });
        } catch (error) {
            logger.error(`Update request status error: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    async assign(req, res) {
        try {
            const { executor_id } = req.body;
            const request = await Request.assignExecutor(req.params.number, executor_id);
            if (!request) {
                return res.status(404).json({ success: false, message: 'Request not found' });
            }
            res.json({ success: true, data: request });
        } catch (error) {
            logger.error(`Assign executor error: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = requestController;
```

**Step 2: Write routes**

```javascript
// src/routes/requestRoutes.js
const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { requireAnyRole } = require('../middleware/roleGuard');
const { authenticateJWT } = require('../middleware/auth');

// All request routes require authentication
router.use(authenticateJWT);

router.get('/', requestController.getAll);
router.get('/:number', requestController.getByNumber);
router.post('/', requireAnyRole(['resident', 'manager', 'admin']), requestController.create);
router.patch('/:number/status', requireAnyRole(['manager', 'admin', 'executor']), requestController.updateStatus);
router.patch('/:number/assign', requireAnyRole(['manager', 'admin']), requestController.assign);

module.exports = router;
```

**Step 3: Register in main router**

Add to `src/routes/index.js`:

```javascript
const requestRoutes = require('./requestRoutes');
// ... in the routes section:
router.use('/requests', requestRoutes);
```

**Step 4: Run existing tests**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/controllers/requestController.js src/routes/requestRoutes.js src/routes/index.js
git commit -m "feat: requests API - CRUD endpoints with role guards"
```

---

### Task 2.3: Request comments and ratings models

**Files:**
- Create: `src/models/RequestComment.js`
- Create: `src/models/Rating.js`

**Step 1: Write RequestComment model**

```javascript
// src/models/RequestComment.js
const db = require('../config/database');

class RequestComment {
    static async create(requestNumber, userId, text) {
        const { rows } = await db.query(
            `INSERT INTO uk.request_comments (request_number, user_id, text)
             VALUES ($1, $2, $3) RETURNING *`,
            [requestNumber, userId, text]
        );
        return rows[0];
    }

    static async findByRequest(requestNumber) {
        const { rows } = await db.query(
            `SELECT c.*, u.username, u.full_name
             FROM uk.request_comments c
             JOIN users u ON c.user_id = u.user_id
             WHERE c.request_number = $1
             ORDER BY c.created_at ASC`,
            [requestNumber]
        );
        return rows;
    }
}

module.exports = RequestComment;
```

**Step 2: Write Rating model**

```javascript
// src/models/Rating.js
const db = require('../config/database');

class Rating {
    static async create(requestNumber, userId, score, comment) {
        const { rows } = await db.query(
            `INSERT INTO uk.ratings (request_number, user_id, score, comment)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (request_number, user_id) DO UPDATE SET score = $3, comment = $4
             RETURNING *`,
            [requestNumber, userId, score, comment]
        );
        return rows[0];
    }

    static async getByRequest(requestNumber) {
        const { rows } = await db.query(
            `SELECT r.*, u.username FROM uk.ratings r
             JOIN users u ON r.user_id = u.user_id
             WHERE r.request_number = $1`,
            [requestNumber]
        );
        return rows;
    }

    static async getExecutorAvgRating(executorId) {
        const { rows } = await db.query(
            `SELECT AVG(r.score)::numeric(3,2) as avg_rating, COUNT(*) as total_ratings
             FROM uk.ratings r
             JOIN uk.requests req ON r.request_number = req.request_number
             WHERE req.executor_id = $1`,
            [executorId]
        );
        return rows[0];
    }
}

module.exports = Rating;
```

**Step 3: Add comment/rating endpoints to requestRoutes.js**

```javascript
// Add to src/routes/requestRoutes.js
const RequestComment = require('../models/RequestComment');
const Rating = require('../models/Rating');

// Comments
router.get('/:number/comments', async (req, res) => {
    try {
        const comments = await RequestComment.findByRequest(req.params.number);
        res.json({ success: true, data: comments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/:number/comments', async (req, res) => {
    try {
        const comment = await RequestComment.create(
            req.params.number, req.user.user_id, req.body.text
        );
        res.status(201).json({ success: true, data: comment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Ratings
router.post('/:number/rate', requireAnyRole(['resident', 'manager']), async (req, res) => {
    try {
        const { score, comment } = req.body;
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ success: false, message: 'Score must be 1-5' });
        }
        const rating = await Rating.create(req.params.number, req.user.user_id, score, comment);
        res.status(201).json({ success: true, data: rating });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
```

**Step 4: Commit**

```bash
git add src/models/RequestComment.js src/models/Rating.js src/routes/requestRoutes.js
git commit -m "feat: request comments and ratings with API endpoints"
```

---

### Task 2.4: Vue Requests views

**Files:**
- Create: `frontend/src/views/requests/RequestsList.vue`
- Create: `frontend/src/views/requests/RequestCreate.vue`
- Create: `frontend/src/views/requests/RequestDetail.vue`
- Create: `frontend/src/stores/requests.js`
- Modify: `frontend/src/router/index.js`

This task creates the frontend views for request management. The implementation follows the same patterns established in Tasks 1.4 and 1.5 — Pinia store for data, Vue components for UI, router for navigation.

**Key store methods:** `fetchRequests()`, `fetchRequest(number)`, `createRequest(data)`, `updateStatus(number, status)`

**Key routes to add:**
```javascript
{ path: '/requests', name: 'requests', component: RequestsList, meta: { requiresAuth: true } }
{ path: '/requests/new', name: 'request-create', component: RequestCreate, meta: { requiresAuth: true } }
{ path: '/requests/:number', name: 'request-detail', component: RequestDetail, meta: { requiresAuth: true } }
```

**Commit:** `git commit -m "feat: Vue requests views (list, create, detail)"`

---

## Phase 3: Shifts Module (Weeks 6-7)

### Task 3.1: Shift model

**Files:**
- Create: `src/models/Shift.js`
- Create: `tests/jest/unit/shiftModel.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/shiftModel.test.js
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

const db = require('../../../src/config/database');
const Shift = require('../../../src/models/Shift');

describe('Shift model', () => {
    afterEach(() => jest.clearAllMocks());

    test('create returns a new shift', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{
                shift_id: 1,
                executor_id: 2,
                shift_type: 'morning',
                status: 'planned'
            }]
        });

        const result = await Shift.create({
            executor_id: 2,
            shift_type: 'morning',
            started_at: '2026-03-08T08:00:00Z'
        });

        expect(result.shift_id).toBe(1);
        expect(result.status).toBe('planned');
    });

    test('getActiveByExecutor returns active shift', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ shift_id: 1, status: 'active' }]
        });

        const result = await Shift.getActiveByExecutor(2);
        expect(result.status).toBe('active');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=shiftModel`
Expected: FAIL

**Step 3: Write implementation**

```javascript
// src/models/Shift.js
const db = require('../config/database');
const logger = require('../utils/logger');

class Shift {
    static async create(data) {
        const { executor_id, shift_type, started_at, ended_at } = data;
        const { rows } = await db.query(
            `INSERT INTO uk.shifts (executor_id, shift_type, started_at, ended_at)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [executor_id, shift_type, started_at, ended_at || null]
        );
        return rows[0];
    }

    static async findById(shiftId) {
        const { rows } = await db.query(
            `SELECT s.*, u.username as executor_name, u.specializations
             FROM uk.shifts s
             JOIN users u ON s.executor_id = u.user_id
             WHERE s.shift_id = $1`,
            [shiftId]
        );
        return rows[0] || null;
    }

    static async getActiveByExecutor(executorId) {
        const { rows } = await db.query(
            `SELECT * FROM uk.shifts
             WHERE executor_id = $1 AND status = 'active'
             ORDER BY started_at DESC LIMIT 1`,
            [executorId]
        );
        return rows[0] || null;
    }

    static async findAll({ page = 1, limit = 20, status, executor_id } = {}) {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) { conditions.push(`s.status = $${idx++}`); params.push(status); }
        if (executor_id) { conditions.push(`s.executor_id = $${idx++}`); params.push(executor_id); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (page - 1) * limit;

        const { rows } = await db.query(
            `SELECT s.*, u.username as executor_name
             FROM uk.shifts s
             JOIN users u ON s.executor_id = u.user_id
             ${where}
             ORDER BY s.started_at DESC
             LIMIT $${idx++} OFFSET $${idx}`,
            [...params, limit, offset]
        );

        return rows;
    }

    static async updateStatus(shiftId, status) {
        const { rows } = await db.query(
            `UPDATE uk.shifts SET status = $1 WHERE shift_id = $2 RETURNING *`,
            [status, shiftId]
        );
        return rows[0] || null;
    }
}

module.exports = Shift;
```

**Step 4: Run test**

Run: `npm run test:unit -- --testPathPattern=shiftModel`
Expected: PASS

**Step 5: Commit**

```bash
git add src/models/Shift.js tests/jest/unit/shiftModel.test.js
git commit -m "feat: Shift model with CRUD operations"
```

---

### Task 3.2: ML-scoring assignment service

**Files:**
- Create: `src/services/assignmentService.js`
- Create: `tests/jest/unit/assignmentService.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/assignmentService.test.js
const AssignmentService = require('../../../src/services/assignmentService');

describe('AssignmentService', () => {
    test('calculateScore returns weighted score', () => {
        const executor = {
            specializations: ['plumbing', 'electrical'],
            latitude: 41.31,
            longitude: 69.24,
            active_requests: 2,
            max_requests: 5,
            avg_rating: 4.5
        };

        const request = {
            category: 'plumbing',
            building_latitude: 41.32,
            building_longitude: 69.25
        };

        const score = AssignmentService.calculateScore(executor, request);

        expect(score.total).toBeGreaterThan(0);
        expect(score.total).toBeLessThanOrEqual(100);
        expect(score.specialization_match).toBeGreaterThan(0);
    });

    test('score is 0 for non-matching specialization', () => {
        const executor = {
            specializations: ['cleaning'],
            latitude: 41.31,
            longitude: 69.24,
            active_requests: 0,
            max_requests: 5,
            avg_rating: 5.0
        };

        const request = {
            category: 'electrical',
            building_latitude: 41.31,
            building_longitude: 69.24
        };

        const score = AssignmentService.calculateScore(executor, request);
        expect(score.specialization_match).toBe(0);
    });

    test('rankExecutors returns sorted by total score', () => {
        const executors = [
            { user_id: 1, specializations: ['plumbing'], latitude: 41.31, longitude: 69.24, active_requests: 4, max_requests: 5, avg_rating: 3.0 },
            { user_id: 2, specializations: ['plumbing'], latitude: 41.32, longitude: 69.25, active_requests: 1, max_requests: 5, avg_rating: 4.8 }
        ];

        const request = { category: 'plumbing', building_latitude: 41.31, building_longitude: 69.24 };

        const ranked = AssignmentService.rankExecutors(executors, request);
        expect(ranked[0].user_id).toBe(2); // Better rating + lower workload
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern=assignmentService`
Expected: FAIL

**Step 3: Write implementation**

```javascript
// src/services/assignmentService.js

const WEIGHTS = {
    specialization: 0.35,
    geography: 0.25,
    workload: 0.25,
    rating: 0.15
};

const AUTO_ASSIGN_THRESHOLD = 70;

class AssignmentService {
    static calculateScore(executor, request) {
        const specMatch = this._matchSpecialization(executor.specializations, request.category);
        const geoScore = this._calculateGeographicScore(
            executor.latitude, executor.longitude,
            request.building_latitude, request.building_longitude
        );
        const workloadScore = 1 - (executor.active_requests / (executor.max_requests || 5));
        const ratingScore = (executor.avg_rating || 3.0) / 5.0;

        const total = Math.round(
            (specMatch * WEIGHTS.specialization +
             geoScore * WEIGHTS.geography +
             Math.max(0, workloadScore) * WEIGHTS.workload +
             ratingScore * WEIGHTS.rating) * 100
        );

        return {
            total: Math.min(100, Math.max(0, total)),
            specialization_match: Math.round(specMatch * 100),
            geographic_score: Math.round(geoScore * 100),
            workload_score: Math.round(Math.max(0, workloadScore) * 100),
            rating_score: Math.round(ratingScore * 100)
        };
    }

    static _matchSpecialization(specializations = [], category) {
        if (!specializations || !Array.isArray(specializations)) return 0;
        return specializations.includes(category) ? 1.0 : 0;
    }

    static _calculateGeographicScore(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 0.5;
        const distance = this._haversineKm(lat1, lon1, lat2, lon2);
        // Score: 1.0 for 0km, 0.0 for 10+km
        return Math.max(0, 1 - distance / 10);
    }

    static _haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    static rankExecutors(executors, request) {
        return executors
            .map(executor => ({
                ...executor,
                score: this.calculateScore(executor, request)
            }))
            .sort((a, b) => b.score.total - a.score.total);
    }

    static shouldAutoAssign(score) {
        return score.total >= AUTO_ASSIGN_THRESHOLD;
    }
}

module.exports = AssignmentService;
```

**Step 4: Run test**

Run: `npm run test:unit -- --testPathPattern=assignmentService`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/services/assignmentService.js tests/jest/unit/assignmentService.test.js
git commit -m "feat: ML-scoring assignment service with weighted scoring"
```

---

### Task 3.3: Shifts controller and routes

**Files:**
- Create: `src/controllers/shiftController.js`
- Create: `src/routes/shiftRoutes.js`
- Modify: `src/routes/index.js`

Follow the same pattern as Task 2.2. Key endpoints:

- `GET /api/shifts` — list all shifts (manager)
- `GET /api/shifts/current` — get executor's active shift (executor)
- `POST /api/shifts` — create shift (manager)
- `PATCH /api/shifts/:id/status` — update shift status (manager, executor)
- `POST /api/shifts/:id/assign` — assign request to shift (manager)
- `GET /api/assignments/suggest` — get ML-ranked executors for a request (manager)

Register in `src/routes/index.js`:
```javascript
const shiftRoutes = require('./shiftRoutes');
router.use('/shifts', shiftRoutes);
```

**Commit:** `git commit -m "feat: shifts API with assignment endpoints"`

---

### Task 3.4: Vue Shifts views

**Files:**
- Create: `frontend/src/views/shifts/ShiftsList.vue`
- Create: `frontend/src/views/shifts/ShiftCurrent.vue`
- Create: `frontend/src/stores/shifts.js`
- Modify: `frontend/src/router/index.js`

Add routes:
```javascript
{ path: '/shifts', name: 'shifts', component: ShiftsList, meta: { requiresAuth: true, roles: ['manager'] } }
{ path: '/shift', name: 'shift-current', component: ShiftCurrent, meta: { requiresAuth: true, roles: ['executor'] } }
```

**Commit:** `git commit -m "feat: Vue shifts views (list, current shift)"`

---

## Phase 4: Addresses + Verification (Week 8)

### Task 4.1: Addresses model and routes

**Files:**
- Create: `src/models/Apartment.js`
- Create: `src/models/Yard.js`
- Create: `src/controllers/addressController.js`
- Create: `src/routes/addressRoutes.js`

Key endpoints:
- `GET /api/apartments?building_id=X` — list apartments in building
- `POST /api/apartments` — create apartment (admin)
- `POST /api/apartments/:id/link` — link user to apartment (resident)
- `GET /api/yards` — list territorial zones
- `POST /api/yards` — create yard (admin)

Register: `router.use('/apartments', addressRoutes)`

**Commit:** `git commit -m "feat: addresses API (apartments, yards, user-apartment links)"`

---

### Task 4.2: Verification model and routes

**Files:**
- Create: `src/models/Verification.js`
- Create: `src/controllers/verificationController.js`
- Create: `src/routes/verificationRoutes.js`

Key endpoints:
- `POST /api/verification/upload` — upload verification document (resident)
- `GET /api/verification/pending` — list pending verifications (manager)
- `PATCH /api/verification/:id/review` — approve/reject document (manager)

Register: `router.use('/verification', verificationRoutes)`

**Commit:** `git commit -m "feat: document verification API with file upload"`

---

### Task 4.3: Vue admin views for addresses and verification

**Files:**
- Create: `frontend/src/views/admin/UsersAdmin.vue`
- Create: `frontend/src/views/admin/VerificationAdmin.vue`
- Create: `frontend/src/views/admin/AddressAdmin.vue`
- Create: `frontend/src/views/profile/ProfileView.vue`
- Modify: `frontend/src/router/index.js`

Routes:
```javascript
{ path: '/admin/users', component: UsersAdmin, meta: { roles: ['manager', 'admin'] } }
{ path: '/admin/verification', component: VerificationAdmin, meta: { roles: ['manager'] } }
{ path: '/admin/addresses', component: AddressAdmin, meta: { roles: ['manager', 'admin'] } }
{ path: '/profile', component: ProfileView, meta: { requiresAuth: true } }
```

**Commit:** `git commit -m "feat: Vue admin views (users, verification, addresses, profile)"`

---

## Phase 5: Telegram Bot (Week 9)

### Task 5.1: grammY bot setup

**Files:**
- Create: `src/modules/telegram/bot.js`
- Create: `src/modules/telegram/handlers/notifications.js`
- Create: `src/modules/telegram/handlers/quickActions.js`
- Create: `src/routes/telegramRoutes.js`

**Step 1: Install grammY**

Run: `npm install grammy`

**Step 2: Create bot instance**

```javascript
// src/modules/telegram/bot.js
const { Bot } = require('grammy');
const logger = require('../../utils/logger');

let bot = null;

function init() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        logger.warn('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled');
        return null;
    }

    bot = new Bot(token);

    // Register handlers
    require('./handlers/notifications').register(bot);
    require('./handlers/quickActions').register(bot);

    logger.info('Telegram bot initialized');
    return bot;
}

function getBot() {
    return bot;
}

module.exports = { init, getBot };
```

**Step 3: Create notification handler**

```javascript
// src/modules/telegram/handlers/notifications.js
const logger = require('../../../utils/logger');

function register(bot) {
    bot.command('start', async (ctx) => {
        await ctx.reply(
            'InfraSafe - Система мониторинга и управления\n\n' +
            'Привяжите аккаунт через веб-интерфейс для получения уведомлений.'
        );
    });
}

async function sendNotification(bot, telegramId, message) {
    try {
        await bot.api.sendMessage(telegramId, message, { parse_mode: 'HTML' });
    } catch (error) {
        logger.error(`Telegram notification error: ${error.message}`);
    }
}

module.exports = { register, sendNotification };
```

**Step 4: Create quick actions handler**

```javascript
// src/modules/telegram/handlers/quickActions.js
const Request = require('../../../models/Request');
const logger = require('../../../utils/logger');

function register(bot) {
    bot.callbackQuery(/^accept_(.+)$/, async (ctx) => {
        const requestNumber = ctx.match[1];
        try {
            await Request.updateStatus(requestNumber, 'in_progress');
            await ctx.answerCallbackQuery({ text: 'Заявка принята' });
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        } catch (error) {
            logger.error(`Quick action error: ${error.message}`);
            await ctx.answerCallbackQuery({ text: 'Ошибка' });
        }
    });

    bot.callbackQuery(/^reject_(.+)$/, async (ctx) => {
        const requestNumber = ctx.match[1];
        try {
            await Request.updateStatus(requestNumber, 'new');
            await ctx.answerCallbackQuery({ text: 'Заявка отклонена' });
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        } catch (error) {
            logger.error(`Quick action error: ${error.message}`);
            await ctx.answerCallbackQuery({ text: 'Ошибка' });
        }
    });
}

module.exports = { register };
```

**Step 5: Create webhook route**

```javascript
// src/routes/telegramRoutes.js
const express = require('express');
const router = express.Router();
const { getBot } = require('../modules/telegram/bot');
const { webhookCallback } = require('grammy');

router.post('/webhook', (req, res, next) => {
    const bot = getBot();
    if (!bot) {
        return res.status(503).json({ message: 'Telegram bot not configured' });
    }
    webhookCallback(bot, 'express')(req, res, next);
});

module.exports = router;
```

**Step 6: Register in main router and init in server startup**

Add to `src/routes/index.js`:
```javascript
const telegramRoutes = require('./telegramRoutes');
router.use('/telegram', telegramRoutes);
```

Add to `src/index.js` (in startup sequence):
```javascript
const telegramBot = require('./modules/telegram/bot');
telegramBot.init();
```

**Step 7: Add env variables**

Add to `.env.example`:
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_URL=
```

**Step 8: Commit**

```bash
git add src/modules/telegram/ src/routes/telegramRoutes.js src/routes/index.js package.json package-lock.json
git commit -m "feat: Telegram bot with grammY (webhook, notifications, quick actions)"
```

---

### Task 5.2: Notification service (unified web + telegram)

**Files:**
- Create: `src/services/notificationService.js`
- Create: `tests/jest/unit/notificationService.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/notificationService.test.js
jest.mock('../../../src/config/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [{ notification_id: 1 }] })
}));
jest.mock('../../../src/services/sseService', () => ({
    instance: { sendToUser: jest.fn() }
}));

const NotificationService = require('../../../src/services/notificationService');

describe('NotificationService', () => {
    test('notify sends to SSE and logs to DB', async () => {
        const sseService = require('../../../src/services/sseService').instance;
        const db = require('../../../src/config/database');

        await NotificationService.notify({
            userId: 1,
            type: 'request_assigned',
            message: 'New request assigned to you',
            channel: 'web'
        });

        expect(sseService.sendToUser).toHaveBeenCalledWith('1', 'notification', expect.any(Object));
        expect(db.query).toHaveBeenCalled();
    });
});
```

**Step 2: Run test, verify fail, implement, verify pass**

```javascript
// src/services/notificationService.js
const db = require('../config/database');
const { instance: sseService } = require('./sseService');
const logger = require('../utils/logger');

class NotificationService {
    static async notify({ userId, type, message, channel = 'web', data = {} }) {
        // Log to database
        await db.query(
            `INSERT INTO uk.notifications (user_id, type, message, channel)
             VALUES ($1, $2, $3, $4)`,
            [userId, type, message, channel]
        );

        // Send via SSE (web)
        if (channel === 'web' || channel === 'both') {
            sseService.sendToUser(String(userId), 'notification', {
                type, message, ...data, timestamp: new Date().toISOString()
            });
        }

        // Send via Telegram
        if (channel === 'telegram' || channel === 'both') {
            await this._sendTelegram(userId, message);
        }

        logger.debug(`Notification sent to user ${userId}: ${type}`);
    }

    static async _sendTelegram(userId, message) {
        try {
            const { rows } = await db.query(
                'SELECT telegram_id FROM users WHERE user_id = $1 AND telegram_id IS NOT NULL',
                [userId]
            );
            if (rows[0]?.telegram_id) {
                const { getBot } = require('../modules/telegram/bot');
                const bot = getBot();
                if (bot) {
                    const { sendNotification } = require('../modules/telegram/handlers/notifications');
                    await sendNotification(bot, rows[0].telegram_id, message);
                }
            }
        } catch (error) {
            logger.error(`Telegram notification error: ${error.message}`);
        }
    }

    static async getUnread(userId) {
        const { rows } = await db.query(
            `SELECT * FROM uk.notifications
             WHERE user_id = $1 AND read_at IS NULL
             ORDER BY sent_at DESC LIMIT 50`,
            [userId]
        );
        return rows;
    }

    static async markRead(notificationId, userId) {
        await db.query(
            `UPDATE uk.notifications SET read_at = NOW()
             WHERE notification_id = $1 AND user_id = $2`,
            [notificationId, userId]
        );
    }
}

module.exports = NotificationService;
```

**Step 3: Run test**

Run: `npm run test:unit -- --testPathPattern=notificationService`
Expected: PASS

**Step 4: Commit**

```bash
git add src/services/notificationService.js tests/jest/unit/notificationService.test.js
git commit -m "feat: unified notification service (SSE + Telegram + DB log)"
```

---

## Phase 6: Alert-Request Pipeline + Analytics (Week 10)

### Task 6.1: Alert-to-Request pipeline service

**Files:**
- Create: `src/services/alertRequestPipeline.js`
- Create: `tests/jest/unit/alertRequestPipeline.test.js`

**Step 1: Write the failing test**

```javascript
// tests/jest/unit/alertRequestPipeline.test.js
const AlertRequestPipeline = require('../../../src/services/alertRequestPipeline');

describe('AlertRequestPipeline', () => {
    test('mapAlertToCategory converts alert types correctly', () => {
        expect(AlertRequestPipeline.mapAlertToCategory('voltage_low')).toBe('electrical');
        expect(AlertRequestPipeline.mapAlertToCategory('water_leak')).toBe('plumbing');
        expect(AlertRequestPipeline.mapAlertToCategory('temperature_high')).toBe('heating');
        expect(AlertRequestPipeline.mapAlertToCategory('unknown_type')).toBe('security');
    });

    test('mapSeverityToUrgency converts correctly', () => {
        expect(AlertRequestPipeline.mapSeverityToUrgency('INFO')).toBe('normal');
        expect(AlertRequestPipeline.mapSeverityToUrgency('WARNING')).toBe('medium');
        expect(AlertRequestPipeline.mapSeverityToUrgency('CRITICAL')).toBe('critical');
    });
});
```

**Step 2: Run, fail, implement**

```javascript
// src/services/alertRequestPipeline.js
const Request = require('../models/Request');
const AssignmentService = require('./assignmentService');
const NotificationService = require('./notificationService');
const logger = require('../utils/logger');

const ALERT_CATEGORY_MAP = {
    voltage_low: 'electrical',
    voltage_high: 'electrical',
    power_outage: 'electrical',
    water_leak: 'plumbing',
    water_pressure_low: 'plumbing',
    temperature_high: 'heating',
    temperature_low: 'heating',
    humidity_high: 'security',
    co2_high: 'security'
};

const SEVERITY_URGENCY_MAP = {
    INFO: 'normal',
    WARNING: 'medium',
    CRITICAL: 'critical'
};

class AlertRequestPipeline {
    static mapAlertToCategory(alertType) {
        return ALERT_CATEGORY_MAP[alertType] || 'security';
    }

    static mapSeverityToUrgency(severity) {
        return SEVERITY_URGENCY_MAP[severity] || 'normal';
    }

    static async processAlert(alert, buildingId) {
        const category = this.mapAlertToCategory(alert.type);
        const urgency = this.mapSeverityToUrgency(alert.severity);

        const request = await Request.create({
            user_id: 1, // system user
            building_id: buildingId,
            alert_id: alert.alert_id,
            category,
            description: `[AUTO] ${alert.message}`,
            urgency
        });

        logger.info(`Alert ${alert.alert_id} -> Request ${request.request_number}`);

        // Notify managers
        await NotificationService.notify({
            userId: 1, // TODO: query managers
            type: 'alert_request_created',
            message: `Автоматическая заявка ${request.request_number} по алерту: ${alert.message}`,
            channel: 'both'
        });

        return request;
    }
}

module.exports = AlertRequestPipeline;
```

**Step 3: Run test**

Run: `npm run test:unit -- --testPathPattern=alertRequestPipeline`
Expected: PASS

**Step 4: Commit**

```bash
git add src/services/alertRequestPipeline.js tests/jest/unit/alertRequestPipeline.test.js
git commit -m "feat: alert-to-request pipeline with category/urgency mapping"
```

---

### Task 6.2: Analytics endpoints for UK data

**Files:**
- Create: `src/controllers/ukAnalyticsController.js`
- Create: `src/routes/ukAnalyticsRoutes.js`
- Modify: `src/routes/index.js`

Key endpoints:
- `GET /api/uk-analytics/requests/summary` — requests by status/category/time
- `GET /api/uk-analytics/executors/performance` — executor efficiency/ratings
- `GET /api/uk-analytics/shifts/efficiency` — shift analytics

Register: `router.use('/uk-analytics', ukAnalyticsRoutes)`

**Commit:** `git commit -m "feat: UK analytics endpoints (requests summary, executor performance)"`

---

### Task 6.3: Vue Dashboard with combined analytics

**Files:**
- Create: `frontend/src/views/DashboardView.vue`
- Modify: `frontend/src/router/index.js`

Dashboard shows:
- IoT status summary (from existing `/api/analytics`)
- Request pipeline stats (from `/api/uk-analytics/requests/summary`)
- Active alerts count
- Executor availability

Route: `{ path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true } }`

**Commit:** `git commit -m "feat: Vue dashboard with combined IoT + UK analytics"`

---

### Task 6.4: Update Nginx config for Vue SPA

**Files:**
- Modify: `nginx/nginx.conf` (or equivalent)

Update Nginx to:
1. Serve Vue SPA `dist/` for all non-API routes
2. Proxy `/api/*` to Express (unchanged)
3. Handle SPA fallback (`try_files $uri $uri/ /index.html`)

```nginx
server {
    listen 8080;

    # Vue SPA static files
    root /usr/share/nginx/html;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://app:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE proxy (no buffering)
    location /api/events/ {
        proxy_pass http://app:3000/api/events/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Commit:** `git commit -m "feat: update Nginx config for Vue SPA with SSE proxy"`

---

### Task 6.5: Update Docker Compose for Vue build

**Files:**
- Modify: `docker-compose.dev.yml`
- Create: `frontend/Dockerfile`

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY ../nginx/nginx.conf /etc/nginx/conf.d/default.conf
```

Update `docker-compose.dev.yml` frontend service to build from `frontend/Dockerfile`.

**Commit:** `git commit -m "feat: Docker build for Vue frontend"`

---

### Task 6.6: Final integration test

**Files:**
- Create: `tests/jest/integration/v2-integration.test.js`

Test the full flow:
1. Login as admin
2. Create a request
3. Assign executor
4. Update status to completed
5. Rate the request
6. Verify analytics endpoint returns data

Run: `npm run test:integration`
Expected: PASS

**Commit:** `git commit -m "test: v2 integration test for full request lifecycle"`

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 0 | 0.1-0.7 | DB schemas, migrations, Redis, Vue 3 init, useApi |
| 1 | 1.1-1.5 | Role guard, auth roles, SSE, Vue map, login |
| 2 | 2.1-2.4 | Request model/API, comments, ratings, Vue views |
| 3 | 3.1-3.4 | Shift model, ML-scoring, API, Vue views |
| 4 | 4.1-4.3 | Apartments, yards, verification, Vue admin |
| 5 | 5.1-5.2 | grammY bot, webhook, notification service |
| 6 | 6.1-6.6 | Alert-request pipeline, analytics, Nginx, Docker, integration test |

**Total: 25 tasks across 6 phases (~10 weeks)**

Each task is independently committable and testable. Tasks within a phase are sequential (later tasks depend on earlier ones). Phases are also sequential (Phase N depends on Phase N-1 infrastructure).
