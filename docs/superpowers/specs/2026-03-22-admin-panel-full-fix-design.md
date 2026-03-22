# Admin Panel Full Fix — Design Specification

## Goal

Fix all P0 bugs, P1 UX issues, and implement partial P2 improvements (CSS extraction + generic table renderer) identified by three expert reviews (UX/UI, Architect, IoT Specialist) of the InfraSafe admin panel.

## Scope

- **P0 (8 items)**: inline onclick removal, missing CSS classes, localStorage key bug, aria-labels, colspan fix, dead code removal, Alerts tab, header checkbox listener leak
- **P1 (7 items)**: status localization, contrast fix, toast/logout overlap, metrics form unification, CSS extraction with variables, entity cache with name display, controller heartbeat
- **Partial P2 (1 item)**: generic table renderer replacing 7 of 8 duplicate renderXxxTable functions

**Out of scope**: ES module decomposition of admin.js, design system unification with index.html, dark mode for admin, full event delegation refactor.

## Files Affected

### Modified
- `admin.html` — remove inline onclick, add aria-labels, fix colspan, add alerts section, add alerts nav tab, restructure metrics form, replace inline `<style>` with `<link>` to external CSS
- `public/admin.js` — remove dead stubs, replace 7 renderXxxTable with generic renderer, add alerts CRUD, add entity cache, add heartbeat column, fix status labels, wire up onclick replacements
- `public/admin-auth.js` — no changes (toast positioning fix is CSS-only)
- `public/admin-coordinate-editor.js` — fix localStorage key `'token'` → `'admin_token'` (line 337)
- `src/controllers/alertController.js` — add `status` query param support to `getActiveAlerts`
- `src/services/alertService.js` — parameterize status in `getActiveAlerts` WHERE clause
- `src/routes/alertRoutes.js` — add `isAdmin` middleware to PATCH acknowledge/resolve routes (authorization fix)

### Created
- `public/css/admin.css` — extracted from admin.html inline `<style>`, with CSS variables for colors

## Section 1: P0 Bug Fixes

### 1.1 Remove inline onclick attributes

Three inline onclick handlers in `admin.html`:
- **Line 1161**: "Указать на карте" button in add-transformer form — calls `openCoordinateEditor('transformer', ...)`
- **Line 1777**: "Сброс" button in metrics form — calls `resetMetricsForm()`
- **Line 1970**: "Указать на карте" button in edit-transformer modal — calls `openCoordinateEditor('transformer', ...)`

Replace all three with `id` attributes on the buttons. In `admin.js`, add `addEventListener('click', ...)` handlers for each, using the same logic currently inline.

### 1.2 Add aria-label to edit modals

Four edit modals in `admin.html` lack `aria-label`:
- `#edit-water-source-modal` → `aria-label="Редактировать источник воды"`
- `#edit-heat-source-modal` → `aria-label="Редактировать источник тепла"`
- `#edit-line-modal` → `aria-label="Редактировать линию"`
- `#edit-controller-modal` → `aria-label="Редактировать контроллер"`

The `openModal()` utility already sets `role="dialog"` and `aria-modal="true"`. Adding `aria-label` completes the accessibility story.

### 1.3 Define btn-sm and btn-danger CSS classes

Used in 14 places across `admin.js` but never defined in CSS. Add to the new `admin.css`:

```css
.btn-sm {
    padding: 4px 10px;
    font-size: 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text);
    transition: background 0.2s;
}
.btn-sm:hover {
    background: var(--color-hover);
}
.btn-danger {
    background: var(--color-danger);
    color: white;
    border-color: var(--color-danger);
}
.btn-danger:hover {
    background: var(--color-danger-hover);
}
```

### 1.4 Fix colspan mismatch in water-lines-table empty state

The thead (11 columns) and JS render function (11 cells) actually MATCH — both render: checkbox, ID, Name, Description, Diameter, Material, Pressure, Installation date, Status, Connected buildings, Actions. Do NOT remove columns from thead.

The real bug is in the **empty state**: `showNoDataMessage(newTableBody, "7")` on line 563 of `admin.js` passes colspan="7" but should be "11". Fix: change `"7"` to `"11"`. Also verify all other `showNoDataMessage()` calls have correct colspan values matching their respective table column counts.

### 1.5 Fix localStorage key in coordinate-editor

`public/admin-coordinate-editor.js` line 337:
```js
// Before:
'Authorization': `Bearer ${localStorage.getItem('token')}`
// After:
'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
```

### 1.6 Add Alerts tab

**Backend prerequisite**: The current `alertService.getActiveAlerts()` hardcodes `WHERE ia.status = 'active'`. Two changes needed:

1. **Controller** (`alertController.js`): Extract `status` from `req.query`, validate ALL filter params via whitelist:
```js
const { severity, infrastructure_type, limit, status, page, sort, order } = req.query;

// Whitelist validation for all enum params
const validStatuses = ['active', 'acknowledged', 'resolved'];
if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Недопустимый статус' });
}
const validSeverities = ['INFO', 'WARNING', 'CRITICAL'];
if (severity && !validSeverities.includes(severity.toUpperCase())) {
    return res.status(400).json({ success: false, message: 'Недопустимый уровень важности' });
}
const validInfraTypes = ['transformer', 'controller', 'water_source', 'heat_source'];
if (infrastructure_type && !validInfraTypes.includes(infrastructure_type.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Недопустимый тип инфраструктуры' });
}

if (status) filters.status = status;
// Also pass page, sort, order to service for pagination support
```

2. **Service** (`alertService.js`): Two changes:
   - Replace `const values = ['active']` with `const values = [filters.status || 'active']`. The `$1` position for status is already correct — no param index renumbering needed.
   - **Add pagination support**: Accept `page`, `limit`, `sort`, `order` params. Add `OFFSET` calculation (`(page - 1) * limit`). Return response in the same shape as other endpoints: `{ data: [...], pagination: { page, limit, total } }`. The `sort` param must be validated against a whitelist of allowed column names (e.g., `['created_at', 'severity', 'status', 'infrastructure_type']`) using the existing `queryValidation.js` pattern to prevent SQL injection. The `order` param: validate `['asc', 'desc']` only.

3. **Controller response shape**: Update `alertController.getActiveAlerts()` to return `{ success, data, pagination: { page, limit, total }, filters }` instead of `{ success, data, count, filters }`. This matches the response shape expected by `loadData()` helper in admin.js.

4. **Routes** (`alertRoutes.js`): Add `isAdmin` middleware to PATCH acknowledge/resolve routes. Currently these routes only have `applyCrudRateLimit` — any authenticated user (not just admin) can acknowledge/close alerts. This is an authorization gap:
```js
// Before:
router.patch('/:alertId/acknowledge', applyCrudRateLimit, alertController.acknowledgeAlert);
router.patch('/:alertId/resolve', applyCrudRateLimit, alertController.resolveAlert);
// After:
router.patch('/:alertId/acknowledge', applyCrudRateLimit, isAdmin, alertController.acknowledgeAlert);
router.patch('/:alertId/resolve', applyCrudRateLimit, isAdmin, alertController.resolveAlert);
```
Import `{ isAdmin }` from `../middleware/auth` (already imported for other routes in the file).

**Nav**: Add 4th group separator + "Тревоги" tab button after heat-sources, with `role="tab"`, `aria-selected="false"`, `aria-controls="alerts-section"`.

**HTML section**: New `<section id="alerts-section">` with:
- Filter bar: 3 `<select>` elements for severity (Все/INFO/WARNING/CRITICAL), status (Все/active/acknowledged/resolved), infrastructure_type (Все/transformer/controller/water_source/heat_source)
- `<table id="alerts-table">` with columns: ID, Тип, Severity, Сообщение, Объект, Статус, Создан, Действия
- Empty state row

**JS**:
- `loadAlerts()` function — use the existing `loadData('/alerts', 'alerts')` helper (line 645) which handles pagination, sorting, filters, response envelope unwrapping, and error toasts automatically. Alert-specific filters (severity, status, infrastructure_type) go into `filters.alerts` object, which `loadData()` appends to query params. This ensures alerts get pagination, sorting, and error handling identical to all other sections.
  All fetch calls go through the existing `admin-auth.js` fetch interceptor which automatically adds `Authorization: Bearer` header for `/api/*` requests — no manual header management needed.
- Render via generic table renderer (Section 3.2)
- Action buttons with conditional visibility:
  - Подтвердить (acknowledge) → PATCH `/api/alerts/:id/acknowledge`, condition: `item.status === 'active'` (only show on active alerts)
  - Закрыть (resolve) → PATCH `/api/alerts/:id/resolve`, condition: `item.status !== 'resolved'` (show on active and acknowledged)
- Severity badges: INFO (blue), WARNING (orange), CRITICAL (red)
- Wire up filter change → reload
- **State objects**: Add `'alerts'` key to ALL section-keyed objects at the top of `admin.js`: `pagination`, `dataLoaded`, `filters`, `sorting`, `selectedItems`. (Note: there is NO `currentData` object in admin.js — pagination state lives in `pagination[section]`.) Default sorting: `alerts: { column: 'created_at', direction: 'desc' }` (matches backend ORDER BY). Also add to `switchSection()` and `loadSectionData()`.

### 1.7 Remove dead code stubs

Delete lines 1753-1759 in `admin.js` — 7 function stubs that are immediately overwritten by real implementations below.

### 1.8 Fix header checkbox listener leak

In `updateCheckboxHandlers()` (admin.js ~line 1228), the `selectAllCheckbox` change handler is added WITHOUT a `handlerSet` guard — unlike the `selectAllBtn` handler (line 1203) which correctly checks `dataset.handlerSet`. Every table re-render accumulates another listener. Fix by adding the same guard pattern:
```js
if (selectAllCheckbox && !selectAllCheckbox.dataset.handlerSet) {
    selectAllCheckbox.addEventListener('change', function() { ... });
    selectAllCheckbox.dataset.handlerSet = 'true';
}
```

## Section 2: P1 UX Improvements

### 2.1 Localize status labels

In `admin.js`, update the universal modal controller config (lines ~1781-1783):
```js
// Before:
{ value: 'online', text: 'Online' },
{ value: 'offline', text: 'Offline' },
{ value: 'maintenance', text: 'Maintenance' }
// After:
{ value: 'online', text: 'В сети' },
{ value: 'offline', text: 'Не в сети' },
{ value: 'maintenance', text: 'На обслуживании' }
```

Update `getStatusLabel()` to also cover `'online'` and `'offline'` keys:
```js
const statusLabels = {
    'active': 'Активный',
    'inactive': 'Неактивный',
    'maintenance': 'На обслуживании',
    'online': 'В сети',
    'offline': 'Не в сети'
};
```

### 2.2 Fix button contrast

In `admin.css`, primary green buttons: change text color from black to white on `#4CAF50` backgrounds. Ensure WCAG AA compliance (4.5:1 ratio).

### 2.3 Fix toast/logout overlap

In `admin.css`, change `#toast-container` from `top: 20px` to `top: 70px`. Logout button stays at `top: 20px` (defined in admin-auth.js injected styles — do not modify).

### 2.4 Unify metrics form visual style

Keep the existing `form-section` + `form-row` structure of the metrics form (which uses 3-column grouping for electrical phases — semantically meaningful for monitoring). Do NOT force it into the 2-column `form-grid` layout. Instead, align visual styling only: use the same `horizontal-form` wrapper class for consistent padding/margins/borders, keep `form-row` for the 3-column phase groups, and ensure colors/fonts/spacing match other forms via CSS variables.

### 2.5 Extract CSS to external file

1. Create `public/css/admin.css`
2. Move the entire `<style>` block content from `admin.html` `<head>` into it (the block spans from `<style>` after `<meta>` tags to `</style>` before `</head>`)
3. Add CSS variables at `:root`:
   ```css
   :root {
       --color-primary: #4CAF50;
       --color-primary-hover: #45a049;
       --color-secondary: #007bff;
       --color-secondary-hover: #0056b3;
       --color-danger: #dc3545;
       --color-danger-hover: #c82333;
       --color-warning: #ff9800;
       --color-text: #333;
       --color-text-light: #666;
       --color-surface: #fff;
       --color-background: #f5f5f5;
       --color-border: #ddd;
       --color-hover: #f0f0f0;
   }
   ```
4. Replace hardcoded colors throughout the CSS with variable references
5. Replace `<style>...</style>` in `admin.html` with `<link rel="stylesheet" href="public/css/admin.css">` (uses relative path consistent with existing `admin.html` conventions, e.g. `public/images/favicon.svg` on line 7)
6. Add new classes from this plan (btn-sm, btn-danger, severity badges, alert filters, heartbeat styles)

### 2.6 Entity cache with name display

**Cache initialization** (in `admin.js`, call `loadEntityCache()` inside the existing `window.addEventListener('admin-auth-ready', ...)` handler, BEFORE `loadSectionData('buildings')` so names are available for first render):
```js
const entityCache = {
    buildings: {},
    controllers: {},
    transformers: {}
};

async function loadEntityCache() {
    // Models default to limit=10. Pass limit=200 for cache — sufficient for current scale
    // (17 buildings, ~30 controllers, ~10 transformers). If entity count exceeds 200,
    // switch to on-demand lookup instead of preloading.
    // Response shape is { data: [...], pagination: {...} } — unwrap via d.data.
    const fetches = [
        fetch('/api/buildings?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/controllers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/transformers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => [])
    ];
    const [buildings, controllers, transformers] = await Promise.all(fetches);
    buildings.forEach(b => entityCache.buildings[b.building_id] = b.name);
    controllers.forEach(c => entityCache.controllers[c.controller_id] = c.serial_number);
    transformers.forEach(t => entityCache.transformers[t.transformer_id] = t.name);
}
```

**Cache invalidation**: After successful POST/PUT to buildings, controllers, or transformers, call `loadEntityCache()` to refresh.

**Usage in render functions**: Replace raw ID display with:
```js
{ key: 'building_id', label: 'Здание', render: (val) => entityCache.buildings[val] || val }
```

Applies to: controllers table (building_id), metrics table (controller_id), lines table (transformer_id).

### 2.7 Controller heartbeat display

Add `last_heartbeat` column to controllers table config. Render as human-readable relative time:
```js
function formatHeartbeat(timestamp) {
    if (!timestamp) return '—';
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 0) return 'Только что'; // clock skew guard
    if (minutes < 1) return 'Только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} д назад`;
}
```

Visual indicator: green dot if heartbeat < 5 min, yellow if < 30 min, red/grey if older or null. Add `.heartbeat-indicator` CSS class.

## Section 3: Partial P2 — Generic Table Renderer

### 3.1 Generic renderEntityTable()

**Function signature:**
```js
function renderEntityTable({ tableId, entityType, data, columns, actions, idKey, emptyMessage }) {
    // Use replaceChild pattern (same as existing render functions) for atomic DOM swap — no visual flash
    const table = document.getElementById(tableId);
    const oldTbody = table.querySelector('tbody');
    const newTbody = document.createElement('tbody');

    if (!data || data.length === 0) {
        newTbody.appendChild(showNoDataMessage(newTbody, String(columns.length + 2))); // +2 for checkbox + actions
        table.replaceChild(newTbody, oldTbody);
        updateCheckboxHandlers(entityType); // MUST call after render — wires up batch operations
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');

        // Checkbox cell — idKey is explicit, never positional
        const checkTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'item-checkbox'; // MUST match existing selectors in updateCheckboxHandlers()
        checkbox.dataset.id = item[idKey]; // MUST use dataset.id, not .value — existing batch handlers read dataset.id
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);

        // Data cells
        columns.forEach(col => {
            const td = document.createElement('td');
            if (col.render) {
                const rendered = col.render(item[col.key], item);
                if (rendered instanceof HTMLElement) {
                    td.appendChild(rendered);
                } else {
                    td.textContent = rendered;
                }
            } else {
                td.textContent = item[col.key] ?? '—';
            }
            tr.appendChild(td);
        });

        // Action cells
        if (actions && actions.length > 0) {
            const actionTd = document.createElement('td');
            actions.forEach(action => {
                if (action.condition && !action.condition(item)) return;
                const btn = document.createElement('button');
                btn.className = action.className || 'btn-sm';
                btn.textContent = action.label;
                btn.addEventListener('click', () => action.handler(item));
                actionTd.appendChild(btn);
            });
            tr.appendChild(actionTd);
        }

        newTbody.appendChild(tr);
    });

    table.replaceChild(newTbody, oldTbody);
    updateCheckboxHandlers(entityType); // MUST call after render — wires up batch operations
}
```

**Replaces** (7 functions):
- `renderControllersTable()` (~90 lines)
- `renderMetricsTable()` (~80 lines)
- `renderWaterLinesTable()` (~90 lines)
- `renderTransformersTable()` (~80 lines)
- `renderLinesTable()` (~80 lines)
- `renderWaterSourcesTable()` (~90 lines)
- `renderHeatSourcesTable()` (~90 lines)

**Does NOT replace**: `renderBuildingsTable()` — unique expandable row logic.

**Each table** becomes a config object + `renderEntityTable(config)` call. Custom cells (status badges, heartbeat indicators, severity badges) use the `render` function in column config. Note: water-lines table uses `getWaterLineStatusLabel()` (line 572) which returns feminine Russian forms ("Активная" vs "Активный") — the column config for water-lines must use this specific function, not the generic `getStatusLabel()`.

**Pagination**: The existing `updatePagination()` function remains unchanged — it works on `pagination[section]` which is section-agnostic.

**Checkbox compatibility**: The generic renderer MUST use `className = 'item-checkbox'` and `dataset.id` (not `row-checkbox` / `.value`) to match the existing `updateCheckboxHandlers()` function which queries `.item-checkbox` and reads `dataset.id` for batch operations.

**XSS safety contract**: The generic renderer is XSS-safe by design — `td.textContent = rendered` is always safe. When `col.render()` returns an HTMLElement, it MUST be constructed via DOM API (`createElement` + `textContent`), NEVER via `innerHTML`. This is a hard rule: **no `innerHTML` anywhere in `col.render()` implementations**. All existing render helpers (`createSecureTableCell`, `safeValue`, status badge creators) already follow this pattern.

## Testing Strategy

- All 180 existing tests must continue passing after each task
- Manual verification: open admin panel, test each section (CRUD operations, filters, modals, pagination)
- Verify CSP compliance: no inline event handlers after fixes
- Verify accessibility: screen reader testing for ARIA labels
- Verify alerts tab: create/acknowledge/resolve lifecycle

## Risk Assessment

- **Low risk**: P0 items 1-5, 7 are mechanical fixes with no behavioral change
- **Medium risk**: Alerts tab (1.6) — new feature, but follows established patterns
- **Medium risk**: Generic table renderer (3.2) — replaces working code, but functional behavior is identical
- **Low risk**: CSS extraction (2.5) — visual-only, no logic changes
- **Low risk**: Entity cache (2.6) — additive, fallback to ID on failure
