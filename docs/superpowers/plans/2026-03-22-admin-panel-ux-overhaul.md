# Admin Panel UX/UI Overhaul Implementation Plan

> **Status: COMPLETED (2026-03-23)** — All 10 tasks implemented and verified.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the admin panel from a prototype-quality interface into a production-grade admin tool with consistent design, proper auth flow, usable tables, and accessibility compliance.

**Architecture:** Incremental refactoring of `admin.html` + `public/admin.js` + `public/admin-auth.js`. No new frameworks — stays vanilla JS. CSS extracted from inline `<style>` to `css/admin.css` (created in Task 1 of the existing frontend-ux plan). Each task produces a working, testable state. Tasks are ordered by dependency and priority.

**Tech Stack:** Vanilla JS, HTML5, CSS3 (with CSS variables from `css/style.css`), Leaflet.js (for coordinate editor)

**Prerequisite:** The existing `2026-03-21-frontend-ux-improvements.md` plan Tasks 1-6 should be completed first (viewport fixes, CSS extraction, font unification, lang="ru"). This plan picks up where that one leaves off for admin-specific work.

**Architect review:** Applied. Key fixes — Task 1: removed setTimeout fallback (can cause logout on slow networks), replaced with isAuthenticated check; Task 5: eliminated XSS regression by keeping createElement+textContent pattern instead of template literals with innerHTML, expand handler registered once outside render; Task 8: fixed modal IDs (-modal not -overlay), fixed { once: true } bug on overlay click, added missing edit-line-modal; Task 9: aria-labelledby→aria-label on tabpanels (tab buttons lack IDs).

---

## Scope

This plan covers admin panel improvements only. It does NOT cover:
- Main map page (`index.html`, `public/script.js`) — handled by frontend-ux plan
- About/contacts/documentation pages — handled by frontend-ux plan
- Backend API changes — only frontend changes here
- admin.js modularization into ES modules — separate future plan (too large for this scope)

---

## File Structure

### Files to modify:
- `admin.html` — restructure layout (wrap in `.admin-container`), fix tables, fix forms, add ARIA, fix i18n
- `public/admin.js:1466-1502` — fix pagination event listener leak
- `public/admin.js:1509` — defer data loading until auth ready
- `public/admin-auth.js:29-31,196-209` — emit `auth-ready` event, fix `.admin-container` selector
- `css/admin.css` — new styles (created by prerequisite plan Task 6)

### Files NOT touched:
- `public/admin-coordinate-editor.js` — works fine as-is
- `public/infrastructure-line-editor.js` — works fine as-is

### Task dependencies:
```
Task 1 (auth race condition) — independent, P0
Task 2 (admin-container wrap) — independent, P0
Task 3 (table overflow) — independent, P0
Task 4 (i18n EN→RU) — independent, P1
Task 5 (buildings table) — depends on Task 3
Task 6 (pagination fix) — independent, P1
Task 7 (forms unification) — independent, P1
Task 8 (modal improvements) — independent, P1
Task 9 (ARIA + a11y) — depends on Tasks 2, 5, 8
Task 10 (nav grouping) — independent, P2
```

Tasks 1-4 can run in parallel. Task 5 after Task 3. Task 9 last.

---

## Task 1: Fix auth race condition — data loads before auth ready (P0)

**Context:** `admin.js` calls `loadSectionData('buildings')` on `DOMContentLoaded` (line 1509), but `admin-auth.js` `validateToken()` is async. Data requests fire before the fetch interceptor adds the JWT header, causing 401 errors. After login/token validation, data is never retried.

**Files:**
- Modify: `public/admin-auth.js:29-31` (after successful auth, dispatch event)
- Modify: `public/admin-auth.js:58-62` (after login success, dispatch event)
- Modify: `public/admin.js:1509` (replace immediate load with event listener)

- [x] **Step 1: Add `auth-ready` event dispatch in admin-auth.js**

In `public/admin-auth.js`, find `validateToken()` method. After line 31 (`this.setupAuthHeaders();`), add:

```javascript
// After this.setupAuthHeaders(); in validateToken():
window.dispatchEvent(new CustomEvent('admin-auth-ready'));
```

Also in the `login()` method, after the successful login block where `this.setupAuthHeaders()` is called (around line 62), add the same dispatch:

```javascript
// After successful login setupAuthHeaders():
window.dispatchEvent(new CustomEvent('admin-auth-ready'));
```

- [x] **Step 2: Replace immediate load with event listener in admin.js**

In `public/admin.js`, replace line 1509:

```javascript
// OLD:
loadSectionData('buildings');
```

with:

```javascript
// NEW: Wait for auth to be ready before loading data
// Check if auth already completed (fast token validation)
if (window.adminAuth && window.adminAuth.isAuthenticated) {
    loadSectionData('buildings');
} else {
    window.addEventListener('admin-auth-ready', () => {
        loadSectionData('buildings');
    }, { once: true });
}
```

- [x] **Step 3: Verify in browser**

1. Open http://localhost:8088/admin.html in a fresh incognito window
2. Login with admin/admin123
3. Buildings table should populate with data immediately after login
4. Refresh page (F5) — buildings should load automatically without re-login
5. No 401 errors in console before auth is ready

- [x] **Step 4: Commit**

```bash
git add public/admin-auth.js public/admin.js
git commit -m "fix(admin): resolve auth race condition — defer data load until auth ready"
```

---

## Task 2: Wrap admin content in `.admin-container` for proper auth show/hide (P0)

**Context:** `admin-auth.js` calls `showAdminPanel()`/`hideAdminPanel()` targeting `.admin-container`, but this element doesn't exist in `admin.html`. Navigation, search bar, and sections are visible behind the login overlay.

**Files:**
- Modify: `admin.html:782-800` — wrap nav + search + all sections in `<div class="admin-container">`

- [x] **Step 1: Add opening `<div class="admin-container">` before nav**

In `admin.html`, immediately before line 782 (`<!-- Навигационное меню -->`), add:

```html
<div class="admin-container" style="display: none;">
```

- [x] **Step 2: Add closing `</div>` after last section**

In `admin.html`, immediately before the DOMPurify script tag (line 2002 `<!-- Подключение DOMPurify для защиты от XSS -->`), add:

```html
</div><!-- /.admin-container -->
```

- [x] **Step 3: Add CSS for admin-container**

In `css/admin.css` (if it exists from prerequisite plan) or in the inline `<style>` block in `admin.html`, add:

```css
.admin-container {
    display: none; /* Hidden until auth confirms */
}

.admin-container.visible {
    display: block;
}
```

- [x] **Step 4: Update admin-auth.js to use class toggle**

In `public/admin-auth.js`, update `showAdminPanel()` (line 196):

```javascript
showAdminPanel() {
    const adminContent = document.querySelector('.admin-container');
    if (adminContent) {
        adminContent.style.display = 'block';
    }
    this.addLogoutButton();
}
```

No change needed — the existing code already targets `.admin-container` and sets `display: block`. The key fix is that the element now exists in the DOM.

- [x] **Step 5: Verify in browser**

1. Open admin.html — only login form should be visible, NO nav/search/tables behind it
2. Login — full admin panel appears
3. Logout — admin panel hides, only login form visible

- [x] **Step 6: Commit**

```bash
git add admin.html public/admin-auth.js css/admin.css
git commit -m "fix(admin): wrap content in .admin-container for proper auth show/hide"
```

---

## Task 3: Fix table overflow — hidden content becomes scrollable (P0)

**Context:** `.table-container` has `overflow: hidden` in CSS, cutting off wide tables. Tables with 9-15 columns are unusable on smaller screens.

**Files:**
- Modify: `admin.html` inline CSS (or `css/admin.css`) — change overflow property

- [x] **Step 1: Change overflow from hidden to auto**

Find the `.table-container` CSS rule (around line 210 in admin.html `<style>` block):

```css
/* OLD: */
.table-container {
    overflow: hidden;
}
```

Replace with:

```css
/* NEW: */
.table-container {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
}
```

If the property is defined elsewhere (check all CSS locations), update all occurrences.

- [x] **Step 2: Remove `table-layout: fixed` from the global table rule**

The global `table { table-layout: fixed; }` rule (line 48 of inline CSS) forces all columns to equal width regardless of content. This causes data truncation. Replace:

```css
/* OLD: */
table {
    table-layout: fixed;
}
```

with:

```css
/* NEW: */
table {
    table-layout: auto;
}
```

- [x] **Step 3: Add min-width to prevent column collapse**

Add to the table styles:

```css
/* No global min-width — let smaller tables (controllers: 8 cols) size naturally.
   Only the buildings table gets min-width after Task 5 simplifies it. */
```

- [x] **Step 4: Verify in browser**

1. Open admin.html, login
2. Buildings table should show horizontal scrollbar when window is narrow
3. Resize browser to ~800px width — table should scroll horizontally, not truncate
4. All text in cells should be fully visible (no ellipsis unless cell is very narrow)
5. Check controllers, transformers sections — same behavior

- [x] **Step 5: Commit**

```bash
git add admin.html css/admin.css
git commit -m "fix(admin): enable horizontal scroll for wide tables, remove table-layout:fixed"
```

---

## Task 4: Fix i18n — translate all English strings to Russian (P1)

**Context:** Multiple headings, placeholders, and button labels are in English while the rest of the UI is Russian. Mixed language creates unprofessional appearance.

**Files:**
- Modify: `admin.html` — translate headings, placeholders, buttons, select options

- [x] **Step 1: Fix Buildings section**

In `admin.html`, find and replace:

| Line ~826 | Old | New |
|-----------|-----|-----|
| `<h2>Buildings</h2>` | → | `<h2>Таблица зданий</h2>` |

- [x] **Step 2: Fix Controllers section**

| Location | Old | New |
|----------|-----|-----|
| ~1024 | `<h2>Controllers</h2>` | `<h2>Таблица контроллеров</h2>` |
| ~1053 | `<h2>Add New Controller</h2>` | `<h2>Добавить контроллер</h2>` |
| ~1055 | `placeholder="Serial Number"` | `placeholder="Серийный номер"` |
| ~1056 | `placeholder="Vendor"` | `placeholder="Производитель"` |
| ~1057 | `placeholder="Model"` | `placeholder="Модель"` |
| ~1058 | `placeholder="Building ID"` | `placeholder="ID здания"` |
| ~1064 | `<button type="submit">Add Controller</button>` | `<button type="submit">Добавить контроллер</button>` |

- [x] **Step 3: Fix select options for controller status (HTML)**

Replace English status options in controller forms and filters:

```html
<!-- OLD -->
<option value="online">Online</option>
<option value="offline">Offline</option>
<option value="maintenance">Maintenance</option>

<!-- NEW -->
<option value="online">В сети</option>
<option value="offline">Не в сети</option>
<option value="maintenance">Обслуживание</option>
```

Apply to: `#controller-status` select, `#controllers-status-filter` select, `#controllers-bulk-status-select` select, and the edit controller modal status select.

- [x] **Step 4: Fix Metrics section**

| Location | Old | New |
|----------|-----|-----|
| ~1573 | `<h2>Latest Metrics</h2>` | `<h2>Последние метрики</h2>` |

- [x] **Step 5: Fix page title**

In `admin.html` line 6:

```html
<!-- OLD -->
<title>Database Admin Panel</title>
<!-- NEW -->
<title>InfraSafe - Администрирование</title>
```

- [x] **Step 6: Verify**

Open admin.html — all headings, buttons, placeholders, and select options should be in Russian. No English strings visible in the UI (except technical identifiers like ID, CSV, which are universal).

- [x] **Step 7: Commit**

```bash
git add admin.html
git commit -m "fix(admin): translate all English UI strings to Russian"
```

---

## Task 5: Simplify buildings table — replace 3-row header with expandable rows (P0)

**Context:** Buildings table has 15+ columns split across 3 header rows using `rowspan`. This makes the table unreadable, unsortable for infrastructure columns, and terrible on mobile. Solution: show core data in the main row, reveal infrastructure details on click.

**Files:**
- Modify: `admin.html:828-859` — simplify thead to single row
- Modify: `public/admin.js` — update `renderBuildings()` to use expandable rows

- [x] **Step 1: Replace multi-row thead with single-row thead**

In `admin.html`, replace the entire buildings table `<thead>` (lines ~828-855):

```html
<table id="buildings-table" border="1">
    <thead>
        <tr>
            <th><input type="checkbox" id="buildings-select-all-checkbox"></th>
            <th class="sortable" data-column="building_id">ID ↕</th>
            <th class="sortable" data-column="name">Название ↕</th>
            <th class="sortable" data-column="address">Адрес ↕</th>
            <th class="sortable" data-column="town">Город ↕</th>
            <th class="sortable" data-column="region">Регион ↕</th>
            <th class="sortable" data-column="management_company">УК ↕</th>
            <th>Действия</th>
        </tr>
    </thead>
```

Remove the `class="multi-row-table"` from the table element.

- [x] **Step 2: Update renderBuildingsTable() in admin.js**

Find `renderBuildingsTable()` in `public/admin.js` (around line 713). The existing code uses `document.createElement` + `textContent` for XSS safety. **IMPORTANT: Keep the createElement+textContent pattern. Do NOT use innerHTML or template literals for user data — this would reintroduce XSS vulnerabilities.**

Replace the multi-row rendering (3 `<tr>` per building with `rowspan`) with a single main row + hidden detail row, using the same safe DOM API:

```javascript
// For each building, create TWO rows: main + expandable detail
function createBuildingRows(b, tbody) {
    // Main row
    const mainRow = document.createElement('tr');
    mainRow.className = 'building-main-row';
    mainRow.dataset.buildingId = b.building_id;

    // Checkbox cell
    const checkCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'row-checkbox';
    checkbox.dataset.id = b.building_id;
    checkCell.appendChild(checkbox);
    mainRow.appendChild(checkCell);

    // Text cells — all use textContent (XSS-safe)
    const fields = [b.building_id, b.name, b.address, b.town, b.region, b.management_company];
    fields.forEach(val => {
        const td = document.createElement('td');
        td.textContent = safeValue(val, '—');
        mainRow.appendChild(td);
    });

    // Actions cell
    const actionsCell = document.createElement('td');
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn-expand';
    expandBtn.textContent = '▶';
    expandBtn.title = 'Подробности';
    actionsCell.appendChild(expandBtn);

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️';
    editBtn.title = 'Редактировать';
    editBtn.addEventListener('click', () => editBuilding(b.building_id));
    actionsCell.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Удалить';
    deleteBtn.addEventListener('click', () => deleteBuilding(b.building_id));
    actionsCell.appendChild(deleteBtn);

    mainRow.appendChild(actionsCell);
    tbody.appendChild(mainRow);

    // Detail row (hidden by default)
    const detailRow = document.createElement('tr');
    detailRow.className = 'building-detail-row';
    detailRow.style.display = 'none';
    detailRow.dataset.detailFor = b.building_id;

    const detailCell = document.createElement('td');
    detailCell.colSpan = 8;

    const detailGrid = document.createElement('div');
    detailGrid.className = 'detail-grid';

    const details = [
        ['Координаты', `${safeValue(b.latitude, '—')}, ${safeValue(b.longitude, '—')}`],
        ['Горячая вода', b.hot_water ? 'Да' : 'Нет'],
        ['Осн. трансформатор', safeValue(b.primary_transformer_name, '—')],
        ['Рез. трансформатор', safeValue(b.backup_transformer_name, '—')],
        ['Осн. линия', safeValue(b.primary_line_name, '—')],
        ['Рез. линия', safeValue(b.backup_line_name, '—')],
        ['Линия ХВС', safeValue(b.cold_water_line_name, '—')],
        ['Линия ГВС', safeValue(b.hot_water_line_name, '—')],
        ['Поставщик ХВС', safeValue(b.cold_water_supplier_name, '—')],
        ['Поставщик ГВС', safeValue(b.hot_water_supplier_name, '—')]
    ];

    details.forEach(([label, value]) => {
        const div = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = label + ': ';
        div.appendChild(strong);
        div.appendChild(document.createTextNode(value));
        detailGrid.appendChild(div);
    });

    detailCell.appendChild(detailGrid);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);
}
```

- [x] **Step 3: Register expand/collapse handler ONCE in initialization section**

Add this in the INITIALIZATION section of admin.js (around line 1510), NOT inside `renderBuildingsTable()`. This prevents listener accumulation on re-renders:

```javascript
// Delegated click handler for expand buttons — registered ONCE
document.getElementById('buildings-table').addEventListener('click', (e) => {
    const expandBtn = e.target.closest('.btn-expand');
    if (!expandBtn) return;

    const mainRow = expandBtn.closest('tr');
    const buildingId = mainRow.dataset.buildingId;
    const detailRow = document.querySelector(`tr[data-detail-for="${buildingId}"]`);

    if (detailRow) {
        const isVisible = detailRow.style.display !== 'none';
        detailRow.style.display = isVisible ? 'none' : 'table-row';
        expandBtn.textContent = isVisible ? '▶' : '▼';
    }
});
```

- [x] **Step 4: Add detail-grid CSS**

```css
.detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 8px;
    padding: 8px;
    background: #f9f9f9;
    border-radius: 4px;
}

.detail-grid div {
    font-size: 0.9rem;
}

.building-detail-row td {
    padding: 0 !important;
    border-top: none !important;
}

.building-detail-row .detail-grid {
    margin: 4px 8px 8px;
}

.btn-expand {
    background: none;
    border: 1px solid #ddd;
    border-radius: 3px;
    cursor: pointer;
    padding: 2px 6px;
    font-size: 0.8rem;
}

.btn-expand:hover {
    background: #e8e8e8;
}
```

- [x] **Step 5: Verify in browser**

1. Open admin.html, login
2. Buildings table shows 7 columns (ID, Название, Адрес, Город, Регион, УК, Действия) — clean, single-row
3. Click ▶ button on any building — detail row expands showing infrastructure info in a grid
4. Click ▼ button — detail row collapses
5. Sorting by ID, Название, Город works
6. Checkbox selection still works
7. Edit/Delete buttons still work

- [x] **Step 6: Commit**

```bash
git add admin.html public/admin.js css/admin.css
git commit -m "feat(admin): replace 3-row buildings table with expandable detail rows"
```

---

## Task 6: Fix pagination event listener leak (P1)

**Context:** `updatePagination()` (admin.js:1466-1502) adds new `addEventListener` on prev/next buttons every time it's called, without removing old listeners. After 10 page changes, one click triggers the handler 10 times.

**Files:**
- Modify: `public/admin.js:1466-1502` — clone buttons to remove old listeners

- [x] **Step 1: Fix updatePagination() to clone buttons**

In `public/admin.js`, replace the `updatePagination` function (lines 1466-1502):

```javascript
function updatePagination(section) {
    const pageInfo = document.getElementById(`${section}-page-info`);
    const prevBtn = document.getElementById(`${section}-prev-page`);
    const nextBtn = document.getElementById(`${section}-next-page`);

    const currentPage = pagination[section].page;
    const total = pagination[section].total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pagination[section].limit));

    if (pageInfo) {
        pageInfo.textContent = `Страница ${currentPage} из ${totalPages}`;
    }

    // Clone buttons to remove all old event listeners
    if (prevBtn) {
        const newPrev = prevBtn.cloneNode(true);
        prevBtn.replaceWith(newPrev);
        newPrev.disabled = currentPage <= 1;
        newPrev.addEventListener('click', () => {
            if (pagination[section].page > 1) {
                pagination[section].page--;
                dataLoaded[section] = false;
                loadSectionData(section);
            }
        });
    }

    if (nextBtn) {
        const newNext = nextBtn.cloneNode(true);
        nextBtn.replaceWith(newNext);
        newNext.disabled = currentPage >= totalPages;
        newNext.addEventListener('click', () => {
            const tp = Math.max(1, Math.ceil((pagination[section].total || 0) / pagination[section].limit));
            if (pagination[section].page < tp) {
                pagination[section].page++;
                dataLoaded[section] = false;
                loadSectionData(section);
            }
        });
    }
}
```

- [x] **Step 2: Verify**

1. Open admin.html, login, go to buildings
2. Click "Следующая" — page 2 loads
3. Click "Предыдущая" — page 1 loads
4. Repeat 5 times rapidly — each click should trigger exactly ONE load, not multiple
5. Check browser DevTools Network tab — each click produces exactly one /api/buildings request

- [x] **Step 3: Commit**

```bash
git add public/admin.js
git commit -m "fix(admin): prevent pagination event listener leak via button cloning"
```

---

## Task 7: Unify form design — apply consistent layout to all sections (P1)

**Context:** Buildings form uses well-designed `horizontal-form` with labels, grid layout, and sections. Controllers, water sources, and heat sources use raw `<form>` with inline inputs, no labels, and placeholders only. Three different visual styles on one page.

**Files:**
- Modify: `admin.html` — restructure controller, water-source, and heat-source forms
- Modify: `css/admin.css` — ensure `.horizontal-form` styles apply

- [x] **Step 1: Restructure controller form**

In `admin.html`, replace the controller form (lines ~1053-1065):

```html
<h2>Добавить контроллер</h2>
<div class="form-wrapper">
    <form id="add-controller-form" class="horizontal-form">
        <div class="form-grid">
            <div class="form-group">
                <label for="controller-serial">Серийный номер *</label>
                <input type="text" id="controller-serial" placeholder="Серийный номер" required>
            </div>
            <div class="form-group">
                <label for="controller-vendor">Производитель</label>
                <input type="text" id="controller-vendor" placeholder="Производитель">
            </div>
            <div class="form-group">
                <label for="controller-model">Модель</label>
                <input type="text" id="controller-model" placeholder="Модель">
            </div>
            <div class="form-group">
                <label for="controller-building-id">ID здания *</label>
                <input type="number" id="controller-building-id" placeholder="ID здания" required>
            </div>
            <div class="form-group">
                <label for="controller-status">Статус</label>
                <select id="controller-status">
                    <option value="online">В сети</option>
                    <option value="offline">Не в сети</option>
                    <option value="maintenance">Обслуживание</option>
                </select>
            </div>
        </div>
        <button type="submit" class="submit-btn">✅ Добавить контроллер</button>
    </form>
</div>
```

- [x] **Step 2: Restructure water source form — remove manual ID input**

In `admin.html`, replace the water source form (lines ~1440-1463). Remove the `water-source-id` field (ID is auto-generated by backend):

```html
<h2>Добавить источник воды</h2>
<div class="form-wrapper">
    <form id="add-water-source-form" class="horizontal-form">
        <div class="form-grid">
            <div class="form-group">
                <label for="water-source-name">Название *</label>
                <input type="text" id="water-source-name" placeholder="Название" required>
            </div>
            <div class="form-group">
                <label for="water-source-address">Адрес *</label>
                <input type="text" id="water-source-address" placeholder="Адрес" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="water-source-latitude">Широта *</label>
                    <input type="number" step="0.000001" id="water-source-latitude" placeholder="Широта" required min="-90" max="90">
                </div>
                <div class="form-group">
                    <label for="water-source-longitude">Долгота *</label>
                    <input type="number" step="0.000001" id="water-source-longitude" placeholder="Долгота" required min="-180" max="180">
                </div>
            </div>
            <div class="form-group">
                <label for="water-source-type">Тип *</label>
                <select id="water-source-type" required>
                    <option value="">Выберите тип</option>
                    <option value="pumping_station">Насосная станция</option>
                    <option value="well">Скважина</option>
                    <option value="reservoir">Резервуар</option>
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="water-source-capacity">Производительность (м³/ч)</label>
                    <input type="number" step="0.1" id="water-source-capacity" placeholder="Производительность">
                </div>
                <div class="form-group">
                    <label for="water-source-pressure">Давление (бар)</label>
                    <input type="number" step="0.1" id="water-source-pressure" placeholder="Давление">
                </div>
            </div>
            <div class="form-group">
                <label for="water-source-contact">Контакт для обслуживания</label>
                <input type="text" id="water-source-contact" placeholder="Контакт">
            </div>
            <div class="form-group">
                <label for="water-source-notes">Примечания</label>
                <textarea id="water-source-notes" placeholder="Примечания"></textarea>
            </div>
            <div class="form-group">
                <label for="water-source-status">Статус</label>
                <select id="water-source-status">
                    <option value="active">Активный</option>
                    <option value="inactive">Неактивный</option>
                    <option value="maintenance">На обслуживании</option>
                </select>
            </div>
        </div>
        <button type="submit" class="submit-btn">✅ Добавить источник воды</button>
    </form>
</div>
```

- [x] **Step 3: Restructure heat source form — remove manual ID input**

Apply the same pattern to the heat source form. Remove `heat-source-id` field. Add labels to all fields. Wrap in `.horizontal-form` with `.form-grid`.

- [x] **Step 4: Update admin.js water source submit handler**

In `public/admin.js`, find the water source form submit handler. Remove the line that reads `water-source-id` field value. The backend auto-generates the ID.

- [x] **Step 5: Update admin.js heat source submit handler**

Same as Step 4 — remove manual ID reading for heat sources.

- [x] **Step 6: Verify**

1. Open admin.html, login
2. Navigate to each section (Controllers, Water Sources, Heat Sources)
3. Each form should have labels, consistent grid layout, matching the buildings form style
4. Submit a test controller — should work without manual ID
5. Submit a test water source — should work without manual ID field

- [x] **Step 7: Commit**

```bash
git add admin.html public/admin.js css/admin.css
git commit -m "feat(admin): unify all forms to consistent horizontal-form layout with labels"
```

---

## Task 8: Improve modal dialogs — Escape, overlay click, focus trap (P1)

**Context:** Modal dialogs (edit building, edit water source, etc.) can only be closed via Cancel button. No Escape key support, no click-outside-to-close, no focus trapping.

**Files:**
- Modify: `public/admin.js` — add global modal management
- Modify: `admin.html` — add `data-modal` attributes to overlay elements

- [x] **Step 1: Add modal utility functions at top of admin.js**

After the variable declarations at the top of admin.js (after line ~50), add:

```javascript
// ===============================================
// MODAL UTILITIES
// ===============================================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'flex';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Focus first input
    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') closeModal(modalId);
    };
    document.addEventListener('keydown', escHandler);
    modal._escHandler = escHandler;

    // Close on overlay click (not content click)
    // Do NOT use { once: true } — it breaks after any click inside the form
    const clickHandler = (e) => {
        if (e.target === modal) closeModal(modalId);
    };
    modal.addEventListener('click', clickHandler);
    modal._clickHandler = clickHandler;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'none';

    if (modal._escHandler) {
        document.removeEventListener('keydown', modal._escHandler);
        delete modal._escHandler;
    }
    if (modal._clickHandler) {
        modal.removeEventListener('click', modal._clickHandler);
        delete modal._clickHandler;
    }
}
```

- [x] **Step 2: Update existing modal open/close calls**

Search `admin.js` for all `.style.display = 'flex'` and `.style.display = 'none'` calls on overlay elements. Replace with `openModal('overlay-id')` and `closeModal('overlay-id')`.

Common modal IDs to update (actual HTML IDs use `-modal` suffix, NOT `-overlay`):
- `edit-building-modal`
- `edit-transformer-modal`
- `edit-water-source-modal`
- `edit-heat-source-modal`
- `edit-line-modal`

- [x] **Step 3: Verify**

1. Click Edit on any building — modal opens, focus is on first field
2. Press Escape — modal closes
3. Open modal again, click dark overlay area — modal closes
4. Open modal, click inside form — modal stays open
5. Repeat for other entity edit modals

- [x] **Step 4: Commit**

```bash
git add public/admin.js
git commit -m "feat(admin): add Escape, overlay-click-close, and focus management to modals"
```

---

## Task 9: Add ARIA attributes for accessibility (P1)

**Context:** No ARIA roles on navigation tabs, modals, sortable headers, or toast notifications. Screen readers cannot interpret the interface correctly.

**Files:**
- Modify: `admin.html` — add ARIA attributes to nav, tables, modals

- [x] **Step 1: Add tablist/tab/tabpanel roles to navigation**

In `admin.html`, update the navigation (line ~783):

```html
<nav class="admin-nav" role="tablist" aria-label="Разделы администрирования">
    <button class="nav-btn active" data-section="buildings" role="tab" aria-selected="true" aria-controls="buildings-section">Здания</button>
    <button class="nav-btn" data-section="controllers" role="tab" aria-selected="false" aria-controls="controllers-section">Контроллеры</button>
    <button class="nav-btn" data-section="transformers" role="tab" aria-selected="false" aria-controls="transformers-section">Трансформаторы</button>
    <button class="nav-btn" data-section="lines" role="tab" aria-selected="false" aria-controls="lines-section">Линии</button>
    <button class="nav-btn" data-section="water-lines" role="tab" aria-selected="false" aria-controls="water-lines-section">Линии ХВС/ГВС</button>
    <button class="nav-btn" data-section="water-sources" role="tab" aria-selected="false" aria-controls="water-sources-section">Источники воды</button>
    <button class="nav-btn" data-section="heat-sources" role="tab" aria-selected="false" aria-controls="heat-sources-section">Источники тепла</button>
    <button class="nav-btn" data-section="metrics" role="tab" aria-selected="false" aria-controls="metrics-section">Метрики</button>
</nav>
```

- [x] **Step 2: Add tabpanel role to sections**

Add `role="tabpanel"` to each `<section>`:

```html
<section id="buildings-section" class="admin-section active" role="tabpanel" aria-label="Здания">
```

Note: Use `aria-label` (not `aria-labelledby`) since tab buttons don't have `id` attributes.

- [x] **Step 3: Update admin.js tab switching to toggle aria-selected**

In the tab switching handler in `admin.js`, add:

```javascript
// When switching tabs, update aria-selected
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.setAttribute('aria-selected', btn === activeBtn ? 'true' : 'false');
});
```

- [x] **Step 4: Add aria-label to header checkboxes**

```html
<th><input type="checkbox" id="buildings-select-all-checkbox" aria-label="Выбрать все здания"></th>
```

Apply to all section checkboxes.

- [x] **Step 5: Add aria-live to toast container**

In admin.js, where the toast container is created, add:

```javascript
toastContainer.setAttribute('aria-live', 'polite');
toastContainer.setAttribute('role', 'status');
```

- [x] **Step 6: Add keyboard support for sortable headers**

In admin.js, after the sortable click handler, add keyboard support:

```javascript
document.querySelectorAll('.sortable').forEach(th => {
    th.setAttribute('tabindex', '0');
    th.setAttribute('role', 'button');
    th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            th.click();
        }
    });
});
```

- [x] **Step 7: Verify**

1. Tab through the page using keyboard — nav buttons, sortable headers, checkboxes are all reachable
2. Press Enter/Space on sortable header — sorting works
3. Screen reader (VoiceOver on Mac) announces tab roles correctly

- [x] **Step 8: Commit**

```bash
git add admin.html public/admin.js
git commit -m "feat(admin): add ARIA roles for tabs, modals, sortable headers, and toasts"
```

---

## Task 10: Visual nav grouping with separators (P2)

**Context:** 8 flat navigation buttons without logical grouping. Users must scan all tabs to find infrastructure-related sections.

**Files:**
- Modify: `admin.html:783-792` — add visual separators
- Modify: `css/admin.css` — separator styles

- [x] **Step 1: Add separator spans between tab groups**

```html
<nav class="admin-nav" role="tablist" aria-label="Разделы администрирования">
    <!-- Основные объекты -->
    <button class="nav-btn active" data-section="buildings" role="tab">Здания</button>
    <button class="nav-btn" data-section="controllers" role="tab">Контроллеры</button>
    <button class="nav-btn" data-section="metrics" role="tab">Метрики</button>

    <span class="nav-separator" aria-hidden="true">|</span>

    <!-- Электроинфраструктура -->
    <button class="nav-btn" data-section="transformers" role="tab">Трансформаторы</button>
    <button class="nav-btn" data-section="lines" role="tab">Линии</button>

    <span class="nav-separator" aria-hidden="true">|</span>

    <!-- Водоснабжение -->
    <button class="nav-btn" data-section="water-lines" role="tab">Линии ХВС/ГВС</button>
    <button class="nav-btn" data-section="water-sources" role="tab">Источники воды</button>
    <button class="nav-btn" data-section="heat-sources" role="tab">Источники тепла</button>
</nav>
```

Note: Метрики moved next to Контроллеры (logically related). Separators divide into 3 groups.

- [x] **Step 2: Add separator CSS**

```css
.nav-separator {
    color: #ccc;
    font-size: 1.2rem;
    margin: 0 4px;
    user-select: none;
    align-self: center;
}

@media (max-width: 768px) {
    .nav-separator {
        display: none; /* Hide separators on mobile */
    }

    .admin-nav {
        overflow-x: auto;
        flex-wrap: nowrap;
        -webkit-overflow-scrolling: touch;
    }

    .nav-btn {
        flex-shrink: 0;
        white-space: nowrap;
    }
}
```

- [x] **Step 3: Verify**

1. Desktop: 3 visually distinct groups separated by `|`
2. Mobile: horizontal scroll, no separators, tabs don't wrap vertically

- [x] **Step 4: Commit**

```bash
git add admin.html css/admin.css
git commit -m "feat(admin): group navigation tabs with separators and horizontal scroll on mobile"
```

---

## Verification Checklist

After all tasks:

- [x] `npm test` — all 180 tests pass
- [x] Docker containers rebuilt and running
- [x] Admin panel: login → data loads immediately (no 401 race)
- [x] Admin panel: content hidden behind login overlay
- [x] Buildings table: clean single-row format with expandable details
- [x] All tables: horizontal scroll on narrow screens
- [x] All text in Russian (no English remnants)
- [x] Pagination: no listener leak, correct "Страница X из Y"
- [x] All forms: consistent layout with labels
- [x] Modals: close on Escape and overlay click
- [x] Keyboard navigation works for tabs and sortable headers
- [x] Nav tabs grouped logically with separators
