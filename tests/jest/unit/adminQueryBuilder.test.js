// Mock logger first (imported transitively by queryValidation)
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const { buildPaginatedList } = require('../../../src/utils/adminQueryBuilder');

/**
 * Build a fake pool that records every query and returns canned results.
 * First call served by `dataRows`, second by `[{count}]`.
 */
function makePool({ dataRows = [], count = 0 } = {}) {
    const calls = [];
    const pool = {
        query: jest.fn((sql, params) => {
            calls.push({ sql, params });
            // COUNT queries — detect by the leading SELECT COUNT
            if (/^\s*SELECT COUNT/i.test(sql)) {
                return Promise.resolve({ rows: [{ count: String(count) }] });
            }
            return Promise.resolve({ rows: dataRows });
        }),
    };
    return { pool, calls };
}

// Normalize whitespace so we can snapshot-compare SQL across formatting.
const norm = s => s.replace(/\s+/g, ' ').trim();

describe('adminQueryBuilder — buildPaginatedList', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('basic behavior', () => {
        test('no filters, default sort — emits bare SELECT + COUNT', async () => {
            const { pool, calls } = makePool({ dataRows: [{ building_id: 1 }], count: 42 });
            const result = await buildPaginatedList(pool, {
                table: 'buildings',
                entityType: 'buildings',
                defaultSort: 'building_id',
            }, { query: {} });

            expect(result).toEqual({
                data: [{ building_id: 1 }],
                pagination: { total: 42, page: 1, limit: 50, totalPages: 1 },
            });

            expect(calls).toHaveLength(2);
            // the data query (non-COUNT)
            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('SELECT * FROM buildings');
            expect(norm(dataCall.sql)).toContain('ORDER BY building_id ASC');
            expect(norm(dataCall.sql)).toContain('LIMIT $1 OFFSET $2');
            expect(dataCall.params).toEqual([50, 0]);

            const countCall = calls.find(c => /SELECT COUNT/i.test(c.sql));
            expect(norm(countCall.sql)).toContain('FROM buildings');
            expect(countCall.params).toEqual([]);
        });

        test('envelope matches legacy format (data + pagination {total,page,limit,totalPages}) with no extra keys', async () => {
            const { pool } = makePool({ dataRows: [{}], count: 5 });
            const result = await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
            }, { query: { limit: 3 } });

            expect(Object.keys(result).sort()).toEqual(['data', 'pagination']);
            expect(Object.keys(result.pagination).sort())
                .toEqual(['limit', 'page', 'total', 'totalPages']);
            expect(result.pagination.totalPages).toBe(Math.ceil(5 / 3));
        });

        test('pagination parses page/limit from query', async () => {
            const { pool, calls } = makePool({ count: 200 });
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
            }, { query: { page: 3, limit: 20 } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(dataCall.params).toEqual([20, 40]); // limit=20, offset=(3-1)*20
        });
    });

    describe('filters', () => {
        test('exact filter → col = $n with raw value', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                filters: [{ param: 'town', kind: 'exact' }],
            }, { query: { town: 'Tashkent' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('WHERE town = $1');
            expect(dataCall.params.slice(0, -2)).toEqual(['Tashkent']);
        });

        test('like filter → col ILIKE $n wrapped in %...%', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'transformers', entityType: 'transformers',
                filters: [{ param: 'material', column: 'material', kind: 'like' }],
            }, { query: { material: 'copper' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('WHERE material ILIKE $1');
            expect(dataCall.params[0]).toBe('%copper%');
        });

        test('gte + lte with cast:int → numeric parameter', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'transformers', entityType: 'transformers',
                filters: [
                    { param: 'power_min', column: 'power_kva', kind: 'gte', cast: 'int' },
                    { param: 'power_max', column: 'power_kva', kind: 'lte', cast: 'int' },
                ],
            }, { query: { power_min: '100', power_max: '500' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('WHERE power_kva >= $1 AND power_kva <= $2');
            expect(dataCall.params.slice(0, 2)).toEqual([100, 500]);
        });

        test('filter ignored when value is undefined/empty', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                filters: [
                    { param: 'town', kind: 'exact' },
                    { param: 'region', kind: 'exact' },
                ],
            }, { query: { town: 'X', region: '' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('WHERE town = $1');
            expect(norm(dataCall.sql)).not.toContain('region');
        });

        test('invalid kind throws', async () => {
            const { pool } = makePool();
            await expect(buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                filters: [{ param: 'x', kind: 'bogus' }],
            }, { query: { x: 1 } })).rejects.toThrow(/unsupported filter kind/);
        });
    });

    describe('search across columns', () => {
        test('expands to OR ILIKE across all searchColumns', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                searchColumns: ['name', 'address'],
            }, { query: { search: 'main st' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('WHERE (name ILIKE $1 OR address ILIKE $1)');
            expect(dataCall.params[0]).toBe('%main st%');
        });

        test('skips when search is empty string', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                searchColumns: ['name'],
            }, { query: { search: '' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).not.toContain('ILIKE');
        });
    });

    describe('sortAliasMap', () => {
        test('remaps user-visible sort key to real column', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'transformers', entityType: 'transformers',
                sortAliasMap: { id: 'transformer_id' },
            }, { query: { sort: 'id', order: 'desc' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('ORDER BY transformer_id DESC');
        });
    });

    describe('custom SELECT + GROUP BY (WaterLine pattern)', () => {
        test('selectSql replaces FROM; groupBy applied', async () => {
            const { pool, calls } = makePool({ dataRows: [{ line_id: 1 }] });
            const SELECT = `
                wl.*,
                COUNT(DISTINCT b.building_id) AS connected_count
                FROM water_lines wl
                LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id)
            `;
            await buildPaginatedList(pool, {
                table: 'water_lines', entityType: 'water_lines',
                tableAlias: 'wl',
                selectSql: SELECT,
                groupBy: 'GROUP BY wl.line_id',
                searchColumns: ['wl.name'],
                filters: [{ param: 'status', column: 'wl.status', kind: 'exact' }],
                sortAliasMap: {},
            }, { query: { status: 'active' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('wl.*, COUNT(DISTINCT b.building_id)');
            expect(norm(dataCall.sql)).toContain('GROUP BY wl.line_id');
            expect(norm(dataCall.sql)).toContain('WHERE wl.status = $1');
        });
    });

    describe('security', () => {
        test('unknown table throws (defence in depth)', async () => {
            const { pool } = makePool();
            await expect(buildPaginatedList(pool, {
                table: 'DROP_TABLE', entityType: 'buildings',
            }, { query: {} })).rejects.toThrow(/unsupported table/);
        });

        test('filter column with SQL-unlike identifier throws', async () => {
            const { pool } = makePool();
            await expect(buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                filters: [{ param: 'x', column: 'name; DROP TABLE x', kind: 'exact' }],
            }, { query: { x: 1 } })).rejects.toThrow(/invalid filter column/);
        });

        test('searchColumn with SQL-unlike identifier throws', async () => {
            const { pool } = makePool();
            await expect(buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
                searchColumns: ['name; DROP TABLE x'],
            }, { query: { search: 'z' } })).rejects.toThrow(/invalid searchColumn/);
        });

        test('sort value outside whitelist falls back to default (not thrown)', async () => {
            const { pool, calls } = makePool();
            await buildPaginatedList(pool, {
                table: 'buildings', entityType: 'buildings',
            }, { query: { sort: 'passwords; DROP' } });

            const dataCall = calls.find(c => !/SELECT COUNT/i.test(c.sql));
            expect(norm(dataCall.sql)).toContain('ORDER BY building_id ASC');
        });
    });
});
