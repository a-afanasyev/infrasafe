# Phase 0: Infrastructure Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate frontend-design into the existing InfraSafe project so it serves from Docker/Nginx with working auth against the real Express backend.

**Architecture:** The new frontend-design replaces root HTML files and public/ JS. Nginx serves static files from frontend-design/, proxies /api/* to Express:3000. Auth uses the same JWT flow (POST /api/auth/login → localStorage admin_token → Authorization Bearer header).

**Tech Stack:** Vanilla JS (IIFE → ES module conversion deferred to Phase 0b), HTML, CSS, Docker, Nginx, existing Express.js backend.

**Branch:** `feature/frontend-redesign` (already exists)

**Spec:** `docs/FRONTEND-REDESIGN-MASTER-PLAN.md` Section 1.5 + Section 12 Phase 0

---

## File Map

### New files to create

| File | Responsibility |
|------|---------------|
| `frontend-design/login.html` | Login page in the new design system |
| `frontend-design/js/api.js` | HTTP client wrapping fetch() with JWT auth header injection |
| `frontend-design/js/auth.js` | Login/logout/token management, auth-guard logic |
| `frontend-design/js/auth-guard.js` | Inline guard script for protected pages (runs in `<head>`) |
| `frontend-design/js/lib/event-bus.js` | Simple pub/sub for decoupled component communication |
| `frontend-design/images/` | Copied from `public/images/` |

### Files to modify

| File | Change |
|------|--------|
| `docker-compose.dev.yml` | Update frontend volume mounts to `./frontend-design/` |
| `nginx.dev.conf` | Already uses `try_files $uri $uri/ =404` (no change needed) |
| `frontend-design/dashboard.html` | Add auth-guard script, extract inline staleness script |
| `frontend-design/index.html` | Extract inline mobile-menu script |
| `frontend-design/energy-analytics.html` | Extract inline chart init script |
| All 11 protected HTML pages | Add `<script src="js/auth-guard.js"></script>` in `<head>` |
| `frontend-design/js/sidebar.js` | Read user name from auth state instead of hardcoded "Администратор" |

### Files to copy (not modify)

| Source | Destination |
|--------|------------|
| `public/images/*` | `frontend-design/images/` |
| `public/libs/leaflet/` | `frontend-design/js/lib/leaflet/` (for Phase 1 map) |
| `public/libs/leaflet-markercluster/` | `frontend-design/js/lib/leaflet-markercluster/` |

---

## Task 1: Backup old frontend + copy assets

**Files:**
- Create: `backup/frontend-old/` (directory)
- Create: `frontend-design/images/` (copied from `public/images/`)
- Create: `frontend-design/js/lib/leaflet/` (copied from `public/libs/leaflet/`)
- Create: `frontend-design/js/lib/leaflet-markercluster/` (copied)

- [ ] **Step 1: Backup current frontend**

```bash
mkdir -p backup/frontend-old
cp index.html admin.html about.html contacts.html documentation.html backup/frontend-old/
cp -r css/ backup/frontend-old/css/
cp -r public/ backup/frontend-old/public/
echo "Backup complete: $(ls backup/frontend-old/ | wc -l) items"
```

- [ ] **Step 2: Copy images**

```bash
cp -r public/images/ frontend-design/images/
ls frontend-design/images/
```

Expected: `infrasafe-logo.svg`, `favicon.svg`, etc.

- [ ] **Step 3: Copy Leaflet libraries**

```bash
mkdir -p frontend-design/js/lib/leaflet
cp -r public/libs/leaflet/* frontend-design/js/lib/leaflet/
cp -r public/libs/leaflet-markercluster frontend-design/js/lib/leaflet-markercluster
ls frontend-design/js/lib/leaflet/
ls frontend-design/js/lib/leaflet-markercluster/
```

Expected: `leaflet.js`, `leaflet.css`, `MarkerCluster.css`, etc.

- [ ] **Step 4: Commit**

```bash
git add backup/ frontend-design/images/ frontend-design/js/lib/leaflet/ frontend-design/js/lib/leaflet-markercluster/
git commit -m "chore: backup old frontend, copy assets to frontend-design"
```

---

## Task 2: Create API client (js/api.js)

**Files:**
- Create: `frontend-design/js/api.js`
- Test: Manual — verify in browser console after Task 5

The API client must be compatible with the existing backend which expects `Authorization: Bearer <token>` headers. The current frontend stores the token in `localStorage` under key `admin_token`.

- [ ] **Step 1: Create api.js**

Create `frontend-design/js/api.js`:

```javascript
/**
 * InfraSafe API Client
 * Compatible with existing Express backend.
 * Token stored in localStorage under 'admin_token' (same key as legacy frontend).
 */
(function () {
  'use strict';

  var API_BASE = '/api';
  var TOKEN_KEY = 'admin_token';

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {
      // localStorage unavailable
    }
  }

  function clearToken() {
    setToken(null);
  }

  /**
   * Core fetch wrapper with auth header injection.
   * Redirects to /login.html on 401.
   * @param {string} path - API path (e.g., '/buildings')
   * @param {object} options - fetch options
   * @returns {Promise<Response>}
   */
  async function apiFetch(path, options) {
    options = options || {};
    var token = getToken();
    var headers = Object.assign({}, options.headers || {});

    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    // Default to JSON content type for POST/PUT/PATCH
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    var fetchOptions = Object.assign({}, options, { headers: headers });
    var res;

    try {
      res = await fetch(API_BASE + path, fetchOptions);
    } catch (err) {
      // Network error — emit event for UI to handle
      if (window.InfraSafeEvents) {
        window.InfraSafeEvents.emit('api:network-error', { path: path, error: err });
      }
      throw err;
    }

    // Handle 401 — token expired or invalid
    if (res.status === 401) {
      clearToken();
      if (window.InfraSafeEvents) {
        window.InfraSafeEvents.emit('auth:unauthorized', { path: path });
      }
      // Don't redirect if already on login page
      if (!location.pathname.endsWith('/login.html')) {
        location.replace('/login.html');
      }
      return res;
    }

    return res;
  }

  /**
   * Convenience methods.
   */
  function apiGet(path) {
    return apiFetch(path, { method: 'GET' });
  }

  function apiPost(path, body) {
    return apiFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function apiPut(path, body) {
    return apiFetch(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  function apiPatch(path, body) {
    return apiFetch(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  function apiDelete(path) {
    return apiFetch(path, { method: 'DELETE' });
  }

  // Expose globally
  window.InfraSafeAPI = {
    fetch: apiFetch,
    get: apiGet,
    post: apiPost,
    put: apiPut,
    patch: apiPatch,
    delete: apiDelete,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add frontend-design/js/api.js
git commit -m "feat: add API client (js/api.js) compatible with existing backend"
```

---

## Task 3: Create auth module (js/auth.js) + auth-guard

**Files:**
- Create: `frontend-design/js/auth.js`
- Create: `frontend-design/js/auth-guard.js`

- [ ] **Step 1: Create auth.js**

Create `frontend-design/js/auth.js`:

```javascript
/**
 * InfraSafe Auth Module
 * Handles login, logout, token validation, user state.
 * Depends on: js/api.js (window.InfraSafeAPI)
 */
(function () {
  'use strict';

  var currentUser = null;

  /**
   * Login with username and password.
   * Stores token and user data.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function login(username, password) {
    try {
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      });

      if (!res.ok) {
        var errorData = {};
        try { errorData = await res.json(); } catch (e) {}
        return { success: false, error: errorData.message || 'Ошибка авторизации' };
      }

      var data = await res.json();
      var token = data.accessToken || data.token;
      if (!token) {
        return { success: false, error: 'Токен не получен' };
      }

      window.InfraSafeAPI.setToken(token);

      // Parse JWT payload for user info (without verifying — backend does that)
      try {
        var payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = {
          id: payload.userId || payload.id,
          username: payload.username,
          role: payload.role || 'user',
        };
      } catch (e) {
        currentUser = { username: username, role: 'user' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: 'Ошибка сети' };
    }
  }

  /**
   * Logout — clear token and redirect.
   */
  async function logout() {
    try {
      await window.InfraSafeAPI.post('/auth/logout', {});
    } catch (e) {
      // Ignore — we're logging out anyway
    }
    window.InfraSafeAPI.clearToken();
    currentUser = null;
    location.replace('/login.html');
  }

  /**
   * Validate current token by calling /api/auth/profile.
   * @returns {Promise<boolean>}
   */
  async function validateToken() {
    var token = window.InfraSafeAPI.getToken();
    if (!token) return false;

    try {
      var res = await window.InfraSafeAPI.get('/auth/profile');
      if (res.ok) {
        var data = await res.json();
        currentUser = {
          id: data.id || data.userId,
          username: data.username,
          role: data.role || 'user',
        };
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if user is authenticated (has token).
   */
  function isAuthenticated() {
    return !!window.InfraSafeAPI.getToken();
  }

  /**
   * Check if user has admin role.
   */
  function isAdmin() {
    return currentUser && currentUser.role === 'admin';
  }

  /**
   * Get current user info.
   */
  function getUser() {
    return currentUser;
  }

  /**
   * Get user initials for avatar.
   */
  function getUserInitials() {
    if (!currentUser || !currentUser.username) return '??';
    var name = currentUser.username;
    if (name.length <= 2) return name.toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  // Expose globally
  window.InfraSafeAuth = {
    login: login,
    logout: logout,
    validateToken: validateToken,
    isAuthenticated: isAuthenticated,
    isAdmin: isAdmin,
    getUser: getUser,
    getUserInitials: getUserInitials,
  };
})();
```

- [ ] **Step 2: Create auth-guard.js**

Create `frontend-design/js/auth-guard.js` — a tiny script that runs in `<head>` before page renders:

```javascript
/**
 * Auth Guard — blocks page render if not authenticated.
 * Must be loaded synchronously in <head> AFTER api.js.
 */
(function () {
  'use strict';
  var TOKEN_KEY = 'admin_token';
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  if (!token && !location.pathname.endsWith('/login.html') && !location.pathname.endsWith('/index.html')) {
    location.replace('/login.html');
  }
})();
```

- [ ] **Step 3: Commit**

```bash
git add frontend-design/js/auth.js frontend-design/js/auth-guard.js
git commit -m "feat: add auth module (js/auth.js) + auth-guard for protected pages"
```

---

## Task 4: Create login.html

**Files:**
- Create: `frontend-design/login.html`

- [ ] **Step 1: Create login page in design system**

Create `frontend-design/login.html` — a standalone login page using the existing design tokens (no sidebar, centered form):

The login page should:
- Use `css/styles.css` and `css/design-tokens.css` for consistent theming
- Load `js/theme.js` for dark/light mode
- Load `js/api.js` and `js/auth.js`
- Have a centered card with username/password fields + submit button
- Show error messages inline
- On success, redirect to `/dashboard.html` (or saved redirect URL)
- Support Enter key to submit
- Show InfraSafe logo at top
- Russian text throughout

Read `frontend-design/css/styles.css` and `frontend-design/css/design-tokens.css` for available CSS classes (`.card`, `.btn`, `.btn-primary`, `.form-input`, `.form-field`, etc.) and build the page using those classes.

- [ ] **Step 2: Commit**

```bash
git add frontend-design/login.html
git commit -m "feat: add login.html in design system"
```

---

## Task 5: Create event-bus.js

**Files:**
- Create: `frontend-design/js/lib/event-bus.js`

- [ ] **Step 1: Create event bus**

Create `frontend-design/js/lib/event-bus.js`:

```javascript
/**
 * Simple pub/sub event bus for decoupled component communication.
 * Used for SSE events, auth state changes, API errors.
 */
(function () {
  'use strict';

  var listeners = {};

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return function off() {
      listeners[event] = listeners[event].filter(function (f) { return f !== fn; });
    };
  }

  function emit(event, data) {
    var fns = listeners[event];
    if (fns) {
      fns.forEach(function (fn) {
        try { fn(data); } catch (e) { console.error('EventBus error on ' + event, e); }
      });
    }
  }

  function off(event, fn) {
    if (fn && listeners[event]) {
      listeners[event] = listeners[event].filter(function (f) { return f !== fn; });
    } else if (!fn) {
      delete listeners[event];
    }
  }

  window.InfraSafeEvents = { on: on, emit: emit, off: off };
})();
```

- [ ] **Step 2: Commit**

```bash
git add frontend-design/js/lib/event-bus.js
git commit -m "feat: add event bus (js/lib/event-bus.js)"
```

---

## Task 6: Add auth-guard to all protected pages + extract inline scripts

**Files:**
- Modify: All 11 protected HTML pages (dashboard, map, buildings, controllers, power, water, heating, energy-analytics, alerts, users, settings)
- Modify: `frontend-design/dashboard.html` — extract inline staleness script
- Modify: `frontend-design/index.html` — extract inline mobile menu script
- Create: `frontend-design/js/dashboard-staleness.js`
- Create: `frontend-design/js/index-nav.js`

- [ ] **Step 1: Add auth scripts to all 11 protected pages**

In each protected page's `<head>`, AFTER `<script src="js/theme.js"></script>`, add:

```html
<script src="js/lib/event-bus.js"></script>
<script src="js/api.js"></script>
<script src="js/auth-guard.js"></script>
```

Protected pages (NOT index.html, NOT login.html):
`dashboard.html`, `map.html`, `buildings.html`, `controllers.html`, `power.html`, `water.html`, `heating.html`, `energy-analytics.html`, `alerts.html`, `users.html`, `settings.html`

Also add to `admin.html` in its `<head>`.

- [ ] **Step 2: Extract dashboard staleness inline script**

Move the `<script>` block at end of `dashboard.html` (the staleness timer IIFE) to a new file `frontend-design/js/dashboard-staleness.js` and replace with `<script src="js/dashboard-staleness.js"></script>`.

- [ ] **Step 3: Extract index.html mobile menu inline script**

Move the `<script>` block at end of `index.html` (mobile menu toggle) to `frontend-design/js/index-nav.js` and replace with `<script src="js/index-nav.js"></script>`.

- [ ] **Step 4: Commit**

```bash
git add frontend-design/
git commit -m "feat: add auth-guard to all protected pages, extract inline scripts"
```

---

## Task 7: Update sidebar with auth user info

**Files:**
- Modify: `frontend-design/js/sidebar.js`

- [ ] **Step 1: Update sidebar footer to show real user**

In `sidebar.js`, find the `buildSidebar` function where it creates the user footer section (hardcoded "Администратор" / "АД"). Replace with dynamic user info:

```javascript
// In the footer section of buildSidebar:
var user = window.InfraSafeAuth ? window.InfraSafeAuth.getUser() : null;
var displayName = user ? user.username : 'Гость';
var initials = window.InfraSafeAuth ? window.InfraSafeAuth.getUserInitials() : '??';
var roleName = user && user.role === 'admin' ? 'admin' : 'user';

// Then use displayName, initials, roleName in the DOM creation
userName.textContent = displayName;
avatar.textContent = initials;
userRole.textContent = roleName;
```

Keep fallback to "Администратор" / "АД" when auth is not loaded (e.g., on index.html landing page).

- [ ] **Step 2: Add logout button to sidebar footer**

Add a small logout button (icon-only) next to the user info. On click, call `window.InfraSafeAuth.logout()`.

- [ ] **Step 3: Commit**

```bash
git add frontend-design/js/sidebar.js
git commit -m "feat: sidebar shows authenticated user info + logout button"
```

---

## Task 8: Update Docker volumes for new frontend

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Update frontend volumes**

Replace the frontend service volumes section:

```yaml
volumes:
  # New frontend-design as root
  - ./frontend-design:/usr/share/nginx/html:ro
  # Legacy assets still needed
  - ./public/images:/usr/share/nginx/html/images:ro
  # Nginx config
  - ./nginx.dev.conf:/etc/nginx/nginx.conf:ro
```

Note: Leaflet libs are already copied into `frontend-design/js/lib/` in Task 1.

- [ ] **Step 2: Verify nginx.dev.conf is MPA-compatible**

Check that `nginx.dev.conf` already has `try_files $uri $uri/ =404;` (not SPA fallback). If yes, no change needed.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "chore: update docker-compose volumes for new frontend-design"
```

---

## Task 9: Smoke test

**Files:** None (testing only)

- [ ] **Step 1: Start Docker**

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

Wait for healthy status.

- [ ] **Step 2: Verify login page loads**

Open `http://localhost:8088/login.html` — should show styled login form.

- [ ] **Step 3: Login with test credentials**

Login with `admin` / `admin123`. Should redirect to `/dashboard.html`.

- [ ] **Step 4: Verify dashboard loads with auth**

Dashboard should show with sidebar, KPIs, charts. Check browser console — 0 JS errors (excluding favicon).

- [ ] **Step 5: Verify sidebar navigation**

Click through all sidebar links. Each page should load without redirect to login.

- [ ] **Step 6: Verify theme toggle**

Toggle dark/light theme on dashboard and buildings pages.

- [ ] **Step 7: Verify auth-guard on direct URL access**

Open `http://localhost:8088/buildings.html` in incognito (no token). Should redirect to `/login.html`.

- [ ] **Step 8: Test API call from console**

In browser console on dashboard page:
```javascript
InfraSafeAPI.get('/buildings').then(r => r.json()).then(console.log)
```

Should return buildings data from the real backend.

---

## Summary

| Task | Description | Effort |
|------|-------------|--------|
| 1 | Backup + copy assets | 15 min |
| 2 | API client (api.js) | 30 min |
| 3 | Auth module (auth.js + auth-guard.js) | 45 min |
| 4 | Login page (login.html) | 1 hour |
| 5 | Event bus | 15 min |
| 6 | Add auth-guard to all pages + extract inline scripts | 1 hour |
| 7 | Sidebar user info | 30 min |
| 8 | Docker volumes update | 15 min |
| 9 | Smoke test | 30 min |
| **Total** | | **~5 hours** |

**Dependencies:**
```
Task 1 (assets) ──────────────────────────┐
Task 2 (api.js) ──→ Task 3 (auth.js) ──→ Task 4 (login.html) ──→ Task 6 (auth-guard) ──→ Task 9 (smoke)
Task 5 (event-bus) ────────────────────→ Task 6
                                         Task 7 (sidebar) ──────→ Task 9
                                         Task 8 (docker) ───────→ Task 9
```

Tasks 1, 2, 5 can run in parallel. Tasks 3, 7, 8 can run in parallel after 2. Task 9 requires all others.
