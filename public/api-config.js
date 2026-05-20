// [P1-3] Extracted from inline <script> in index.html so the production
// CSP can drop 'unsafe-inline' from script-src.
//
// Sets the global API base URL and installs lightweight global error
// listeners. The relative "/api" path works because nginx proxies
// /api/* to the app container; in dev the same path works because
// docker-compose.dev.yml also wires nginx in front.

(function () {
    'use strict';

    window.BACKEND_URL = '/api';

    window.addEventListener('error', function (e) {
        // Don't swallow — re-emit to console so devs can see in DevTools.
        // No structured reporting endpoint exists yet; that's a future item.
        console.error('Global error:', e.error, e.message, e.filename, e.lineno);
    });

    window.addEventListener('unhandledrejection', function (e) {
        console.error('Unhandled promise rejection:', e.reason);
    });
}());
