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

    test('REVOKE CREATE ON SCHEMA public FROM PUBLIC — belt-and-braces', () => {
        expect(MIGRATION).toMatch(
            /REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i
        );
    });

    test('placeholder password is the literal documented in the operator runbook', () => {
        // Anyone reading the migration must be unable to confuse the
        // placeholder for a real prod password.
        expect(MIGRATION).toMatch(/CHANGE_ME_VIA_OPERATOR_RUNBOOK_DO_NOT_USE_IN_PROD/);
        expect(INIT_MIRROR).toMatch(/CHANGE_ME_VIA_OPERATOR_RUNBOOK_DO_NOT_USE_IN_PROD/);
    });

    test('SECURITY DEFINER alter is wrapped in EXISTS guard (idempotent + safe across migration order)', () => {
        // If a future migration renames the function, the alter no-ops
        // cleanly instead of erroring.
        expect(MIGRATION).toMatch(
            /IF EXISTS[\s\S]*?pg_proc[\s\S]*?refresh_transformer_analytics[\s\S]*?ALTER FUNCTION/i
        );
    });
});
