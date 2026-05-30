# TOTP_ENCRYPTION_KEY rotation plan (SEC-3)

> Why: `TOTP_ENCRYPTION_KEY` was present in `.env` git history. With repo-history + a DB dump, an
> attacker could derive the AES key and decrypt every admin's TOTP secret → forge 2FA codes.
> Rotating the key closes that for any **future** key+DB exposure.
>
> ⚠️ **Never blind-rotate this key.** `users.totp_secret` is AES-256-GCM ciphertext keyed (via HKDF)
> off `TOTP_ENCRYPTION_KEY`. Change the key without migrating the data and `totpService.decrypt()`
> throws on the GCM auth tag → every enrolled admin fails `verifyCode` → locked out of 2FA
> (and admins **cannot** self-disable 2FA — `totpService.disable()` rejects `role==='admin'`).

## How TOTP is stored (current code)
- `users.totp_secret` — `iv:authTag:ciphertext` (hex), AES-256-GCM. Key = `HKDF-SHA256(TOTP_ENCRYPTION_KEY, salt='infrasafe-totp-v1', info='aes-encryption-key', 32)` (`src/services/totpService.js:47-77`).
- `users.totp_enabled` — boolean gate. `users.recovery_codes` — JSON array of **bcrypt** hashes (NOT encrypted with the TOTP key → **recovery codes keep working after key rotation**).
- Re-enrollment trigger: set `totp_enabled=false` → next login returns `requires2FASetup` + tempToken → admin runs `/auth/setup-2fa` → `/auth/confirm-2fa` (fresh secret encrypted under the new key). `generateSetup` reuses a pending secret only while `totp_secret` set AND `totp_enabled=false`.

---

## Decision: which strategy

| | **A — Re-encrypt (preferred)** | **B — Force re-enrollment** |
|---|---|---|
| Admin impact | **None** — authenticator entries unchanged | Every admin re-scans QR + saves new recovery codes |
| Secrets | Same TOTP secrets, re-wrapped under new key | **Brand-new** TOTP secrets |
| Closes "key was in git" for future DB access | ✅ | ✅ |
| Closes risk if a **past DB dump also leaked** (secrets already exposed) | ❌ (same secret values) | ✅ (fresh secrets) |
| Effort / risk | One-off migration script, both keys present | Coordinate admins; brief setup window |

**Recommendation:** Strategy **A** by default (non-disruptive, closes the key-in-history exposure).
Use Strategy **B** instead *only if* there is reason to believe a DB dump leaked alongside the key
(then the existing secrets are considered compromised and must be regenerated). Admin count is small,
so either is feasible.

---

## Strategy A — re-encryption migration

One-off Node script (run on the host, with OLD + NEW keys in env; never commit the keys):

```js
// scripts/rotate-totp-key.js — run with BOTH keys present. Dry-run unless --commit.
//   TOTP_OLD_KEY=<current> TOTP_NEW_KEY=<new> node scripts/rotate-totp-key.js          # dry-run
//   TOTP_OLD_KEY=<current> TOTP_NEW_KEY=<new> node scripts/rotate-totp-key.js --commit  # write
const crypto = require('crypto');
const db = require('../src/config/database');
const ALG = 'aes-256-gcm';
const derive = k => { if (!k || k.length < 32) throw new Error('key < 32 chars');
  return Buffer.from(crypto.hkdfSync('sha256', k, 'infrasafe-totp-v1', 'aes-encryption-key', 32)); };
const dec = (t, key) => { const [iv, tag, e] = t.split(':');
  const d = crypto.createDecipheriv(ALG, key, Buffer.from(iv, 'hex')); d.setAuthTag(Buffer.from(tag, 'hex'));
  return d.update(e, 'hex', 'utf8') + d.final('utf8'); };
const enc = (txt, key) => { const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv(ALG, key, iv); let e = c.update(txt, 'utf8', 'hex'); e += c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${e}`; };

(async () => {
  const OLD = derive(process.env.TOTP_OLD_KEY), NEW = derive(process.env.TOTP_NEW_KEY);
  const commit = process.argv.includes('--commit');
  const { rows } = await db.query('SELECT user_id, username, totp_secret FROM users WHERE totp_secret IS NOT NULL');
  let ok = 0, fail = 0;
  for (const u of rows) {
    try {
      const plain = dec(u.totp_secret, OLD);
      const re = enc(plain, NEW);
      if (dec(re, NEW) !== plain) throw new Error('roundtrip mismatch');   // sanity before write
      if (commit) await db.query('UPDATE users SET totp_secret = $1 WHERE user_id = $2', [re, u.user_id]);
      ok++; console.log(`${commit ? 'reencrypted' : 'OK(dry)'} user ${u.user_id} ${u.username}`);
    } catch (e) { fail++; console.error(`FAIL user ${u.user_id} ${u.username}: ${e.message}`); }
  }
  console.log(`\n${commit ? 'COMMITTED' : 'DRY-RUN'}: ${ok} ok, ${fail} failed`);
  if (fail > 0) console.log('ABORT — do NOT change TOTP_ENCRYPTION_KEY until every row decrypts.');
  process.exit(fail > 0 ? 1 : 0);
})();
```

**Runbook (Strategy A):**
1. `cp .env.prod .env.prod.bak.totp.$(date +%Y%m%d-%H%M%S)`.
2. Generate the new key: `openssl rand -base64 32` (≥32 chars). Keep it out of shell history.
3. **Dry-run** inside the app container (has `pg` + DB env):
   ```
   docker exec -e TOTP_OLD_KEY="<current>" -e TOTP_NEW_KEY="<new>" infrasafe-app-1 \
     node scripts/rotate-totp-key.js
   ```
   Expect `N ok, 0 failed`. **If any row fails to decrypt → STOP** (the current key isn't what you think; do not proceed).
4. **Commit** the re-encryption: same command **+ `--commit`**. Now `totp_secret` rows are wrapped under the NEW key while the env key is still OLD (so 2FA is briefly broken — do step 5 immediately).
5. Set `TOTP_ENCRYPTION_KEY=<new>` in `.env.prod`, then `docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app`.
6. **Verify:** an admin logs in with their **existing** authenticator code → 2FA passes (secret preserved). Check `docker logs infrasafe-app-1 | grep -i totp` for decrypt errors (expect none).
7. **Rollback** (if step 6 fails): restore `.env.prod` key to OLD + recreate app (rows are still valid under NEW only if step 5 done — so rollback = re-run the script with OLD/NEW swapped, or restore a DB backup of `users.totp_secret` taken before step 4). **Take a `users` snapshot before step 4:**
   `docker exec infrasafe-postgres-1 pg_dump -h 127.0.0.1 -U infrasafe_runtime -d infrasafe -t users --data-only -f /tmp/users_pre_totp.sql` (set `PGPASSWORD`).

> Sequencing note: steps 4→5 are the only window where 2FA is inconsistent (data on NEW, env on OLD).
> Keep it to seconds. Do it off-peak with an admin standing by to test step 6.

---

## Strategy B — force re-enrollment (fresh secrets)

Use if existing secrets are considered compromised.
1. Snapshot `users` (as above).
2. Notify all admins they'll re-enroll 2FA; have them online.
3. Clear 2FA state:
   ```sql
   UPDATE users SET totp_enabled = false, totp_secret = NULL, recovery_codes = NULL
   WHERE role = 'admin';
   ```
   (run via `docker exec ... psql ... -U infrasafe_runtime -d infrasafe`).
4. Set `TOTP_ENCRYPTION_KEY=<new>` in `.env.prod` + recreate app.
5. Each admin logs in → backend returns `requires2FASetup` → completes `/auth/setup-2fa` → `/auth/confirm-2fa` → saves new recovery codes. New secret is encrypted under the new key.
6. Verify each admin can log in via the new authenticator entry.

> Trade-off: simpler/no script, but every admin must re-scan and there's a window where an admin has
> no working second factor until they finish setup (the tempToken setup flow bridges it).

---

## Recommendation
Run **Strategy A** in a short off-peak window with one admin available to verify step 6. It rotates the
key with zero user disruption and closes the git-history exposure. Escalate to **Strategy B** only if a
DB compromise is suspected. Either way: snapshot `users.totp_secret` first; dry-run before `--commit`;
keep the 4→5 window tight.
