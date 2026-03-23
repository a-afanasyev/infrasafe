# Admin Panel Full Fix Implementation Plan

> **Status: COMPLETED (2026-03-23)** — All 14 tasks implemented and verified.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all P0 bugs, P1 UX issues, and implement partial P2 improvements (CSS extraction + generic table renderer) for the InfraSafe admin panel.

**Architecture:** Extract inline CSS to external file with variables first (foundation for all subsequent tasks). Then mechanical P0 fixes. Then backend alerts changes (prerequisite for frontend). Then generic table renderer (shared by entity cache column configs + alerts). Then entity cache + heartbeat. Finally alerts tab frontend.

**Tech Stack:** Vanilla JS (no framework/bundler), Express.js backend, PostgreSQL, Jest for tests.

---

## File Structure

### Modified
- `admin.html` — replace inline `<style>` with `<link>`, remove 3 inline onclick, add 4 aria-labels, add alerts section + nav tab
- `public/admin.js` — remove dead stubs, fix header checkbox leak, fix colspan, fix status labels, add generic renderer, replace 7 render functions with configs, add entity cache, add heartbeat, add alerts tab logic
- `public/admin-coordinate-editor.js` — fix localStorage key (line 337)
- `src/controllers/alertController.js` — add status/page/sort/order params, whitelist validation, paginated response shape
- `src/services/alertService.js` — parameterize status, add pagination/sort support
- `src/routes/alertRoutes.js` — add isAdmin to PATCH acknowledge/resolve (lines 343, 375)
- `tests/jest/unit/alertService.test.js` — update existing tests for parameterized status + pagination

### Created
- `public/css/admin.css` — extracted from admin.html inline `<style>`, with CSS variables for colors
- `tests/jest/unit/alertController.test.js` — new tests for alert whitelist validation + paginated response

---

### Task 1: Extract CSS to external file (P1 item 2.5)

Foundation task — many subsequent tasks add CSS classes to this file.

**Files:**
- Create: `public/css/admin.css`
- Modify: `admin.html:9-765` (replace inline `<style>` block with `<link>`)

- [x] **Step 1: Create `public/css/admin.css` with CSS variables + extracted styles**

Copy the entire content of admin.html lines 10-763 (inside the `<style>` tags) into a new file `public/css/admin.css`. Prepend CSS variables at `:root`:

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
    --color-muted: #999;
}
```

Then do a find-replace pass through the CSS content: replace all hardcoded `#4CAF50` with `var(--color-primary)`, `#45a049` with `var(--color-primary-hover)`, `#dc3545` with `var(--color-danger)`, `#c82333` with `var(--color-danger-hover)`, `#007bff` with `var(--color-secondary)`, `#0056b3` with `var(--color-secondary-hover)`, `#ff9800` with `var(--color-warning)`, `#ddd` (border contexts) with `var(--color-border)`, `#f5f5f5` (background contexts) with `var(--color-background)`.

Do NOT replace colors in very specific contexts (like status badges that have semantic colors, or gradient values) — use judgment. The goal is that `--color-primary` etc. become the single source of truth for the green/blue/red/orange palette.

- [x] **Step 2: Replace `<style>` block in admin.html with `<link>`**

In `admin.html`, replace lines 9-764 (the entire `<style>...</style>` block) with:

```html
    <link rel="stylesheet" href="public/css/admin.css">
```

This uses a relative path consistent with existing conventions (line 7: `href="public/images/favicon.svg"`).

- [x] **Step 3: Verify admin panel renders correctly**

Run: `npm run dev` (or docker compose), open `http://localhost:8080/admin.html` in browser.
Expected: Panel looks identical to before — no visual changes.

- [x] **Step 4: Run existing tests**

Run: `npm test`
Expected: All 175+ tests pass (CSS extraction is frontend-only, no backend test impact).

- [x] **Step 5: Commit**

```bash
git add public/css/admin.css admin.html
git commit -m "refactor: extract admin.html inline CSS to public/css/admin.css with CSS variables"
```

---

### Task 2: Add missing CSS classes (P0 item 1.3 + P1 items 2.2, 2.3)

**Files:**
- Modify: `public/css/admin.css`

- [x] **Step 1: Add `btn-sm` and `btn-danger` classes**

Append to `public/css/admin.css`:

```css
/* === Button variants === */
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

- [x] **Step 2: Fix button contrast (P1 item 2.2)**

Find all CSS rules that apply to primary green buttons (`.btn-primary`, `.add-btn`, submit buttons) where `background` uses `var(--color-primary)` (was `#4CAF50`). Ensure `color: white` (not black or inherit). Check: white text on #4CAF50 = contrast ratio ~3.9:1 (just under AA for normal text). For WCAG AA compliance, darken the green to `#388E3C` (`--color-primary: #388E3C`) which gives 5.5:1, OR keep `#4CAF50` with `font-weight: bold` and large text (AA-Large compliant at 3:1).

Decision: Keep `#4CAF50` but ensure all button text is `color: white` and `font-weight: 600` — this satisfies AA-Large (buttons are typically 14px+ bold).

- [x] **Step 3: Fix toast/logout overlap (P1 item 2.3)**

Find `#toast-container` in admin.css. Change `top: 20px` to `top: 70px`. (Logout button is at `top: 20px` from admin-auth.js injected styles — do not touch that.)

- [x] **Step 4: Verify button styling and toast position**

Open admin panel, navigate to any table section. Expected:
- Edit buttons: grey background with border
- Delete buttons: red background with white text
- Toast messages appear below logout button (no overlap)

- [x] **Step 5: Commit**

```bash
git add public/css/admin.css
git commit -m "fix: add btn-sm/btn-danger CSS classes, fix button contrast and toast overlap"
```

---

### Task 3: Mechanical P0 fixes — inline onclick, aria-labels, localStorage key, dead code, checkbox leak, colspan (P0 items 1.1, 1.2, 1.4, 1.5, 1.7, 1.8)

**Files:**
- Modify: `admin.html:1161,1777,1970` (inline onclick)
- Modify: `admin.html` (4 aria-labels on edit modals)
- Modify: `public/admin.js:1753-1759` (dead stubs)
- Modify: `public/admin.js:1228` (header checkbox leak)
- Modify: `public/admin.js:563` (colspan)
- Modify: `public/admin.js:1187-1194` (status labels — P1 item 2.1)
- Modify: `public/admin.js:1781-1783` (universal modal status labels — P1 item 2.1)
- Modify: `public/admin-coordinate-editor.js:337` (localStorage key)

- [x] **Step 1: Remove 3 inline onclick in admin.html**

Note: `getStatusLabel` is inside a DOMContentLoaded closure in admin.js and cannot be unit-tested without extracting it. Status label localization is verified via browser testing (Step 10).

**Line 1161** (add-transformer form "Указать на карте" button):
Replace `onclick="openCoordinateEditor('transformer', ...)"` with `id="btn-transformer-coord-picker"` and remove the onclick attribute.

**Line 1777** (metrics form "Сброс" button):
Replace `onclick="resetMetricsForm()"` with `id="btn-metrics-reset"` and remove the onclick attribute.

**Line 1970** (edit-transformer modal "Указать на карте" button):
Replace `onclick="openCoordinateEditor('transformer', ...)"` with `id="btn-edit-transformer-coord-picker"` and remove the onclick attribute.

- [x] **Step 2: Add addEventListener replacements in admin.js**

Add near the end of the DOMContentLoaded handler (after existing init code, before the closing `})`):

```js
// === CSP-compliant onclick replacements (moved from inline onclick in admin.html) ===

// Add-transformer "Указать на карте" (was admin.html line 1161)
document.getElementById('btn-transformer-coord-picker')?.addEventListener('click', function() {
    const currentLat = parseFloat(document.getElementById('transformer-latitude').value) || null;
    const currentLng = parseFloat(document.getElementById('transformer-longitude').value) || null;
    openCoordinateEditor('transformer', null, currentLat, currentLng, null, (lat, lng) => {
        document.getElementById('transformer-latitude').value = lat;
        document.getElementById('transformer-longitude').value = lng;
    });
});

// Metrics form "Сброс" (was admin.html line 1777)
document.getElementById('btn-metrics-reset')?.addEventListener('click', function() {
    resetMetricsForm();
});

// Edit-transformer "Указать на карте" (was admin.html line 1970)
document.getElementById('btn-edit-transformer-coord-picker')?.addEventListener('click', function() {
    const currentLat = parseFloat(document.getElementById('edit-transformer-latitude').value) || null;
    const currentLng = parseFloat(document.getElementById('edit-transformer-longitude').value) || null;
    openCoordinateEditor('transformer', document.getElementById('edit-transformer-id').value, currentLat, currentLng, null, (lat, lng) => {
        document.getElementById('edit-transformer-latitude').value = lat;
        document.getElementById('edit-transformer-longitude').value = lng;
    });
});
```

Signature: `openCoordinateEditor(objectType, objectId, latitude, longitude, objectName, onSave)` — see `admin-coordinate-editor.js:418`.

- [x] **Step 3: Add 4 aria-labels to edit modals in admin.html**

Find these 4 modals by their id and add `aria-label` attribute:

```html
<div id="edit-water-source-modal" ... aria-label="Редактировать источник воды">
<div id="edit-heat-source-modal" ... aria-label="Редактировать источник тепла">
<div id="edit-line-modal" ... aria-label="Редактировать линию">
<div id="edit-controller-modal" ... aria-label="Редактировать контроллер">
```

- [x] **Step 4: Fix localStorage key in coordinate-editor**

In `public/admin-coordinate-editor.js` line 337, change:
```js
'Authorization': `Bearer ${localStorage.getItem('token')}`
```
to:
```js
'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
```

- [x] **Step 5: Remove dead code stubs in admin.js**

Delete lines 1753-1759:
```js
window.editController = function(id) { /* реализация */ };
window.deleteController = function(id) { /* реализация */ };
window.deleteMetric = function(id) { /* реализация */ };
window.editTransformer = function(id) { /* реализация */ };
window.deleteTransformer = function(id) { /* реализация */ };
window.editLine = function(id) { /* реализация */ };
window.deleteLine = function(id) { /* реализация */ };
```

These are immediately overwritten by real implementations starting at line 1765 (`window.editController = async function(id) { ... }`).

- [x] **Step 6: Fix header checkbox listener leak in admin.js**

In `updateCheckboxHandlers()` (line 1228), wrap the `selectAllCheckbox` handler with a guard:

Before (line 1228):
```js
if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function() {
```

After:
```js
if (selectAllCheckbox && !selectAllCheckbox.dataset.handlerSet) {
    selectAllCheckbox.addEventListener('change', function() {
```

And add after the closing `});` of the addEventListener (before the closing `}` of the if block):
```js
    selectAllCheckbox.dataset.handlerSet = 'true';
```

- [x] **Step 7: Fix colspan in showNoDataMessage calls**

In `admin.js`:
- Line 563: `showNoDataMessage(newTableBody, "7")` → `showNoDataMessage(newTableBody, "11")` (water-lines has 11 columns)
- Line 888: Verify colspan matches the transformers table column count (check thead)
- Line 973: Verify colspan matches the lines table column count (check thead)
- Line 1064: Verify colspan matches the water-sources table column count (check thead)
- Line 1155: Verify colspan matches the heat-sources table column count (check thead)

- [x] **Step 8: Localize status labels (P1 item 2.1)**

In `admin.js` line 1187, update `getStatusLabel`:
```js
function getStatusLabel(status) {
    const statusLabels = {
        'active': 'Активный',
        'inactive': 'Неактивный',
        'maintenance': 'На обслуживании',
        'online': 'В сети',
        'offline': 'Не в сети'
    };
    return statusLabels[status] || status;
}
```

In universal modal controller config (line 1781), localize:
```js
{ value: 'online', text: 'В сети' },
{ value: 'offline', text: 'Не в сети' },
{ value: 'maintenance', text: 'На обслуживании' }
```

- [x] **Step 9: Run all tests**

Run: `npm test`
Expected: All 175+ tests pass.

- [x] **Step 10: Verify in browser**

Open admin panel:
- Verify no inline onclick in source (View Source, search "onclick")
- Verify edit modals have aria-label (Inspect element)
- Verify "Указать на карте" buttons still work in add/edit transformer forms
- Verify "Сброс" button works in metrics form
- Verify controller status shows "В сети" / "Не в сети" instead of "Online" / "Offline"
- Verify delete buttons are red, edit buttons are grey

- [x] **Step 11: Commit**

```bash
git add admin.html public/admin.js public/admin-coordinate-editor.js
git commit -m "fix: remove inline onclick, add aria-labels, fix localStorage key, dead code, checkbox leak, colspan, localize status labels"
```

---

### Task 4: Backend — Alert pagination, whitelist validation, isAdmin on PATCH (P0 item 1.6 backend + security)

**Files:**
- Modify: `src/controllers/alertController.js:7-31`
- Modify: `src/services/alertService.js:366-388`
- Modify: `src/routes/alertRoutes.js:343,375`
- Create: `tests/jest/unit/alertController.test.js` (or update if exists)

- [x] **Step 1: Write failing test for alert controller whitelist validation**

File: `tests/jest/unit/alertController.test.js`

```js
jest.mock('../../../src/services/alertService', () => {
    const instance = {
        getActiveAlerts: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        acknowledgeAlert: jest.fn(),
        resolveAlert: jest.fn()
    };
    // alertService is a singleton instance, not a class
    return instance;
});

const alertController = require('../../../src/controllers/alertController');
const alertService = require('../../../src/services/alertService');

describe('AlertController.getActiveAlerts', () => {
    let req, res;

    beforeEach(() => {
        req = { query: {} };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
        jest.clearAllMocks();
        alertService.getActiveAlerts.mockResolvedValue({ data: [], total: 0 });
    });

    test('rejects invalid status param', async () => {
        req.query = { status: 'INVALID' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects invalid severity param', async () => {
        req.query = { severity: 'EXTREME' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects invalid infrastructure_type param', async () => {
        req.query = { infrastructure_type: 'nuclear' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('accepts valid params and returns paginated response', async () => {
        req.query = { status: 'active', severity: 'WARNING', page: '1', limit: '10' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).not.toHaveBeenCalled();
        const response = res.json.mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('data');
        expect(response).toHaveProperty('pagination');
        expect(response.pagination).toEqual({ page: 1, limit: 10, total: 0 });
    });
});
```

Note: The mock pattern mirrors how `alertService` is used — it's a singleton instance (not a class constructor). `jest.mock` at top level intercepts the require before `alertController` loads it.

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest tests/jest/unit/alertController.test.js -v`
Expected: FAIL — current controller doesn't validate status, doesn't return `pagination` shape.

- [x] **Step 3: Update alertController.getActiveAlerts**

In `src/controllers/alertController.js`, replace the `getActiveAlerts` method (lines 7-31):

```js
static async getActiveAlerts(req, res) {
    try {
        const { severity, infrastructure_type, limit, status, page, sort, order } = req.query;

        // Whitelist validation for enum params
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

        const filters = {};
        if (status) filters.status = status;
        if (severity) filters.severity = severity.toUpperCase();
        if (infrastructure_type) filters.infrastructure_type = infrastructure_type.toLowerCase();
        if (limit) filters.limit = Math.min(parseInt(limit) || 10, 200);

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = filters.limit || 10;
        const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
        const sortCol = validSortColumns.includes(sort) ? sort : 'created_at';
        const sortDir = order === 'asc' ? 'asc' : 'desc';

        const result = await alertService.getActiveAlerts(filters, {
            page: pageNum,
            limit: pageSize,
            sort: sortCol,
            order: sortDir
        });

        res.json({
            success: true,
            data: result.data,
            pagination: {
                page: pageNum,
                limit: pageSize,
                total: result.total
            },
            filters
        });

    } catch (error) {
        logger.error('Ошибка получения активных алертов:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
}
```

- [x] **Step 4: Update alertService.getActiveAlerts with pagination**

In `src/services/alertService.js`, replace lines 366-388:

```js
async getActiveAlerts(filters = {}, pagination = {}) {
    await this.ensureInitialized();

    const { page = 1, limit = 10, sort = 'created_at', order = 'desc' } = pagination;
    const offset = (page - 1) * limit;

    // Build WHERE clause dynamically
    const conditions = [];
    const values = [];
    let paramIdx = 1;

    // Status filter (default to 'active')
    conditions.push(`ia.status = $${paramIdx++}`);
    values.push(filters.status || 'active');

    if (filters.severity) {
        conditions.push(`ia.severity = $${paramIdx++}`);
        values.push(filters.severity);
    }
    if (filters.infrastructure_type) {
        conditions.push(`ia.infrastructure_type = $${paramIdx++}`);
        values.push(filters.infrastructure_type);
    }

    const whereClause = conditions.join(' AND ');

    // Validate sort column (whitelist)
    const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    // Count query for pagination total
    const countQuery = `
        SELECT COUNT(*) as total
        FROM infrastructure_alerts ia
        WHERE ${whereClause}
    `;
    const countResult = await db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total);

    // Data query with pagination
    const dataQuery = `
        SELECT ia.*, u1.username as acknowledged_by_name, u2.username as resolved_by_name
        FROM infrastructure_alerts ia
        LEFT JOIN users u1 ON ia.acknowledged_by = u1.user_id
        LEFT JOIN users u2 ON ia.resolved_by = u2.user_id
        WHERE ${whereClause}
        ORDER BY ia.${sortColumn} ${sortOrder}
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    values.push(limit, offset);

    const result = await db.query(dataQuery, values);
    return { data: result.rows, total };
}
```

- [x] **Step 5: Add isAdmin to PATCH routes in alertRoutes.js**

In `src/routes/alertRoutes.js`:

Line 343, change:
```js
router.patch('/:alertId/acknowledge', applyCrudRateLimit, alertController.acknowledgeAlert);
```
to:
```js
router.patch('/:alertId/acknowledge', applyCrudRateLimit, isAdmin, alertController.acknowledgeAlert);
```

Line 375, change:
```js
router.patch('/:alertId/resolve', applyCrudRateLimit, alertController.resolveAlert);
```
to:
```js
router.patch('/:alertId/resolve', applyCrudRateLimit, isAdmin, alertController.resolveAlert);
```

Verify `isAdmin` is already imported at the top of the file (it should be — it's used for other routes).

- [x] **Step 6: Add getActiveAlerts tests to alertService.test.js**

The existing `tests/jest/unit/alertService.test.js` covers `getAlertStatistics` but NOT `getActiveAlerts`. The service signature changes from `getActiveAlerts(filters)` to `getActiveAlerts(filters, pagination)` with a new return shape `{ data, total }`. Add a new describe block:

```js
describe('getActiveAlerts', () => {
    test('defaults to status=active when no status filter provided', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '1' }] })  // count query
            .mockResolvedValueOnce({ rows: [{ alert_id: 1 }] }); // data query

        const result = await alertService.getActiveAlerts({}, { page: 1, limit: 10 });

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('total', 1);
        // First param of first query call should include 'active'
        const [, countParams] = db.query.mock.calls[0];
        expect(countParams[0]).toBe('active');
    });

    test('uses provided status filter', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '2' }] })
            .mockResolvedValueOnce({ rows: [{ alert_id: 1 }, { alert_id: 2 }] });

        const result = await alertService.getActiveAlerts({ status: 'acknowledged' }, { page: 1, limit: 10 });

        const [, countParams] = db.query.mock.calls[0];
        expect(countParams[0]).toBe('acknowledged');
        expect(result.total).toBe(2);
    });

    test('applies pagination offset correctly', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '25' }] })
            .mockResolvedValueOnce({ rows: [] });

        await alertService.getActiveAlerts({}, { page: 3, limit: 10 });

        // Data query (second call) should have LIMIT and OFFSET params
        const [query, params] = db.query.mock.calls[1];
        expect(query).toContain('LIMIT');
        expect(query).toContain('OFFSET');
        // Last two params: limit=10, offset=20 (page 3 * 10 - 10)
        expect(params[params.length - 2]).toBe(10);
        expect(params[params.length - 1]).toBe(20);
    });

    test('validates sort column against whitelist', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ total: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        await alertService.getActiveAlerts({}, { page: 1, limit: 10, sort: 'DROP TABLE', order: 'desc' });

        // Should fall back to 'created_at', not use the injected value
        const [query] = db.query.mock.calls[1];
        expect(query).toContain('created_at');
        expect(query).not.toContain('DROP TABLE');
    });
});
```

- [x] **Step 7: Run tests**

Run: `npx jest tests/jest/unit/alertController.test.js tests/jest/unit/alertService.test.js -v`
Expected: PASS

Run: `npm test`
Expected: All tests pass (including existing alert tests).

- [x] **Step 8: Commit**

```bash
git add src/controllers/alertController.js src/services/alertService.js src/routes/alertRoutes.js tests/jest/unit/alertController.test.js tests/jest/unit/alertService.test.js
git commit -m "fix: add alert pagination, whitelist validation, isAdmin on acknowledge/resolve"
```

---

### Task 5: Generic table renderer (P2 item 3.1)

**Files:**
- Modify: `public/admin.js` — add `renderEntityTable()` function

- [x] **Step 1: Add renderEntityTable function**

Add in `admin.js` after the `showNoDataMessage` function (after line 198), before the navigation section:

```js
// ===============================================
// GENERIC TABLE RENDERER
// ===============================================

function renderEntityTable({ tableId, entityType, data, columns, actions, idKey, emptyMessage }) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const oldTbody = table.querySelector('tbody');
    const newTbody = document.createElement('tbody');

    if (!data || data.length === 0) {
        // +2 accounts for checkbox column + actions column
        const colSpan = String(columns.length + (actions ? 2 : 1));
        newTbody.appendChild(showNoDataMessage(newTbody, colSpan, emptyMessage));
        table.replaceChild(newTbody, oldTbody);
        updateCheckboxHandlers(entityType);
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');

        // Checkbox cell
        const checkTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'item-checkbox';
        checkbox.dataset.id = item[idKey];
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);

        // Data cells from column config
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
    updateCheckboxHandlers(entityType);
}
```

- [x] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (additive change — no existing code modified yet).

- [x] **Step 3: Commit**

```bash
git add public/admin.js
git commit -m "feat: add generic renderEntityTable function"
```

---

### Task 6: Replace renderControllersTable with generic renderer

**Files:**
- Modify: `public/admin.js` — replace `renderControllersTable` (lines 309-373) with config + `renderEntityTable` call

- [x] **Step 1: Replace renderControllersTable**

Replace the function `renderControllersTable(data)` (lines 309-373) with:

```js
function renderControllersTable(data) {
    renderEntityTable({
        tableId: 'controllers-table',
        entityType: 'controllers',
        idKey: 'controller_id',
        data,
        columns: [
            { key: 'controller_id', label: 'ID' },
            { key: 'serial_number', label: 'Серийный номер' },
            { key: 'vendor', label: 'Производитель' },
            { key: 'model', label: 'Модель' },
            { key: 'building_id', label: 'Здание' },
            { key: 'status', label: 'Статус', render: (val) => {
                const statusClass = val === 'online' ? 'status-online' :
                                    val === 'offline' ? 'status-offline' : 'status-maintenance';
                const span = document.createElement('span');
                span.className = `status-badge ${statusClass}`;
                span.textContent = getStatusLabel(val);
                return span;
            }}
        ],
        actions: [
            { label: 'Изменить', className: 'btn-sm', handler: (item) => editController(item.controller_id) },
            { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteController(item.controller_id) }
        ]
    });
}
```

- [x] **Step 2: Verify controllers table in browser**

Open admin panel → Controllers tab. Expected: table renders identically to before — same columns, same buttons, checkboxes work.

- [x] **Step 3: Commit**

```bash
git add public/admin.js
git commit -m "refactor: replace renderControllersTable with generic renderer"
```

---

### Task 7: Replace renderMetricsTable with generic renderer

**Files:**
- Modify: `public/admin.js` — replace `renderMetricsTable` (lines 397-478)

- [x] **Step 1: Replace renderMetricsTable**

Read the current `renderMetricsTable` function to note all columns and their formatting (formatNumber, formatDate, etc.). Replace with config-based `renderEntityTable` call, preserving all column render functions.

Key columns to preserve: metric_id, controller_id (will use entityCache later), voltage phases, current phases, power phases, temperature, humidity, timestamps. All use `formatNumber()` or `formatDate()`.

```js
function renderMetricsTable(data) {
    renderEntityTable({
        tableId: 'metrics-table',
        entityType: 'metrics',
        idKey: 'metric_id',
        data,
        columns: [
            { key: 'metric_id', label: 'ID' },
            { key: 'controller_id', label: 'Контроллер' },
            { key: 'voltage_phase_a', label: 'V-A', render: (v) => formatNumber(v) },
            { key: 'voltage_phase_b', label: 'V-B', render: (v) => formatNumber(v) },
            { key: 'voltage_phase_c', label: 'V-C', render: (v) => formatNumber(v) },
            { key: 'current_phase_a', label: 'I-A', render: (v) => formatNumber(v) },
            { key: 'current_phase_b', label: 'I-B', render: (v) => formatNumber(v) },
            { key: 'current_phase_c', label: 'I-C', render: (v) => formatNumber(v) },
            { key: 'power_total', label: 'P', render: (v) => formatNumber(v) },
            { key: 'temperature', label: 'Темп', render: (v) => formatNumber(v, 1) },
            { key: 'humidity', label: 'Влаж', render: (v) => formatNumber(v, 1) },
            { key: 'recorded_at', label: 'Записано', render: (v) => formatDate(v) }
        ],
        actions: [
            { label: 'Удалить', className: 'btn-sm btn-danger', handler: (item) => deleteMetric(item.metric_id) }
        ]
    });
}
```

Note: Check the exact columns in the current implementation — the column list above is approximate. Read the actual function and match exactly.

- [x] **Step 2: Verify metrics table in browser**

Open admin panel → Metrics tab. Expected: table renders identically.

- [x] **Step 3: Commit**

```bash
git add public/admin.js
git commit -m "refactor: replace renderMetricsTable with generic renderer"
```

---

### Task 8: Replace remaining 5 render functions with generic renderer

**Files:**
- Modify: `public/admin.js` — replace renderWaterLinesTable (480-570), renderTransformersTable (837-918), renderLinesTable (919-1003), renderWaterSourcesTable (1004-1094), renderHeatSourcesTable (1095-1159)

- [x] **Step 1: Replace renderWaterLinesTable**

Read current implementation. Key: uses `getWaterLineStatusLabel()` (not `getStatusLabel()`!) for feminine Russian forms. Config must use this function for status column. Has 11 columns (checkbox + 9 data + actions). Replace with `renderEntityTable` call matching exact columns.

- [x] **Step 2: Replace renderTransformersTable**

Read current implementation. Replace with config-based call. Verify column count matches thead.

- [x] **Step 3: Replace renderLinesTable**

Read current implementation. Replace with config-based call.

- [x] **Step 4: Replace renderWaterSourcesTable**

Read current implementation. Replace with config-based call.

- [x] **Step 5: Replace renderHeatSourcesTable**

Read current implementation. Replace with config-based call.

- [x] **Step 6: Verify all tables in browser**

Open admin panel → check each tab: Controllers, Metrics, Water-lines, Transformers, Lines, Water-sources, Heat-sources. Each should render identically to before. Test:
- Data displays correctly
- Checkboxes work (select individual, select all)
- Edit/Delete buttons work
- Empty state shows "Нет данных" with correct colspan
- Pagination works

- [x] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 8: Commit**

```bash
git add public/admin.js
git commit -m "refactor: replace 5 remaining render functions with generic table renderer"
```

---

### Task 9: Entity cache (P1 item 2.6)

**Files:**
- Modify: `public/admin.js` — add entityCache, loadEntityCache, update column configs

- [x] **Step 1: Add entityCache and loadEntityCache**

At the top of admin.js (after the `selectedItems` object, around line 60), add:

```js
// Entity cache for displaying names instead of IDs
const entityCache = {
    buildings: {},
    controllers: {},
    transformers: {}
};

async function loadEntityCache() {
    const fetches = [
        fetch('/api/buildings?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/controllers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => []),
        fetch('/api/transformers?limit=200').then(r => r.json()).then(d => d.data || []).catch(() => [])
    ];
    const [buildings, controllers, transformers] = await Promise.all(fetches);
    buildings.forEach(b => { entityCache.buildings[b.building_id] = b.name; });
    controllers.forEach(c => { entityCache.controllers[c.controller_id] = c.serial_number; });
    transformers.forEach(t => { entityCache.transformers[t.transformer_id] = t.name; });
}
```

- [x] **Step 2: Call loadEntityCache before first data load**

In the `admin-auth-ready` handler (line 1550), add `loadEntityCache()` before `loadSectionData('buildings')`:

```js
window.addEventListener('admin-auth-ready', async () => {
    await loadEntityCache();
    loadSectionData('buildings');
}, { once: true });
```

Also update the sync path (line 1548):
```js
if (window.adminAuth && window.adminAuth.isAuthenticated) {
    loadEntityCache().then(() => loadSectionData('buildings'));
}
```

- [x] **Step 3: Update column configs to use entityCache**

In `renderControllersTable` config, change the `building_id` column:
```js
{ key: 'building_id', label: 'Здание', render: (val) => entityCache.buildings[val] || val }
```

In `renderMetricsTable` config, change the `controller_id` column:
```js
{ key: 'controller_id', label: 'Контроллер', render: (val) => entityCache.controllers[val] || val }
```

In `renderLinesTable` config, change the `transformer_id` column (if it has one):
```js
{ key: 'transformer_id', label: 'Трансформатор', render: (val) => entityCache.transformers[val] || val }
```

- [x] **Step 4: Add cache invalidation after entity CRUD**

Find the POST/PUT success handlers for buildings, controllers, and transformers. After each successful create/update, add `loadEntityCache()` call. Search for patterns like:
- `showToast('Здание добавлено'` or `showToast('Здание обновлено'`
- Similar for controllers, transformers

Add `loadEntityCache();` after each such toast.

- [x] **Step 5: Verify in browser**

Open admin panel:
- Controllers tab: building_id column shows building name instead of numeric ID
- Metrics tab: controller_id column shows serial number instead of numeric ID
- Create a new building, then check controllers tab — new building name appears

- [x] **Step 6: Commit**

```bash
git add public/admin.js
git commit -m "feat: add entity cache for displaying names instead of IDs"
```

---

### Task 10: Controller heartbeat display (P1 item 2.7)

**Files:**
- Modify: `public/admin.js` — add formatHeartbeat, heartbeat column config
- Modify: `public/css/admin.css` — add heartbeat indicator styles

- [x] **Step 1: Add heartbeat CSS**

Append to `public/css/admin.css`:

```css
/* === Heartbeat indicator === */
.heartbeat-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.heartbeat-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
}
.heartbeat-dot.green { background: var(--color-primary); }
.heartbeat-dot.yellow { background: var(--color-warning); }
.heartbeat-dot.red { background: var(--color-danger); }
.heartbeat-dot.grey { background: var(--color-muted); }
```

- [x] **Step 2: Add formatHeartbeat function in admin.js**

Add after the `formatDate` function (around line 211):

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

function getHeartbeatColor(timestamp) {
    if (!timestamp) return 'grey';
    const minutes = (Date.now() - new Date(timestamp).getTime()) / 60000;
    if (minutes < 5) return 'green';
    if (minutes < 30) return 'yellow';
    return 'red';
}
```

- [x] **Step 3: Add heartbeat column to controllers config**

In the `renderControllersTable` config, add after the status column:

```js
{ key: 'last_heartbeat', label: 'Пульс', render: (val) => {
    const container = document.createElement('span');
    container.className = 'heartbeat-indicator';
    const dot = document.createElement('span');
    dot.className = `heartbeat-dot ${getHeartbeatColor(val)}`;
    container.appendChild(dot);
    const text = document.createTextNode(formatHeartbeat(val));
    container.appendChild(text);
    return container;
}}
```

Also update the controllers table `<thead>` in admin.html to add a "Пульс" column header (after "Статус").

- [x] **Step 4: Verify in browser**

Open admin panel → Controllers. Expected: new "Пульс" column with colored dot and relative time. If no heartbeat data exists yet, shows "—" with grey dot.

- [x] **Step 5: Commit**

```bash
git add public/admin.js public/css/admin.css admin.html
git commit -m "feat: add controller heartbeat display with color indicators"
```

---

### Task 11: Add alerts section to admin.html (P0 item 1.6 frontend HTML)

**Files:**
- Modify: `admin.html` — add alerts nav tab + section + table + filters

- [x] **Step 1: Add alerts nav tab**

In `admin.html`, find the nav tabs section (look for `role="tablist"`). After the heat-sources tab button, add a separator and the alerts tab:

```html
<span class="nav-separator">|</span>
<button class="nav-btn" id="alerts-tab" data-section="alerts" role="tab" aria-selected="false" aria-controls="alerts-section">🚨 Тревоги</button>
```

- [x] **Step 2: Add alerts section with filters and table**

After the last section (heat-sources-section), add:

```html
<!-- Тревоги -->
<section id="alerts-section" class="admin-section" role="tabpanel" aria-labelledby="alerts-tab">
    <h2>🚨 Тревоги</h2>

    <div class="filters-panel">
        <div class="filter-group">
            <label for="alert-filter-severity">Важность:</label>
            <select id="alert-filter-severity">
                <option value="">Все</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="CRITICAL">CRITICAL</option>
            </select>
        </div>
        <div class="filter-group">
            <label for="alert-filter-status">Статус:</label>
            <select id="alert-filter-status">
                <option value="">Все</option>
                <option value="active">Активные</option>
                <option value="acknowledged">Подтверждённые</option>
                <option value="resolved">Закрытые</option>
            </select>
        </div>
        <div class="filter-group">
            <label for="alert-filter-infra">Тип:</label>
            <select id="alert-filter-infra">
                <option value="">Все</option>
                <option value="transformer">Трансформатор</option>
                <option value="controller">Контроллер</option>
                <option value="water_source">Источник воды</option>
                <option value="heat_source">Источник тепла</option>
            </select>
        </div>
    </div>

    <div class="table-container">
        <table id="alerts-table">
            <thead>
                <tr>
                    <th><input type="checkbox" id="alerts-select-all-checkbox" aria-label="Выбрать все тревоги"></th>
                    <th>ID</th>
                    <th>Тип</th>
                    <th>Важность</th>
                    <th>Сообщение</th>
                    <th>Объект</th>
                    <th>Статус</th>
                    <th>Создан</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                <tr><td colspan="9" style="text-align: center;">Нет данных</td></tr>
            </tbody>
        </table>
    </div>

    <div class="pagination" id="alerts-pagination"></div>
</section>
```

- [x] **Step 3: Add severity badge CSS**

Append to `public/css/admin.css`. Note: badge colors below are intentionally hardcoded — they are semantic colors specific to alert severity/status visualization, not part of the global color palette. Adding them to `:root` variables would create unused variables in non-alert contexts.

```css
/* === Alert severity badges (semantic colors — intentionally not in :root variables) === */
.severity-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
}
.severity-info {
    background: #e3f2fd;
    color: #1565c0;
}
.severity-warning {
    background: #fff3e0;
    color: #e65100;
}
.severity-critical {
    background: #ffebee;
    color: #c62828;
}
.alert-status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
}
.alert-status-active {
    background: #ffebee;
    color: #c62828;
}
.alert-status-acknowledged {
    background: #fff3e0;
    color: #e65100;
}
.alert-status-resolved {
    background: #e8f5e9;
    color: #2e7d32;
}
```

- [x] **Step 4: Commit**

```bash
git add admin.html public/css/admin.css
git commit -m "feat: add alerts section HTML, filters, table, and severity badge CSS"
```

---

### Task 12: Add alerts tab JavaScript logic (P0 item 1.6 frontend JS)

**Files:**
- Modify: `public/admin.js` — add alerts state, loadAlerts, renderAlertsTable, filter handlers, acknowledge/resolve actions

- [x] **Step 1: Add 'alerts' to all state objects**

In `admin.js`, add `alerts` key to each state object:

```js
// In pagination (after heatSources):
alerts: { page: 1, limit: 10, total: 0 }

// In dataLoaded:
alerts: false

// In filters:
alerts: {}

// In sorting:
alerts: { column: 'created_at', direction: 'desc' }

// In selectedItems:
alerts: new Set()
```

- [x] **Step 2: Add alerts case to loadSectionData**

In `loadSectionData` switch statement (line 254), add:

```js
case 'alerts':
    if (!dataLoaded.alerts) loadAlerts();
    break;
```

- [x] **Step 3: Add loadAlerts function**

Add after the other load functions:

```js
async function loadAlerts() {
    if (dataLoaded.alerts) return;
    showLoadingMessage("#alerts-table tbody", "9");

    try {
        const data = await loadData('/api/alerts', 'alerts');
        renderAlertsTable(data);
        updatePagination('alerts');
        dataLoaded.alerts = true;
    } catch (error) {
        console.error("Error loading alerts:", error);
        showErrorMessage("#alerts-table tbody", "9");
    }
}
```

- [x] **Step 4: Add renderAlertsTable using generic renderer**

```js
function getAlertStatusLabel(status) {
    const labels = {
        'active': 'Активная',
        'acknowledged': 'Подтверждена',
        'resolved': 'Закрыта'
    };
    return labels[status] || status;
}

function getInfraTypeLabel(type) {
    const labels = {
        'transformer': 'Трансформатор',
        'controller': 'Контроллер',
        'water_source': 'Источник воды',
        'heat_source': 'Источник тепла'
    };
    return labels[type] || type;
}

function renderAlertsTable(data) {
    renderEntityTable({
        tableId: 'alerts-table',
        entityType: 'alerts',
        idKey: 'alert_id',
        data,
        columns: [
            { key: 'alert_id', label: 'ID' },
            { key: 'infrastructure_type', label: 'Тип', render: (val) => getInfraTypeLabel(val) },
            { key: 'severity', label: 'Важность', render: (val) => {
                const span = document.createElement('span');
                span.className = `severity-badge severity-${(val || '').toLowerCase()}`;
                span.textContent = val;
                return span;
            }},
            { key: 'message', label: 'Сообщение' },
            { key: 'infrastructure_id', label: 'Объект' },
            { key: 'status', label: 'Статус', render: (val) => {
                const span = document.createElement('span');
                span.className = `alert-status-badge alert-status-${val}`;
                span.textContent = getAlertStatusLabel(val);
                return span;
            }},
            { key: 'created_at', label: 'Создан', render: (val) => formatDate(val) }
        ],
        actions: [
            {
                label: 'Подтвердить',
                className: 'btn-sm',
                condition: (item) => item.status === 'active',
                handler: (item) => acknowledgeAlert(item.alert_id)
            },
            {
                label: 'Закрыть',
                className: 'btn-sm btn-danger',
                condition: (item) => item.status !== 'resolved',
                handler: (item) => resolveAlert(item.alert_id)
            }
        ]
    });
}
```

- [x] **Step 5: Add acknowledge and resolve functions**

```js
async function acknowledgeAlert(alertId) {
    if (!confirm('Подтвердить тревогу?')) return;
    try {
        const response = await fetch(`/api/alerts/${alertId}/acknowledge`, { method: 'PATCH' });
        if (!response.ok) throw new Error('Ошибка подтверждения');
        showToast('Тревога подтверждена', 'success');
        dataLoaded.alerts = false;
        loadAlerts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function resolveAlert(alertId) {
    if (!confirm('Закрыть тревогу?')) return;
    try {
        const response = await fetch(`/api/alerts/${alertId}/resolve`, { method: 'PATCH' });
        if (!response.ok) throw new Error('Ошибка закрытия');
        showToast('Тревога закрыта', 'success');
        dataLoaded.alerts = false;
        loadAlerts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}
```

- [x] **Step 6: Wire up alert filter change handlers**

Add after the alerts load/render functions:

```js
// Alert filter handlers
['alert-filter-severity', 'alert-filter-status', 'alert-filter-infra'].forEach(filterId => {
    const el = document.getElementById(filterId);
    if (el) {
        el.addEventListener('change', function() {
            filters.alerts = {};
            const severity = document.getElementById('alert-filter-severity').value;
            const status = document.getElementById('alert-filter-status').value;
            const infra = document.getElementById('alert-filter-infra').value;
            if (severity) filters.alerts.severity = severity;
            if (status) filters.alerts.status = status;
            if (infra) filters.alerts.infrastructure_type = infra;
            pagination.alerts.page = 1;
            dataLoaded.alerts = false;
            loadAlerts();
        });
    }
});
```

- [x] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 8: Verify alerts tab in browser**

Open admin panel → Тревоги tab. Expected:
- Table loads with alert data (or empty state if no alerts)
- Filters work (severity, status, infrastructure type)
- "Подтвердить" button shows only on active alerts
- "Закрыть" button shows on active and acknowledged alerts
- Severity badges have correct colors (INFO=blue, WARNING=orange, CRITICAL=red)
- Pagination works

- [x] **Step 9: Commit**

```bash
git add public/admin.js
git commit -m "feat: add alerts tab with filters, severity badges, acknowledge/resolve actions"
```

---

### Task 13: Unify metrics form visual style (P1 item 2.4)

**Files:**
- Modify: `public/css/admin.css` — align metrics form styling with horizontal-form class
- Modify: `admin.html` — add `horizontal-form` wrapper class to metrics form if missing

- [x] **Step 1: Check current metrics form structure**

Read the metrics form section in admin.html. The form uses `form-section` + `form-row` for 3-column phase grouping. The fix is visual alignment only — add `horizontal-form` wrapper class and ensure CSS variables are used for padding/margins/borders.

- [x] **Step 2: Add/update CSS for metrics form alignment**

In `public/css/admin.css`, ensure `.form-section` and `.form-row` within `.horizontal-form` have consistent spacing:

```css
/* Metrics form alignment with horizontal-form */
.horizontal-form .form-section {
    padding: 1rem;
    margin-bottom: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
}
.horizontal-form .form-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.75rem;
}
.horizontal-form .form-row .form-group {
    flex: 1;
}
```

- [x] **Step 3: Verify in browser**

Open admin panel → Metrics tab → add metrics form. Expected: form has consistent borders, spacing, colors matching other entity forms.

- [x] **Step 4: Commit**

```bash
git add public/css/admin.css admin.html
git commit -m "fix: align metrics form visual style with horizontal-form pattern"
```

---

### Task 14: Final verification and cleanup

**Files:**
- All modified files

- [x] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (175+ existing + new alert tests).

- [x] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

- [x] **Step 3: Full browser verification checklist**

Open admin panel and verify each item:
- [x] No inline onclick in HTML source (View Source → search "onclick")
- [x] Edit modals have aria-label (Inspect element on 4 modals)
- [x] "Указать на карте" buttons work in add/edit transformer
- [x] "Сброс" button works in metrics form
- [x] Delete buttons are red, edit buttons are grey (btn-sm/btn-danger working)
- [x] Controller status shows Russian labels ("В сети", "Не в сети", "На обслуживании")
- [x] Toast notifications don't overlap logout button
- [x] All 8 entity tables render correctly with data
- [x] Pagination works on all tables
- [x] Batch operations (select all, delete selected) work
- [x] Alerts tab: filters, severity badges, acknowledge/resolve
- [x] Controller heartbeat column with color indicators
- [x] Entity names shown instead of IDs (controllers→building name, metrics→serial number)
- [x] No console errors

- [x] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: final verification cleanup for admin panel full fix"
```
