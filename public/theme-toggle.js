// [P1-3] Extracted from inline <script> in about.html and
// documentation.html so the production CSP can drop 'unsafe-inline'
// from script-src.
//
// Persists user's light/dark choice in localStorage under `theme`,
// applies it on page load, and toggles when the user clicks the
// #theme-toggle button. The .dark class on <html> is what the
// stylesheet keys off.

(function () {
    'use strict';

    const html = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const sun = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');

    function apply(theme) {
        if (theme === 'dark') {
            html.classList.add('dark');
            if (sun) sun.style.display = 'block';
            if (moon) moon.style.display = 'none';
        } else {
            html.classList.remove('dark');
            if (sun) sun.style.display = 'none';
            if (moon) moon.style.display = 'block';
        }
    }

    apply(localStorage.getItem('theme') || 'light');

    if (toggle) {
        toggle.addEventListener('click', function () {
            const next = html.classList.contains('dark') ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            apply(next);
        });
    }
}());
