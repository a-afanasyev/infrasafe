# Deploy scripts audit — 2026-05-21 (P0-4 sanitization pass)

## Scope

Audit of all untracked `*.sh` scripts in the project root for unsafe git
operations that could accidentally publish `.env.prod` (or other
secret-bearing files) to the remote.

## Methodology

```bash
# Unsafe `git add` patterns
grep -nE "git add\s+(-A|--all|\.|\*)" *.sh

# Any `git add` usage at all
grep -nE "git\s+add" *.sh

# Hardcoded secret-like assignments
grep -nE "PASSWORD\s*=|SECRET\s*=|TOKEN\s*=" *.sh \
  | grep -vE "^\s*#|\$\{|\$[A-Z_]+|read -|prompt|echo"
```

## Findings

### ✅ No unsafe `git add` patterns

The patterns that the audit was looking for —

| Pattern | Risk |
| --- | --- |
| `git add -A` | stages ALL changes incl. untracked files (.env, etc) |
| `git add --all` | same as -A |
| `git add .` | stages all current-dir files |
| `git add *` | shell-glob; stages everything visible to shell |

— **do not appear in any of the 22 `.sh` files** in the project root.

The only `git add` reference is in `prepare-for-publication.sh:275`, inside
an `echo` (it prints instructions to a user, it does not execute).

### ⚠️ `fix-git-and-redeploy.sh:67` — `git stash push --include-untracked`

```bash
git stash push --include-untracked -m "deploy-fix-$TS" || true
```

This stashes secrets-bearing untracked files (like `.env.prod`) into the
local stash and pops them back after the pull. Stashes are local-only;
they never reach the remote. **Not a secret-leak path.** Leaving as-is.

### ⚠️ `backup-database.sh:18` — hardcoded `DB_PASSWORD="postgres"`

This is the issue tracked separately as [P1-V5]. Addressed in the
`fix/p0-7-backup-cron` branch (renames hard-coded creds to
`${DB_USER:-postgres}` / `${DB_PASSWORD:?}`).

### Other scripts using git

All other git invocations are reads or fast-forward-only updates:

| File | Lines | Operation |
| --- | --- | --- |
| `deploy.sh` | 126–128 | `git fetch / git checkout main / git pull --ff-only` |
| `deploy-nosudo.sh` | 68–70, 95–97 | `git rev-parse / branch / status / fetch / pull --ff-only` |
| `fix-git-and-redeploy.sh` | 50, 64, 67, 70–71, 74 | `git checkout -- file / status / stash / fetch / pull --ff-only / log` |
| `update-production.sh` | 41, 45 | `git stash / git pull` |

None of these write to the remote.

## Conclusion

**P0-4 (sanitization aspect) is closed without code changes.** The
backlog's stated concern — accidental `git add -A` in deploy scripts —
is not present in any current script.

The deploy-scripts proliferation remains a real concern (tracked as
[P1-V6] — 11 untracked scripts to consolidate into one canonical
deploy.sh or Ansible playbook), but that's a Sprint 1+ item, not a
Sprint 0 hotfix.

The **secret rotation** half of P0-4 is handled separately — see
[secret-rotation-2026-05-21.md](./secret-rotation-2026-05-21.md) for
the operator runbook.

## Recommendation

Before this round of work merges to `main`, audit the working tree of
the prod host (95.46.96.105:32323) one more time:

```bash
ssh infrasafe@95.46.96.105 -p 32323 \
  'cd ~/infrasafe && grep -nE "git add\s+(-A|--all|\.|\*)" *.sh'
```

If the prod host has additional scripts not in this repo (likely,
given the untracked-by-design nature of these), repeat the audit
there.
