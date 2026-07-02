/**
 * [R2-10] Section-id helpers for the admin panel.
 *
 * The admin UI historically uses TWO keyings for the same logical "section":
 *   • camelCase STATE keys  — pagination/filters/sorting/dataLoaded/selectedItems
 *     use `waterSources` / `heatSources` (but `water-lines`, oddly, is kebab).
 *   • kebab DOM ids         — the nav `data-section`, section element ids
 *     (`water-sources-section`), the `loadSectionData` switch cases and the
 *     bulk-op endpoint maps all use `water-sources` / `heat-sources`.
 *
 * Single-word sections (buildings/controllers/…) collapse both forms, which is
 * why only the two multi-word camelCase outliers silently broke: building a DOM
 * selector like `#waterSources-section` finds nothing, so water/heat checkboxes,
 * bulk-delete and pagination buttons never wired up.
 *
 * `toDomId` converts whatever a caller holds (camelCase state key or an already
 * kebab id) into the canonical kebab DOM id. `bulkDeleteEndpoint` maps a section
 * to its REST base path — and corrects the water-sources route, which pointed at
 * the nonexistent `/api/water-sources` instead of `/api/cold-water-sources`.
 *
 * Exposed both as a browser global (esbuild bundle:false keeps it global) and as
 * a CommonJS module for jsdom/node unit tests.
 */
(function (root) {
    'use strict';

    /**
     * Normalize a section identifier to its kebab-case DOM/section id.
     * camelCase → kebab (`waterSources` → `water-sources`); already-kebab and
     * single-word ids pass through unchanged (`water-lines`, `buildings`).
     * @param {string} section
     * @returns {string}
     */
    function toDomId(section) {
        return String(section == null ? '' : section)
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .toLowerCase();
    }

    // REST base path per section, keyed by canonical kebab DOM id.
    const BULK_DELETE_ENDPOINTS = {
        'buildings': '/api/buildings',
        'controllers': '/api/controllers',
        'transformers': '/api/transformers',
        'lines': '/api/lines',
        'water-lines': '/api/water-lines',
        // [R2-10b] real route is /api/cold-water-sources; /api/water-sources 404s.
        'water-sources': '/api/cold-water-sources',
        'heat-sources': '/api/heat-sources',
        'metrics': '/api/metrics',
    };

    /**
     * REST base path for bulk-delete of a section, or null when unsupported.
     * Accepts either keying (camelCase state key or kebab DOM id).
     * @param {string} section
     * @returns {string|null}
     */
    function bulkDeleteEndpoint(section) {
        return BULK_DELETE_ENDPOINTS[toDomId(section)] || null;
    }

    const api = { toDomId, bulkDeleteEndpoint, BULK_DELETE_ENDPOINTS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.SectionId = api;
    }
})(typeof window !== 'undefined' ? window : this);
