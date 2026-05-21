/**
 * [P0-5] Static checks on migration 017 + init mirror.
 *
 * Real apply-and-verify requires a running PostgreSQL — that lives in
 * the E2E suite (which spins docker containers). Here we pin the
 * contract: the migration must contain the privilege fence so a
 * reviewer or future agent can't accidentally weaken it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/017_runtime_role.sql'),
    'utf8'
);
const INIT_MIRROR = fs.readFileSync(
    path.resolve(__dirname, '../../../database/init/09_runtime_role.sql'),
    'utf8'
);

describe('[P0-5] migration 017 — runtime role contract', () => {
    test('CREATE ROLE infrasafe_runtime exists in both files', () => {
        expect(MIGRATION).toMatch(/CREATE ROLE\s+infrasafe_runtime/i);
        expect(INIT_MIRROR).toMatch(/CREATE ROLE\s+infrasafe_runtime/i);
    });

    test('role is created with LOGIN attribute', () => {
        expect(MIGRATION).toMatch(/CREATE ROLE\s+infrasafe_runtime[\s\S]*?\bLOGIN\b/i);
        expect(INIT_MIRROR).toMatch(/CREATE ROLE\s+infrasafe_runtime[\s\S]*?\bLOGIN\b/i);
    });

    test('CREATE ROLE is wrapped in IF NOT EXISTS guard (idempotent)', () => {
        // pg_roles lookup — the canonical idempotency pattern
        expect(MIGRATION).toMatch(/IF NOT EXISTS\s*\(\s*SELECT[\s\S]*?pg_roles[\s\S]*?infrasafe_runtime/i);
    });

    test('no superuser / createdb / createrole attributes on runtime', () => {
        // Belt-and-braces — these would defeat the entire point of P0-5.
        // Comments are allowed to mention them (e.g. in the header
        // describing what infrasafe_app has), so we strip those first
        // and check only executable statements.
        const stripped = MIGRATION
            // remove line-comments
            .replace(/--[^\n]*/g, '')
            // remove block-comments
            .replace(/\/\*[\s\S]*?\*\//g, '');

        // Look for these tokens specifically inside the CREATE ROLE statement
        const createRoleMatch = stripped.match(
            /CREATE ROLE\s+infrasafe_runtime[\s\S]*?;/i
        );
        expect(createRoleMatch).toBeTruthy();
        const createRoleStmt = createRoleMatch[0];

        expect(createRoleStmt).not.toMatch(/\bSUPERUSER\b/i);
        expect(createRoleStmt).not.toMatch(/\bCREATEDB\b/i);
        expect(createRoleStmt).not.toMatch(/\bCREATEROLE\b/i);
        expect(createRoleStmt).not.toMatch(/\bREPLICATION\b/i);
        expect(createRoleStmt).not.toMatch(/\bBYPASSRLS\b/i);
    });

    // [1A-FU-C-L3] Role is NOLOGIN at creation — operator flips it ON
    // atomically with the password.
    test('role is created NOLOGIN (operator runbook flips to LOGIN with password)', () => {
        const createRoleMatch = MIGRATION.match(
            /CREATE ROLE\s+infrasafe_runtime\s+(\w+)/i
        );
        expect(createRoleMatch).toBeTruthy();
        expect(createRoleMatch[1].toUpperCase()).toBe('NOLOGIN');

        const initMatch = INIT_MIRROR.match(
            /CREATE ROLE\s+infrasafe_runtime\s+(\w+)/i
        );
        expect(initMatch).toBeTruthy();
        expect(initMatch[1].toUpperCase()).toBe('NOLOGIN');
    });

    test('no committed PASSWORD literal in executable SQL — eliminates placeholder-credential risk', () => {
        // The old design carried a placeholder password in source.
        // NOLOGIN-first design forbids any PASSWORD literal in executable
        // statements (comments and COMMENT ON text may mention the
        // operator runbook command, which is acceptable documentation).
        function stripCommentsAndStringLiterals(sql) {
            return sql
                .replace(/--[^\n]*/g, '')                  // line comments
                .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
                .replace(/'[^']*'/g, "''");                 // strings (incl COMMENT bodies)
        }
        expect(stripCommentsAndStringLiterals(MIGRATION)).not.toMatch(/\bPASSWORD\b/i);
        expect(stripCommentsAndStringLiterals(INIT_MIRROR)).not.toMatch(/\bPASSWORD\b/i);
    });

    test('GRANT DML (S/I/U/D) on ALL TABLES IN SCHEMA public', () => {
        expect(MIGRATION).toMatch(
            /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE[\s\S]*?ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public[\s\S]*?TO\s+infrasafe_runtime/i
        );
    });

    test('GRANT USAGE on SEQUENCES (nextval) — required for SERIAL columns', () => {
        expect(MIGRATION).toMatch(
            /GRANT\s+USAGE[\s\S]*?ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public[\s\S]*?TO\s+infrasafe_runtime/i
        );
    });

    test('GRANT EXECUTE on FUNCTIONS — required for find_nearest_buildings_to_transformer + refresh_transformer_analytics', () => {
        expect(MIGRATION).toMatch(
            /GRANT\s+EXECUTE[\s\S]*?ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+public[\s\S]*?TO\s+infrasafe_runtime/i
        );
    });

    test('ALTER DEFAULT PRIVILEGES — future objects created by infrasafe_app are auto-granted to runtime', () => {
        // Without this, every new table from a future migration becomes
        // invisible to the runtime user, and we get prod outages.
        expect(MIGRATION).toMatch(
            /ALTER DEFAULT PRIVILEGES\s+FOR ROLE\s+infrasafe_app[\s\S]*?GRANT[\s\S]*?TO\s+infrasafe_runtime/i
        );
    });

    test('refresh_transformer_analytics() is marked SECURITY DEFINER with locked search_path', () => {
        // Allows runtime user to refresh MVs without owning them.
        // search_path lock-down is essential — SECURITY DEFINER with an
        // unconstrained search_path is the classic Postgres privilege-
        // escalation footgun.
        expect(MIGRATION).toMatch(
            /ALTER FUNCTION\s+public\.refresh_transformer_analytics\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET\s+search_path/i
        );
    });

    // [1A-FU-S-L2] Canonical search_path is pg_catalog-first so built-in
    // functions cannot be shadowed by an attacker-controlled schema.
    test('SECURITY DEFINER search_path starts with pg_catalog (canonical)', () => {
        const setMatch = MIGRATION.match(
            /SET\s+search_path\s*=\s*([^;]+?)(?:;|$)/i
        );
        expect(setMatch).toBeTruthy();
        const path = setMatch[1].trim();
        expect(path).toMatch(/^pg_catalog\b/i);
        expect(path).toMatch(/public/i);
        // pg_temp deliberately omitted — function takes no args, no
        // temp-table use case.
        expect(path).not.toMatch(/pg_temp/i);
    });

    // [1A-FU-C-M2] Migration must work on staging / custom-named DBs.
    test('GRANT CONNECT uses current_database() — not a hardcoded DB name', () => {
        expect(MIGRATION).toMatch(
            /EXECUTE\s+format[\s\S]*?GRANT\s+CONNECT\s+ON\s+DATABASE\s+%I[\s\S]*?current_database\(\)/i
        );
        expect(INIT_MIRROR).toMatch(
            /EXECUTE\s+format[\s\S]*?GRANT\s+CONNECT\s+ON\s+DATABASE\s+%I[\s\S]*?current_database\(\)/i
        );
        // Sanity: no leftover hardcoded literal
        expect(MIGRATION).not.toMatch(/GRANT\s+CONNECT\s+ON\s+DATABASE\s+infrasafe\s/i);
    });

    test('REVOKE CREATE ON SCHEMA public FROM PUBLIC — belt-and-braces', () => {
        expect(MIGRATION).toMatch(
            /REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i
        );
    });

    test('SECURITY DEFINER alter is wrapped in EXISTS guard (idempotent + safe across migration order)', () => {
        // If a future migration renames the function, the alter no-ops
        // cleanly instead of erroring.
        expect(MIGRATION).toMatch(
            /IF EXISTS[\s\S]*?pg_proc[\s\S]*?refresh_transformer_analytics[\s\S]*?ALTER FUNCTION/i
        );
    });

    // [1A-FU2-DB-H2] sequence grant must not include UPDATE — setval() lets
    // a compromised runtime role rewind / fast-forward a PK sequence and
    // produce duplicate primary keys.
    test('SEQUENCES grant — no UPDATE (setval) privilege', () => {
        function stripComments(sql) {
            return sql
                .replace(/--[^\n]*/g, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');
        }
        // Split into individual statements so a regex on one cannot bleed
        // into another (TABLES grant uses UPDATE; SEQUENCES grant must not).
        function seqStatements(sql) {
            return stripComments(sql)
                .split(';')
                .map(s => s.trim())
                .filter(s => /\bON\s+(?:ALL\s+)?SEQUENCES\b/i.test(s));
        }
        const migStmts = seqStatements(MIGRATION);
        const initStmts = seqStatements(INIT_MIRROR);
        // We expect at least: direct grant + ALTER DEFAULT PRIVILEGES grant
        expect(migStmts.length).toBeGreaterThanOrEqual(2);
        expect(initStmts.length).toBeGreaterThanOrEqual(2);
        for (const stmt of migStmts) {
            expect(stmt).not.toMatch(/\bUPDATE\b/i);
        }
        for (const stmt of initStmts) {
            expect(stmt).not.toMatch(/\bUPDATE\b/i);
        }
    });

    // [1A-FU2-DB-H1] No ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE on FUNCTIONS.
    // Existing functions get EXECUTE via the snapshot grant; future ones must
    // be granted explicitly per-migration so a stray SECURITY DEFINER cannot
    // auto-leak elevated rights.
    test('No ALTER DEFAULT PRIVILEGES GRANT EXECUTE on FUNCTIONS', () => {
        // Strip line + block comments and string literals so the assertion
        // doesn't match the explanatory comment that mentions the pattern.
        function stripCommentsAndStringLiterals(sql) {
            return sql
                .replace(/--[^\n]*/g, '')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/'[^']*'/g, "''");
        }
        const migrationStripped = stripCommentsAndStringLiterals(MIGRATION);
        const initStripped = stripCommentsAndStringLiterals(INIT_MIRROR);
        expect(migrationStripped).not.toMatch(
            /ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?GRANT\s+EXECUTE[\s\S]*?ON\s+FUNCTIONS/i
        );
        expect(initStripped).not.toMatch(
            /ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?GRANT\s+EXECUTE[\s\S]*?ON\s+FUNCTIONS/i
        );
    });
});
