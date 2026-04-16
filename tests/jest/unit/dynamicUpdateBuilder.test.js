const { buildUpdateQuery } = require('../../../src/utils/dynamicUpdateBuilder');

const norm = s => s.replace(/\s+/g, ' ').trim();

describe('dynamicUpdateBuilder — buildUpdateQuery', () => {
    test('only allow-listed fields are written to SET', () => {
        const { query, params } = buildUpdateQuery(
            'transformers',
            'transformer_id',
            42,
            { name: 'T-1', power_kva: 100, hacked: 'DROP TABLE users' },
            ['name', 'power_kva', 'voltage_kv']
        );

        expect(norm(query)).toContain('SET name = $1, power_kva = $2, updated_at = NOW()');
        expect(norm(query)).toContain('WHERE transformer_id = $3');
        expect(params).toEqual(['T-1', 100, 42]);
    });

    test('undefined values are skipped', () => {
        const { query, params } = buildUpdateQuery(
            'buildings',
            'building_id',
            7,
            { name: 'A', town: undefined, region: 'X' },
            ['name', 'town', 'region']
        );

        expect(norm(query)).toContain('SET name = $1, region = $2');
        expect(norm(query)).not.toContain('town');
        expect(params).toEqual(['A', 'X', 7]);
    });

    test('updated_at is always refreshed', () => {
        const { query } = buildUpdateQuery(
            'controllers',
            'controller_id',
            1,
            { status: 'online' },
            ['status']
        );
        expect(norm(query)).toContain('updated_at = NOW()');
    });

    test('returns WHERE pk = $N with id as final param', () => {
        const { query, params } = buildUpdateQuery(
            'water_lines',
            'line_id',
            'uuid-123',
            { status: 'active' },
            ['status']
        );
        expect(norm(query)).toContain('WHERE line_id = $2');
        expect(params[params.length - 1]).toBe('uuid-123');
    });

    test('empty / all-filtered-out fields throws "No valid fields to update"', () => {
        expect(() =>
            buildUpdateQuery('buildings', 'building_id', 1, {}, ['name'])
        ).toThrow(/No valid fields to update/);

        expect(() =>
            buildUpdateQuery('buildings', 'building_id', 1, { notAllowed: 'x' }, ['name'])
        ).toThrow(/No valid fields to update/);

        expect(() =>
            buildUpdateQuery('buildings', 'building_id', 1, { name: undefined }, ['name'])
        ).toThrow(/No valid fields to update/);
    });

    describe('security', () => {
        test('unknown table throws', () => {
            expect(() =>
                buildUpdateQuery('users', 'user_id', 1, { name: 'x' }, ['name'])
            ).toThrow(/unsupported table/);
        });

        test('malformed pkColumn throws', () => {
            expect(() =>
                buildUpdateQuery('buildings', 'building_id; DROP', 1, { name: 'x' }, ['name'])
            ).toThrow(/invalid pkColumn/);
        });

        test('malformed allowed column throws', () => {
            expect(() =>
                buildUpdateQuery('buildings', 'building_id', 1, { x: 1 }, ['x; --'])
            ).toThrow(/invalid allowed column/);
        });

        test('empty allowedFields throws', () => {
            expect(() =>
                buildUpdateQuery('buildings', 'building_id', 1, { name: 'x' }, [])
            ).toThrow(/allowedFields must be a non-empty array/);
        });
    });
});
