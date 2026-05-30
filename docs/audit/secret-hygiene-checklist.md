# Secret hygiene — manual ops & verification checklist

> Standing reference for operators (and AI assistants) doing manual prod checks, rotations, and
> webhook/token testing. Born from the 2026-05-30 security deploy, where an admin password was typed
> inline into a `curl` command and ended up in shell history + a chat transcript (→ had to rotate it).

## The one rule

**Never put a secret in a command's arguments.** Argv is visible in shell history (`~/.zsh_history`,
`~/.bash_history`), in `ps`/`/proc`, in terminal scrollback, and in any chat/AI transcript you paste it into.
This includes passwords, tokens, API keys, webhook secrets, DB passwords, and JWT secrets.

```bash
# ✗ WRONG — password in argv → history + transcript forever
curl ... -d '{"username":"admin","password":"hunter2"}'

# ✓ RIGHT — read silently into a var, reference the var
read -s "PW?password: "        # zsh
read -rsp "password: " PW; echo # bash
# ...then use "$PW", and `unset PW` after.
```

## Shell gotchas that bit us (so you don't repeat them)

- **zsh ≠ bash `read`.** macOS default shell is **zsh**. `read -rsp "prompt"` is *bash*; in zsh `-p`
  means "read from coprocess" → `read: -p: no coprocess`. zsh syntax: `read -s "VAR?prompt"`.
- **Don't paste a `read` line together with later lines.** If you paste a multi-line block whose first
  command is `read`, the following pasted lines get consumed as the *input* to `read` (i.e. your
  password). Run the `read` line by itself, then the rest.
- **Heredocs don't survive `!`/ssh layering or bracketed paste.** Long multi-line heredocs (`<<'PY'`)
  pasted into a terminal — especially through Claude Code's `!` prefix or nested `ssh '...'` — get
  reflowed/mangled (lines wrap, indentation breaks, terminator lost → stuck at `heredoc>`). Prefer
  short single-line commands; if you need a script, write it to a file on the host with `cat > f` in a
  *plain interactive shell*, or transfer it, not via `!`.
- **`$$` in a double-quoted shell string is the PID**, not a Postgres dollar-quote. Inside
  `psql -c "...$$...​"` the shell eats `$$`. Avoid string literals entirely in ad-hoc SQL: query by
  numeric id (`WHERE user_id = 55`) instead of `WHERE username = 'admin'`.

## Generating & placing secrets

- **Generate on the host, never echo the value.** `openssl rand -base64 48` (JWT) / `openssl rand -base64 32`
  (keys ≥32 chars) / alnum DB pw: `openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32`.
- **Write into `.env.prod` via `sed -i` with a `|` delimiter** (base64/hex never contain `|`), and only
  print the resulting *length* to confirm — never the value. Back up first: `cp .env.prod .env.prod.bak.$(date +%Y%m%d-%H%M%S)`.
- **Shared/external secrets** (e.g. UK webhook): have the human paste it on the host via `read -s` or
  edit `.env.prod` directly. Do **not** send it through chat. After: `--force-recreate --no-deps app`.

## Getting a token for a test without leaking it

- **Browser devtools** → Network → the login response → copy `tempToken`/`accessToken`. Then one
  short `curl ... -H "Authorization: Bearer <paste>"`.
- Or login with the password read via `read -s` into `$PW`, post with the body built by
  `python3 -c 'import os,json;print(json.dumps({...,"password":os.environ["PW"]}))'` (password via
  env, never argv).
- Tokens are shorter-lived/lower-impact than passwords, but still treat scoped/temp tokens as secrets.

## Verifying a rotation (patterns we use)

- **Rotated a password/secret?** Prove the **old** value is now rejected (negative test → 401), and
  check the change landed (`password_changed_at` recent; secret length changed). You usually can't
  test the new value yourself — have the human confirm login.
- **Webhook secret?** Sign a dummy body on the host with the secret from `.env.prod` and POST to the
  app: valid sig → not-401 (e.g. 400 payload-rejected), bad sig → 401. (See
  `2026-05-29-security-audit.md` deploy section.)
- **App always healthy after a recreate:** `docker inspect infrasafe-app-1 --format '{{.State.Health.Status}}'`
  and grep logs for `password authentication failed`/`decrypt`/`FATAL`.

## After any manual check that touched a secret

```bash
unset PW HASH TT                      # drop from the env
sed -i '' '/auth\/login/d' ~/.zsh_history   # macOS zsh; scrub the offending lines
# open a NEW terminal — the current session holds history in memory until exit
```
If a secret reached argv/history/a transcript despite this: **rotate it.** Exposure ≠ "probably fine."

## Rotation triggers (rotate, don't rationalize)
A secret was: committed to git (even if later removed — it's in history), typed inline into a command,
pasted into chat/an AI tool, logged in plaintext, or shared over an insecure channel. Any one → rotate.

## InfraSafe-specific notes
- Prod: `infrasafe@95.46.96.105:32323`, `~/infrasafe`, compose `docker-compose.unified.yml`, repo
  bind-mounted to the app container. Secrets live **only** in `.env.prod` (gitignored).
- DB role is `infrasafe_runtime` (self-`ALTER USER` to rotate its password); `POSTGRES_USER=postgres`
  in `.env.prod` is dead config (role doesn't exist) — see `2026-05-30-totp-key-rotation-plan.md` &
  the related memory note.
- `TOTP_ENCRYPTION_KEY` is special: never blind-rotate (breaks enrolled 2FA) — follow
  `2026-05-30-totp-key-rotation-plan.md`.
