# Runbook — Phase 12A.1: JWT secret rotation + git history scrub

**Status:** DEFERRED — requires explicit owner sign-off and team coordination.
**Findings addressed:** SEC-NEW-001 (CRITICAL), SEC-NEW-006 (MEDIUM).

## Why this exists as a separate runbook

The audit verified that real JWT production secrets sat in git history at
commit `623a059` (file `.env.prod`) and a development `.env` with
`DB_PASSWORD=postgres` at commit `7a68504`. The remote is the public GitHub
repository `github.com/a-afanasyev/infrasafe`, so:

1. Anyone who cloned the repo (including search-indexers and historical
   forks) already has the secrets.
2. Rotation is mandatory and independent of whether history is scrubbed.
3. History scrub (`git filter-repo`) requires a coordinated force-push.
   Every team member's local clone breaks and must be re-cloned; every
   CI pipeline needs a cache flush; every GitHub clone-count becomes a
   permanent copy of the old history.

For these reasons, 12A.1 is **not** automated from the normal Phase 12 run.
Follow this runbook when ready.

## Pre-flight

```bash
# 1. Confirm the secrets are really in history
git show 623a059:.env.prod | grep -E '^(JWT_SECRET|JWT_REFRESH_SECRET)='
git show 7a685040:.env      | grep -E '^DB_PASSWORD='

# 2. Install git-filter-repo (Homebrew or pip)
brew install git-filter-repo    # macOS
# or
pip install git-filter-repo

# 3. Make a full mirror backup OUTSIDE the working tree
cd ..
git clone --mirror ./Infrasafe ./Infrasafe-backup-$(date +%Y%m%d).git
cd ./Infrasafe
```

If `Infrasafe-backup-YYYYMMDD.git` does not exist after step 3, stop.

## Rotation (must happen first — independent of history scrub)

```bash
# New 512-bit random secrets
NEW_JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
NEW_JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')

# Write them into the production secret store / env manager. Never commit.
```

Then, on the production database:

```sql
TRUNCATE token_blacklist;        -- old blacklist entries reference old secrets
DELETE FROM account_lockout;     -- optional: reset lockout state too
```

Restart every running instance of the app. All existing access tokens and
refresh tokens become invalid; clients must re-login. Verify with:

```bash
curl -s -X POST https://<prod>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<current-admin-password>"}'
# expect 200 + new access_token / refresh_token
```

If rotation succeeds, SEC-NEW-001 is fully mitigated at the attack level —
the secrets in the public repo are now useless. History scrub below is
optional hygiene.

## History scrub (optional — plan team coordination)

**Before running**, notify every contributor:

> After we force-push, re-clone the repo. Do not fetch into your existing
> clone. Any unpushed local commits need to be exported as patches first
> (`git format-patch main..HEAD`) and re-applied against the scrubbed
> history.

Then:

```bash
# Warning: this rewrites every commit that touched .env.prod or .env.
# Review the list first.
git filter-repo --invert-paths --path .env.prod --path .env --dry-run
# If the dry-run looks right:
git filter-repo --invert-paths --path .env.prod --path .env

# The remote ref is dropped by filter-repo; add it back.
git remote add origin https://github.com/a-afanasyev/infrasafe.git

# Force-push every branch and tag.
git push --force --all origin
git push --force --tags origin
```

After the force-push:

```bash
# Verify the secrets are gone from history.
git log --all --full-history -- .env.prod .env
# expect: no output

# Optional: install a secret-scanner so this does not recur.
#   - git-secrets (pre-commit hook)
#   - trufflehog filesystem . --only-verified
```

## Prevent recurrence

1. `.env*` is already ignored in `.gitignore` (exception: `.env.example`).
2. Add a pre-commit hook (husky or native) that runs a secret scanner.
3. Enable GitHub secret scanning on the repository.
4. Document in `CONTRIBUTING.md` that real secrets never enter the tree,
   only via secret managers / CI variables.

## Rollback

Restore from `Infrasafe-backup-YYYYMMDD.git`:

```bash
cd ..
rm -rf Infrasafe
git clone Infrasafe-backup-YYYYMMDD.git Infrasafe
cd Infrasafe
git remote set-url origin https://github.com/a-afanasyev/infrasafe.git
git push --force --all origin
git push --force --tags origin
```

Rotation itself cannot be rolled back — new secrets stay in place.

## Acceptance

- [ ] Production `JWT_SECRET` and `JWT_REFRESH_SECRET` rotated.
- [ ] `token_blacklist` truncated; all clients forced to re-login.
- [ ] Smoke test: login with admin → receive tokens → authenticated request succeeds.
- [ ] (Optional) `git filter-repo` run; `git log --all` no longer references
      `.env.prod` or `.env`.
- [ ] (Optional) Secret scanner installed in pre-commit and/or CI.
- [ ] This runbook linked from `docs/audit-implementation-plan.md` Phase 12A.1.
