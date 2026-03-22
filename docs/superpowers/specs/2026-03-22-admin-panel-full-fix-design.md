# Admin Panel Full Fix — Design Specification

## Goal

Fix all P0 bugs, P1 UX issues, and implement partial P2 improvements (CSS extraction + generic table renderer) identified by three expert reviews (UX/UI, Architect, IoT Specialist) of the InfraSafe admin panel.

## Scope

- **P0 (7 items)**: inline onclick removal, missing CSS classes, localStorage key bug, aria-labels, colspan fix, dead code removal, Alerts tab
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

### 1.4 Fix colspan mismatch in water-lines-table

`admin.html` `#water-lines-table` thead has 11 `<th>` columns. The render function in `admin.js` creates rows with fewer cells. Align thead to match what JS actually renders: checkbox, ID, Название, Диаметр (мм), Материал, Давление (бар), Статус, Действия = 8 columns. Remove Description, Дата установки, Подключенные здания from thead (these are not rendered by JS). Update empty-state colspan accordingly.

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

1. **Controller** (`alertController.js`): Extract `status` from `req.query`, validate via whitelist:
```js
const { severity, infrastructure_type, limit, status } = req.query;
const validStatuses = ['active', 'acknowledged', 'resolved'];
if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Недопустимый статус. Разрешены: active, acknowledged, resolved' });
}
if (status) filters.status = status;
```

2. **Service** (`alertService.js`): Replace `const values = ['active']` with `const values = [filters.status || 'active']`. The `$1` position for status is already correct — no param index renumbering needed.

**Nav**: Add 4th group separator + "Тревоги" tab button after heat-sources, with `role="tab"`, `aria-selected="false"`, `aria-controls="alerts-section"`.

**HTML section**: New `<section id="alerts-section">` with:
- Filter bar: 3 `<select>` elements for severity (Все/INFO/WARNING/CRITICAL), status (Все/active/acknowledged/resolved), infrastructure_type (Все/transformer/water_source/heat_source)
- `<table id="alerts-table">` with columns: ID, Тип, Severity, Сообщение, Объект, Статус, Создан, Действия
- Empty state row

**JS**:
- `loadAlerts()` function — fetch `/api/alerts` with filter params, unwrap response envelope:
  ```js
  async function loadAlerts() {
      const params = new URLSearchParams();
      // add filter params from select elements...
      const result = await fetch(`/api/alerts?${params}`).then(r => r.json());
      renderEntityTable({ tableId: 'alerts-table', data: result.data || [], ... });
  }
  ```
  All fetch calls go through the existing `admin-auth.js` fetch interceptor which automatically adds `Authorization: Bearer` header for `/api/*` requests — no manual header management needed.
- Render via generic table renderer (Section 3.2)
- Action buttons with conditional visibility:
  - Подтвердить (acknowledge) → PATCH `/api/alerts/:id/acknowledge`, condition: `item.status === 'active'` (only show on active alerts)
  - Закрыть (resolve) → PATCH `/api/alerts/:id/resolve`, condition: `item.status !== 'resolved'` (show on active and acknowledged)
- Severity badges: INFO (blue), WARNING (orange), CRITICAL (red)
- Wire up filter change → reload
- **State objects**: Add `'alerts'` key to ALL section-keyed objects at the top of `admin.js`: `pagination`, `currentData`, `dataLoaded`, `filters`, `sorting`, `selectedItems`. Also add to `switchSection()` and `loadSectionData()`.

### 1.7 Remove dead code stubs

Delete lines 1753-1759 in `admin.js` — 7 function stubs that are immediately overwritten by real implementations below.

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
5. Replace `<style>...</style>` in `admin.html` with `<link rel="stylesheet" href="/css/admin.css">`
6. Add new classes from this plan (btn-sm, btn-danger, severity badges, alert filters, heartbeat styles)

### 2.6 Entity cache with name display

**Cache initialization** (in `admin.js`, after auth-ready):
```js
const entityCache = {
    buildings: {},
    controllers: {},
    transformers: {}
};

async function loadEntityCache() {
    const fetches = [
        fetch('/api/buildings').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/controllers').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/transformers').then(r => r.json()).then(d => d.data || []).catch(() => [])
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
    if (minutes < 1) return 'Только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} д назад`;
}
```

Visual indicator: green dot if heartbeat < 5 min, yellow if < 30 min, red/grey if older or null. Add `.heartbeat-indicator` CSS class.

## Section 3: Partial P2 — Generic Table Renderer

### 3.2 Generic renderEntityTable()

**Function signature:**
```js
function renderEntityTable({ tableId, entityType, data, columns, actions, idKey, emptyMessage }) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.textContent = ''; // XSS-safe clear

    if (!data || data.length === 0) {
        // empty state row
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');

        // Checkbox cell — idKey is explicit, never positional
        const checkTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'row-checkbox';
        checkbox.value = item[idKey];
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

        tbody.appendChild(tr);
    });
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

**Each table** becomes a config object + `renderEntityTable(config)` call. Custom cells (status badges, heartbeat indicators, severity badges) use the `render` function in column config.

**Pagination**: The existing `updatePagination()` function remains unchanged — it works on `currentData[section]` which is section-agnostic.

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
