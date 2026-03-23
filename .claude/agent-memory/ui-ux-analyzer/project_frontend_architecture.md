---
name: Frontend Architecture Overview
description: Key findings about InfraSafe frontend architecture, file sizes, patterns, and issues discovered during full UI/UX audit (2026-03-21)
type: project
---

## Frontend File Sizes (as of 2026-03-21)
- css/style.css: 2,420 lines — well-structured CSS variables, dark/light theme, neomorph design
- public/script.js: 2,484 lines — map interface, monolithic, contains classes: APIClient, IndustrialPushPanel, ToastManager + skeleton loaders
- public/admin.js: 3,160 lines — admin panel, monolithic, all CRUD in one file
- public/map-layers-control.js: 1,900 lines — MapLayersControl class, manages Leaflet layers
- public/admin-auth.js: 383 lines — AdminAuth class, fetch interceptor pattern
- public/analytics/js/analytics.js: 807 lines — Chart.js analytics page
- Total: ~10,771 lines of JS + CSS

## Key Design Patterns Found
- CSS uses CSS custom properties for theming (light/dark), Inter font
- Neomorphism + glassmorphism design language
- admin.html uses lang="en" (bug — should be "ru"), has ALL styles inline (~700 lines of CSS in <style>)
- index.html uses external CSS (style.css), admin.html does NOT use style.css at all
- Two completely separate design systems: index.html (modern) vs admin.html (basic green/white tables)
- admin-auth.js monkey-patches window.fetch for auth headers
- script.js injects ~300 lines of CSS via JS (sidebar, toasts, skeleton styles)

## Critical Accessibility Issues
- All pages use `user-scalable=no, maximum-scale=1.0` — blocks pinch-to-zoom
- admin.html has no ARIA attributes whatsoever
- about.html, contacts.html, documentation.html have no JS — static pages with no active nav indicator

**Why:** This shapes all UI/UX recommendations — the two halves of the app (map vs admin) have zero design consistency.
**How to apply:** Any improvement plan must address the admin.html design gap as a priority.
