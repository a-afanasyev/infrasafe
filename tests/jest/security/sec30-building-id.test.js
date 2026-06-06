/**
 * SEC-30 — building_id must be sanitized before it is interpolated into HTML
 * id="" attributes and the power-analytics fetch() URL in the Leaflet popup.
 *
 * item.building_id can fall back to a free-text building_name, so an unescaped
 * value could break out of an attribute or inject into the URL path. The fix
 * coerces it to a clean integer (safeBuildingId). Content assertions match the
 * existing xss-protection.test.js precedent (script.js has no JS-exec harness).
 */

const fs = require('fs');
const path = require('path');

describe('SEC-30 — building_id sanitized before HTML/URL interpolation', () => {
    const scriptPath = path.join(__dirname, '../../../public/script.js');
    const content = fs.readFileSync(scriptPath, 'utf8');

    test('defines a sanitized safeBuildingId', () => {
        expect(content).toContain('safeBuildingId');
    });

    test('power-analytics fetch URL uses the sanitized id, not raw item.building_id', () => {
        expect(content).toMatch(/power-analytics\/buildings\/\$\{safeBuildingId\}/);
        expect(content).not.toMatch(/power-analytics\/buildings\/\$\{item\.building_id\}/);
    });

    test('power-row element ids no longer interpolate raw item.building_id', () => {
        expect(content).not.toMatch(/id="power-row-\$\{item\.building_id\}"/);
    });
});
