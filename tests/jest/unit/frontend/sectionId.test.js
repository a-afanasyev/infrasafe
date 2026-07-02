/**
 * @jest-environment node
 *
 * [R2-10] Section-id helpers. The admin panel mixes camelCase state keys
 * (waterSources) with kebab DOM ids (water-sources); single-word sections
 * collapse both forms, so only multi-word camelCase outliers broke. These pure
 * helpers isolate the normalization + the corrected water-sources REST route.
 */

const { toDomId, bulkDeleteEndpoint, BULK_DELETE_ENDPOINTS } = require('../../../../public/utils/sectionId.js');

describe('toDomId', () => {
    test('camelCase → kebab (the outliers that broke)', () => {
        expect(toDomId('waterSources')).toBe('water-sources');
        expect(toDomId('heatSources')).toBe('heat-sources');
    });

    test('already-kebab id passes through unchanged', () => {
        expect(toDomId('water-lines')).toBe('water-lines');
        expect(toDomId('heat-sources')).toBe('heat-sources');
    });

    test('single-word ids pass through unchanged', () => {
        expect(toDomId('buildings')).toBe('buildings');
        expect(toDomId('controllers')).toBe('controllers');
        expect(toDomId('metrics')).toBe('metrics');
        expect(toDomId('lines')).toBe('lines');
    });

    test('is idempotent (kebab of kebab is stable)', () => {
        expect(toDomId(toDomId('waterSources'))).toBe('water-sources');
    });

    test('null/undefined degrade to empty string, not a crash', () => {
        expect(toDomId(null)).toBe('');
        expect(toDomId(undefined)).toBe('');
    });
});

describe('bulkDeleteEndpoint', () => {
    test('water-sources resolves to the REAL /api/cold-water-sources route (R2-10b)', () => {
        expect(bulkDeleteEndpoint('waterSources')).toBe('/api/cold-water-sources');
        expect(bulkDeleteEndpoint('water-sources')).toBe('/api/cold-water-sources');
    });

    test('never resolves to the nonexistent /api/water-sources', () => {
        expect(Object.values(BULK_DELETE_ENDPOINTS)).not.toContain('/api/water-sources');
    });

    test('accepts either keying for every section', () => {
        expect(bulkDeleteEndpoint('heatSources')).toBe('/api/heat-sources');
        expect(bulkDeleteEndpoint('heat-sources')).toBe('/api/heat-sources');
        expect(bulkDeleteEndpoint('water-lines')).toBe('/api/water-lines');
        expect(bulkDeleteEndpoint('buildings')).toBe('/api/buildings');
        expect(bulkDeleteEndpoint('metrics')).toBe('/api/metrics');
    });

    test('unknown section → null (no false endpoint)', () => {
        expect(bulkDeleteEndpoint('nope')).toBeNull();
        expect(bulkDeleteEndpoint('alerts')).toBeNull();
    });
});
