---
name: Frontend Architecture Overview
description: Key findings about InfraSafe frontend architecture, file sizes, patterns, and issues discovered during full UI/UX audit (2026-03-22)
type: project
---

## Frontend File Sizes (as of 2026-03-22)
- admin.html: ~2096 lines (~764 lines inline CSS in <style>)
- public/admin.js: ~3205 lines — all CRUD for 8 entities in one file (grew from ~2400 after UX overhaul)
- public/admin-auth.js: 385 lines — AdminAuth class, monkey-patches window.fetch
- public/admin-coordinate-editor.js — coordinate picker on mini-map
- public/infrastructure-line-editor.js — line editor with map
- public/script.js: ~2484 lines — map interface, monolithic
- css/style.css: 2,420 lines — used ONLY by index/about/contacts, NOT by admin.html
- public/map-layers-control.js: 1,900 lines

## UX Overhaul Status (post-10-task audit)
**Completed (working correctly):**
- lang="ru", .admin-container wrapper, auth flow with admin-auth-ready event
- Full RU localization (all headers, buttons, placeholders)
- Expandable rows for buildings table (detail-grid)
- XSS protection: all innerHTML replaced with DOM API (createSecureTableCell, textContent)
- addEventListener pattern (CSP compliance) -- except 3 leftover inline onclick
- openModal/closeModal: Escape, overlay click, focus first input, aria-modal
- Pagination cloneNode fix for event listener leak
- ARIA: role=tablist/tab/tabpanel, aria-selected, aria-controls, aria-label on checkboxes, aria-live on toast
- Responsive: media query 768px
- Batch operations with progress and confirmation
- Cascading dropdowns (line -> transformer, line -> supplier)
- Universal modal system (openUniversalModal)

**Remaining issues (P0-P1):**
- 3 inline onclick in admin.html (transformer coordinate picker, metrics reset button)
- 4 edit modals without labels (water-source, heat-source, line, controller)
- btn-sm / btn-danger CSS classes undefined -- delete button looks same as edit
- colspan mismatches (water-lines-table: JS says 7, HTML has 11 columns)
- English status labels in universal modal (Online/Offline/Maintenance)
- Dead code: empty function stubs at lines 1753-1759
- Contrast issue: black text on #4CAF50 green buttons
- Toast container overlaps logout button (same position)
- Metrics form uses different design system (metrics-form vs horizontal-form)

## Design System Gap (index.html vs admin.html)
| Aspect | index.html | admin.html |
|--------|-----------|------------|
| Font | Inter (Google Fonts) | Arial (system) |
| Color scheme | CSS variables, dark/light | Hardcoded #4CAF50 green |
| Design | Neomorphism + glassmorphism | Basic green/white tables |
| Header | Logo + nav + auth + theme | Just h1 with emoji |
| CSS | External style.css | Inline 764-line <style> |
| Dark mode | Yes | No |

**Why:** Shapes all improvement priorities -- admin panel is functionally separate from the main app visually.
**How to apply:** Any frontend work must decide: align admin with main design, or accept two design systems.
