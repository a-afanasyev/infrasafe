// PR-1a (AUD-002): pure discovery/validation logic for the migration runner.
//
// scripts/migrate.sh shells out to this module so the subtle parts — strict
// path validation, _superseded exclusion, deterministic ordering (dup-012),
// content checksums, and the frozen baseline allowlist — live in one place that
// jest can unit-test. The bash side owns psql/docker/git-show/lock plumbing.
//
// CLI (invoked by migrate.sh):
//   git ls-tree -r -z --format='%(objectname) %(path)' <commit> -- database/migrations/ \
//     | node scripts/lib/migrate-discover.js discover
//       → emits ordered "<filename>\t<path>" lines; exit 3 on an unsafe filename.
//   <blob bytes on stdin> | node scripts/lib/migrate-discover.js checksum
//       → emits the sha256 hex of stdin.
//   node scripts/lib/migrate-discover.js validate-baseline   (filenames on stdin, one/line)
//       → exit 0 if all in allowlist; exit 4 + offenders on stderr otherwise.
//   node scripts/lib/migrate-discover.js allowlist
//       → emits the 33 frozen baseline filenames, one per line, in order.

'use strict';

const crypto = require('crypto');

// A valid migration is a DIRECT .sql child of database/migrations/ named
// NNN_<safe-chars>.sql. The restricted charset [A-Za-z0-9._-] means a space,
// quote, or shell metacharacter never matches — such a name is rejected, not
// "supported". Anchoring on `[0-9]{3}_` right after the dir also excludes
// `_superseded/...` (starts with `_`) and any deeper subdirectory (`/` absent
// from the charset).
const MIGRATION_PATH_RE = /^database\/migrations\/[0-9]{3}_[A-Za-z0-9._-]+\.sql$/;

// A direct .sql child of database/migrations/ regardless of charset. Used to
// distinguish "a migration file with an UNSAFE name → abort" from "a file we
// legitimately ignore" (a _superseded/ entry or a non-.sql like README.md).
const DIRECT_SQL_CHILD_RE = /^database\/migrations\/[^/]+\.sql$/;

// Frozen baseline allowlist — the 33 migration filenames (003–034, with the two
// independent 012s) that the production DB was hand-migrated through before the
// runner existed. `baseline` marks ONLY these as applied-without-execution.
// Discovery surfacing any file outside this set means an un-baselined migration
// exists → baseline aborts so it goes through `up` instead.
const BASELINE_ALLOWLIST = Object.freeze([
    '003_power_calculation_v2.sql',
    '004_add_coordinates_and_extended_fields.sql',
    '005_add_paths_to_lines.sql',
    '006_cleanup_infrastructure_lines.sql',
    '007_add_metrics_compound_index.sql',
    '008_remove_duplicate_hot_water.sql',
    '009_token_blacklist_hash_index.sql',
    '010_add_missing_indexes.sql',
    '011_uk_integration.sql',
    '012_fix_materialized_view.sql',
    '012_totp_2fa.sql',
    '013_account_lockout.sql',
    '014_performance_indexes.sql',
    '015_alert_dedup_constraint.sql',
    '016_password_changed_at.sql',
    '017_runtime_role.sql',
    '018_alert_request_map_fk.sql',
    '019_buildings_fk_indexes.sql',
    '020_mv_refresh_definer_wrapper.sql',
    '021_alerts_metric_id_fk.sql',
    '022_uk_outbox.sql',
    '023_alert_request_map_counter_idx.sql',
    '024_alert_rules_extensions.sql',
    '025_alert_verifications.sql',
    '026_alert_suppressions.sql',
    '027_alert_lifecycle_v2.sql',
    '028_drop_alert_types_catalog.sql',
    '029_alert_rule_changes.sql',
    '030_uk_request_url_template.sql',
    '031_b020_backfill_orphaned_verifying.sql',
    '032_uk_urgency_canonical_keys.sql',
    '033_alert_verifications_last_checked.sql',
    '034_alert_verifications_dispatch.sql',
]);

class MigrationDiscoveryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MigrationDiscoveryError';
    }
}

function isValidMigrationPath(path) {
    return MIGRATION_PATH_RE.test(path);
}

function basename(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}

// entries: [{ path, oid? }]. Returns ordered [{ filename, path, oid }] of valid
// migrations. Throws MigrationDiscoveryError if a direct .sql child of the
// migrations dir fails the strict charset (an unsafe name must abort, never be
// silently skipped). Subdirectory entries (_superseded/) and non-.sql files are
// ignored.
function discover(entries) {
    const out = [];
    for (const entry of entries) {
        const path = entry.path;
        if (MIGRATION_PATH_RE.test(path)) {
            out.push({ filename: basename(path), path, oid: entry.oid });
        } else if (DIRECT_SQL_CHILD_RE.test(path)) {
            throw new MigrationDiscoveryError(
                `Unsafe / non-conforming migration filename rejected: ${path}`
            );
        }
        // else: _superseded/* or README.md etc. → ignore
    }
    out.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
    return out;
}

function checksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

// discoveredFilenames: ordered list of filenames found at the baseline target.
// Returns { ok, unknown } — unknown = any not in the frozen allowlist.
function validateBaseline(discoveredFilenames) {
    const allow = new Set(BASELINE_ALLOWLIST);
    const unknown = discoveredFilenames.filter((f) => !allow.has(f));
    return { ok: unknown.length === 0, unknown };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readStdin() {
    const chunks = [];
    return new Promise((resolve, reject) => {
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
        process.stdin.on('error', reject);
    });
}

// Parse NUL-delimited `git ls-tree --format='%(objectname) %(path)'` records.
// NUL-delimited so a pathological filename (newline/space) arrives as one unit
// and is then REJECTED by discover() rather than being word-split upstream.
function parseLsTreeZ(buf) {
    const records = buf.toString('utf8').split('\0').filter((r) => r.length > 0);
    return records.map((rec) => {
        const sp = rec.indexOf(' ');
        if (sp === -1) return { oid: '', path: rec };
        return { oid: rec.slice(0, sp), path: rec.slice(sp + 1) };
    });
}

async function main(argv) {
    const cmd = argv[2];
    switch (cmd) {
        case 'discover': {
            const buf = await readStdin();
            let discovered;
            try {
                discovered = discover(parseLsTreeZ(buf));
            } catch (e) {
                process.stderr.write(`${e.message}\n`);
                return 3;
            }
            process.stdout.write(discovered.map((d) => `${d.filename}\t${d.path}`).join('\n'));
            if (discovered.length) process.stdout.write('\n');
            return 0;
        }
        case 'checksum': {
            const buf = await readStdin();
            process.stdout.write(`${checksum(buf)}\n`);
            return 0;
        }
        case 'validate-baseline': {
            const buf = await readStdin();
            const names = buf.toString('utf8').split('\n').map((s) => s.trim()).filter(Boolean);
            const { ok, unknown } = validateBaseline(names);
            if (!ok) {
                process.stderr.write(
                    `baseline aborted — discovered file(s) outside the frozen allowlist:\n` +
                    unknown.map((u) => `  ${u}`).join('\n') + '\n'
                );
                return 4;
            }
            return 0;
        }
        case 'allowlist': {
            process.stdout.write(BASELINE_ALLOWLIST.join('\n') + '\n');
            return 0;
        }
        default:
            process.stderr.write(
                'usage: migrate-discover.js <discover|checksum|validate-baseline|allowlist>\n'
            );
            return 2;
    }
}

module.exports = {
    isValidMigrationPath,
    discover,
    checksum,
    validateBaseline,
    BASELINE_ALLOWLIST,
    MigrationDiscoveryError,
    MIGRATION_PATH_RE,
};

if (require.main === module) {
    main(process.argv).then((code) => process.exit(code)).catch((e) => {
        process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
        process.exit(1);
    });
}
