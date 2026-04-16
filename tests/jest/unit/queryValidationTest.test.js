jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Phase 9.2 (YAGNI-004): buildSecureQuery removed — no production callers
// and the implementation was broken (params.length on a plain object).
const {
    validateSortOrder,
    validatePagination,
    validateSearchString,
    allowedSortColumns,
    allowedOrderDirections,
    defaultSortParams,
} = require('../../../src/utils/queryValidation');

describe('queryValidation', () => {
    describe('validateSortOrder', () => {
        test('returns valid sort and order for known entity and valid column', () => {
            const result = validateSortOrder('buildings', 'name', 'desc');
            expect(result.validSort).toBe('name');
            expect(result.validOrder).toBe('DESC');
        });

        test('uppercases order direction', () => {
            const result = validateSortOrder('buildings', 'name', 'asc');
            expect(result.validOrder).toBe('ASC');
        });

        test('returns default column when sort column is not in whitelist', () => {
            const result = validateSortOrder('buildings', 'DROP TABLE buildings;--', 'ASC');
            expect(result.validSort).toBe('building_id');
            expect(result.validOrder).toBe('ASC');
        });

        test('returns default order when order is invalid', () => {
            const result = validateSortOrder('buildings', 'name', 'INVALID');
            expect(result.validSort).toBe('name');
            expect(result.validOrder).toBe('ASC'); // default for buildings
        });

        test('returns fallback defaults for unknown entity type', () => {
            const result = validateSortOrder('nonexistent', 'id', 'ASC');
            expect(result.validSort).toBe('id');
            expect(result.validOrder).toBe('ASC');
        });

        test('returns default column when sort is null', () => {
            const result = validateSortOrder('metrics', null, null);
            expect(result.validSort).toBe('timestamp');
            expect(result.validOrder).toBe('DESC');
        });

        test('returns default column when sort is undefined', () => {
            const result = validateSortOrder('controllers', undefined, undefined);
            expect(result.validSort).toBe('controller_id');
            expect(result.validOrder).toBe('ASC');
        });

        test('validates sort for alerts entity', () => {
            const result = validateSortOrder('alerts', 'severity', 'DESC');
            expect(result.validSort).toBe('severity');
            expect(result.validOrder).toBe('DESC');
        });

        test('validates sort for transformers entity', () => {
            const result = validateSortOrder('transformers', 'power_kva', 'ASC');
            expect(result.validSort).toBe('power_kva');
            expect(result.validOrder).toBe('ASC');
        });

        test('validates sort for water_lines entity', () => {
            const result = validateSortOrder('water_lines', 'pressure_bar', 'DESC');
            expect(result.validSort).toBe('pressure_bar');
            expect(result.validOrder).toBe('DESC');
        });

        test('validates sort for heat_sources entity', () => {
            const result = validateSortOrder('heat_sources', 'capacity_mw', 'ASC');
            expect(result.validSort).toBe('capacity_mw');
            expect(result.validOrder).toBe('ASC');
        });

        test('rejects SQL injection in sort column', () => {
            const result = validateSortOrder('buildings', "1; DROP TABLE users;--", 'ASC');
            expect(result.validSort).toBe('building_id');
        });

        test('rejects SQL injection in order direction', () => {
            const result = validateSortOrder('buildings', 'name', "ASC; DROP TABLE users;--");
            expect(result.validOrder).toBe('ASC'); // default for buildings
        });
    });

    describe('validatePagination', () => {
        test('returns correct page, limit, and offset', () => {
            const result = validatePagination(2, 20);
            expect(result.pageNum).toBe(2);
            expect(result.limitNum).toBe(20);
            expect(result.offset).toBe(20);
        });

        test('defaults to page 1 for invalid page', () => {
            const result = validatePagination('invalid', 10);
            expect(result.pageNum).toBe(1);
            expect(result.offset).toBe(0);
        });

        test('defaults to limit 50 for invalid limit', () => {
            const result = validatePagination(1, 'invalid');
            expect(result.limitNum).toBe(50);
        });

        test('clamps page to minimum of 1', () => {
            const result = validatePagination(-5, 10);
            expect(result.pageNum).toBe(1);
        });

        test('defaults to 50 when limit is 0 (falsy)', () => {
            // parseInt(0) || 50 = 50 because 0 is falsy
            const result = validatePagination(1, 0);
            expect(result.limitNum).toBe(50);
        });

        test('clamps limit to minimum of 1 for negative values', () => {
            const result = validatePagination(1, -5);
            expect(result.limitNum).toBe(1);
        });

        test('clamps limit to maximum of 200', () => {
            const result = validatePagination(1, 500);
            expect(result.limitNum).toBe(200);
        });

        test('calculates offset correctly for page 3 with limit 25', () => {
            const result = validatePagination(3, 25);
            expect(result.offset).toBe(50); // (3-1) * 25
        });

        test('handles string inputs by parsing them', () => {
            const result = validatePagination('3', '10');
            expect(result.pageNum).toBe(3);
            expect(result.limitNum).toBe(10);
            expect(result.offset).toBe(20);
        });

        test('handles null inputs with defaults', () => {
            const result = validatePagination(null, null);
            expect(result.pageNum).toBe(1);
            expect(result.limitNum).toBe(50);
            expect(result.offset).toBe(0);
        });
    });

    describe('validateSearchString', () => {
        test('returns empty string for null input', () => {
            expect(validateSearchString(null)).toBe('');
        });

        test('returns empty string for undefined input', () => {
            expect(validateSearchString(undefined)).toBe('');
        });

        test('returns empty string for non-string input', () => {
            expect(validateSearchString(123)).toBe('');
        });

        test('preserves special characters (parameterized queries handle SQL safety)', () => {
            expect(validateSearchString("O'zbekiston")).toBe("O'zbekiston");
            expect(validateSearchString("building <A>")).toBe("building <A>");
            expect(validateSearchString("test'; DROP TABLE--")).toBe("test'; DROP TABLE--");
            expect(validateSearchString('script injection')).toBe('script injection');
            expect(validateSearchString('javascript:void(0)')).toBe('javascript:void(0)');
            expect(validateSearchString('onerror=alert(1)')).toBe('onerror=alert(1)');
        });

        test('escapes LIKE wildcard characters', () => {
            expect(validateSearchString('%')).toBe('\\%');
            expect(validateSearchString('_')).toBe('\\_');
            expect(validateSearchString('test%value')).toBe('test\\%value');
            expect(validateSearchString('hello_world')).toBe('hello\\_world');
            expect(validateSearchString('100%')).toBe('100\\%');
        });

        test('escapes backslashes before wildcards', () => {
            expect(validateSearchString('path\\file')).toBe('path\\\\file');
            expect(validateSearchString('50\\%')).toBe('50\\\\\\%');
        });

        test('trims whitespace', () => {
            const result = validateSearchString('  hello  ');
            expect(result).toBe('hello');
        });

        test('truncates string beyond maxLength', () => {
            const longString = 'a'.repeat(150);
            const result = validateSearchString(longString, 100);
            expect(result.length).toBe(100);
        });

        test('uses default maxLength of 100', () => {
            const longString = 'b'.repeat(200);
            const result = validateSearchString(longString);
            expect(result.length).toBe(100);
        });

        test('passes through safe strings unchanged', () => {
            expect(validateSearchString('Hello World')).toBe('Hello World');
        });
    });

    describe('exported constants', () => {
        test('allowedSortColumns has all entity types', () => {
            expect(allowedSortColumns).toHaveProperty('buildings');
            expect(allowedSortColumns).toHaveProperty('controllers');
            expect(allowedSortColumns).toHaveProperty('metrics');
            expect(allowedSortColumns).toHaveProperty('transformers');
            expect(allowedSortColumns).toHaveProperty('lines');
            expect(allowedSortColumns).toHaveProperty('water_lines');
            expect(allowedSortColumns).toHaveProperty('water_sources');
            expect(allowedSortColumns).toHaveProperty('heat_sources');
            expect(allowedSortColumns).toHaveProperty('alerts');
        });

        test('allowedOrderDirections contains ASC and DESC', () => {
            expect(allowedOrderDirections).toEqual(['ASC', 'DESC']);
        });

        test('defaultSortParams has all entity types', () => {
            expect(defaultSortParams).toHaveProperty('buildings');
            expect(defaultSortParams).toHaveProperty('controllers');
            expect(defaultSortParams).toHaveProperty('metrics');
            expect(defaultSortParams.buildings).toEqual({ column: 'building_id', order: 'ASC' });
            expect(defaultSortParams.metrics).toEqual({ column: 'timestamp', order: 'DESC' });
        });
    });
});
