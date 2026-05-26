// [hotfix 2026-05-27 debug] Earliest probe in admin.html <head>.
// Proves the page is actually reaching script execution (vs being aborted
// mid-navigation by the flip loop). Persists to localStorage so we can
// inspect after navigation.
(function () {
    'use strict';
    try {
        var buf = JSON.parse(localStorage.getItem('flip-trace') || '[]');
        buf.push(Date.now() + ' [admin-head] reached url=' + location.href
            + ' referrer=' + document.referrer);
        if (buf.length > 80) buf.shift();
        localStorage.setItem('flip-trace', JSON.stringify(buf));
    } catch (e) { /* ignore */ }
    console.log('[ADMIN-HEAD]', 'reached url=' + location.href,
        'referrer=' + document.referrer);
}());
