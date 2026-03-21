# Frontend UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical accessibility, consistency, and UX issues across all InfraSafe frontend pages based on UI/UX audit findings.

**Architecture:** Incremental fixes organized by priority (P0 first). Each task is self-contained and produces a working, testable state. No new frameworks or build tools — stays vanilla JS. CSS changes go into existing `css/style.css` or new dedicated files, not inline.

**Tech Stack:** Vanilla JS, HTML5, CSS3 (CSS variables), Leaflet.js, Chart.js

**Architect review:** Applied. Key fixes — Task 10 includes alerts cleanup + cache invalidation; Task 7 uses `var(--accent)` without fallback; Task 8 simplified; Task 5 CSS link position corrected; Task 6 moved before Task 5.

---

## File Structure

### Files to modify:
- `index.html` — viewport meta, footer year, font consistency
- `admin.html` — lang, font, link style.css, extract inline CSS
- `about.html` — viewport meta, remove Leaflet CSS, fix font, footer year, nav active state
- `contacts.html` — viewport meta, remove Leaflet CSS, fix font, footer year, nav active state, content fix
- `documentation.html` — viewport meta, remove Leaflet CSS, fix font, footer year, nav active state
- `public/script.js` — extract injected CSS to external file
- `public/admin.js` — fix pagination handler leak, simplify cascade delete
- `css/style.css` — add active nav styles

### Files to create:
- `css/map-components.css` — extracted CSS from script.js (toast, skeleton, clusters, sidebar)
- `css/admin.css` — extracted CSS from admin.html inline `<style>` block

### Task dependencies:
- Tasks 1-4 are independent of each other
- Tasks 2 and 3 modify the same files (about/contacts/documentation) — execute sequentially, NOT in parallel
- Task 5 depends on Task 1 (both modify index.html)
- Task 7 depends on Tasks 2+3 (same files)
- Task 10 is standalone (backend + admin.js)

---

## Task 1: Fix viewport `user-scalable=no` on all pages (P0)

**Files:**
- Modify: `index.html:5`
- Modify: `about.html:5`
- Modify: `contacts.html:5`
- Modify: `documentation.html:5`

- [ ] **Step 1: Fix index.html viewport**

In `index.html` line 5, replace:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```
with:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

- [ ] **Step 2: Fix about.html viewport**

Same change in `about.html` line 5.

- [ ] **Step 3: Fix contacts.html viewport**

Same change in `contacts.html` line 5.

- [ ] **Step 4: Fix documentation.html viewport**

Same change in `documentation.html` line 5.

- [ ] **Step 5: Verify pages still render correctly**

Open each page in browser, verify pinch-zoom works on mobile/responsive mode. Map on `index.html` should still work (Leaflet handles its own zoom via `scrollWheelZoom`).

- [ ] **Step 6: Commit**

```bash
git add index.html about.html contacts.html documentation.html
git commit -m "fix(a11y): remove user-scalable=no from all pages (WCAG 1.4.4)"
```

---

## Task 2: Remove Leaflet CSS from pages without maps + fix fonts (P1)

**Combines old Tasks 2+3 — same files, execute together to avoid conflicts.**

**Files:**
- Modify: `about.html:17-21` (Leaflet CSS lines)
- Modify: `contacts.html:17-21`
- Modify: `documentation.html:17-21`
- Modify: `css/style.css`

- [ ] **Step 1: In about.html — remove Leaflet CSS and replace Roboto with Inter**

Delete these 4 lines:
```html
    <link rel="stylesheet" href="public/libs/leaflet/leaflet.css" />
    <link rel="stylesheet" href="public/libs/leaflet/leaflet-fixes.css" />
    <link rel="stylesheet" href="public/libs/leaflet-markercluster/MarkerCluster.css" />
    <link rel="stylesheet" href="public/libs/leaflet-markercluster/MarkerCluster.Default.css" />
```

Replace:
```html
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
```
with:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Same changes in contacts.html**

- [ ] **Step 3: Same changes in documentation.html**

- [ ] **Step 4: Ensure CSS font-family for content pages**

In `css/style.css`, verify `.content-page` body has Inter. If not, add:
```css
body.content-page {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

- [ ] **Step 5: Verify**

Open about.html, contacts.html, documentation.html — should look identical visually (no map elements on these pages). Font should match index.html (Inter).

- [ ] **Step 6: Commit**

```bash
git add about.html contacts.html documentation.html css/style.css
git commit -m "fix(ui): remove unused Leaflet CSS from content pages, unify fonts to Inter"
```

---

## Task 3: Fix contacts.html placeholder content (P0)

**Files:**
- Modify: `contacts.html:44-66`

- [ ] **Step 1: Replace placeholder content**

Replace the content section in `contacts.html` lines 44-66 with:
```html
    <div class="content">
        <h1>Контакты</h1>
        <div class="contact-info">
            <h2>Наши координаты</h2>
            <p><strong>Компания:</strong> AI Solutions (Serendipity)</p>
            <p><strong>Сайт:</strong> <a href="https://www.aisolutions.uz" target="_blank" rel="noopener noreferrer">www.aisolutions.uz</a></p>
            <p><strong>Подробности:</strong> <a href="https://www.aisolutions.uz/aboutus" target="_blank" rel="noopener noreferrer">Страница контактов на сайте компании</a></p>
        </div>
    </div>
```

- [ ] **Step 2: Verify the page renders with real content**

- [ ] **Step 3: Commit**

```bash
git add contacts.html
git commit -m "fix(content): replace placeholder data on contacts page"
```

---

## Task 4: Fix pagination event handler accumulation in admin.js (P1 bug)

**Bug-fix goes before refactoring tasks per architect recommendation.**

**Files:**
- Modify: `public/admin.js:1466-1501`

- [ ] **Step 1: Understand the bug**

`updatePagination()` is called on every data load. It adds `addEventListener('click', ...)` to prev/next buttons each time — duplicate handlers accumulate, causing multiple API requests per click.

- [ ] **Step 2: Fix by cloning nodes to remove old handlers**

Replace the pagination handler code in `public/admin.js` lines 1477-1501. Before adding listeners, clone the buttons to strip old handlers:

```javascript
        if (prevBtn) {
            prevBtn.disabled = pagination[section].page <= 1;
            const newPrevBtn = prevBtn.cloneNode(true);
            prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
            newPrevBtn.addEventListener('click', () => {
                if (pagination[section].page > 1) {
                    pagination[section].page--;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            });
        }

        if (nextBtn) {
            const totalPages = Math.ceil(pagination[section].total / pagination[section].limit);
            nextBtn.disabled = pagination[section].page >= totalPages;
            const newNextBtn = nextBtn.cloneNode(true);
            nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
            newNextBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(pagination[section].total / pagination[section].limit);
                if (pagination[section].page < totalPages) {
                    pagination[section].page++;
                    dataLoaded[section] = false;
                    loadSectionData(section);
                }
            });
        }
```

Note: `cloneNode` is pragmatic here — not ideal (AbortController or one-time init would be cleaner), but avoids restructuring the 3160-line monolith.

- [ ] **Step 3: Verify pagination works**

Open admin panel, navigate through pages of buildings — should make exactly one API request per click (check Network tab in DevTools).

- [ ] **Step 4: Commit**

```bash
git add public/admin.js
git commit -m "fix(admin): prevent pagination handler accumulation on repeated data loads"
```

---

## Task 5: Extract injected CSS from script.js into map-components.css (P1)

**Files:**
- Create: `css/map-components.css`
- Modify: `public/script.js:1058-1326`
- Modify: `index.html` (add CSS link)

- [ ] **Step 1: Create css/map-components.css**

Copy the CSS content from `public/script.js` lines 1060-1325 (everything inside `sidebarStyles.textContent = \`...\``) into a new file `css/map-components.css`.

- [ ] **Step 2: Remove the CSS injection block from script.js**

Remove lines 1058-1326 in `public/script.js` (from `const sidebarStyles = document.createElement('style');` through `document.head.appendChild(sidebarStyles);`).

- [ ] **Step 3: Link the new CSS file in index.html**

Add after `MarkerCluster.Default.css` link (line 21 in `index.html`), BEFORE the Google Fonts link:
```html
<link rel="stylesheet" href="css/map-components.css">
```

This ensures map-components.css loads after Leaflet CSS and can override cluster styles if needed.

- [ ] **Step 4: Verify map page works**

Open `index.html`, verify: toast notifications appear correctly, skeleton loader shows during load, cluster markers render, sidebar collapses work.

- [ ] **Step 5: Commit**

```bash
git add css/map-components.css public/script.js index.html
git commit -m "refactor(css): extract 265 lines of injected CSS from script.js to map-components.css"
```

---

## Task 6: Add active navigation state to content pages (P1)

**Files:**
- Modify: `css/style.css`
- Modify: `about.html`
- Modify: `documentation.html`

**Note:** `contacts.html` is NOT in the nav. The "Контакты" link points to an external URL (`https://www.aisolutions.uz/aboutus`), not to `contacts.html`. So only `about.html` and `documentation.html` get active states. The `contacts.html` page exists but is not linked from the main nav — it's effectively orphaned or accessible only via direct URL.

- [ ] **Step 1: Add active nav CSS**

Add to `css/style.css`:
```css
.main-nav a.active {
    color: var(--accent);
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 2px;
}
```

Note: `--accent` is defined as `#00BFA5` in `:root` — no fallback needed since the variable is always defined.

- [ ] **Step 2: Add active class in about.html**

In the `<nav>` section, add `class="active"` to the "О системе" link:
```html
<li><a href="about.html" class="active">О системе</a></li>
```

- [ ] **Step 3: Add active class in documentation.html**

Add `class="active"` to the "Документация" link.

- [ ] **Step 4: Verify active state is visible**

Navigate between pages, verify the current page is highlighted in the nav.

- [ ] **Step 5: Commit**

```bash
git add css/style.css about.html documentation.html
git commit -m "feat(nav): add active state highlighting for current page"
```

---

## Task 7: Fix footer year (P2)

**Files:**
- Modify: `index.html:191`
- Modify: `about.html:108`
- Modify: `contacts.html:75`
- Modify: `documentation.html:57`

- [ ] **Step 1: Replace hardcoded year in all footers**

In each file, replace:
```html
<p>© 2025 InfraSafe</p>
```
with:
```html
<p>© 2026 InfraSafe</p>
```

Simple text replacement — year changes once per year, over-engineering with JS is unnecessary for 4 files per architect recommendation.

- [ ] **Step 2: Verify footer shows 2026**

Open any page, check footer.

- [ ] **Step 3: Commit**

```bash
git add index.html about.html contacts.html documentation.html
git commit -m "fix(ui): update footer copyright year to 2026"
```

---

## Task 8: Extract admin.html inline CSS to css/admin.css (P1)

**Files:**
- Create: `css/admin.css`
- Modify: `admin.html:2,6,9-end_of_style_block`

Note: `admin-auth.js` also injects ~120 lines of CSS via `addLoginStyles()` (lines 242-366). This is intentionally NOT extracted here — login styles must be available before admin.css loads (they render before auth). This can be a separate future task.

- [ ] **Step 1: Create css/admin.css**

Extract the entire `<style>...</style>` block from `admin.html` (lines 9 through the closing `</style>` tag) into a new file `css/admin.css`.

- [ ] **Step 2: Replace inline style with link**

In `admin.html`, remove the `<style>...</style>` block and add:
```html
<link rel="stylesheet" href="css/admin.css">
```

- [ ] **Step 3: Fix lang attribute**

Change `admin.html` line 2 from `<html lang="en">` to `<html lang="ru">`.

- [ ] **Step 4: Add Inter font**

Add in `admin.html` `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Update `css/admin.css` body rule:
```css
body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    /* ... rest of existing body styles ... */
}
```

- [ ] **Step 5: Verify admin panel looks the same**

Open admin.html, verify all tables, forms, tabs, pagination render correctly.

- [ ] **Step 6: Commit**

```bash
git add css/admin.css admin.html
git commit -m "refactor(admin): extract inline CSS to admin.css, fix lang=ru, unify font to Inter"
```

---

## Task 9: Add batch cascade delete endpoint on backend (P1)

**Highest risk task — touches backend, DB transactions, and frontend. Execute last.**

**Files:**
- Modify: `src/models/Building.js`
- Modify: `src/services/buildingService.js`
- Modify: `src/controllers/buildingController.js`
- Modify: `public/admin.js:1615-1708`
- Create: `tests/jest/unit/buildingService.test.js`

### DB dependency analysis (from `database/init/01_init_database.sql`):
- `controllers.building_id → buildings(building_id)` — **NO CASCADE**
- `metrics.controller_id → controllers(controller_id)` — **NO CASCADE**
- `alerts.metric_id` — **no FK constraint**, but references metrics semantically
- `water_measurement_points.building_id → buildings(building_id)` — **ON DELETE CASCADE** (auto-handled by PG)

Transaction must explicitly delete: alerts → metrics → controllers → building (leaf-first order).

- [ ] **Step 1: Write failing test for cascade delete**

Create `tests/jest/unit/buildingService.test.js`:

**Note:** `database.js` exports `{ init, query, getPool, close }` — NOT `connect`. The `Building` model uses `db.query()` for simple queries. For transactions, the model must call `db.getPool().connect()` to get a client. The test mocks `getPool` to return a pool with a `connect` method.

```javascript
jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

describe('BuildingService.deleteCascade', () => {
    const db = require('../../../src/config/database');
    const buildingService = require('../../../src/services/buildingService');

    test('should delete building with alerts, metrics, and controllers in transaction', async () => {
        const mockClient = {
            query: jest.fn()
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rowCount: 3 }) // DELETE alerts
                .mockResolvedValueOnce({ rowCount: 5 }) // DELETE metrics
                .mockResolvedValueOnce({ rowCount: 2 }) // DELETE controllers
                .mockResolvedValueOnce({ rows: [{ building_id: 1 }], rowCount: 1 }) // DELETE building
                .mockResolvedValueOnce({}), // COMMIT
            release: jest.fn()
        };
        db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(mockClient) });

        const result = await buildingService.deleteCascade(1);
        expect(result).toBeDefined();
        expect(result.building_id).toBe(1);
        expect(mockClient.query).toHaveBeenCalledTimes(6); // BEGIN + 4 DELETEs + COMMIT
        expect(mockClient.release).toHaveBeenCalled();
    });

    test('should rollback on error', async () => {
        const mockClient = {
            query: jest.fn()
                .mockResolvedValueOnce({}) // BEGIN
                .mockRejectedValueOnce(new Error('FK violation')), // DELETE alerts fails
            release: jest.fn()
        };
        db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(mockClient) });

        await expect(buildingService.deleteCascade(1)).rejects.toThrow('FK violation');
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=buildingService
```
Expected: FAIL — `buildingService.deleteCascade is not a function`

- [ ] **Step 3: Implement deleteCascade in Building model**

Add to `src/models/Building.js`:

**Note:** Building model imports `db` from `config/database`, not a raw pool. Use `db.getPool().connect()` for transaction client.

```javascript
static async deleteCascade(buildingId) {
    const id = parseInt(buildingId, 10);
    if (isNaN(id)) throw new Error('Invalid building ID');

    const client = await db.getPool().connect();
    try {
        await client.query('BEGIN');
        // 1. Delete alerts referencing metrics of this building's controllers
        await client.query(
            `DELETE FROM alerts WHERE metric_id IN (
                SELECT metric_id FROM metrics WHERE controller_id IN (
                    SELECT controller_id FROM controllers WHERE building_id = $1
                )
            )`,
            [id]
        );
        // 2. Delete metrics
        await client.query(
            'DELETE FROM metrics WHERE controller_id IN (SELECT controller_id FROM controllers WHERE building_id = $1)',
            [id]
        );
        // 3. Delete controllers
        await client.query('DELETE FROM controllers WHERE building_id = $1', [id]);
        // 4. Delete building (water_measurement_points auto-cascade via FK)
        const result = await client.query('DELETE FROM buildings WHERE building_id = $1 RETURNING *', [id]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
```

- [ ] **Step 4: Add service method with cache invalidation**

In `src/services/buildingService.js`, add:
```javascript
async deleteCascade(id) {
    const result = await Building.deleteCascade(id);
    if (result) {
        await this.invalidateBuildingCache(id);
    }
    return result;
}
```

- [ ] **Step 5: Update controller to handle cascade query param**

In `src/controllers/buildingController.js`, update the delete handler. When `req.query.cascade === 'true'`, call `buildingService.deleteCascade(id)` instead of the standard delete. Validate that `id` is a valid integer (use existing param validation or `parseInt`).

**Important — fix API response contract:** The current frontend (`admin.js:1583`) expects `errorData.controllers` array in the 400 response when a building has controllers. But `buildingController.js` uses `sendError()` from `apiResponse.js`, which wraps errors as `{ success: false, error: { message, status } }` — it does NOT include a `controllers` array. The `deleteBuilding` handler must return the controllers list in its 400 response for the `confirm()` cascade flow to work. Either:
- Use a custom `res.status(400).json({ error: '...', controllers: [...] })` instead of `sendError()`, OR
- Extend `sendError()` to accept extra fields

Verify the current 400 response format by reading `buildingService.deleteBuilding()` — if it throws with controllers attached, the controller needs to catch and format properly.

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=buildingService
```
Expected: PASS (2 tests)

- [ ] **Step 7: Simplify frontend deleteBuildingCascade**

Replace `public/admin.js` lines 1615-1708 with:
```javascript
async function deleteBuildingCascade(buildingId, controllers) {
    try {
        const response = await fetch(`/api/buildings/${buildingId}?cascade=true`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка каскадного удаления');
        }

        showToast('Здание и связанные данные успешно удалены', 'success');
        dataLoaded.buildings = false;
        loadBuildings();
    } catch (error) {
        console.error('Error in cascade delete:', error);
        showToast(error.message || 'Ошибка каскадного удаления', 'error');
    }
}
```

- [ ] **Step 8: Run all tests**

```bash
npm test
```
Expected: all 177+ tests pass (175 existing + 2 new)

- [ ] **Step 9: Commit**

```bash
git add src/models/Building.js src/services/buildingService.js src/controllers/buildingController.js public/admin.js tests/jest/unit/buildingService.test.js
git commit -m "feat(api): add cascade delete for buildings with alerts cleanup, replace N+1 frontend requests"
```

---

## Summary

| # | Task | Priority | Files | Effort |
|---|------|----------|-------|--------|
| 1 | Fix user-scalable=no | P0 | 4 HTML | 5 min |
| 2 | Remove Leaflet CSS + unify fonts | P1 | 3 HTML + CSS | 10 min |
| 3 | Fix contacts placeholder | P0 | 1 HTML | 5 min |
| 4 | Fix pagination handler leak (bug) | P1 | 1 JS | 10 min |
| 5 | Extract CSS from script.js | P1 | 1 CSS + 1 JS + 1 HTML | 15 min |
| 6 | Active nav state | P1 | 1 CSS + 3 HTML | 10 min |
| 7 | Fix footer year | P2 | 4 HTML | 5 min |
| 8 | Extract admin inline CSS | P1 | 1 CSS + 1 HTML | 20 min |
| 9 | Batch cascade delete | P1 | 4 backend + 1 frontend + 1 test | 30 min |

**Total: 9 tasks, ~110 min estimated**

### Changes from architect review:
1. Old Task 10 → Task 9: added `DELETE FROM alerts` to transaction, added cache invalidation in service, added `parseInt` validation, added rollback test
2. Merged old Tasks 2+3 into one (same files — avoid conflicts)
3. Moved pagination bug-fix before CSS refactoring
4. Task 6 nav active: removed fallback `#4FC3F7`, using `var(--accent)` only
5. Task 7 footer year: simplified to static `2026` replacement (no JS)
6. Task 5 CSS link: positioned after MarkerCluster CSS for correct cascade
7. Added task dependency notes in File Structure section
8. Added note about admin-auth.js CSS injection as future TODO

### Changes from owner review (2026-03-21):
9. Task 6 nav active: removed contacts.html — nav links to external URL, not to contacts.html
10. Task 9 cascade delete: documented sendError/apiResponse contract mismatch — frontend expects `errorData.controllers` but `sendError()` doesn't support extra fields
