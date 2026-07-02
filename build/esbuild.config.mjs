/**
 * Phase 12B.4 — frontend bundler (PERF-003).
 *
 * Minifies individual public/*.js files to public/dist/*.js while preserving
 * the legacy global-scope pattern (no module wrapping). The HTML files keep
 * the existing load order; switching a <script src> from public/X.js to
 * public/dist/X.js is an opt-in, file-by-file migration.
 *
 * Usage:
 *   npm run build:frontend       (minified, sourcemaps on the side)
 *   npm run build:frontend:watch (re-run on every change)
 */

import { build, context } from 'esbuild';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outdir = path.join(projectRoot, 'public', 'dist');

// Entry points — each file is emitted independently so the existing
// <script src> load order in index.html/admin.html keeps working.
// Keep this list in sync with grep 'src="public/.*\\.js"' index.html admin.html.
const ENTRIES = [
    'public/script.js',
    'public/admin.js',
    'public/admin-auth.js',
    'public/admin-coordinate-editor.js',
    'public/infrastructure-line-editor.js',
    'public/map-layers-control.js',
    'public/utils/domSecurity.js',
    'public/utils/powerUtils.js',
    'public/utils/rateLimiter.js',
    'public/utils/safeJsonParser.js',
    // [Sprint 10 PR-5] UK rules client-side validation bounds
    'public/utils/ukRulesValidation.js',
    // [code-review batch] coordinate-integrity guard (prevents NaN→null wipe)
    'public/utils/coordValidation.js',
    // [UK-URGENCY remnant] UK deep-link builder + reopen-meta passthrough
    'public/utils/ukLinkBuilder.js',
    // [R2-10] section-id normalizer + corrected bulk-delete endpoint map
    'public/utils/sectionId.js',
].map(f => path.join(projectRoot, f));

const sharedOptions = {
    entryPoints: ENTRIES,
    bundle: false,        // preserve globals / no module wrapping
    minify: true,
    sourcemap: true,
    target: ['es2020'],
    outdir,
    outbase: path.join(projectRoot, 'public'),
    logLevel: 'info',
    legalComments: 'none',
};

async function run() {
    // [B-027] Clear the CONTENTS of outdir, not the directory itself.
    // rmSync(outdir) removes public/dist as a whole, which needs write
    // permission on the PARENT (public/). On prod, public/ is owned by a
    // different uid (node:1000) than the container user (nodejs:1001), so the
    // whole-dir remove hit EACCES and forced a root-retry every clean build.
    // Clearing entries inside outdir only needs write on outdir itself (already
    // owned by the app user), so no root is required.
    mkdirSync(outdir, { recursive: true });
    for (const entry of readdirSync(outdir)) {
        rmSync(path.join(outdir, entry), { recursive: true, force: true });
    }

    if (process.argv.includes('--watch')) {
        const ctx = await context(sharedOptions);
        await ctx.watch();
        console.log('[esbuild] watching…');
    } else {
        const result = await build(sharedOptions);
        if (result.errors.length) process.exit(1);
        console.log(`[esbuild] done → public/dist (${ENTRIES.length} files)`);
    }
}

run().catch((err) => {
    console.error('[esbuild] failed:', err);
    process.exit(1);
});
