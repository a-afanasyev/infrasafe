// [hotfix 2026-05-27 debug] Probe right before admin-auth.js loads.
(function () {
    try {
        var buf = JSON.parse(localStorage.getItem('flip-trace') || '[]');
        buf.push(Date.now() + ' [admin-body-probe] body reached, about to load admin-auth.js');
        if (buf.length > 80) buf.shift();
        localStorage.setItem('flip-trace', JSON.stringify(buf));
    } catch (e) {}
    console.log('[ADMIN-BODY-PROBE] body reached, about to load admin-auth.js');
}());
