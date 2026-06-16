# SEC-34j — SSH hardening (host-ops runbook)

**Status:** RUNBOOK READY / AWAITING OPERATOR · **Date:** 2026-06-16

Host-level hardening for the prod host (`95.46.96.105`, SSH on port **32323**,
operator user `infrasafe`). This is **operator-executed on the host** — there is
no code change. Mark SEC-34j **CLOSED** only after the operator confirms the
config is applied and key-only login is verified.

> ⚠️ **Lock-out risk.** A wrong `sshd_config` + a dropped session = no way back
> in. Follow the safe-apply order exactly: never close your current session
> until a SECOND session has logged in successfully under the new config.

## 0. Pre-flight (anti-self-lockout)

1. Confirm your public key is already authorized and key-login works **now**:
   ```bash
   # from your workstation
   ssh -p 32323 -o PreferredAuthentications=publickey infrasafe@95.46.96.105 'echo key-login-ok'
   ```
   If this fails, **stop** — add your key to `~/.ssh/authorized_keys` on the host
   (and `chmod 600 ~/.ssh/authorized_keys`, `chmod 700 ~/.ssh`) before going further.
2. Keep the current SSH session **open** for the entire procedure.
3. Note any automation/CI that logs in via password — migrate it to keys first.

## 1. sshd_config changes

Edit `/etc/ssh/sshd_config` (or drop a file in `/etc/ssh/sshd_config.d/`):

```
# SEC-34j hardening
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
# Optional: restrict to the ops user
# AllowUsers infrasafe
```

Notes:
- `KbdInteractiveAuthentication no` closes the keyboard-interactive fallback
  that can otherwise still prompt for a password on some distros.
- `PermitRootLogin prohibit-password` allows key-only root (for break-glass);
  use `no` if root login is never needed.
- Keep `Port 32323` as-is.

## 2. Safe apply

```bash
# 1. Syntax check — must print nothing / no errors.
sudo sshd -t

# 2. Effective resulting config — confirm the values actually took.
sudo sshd -T | grep -Ei 'passwordauthentication|kbdinteractive|pubkeyauthentication|permitrootlogin'
#   expect: passwordauthentication no
#           kbdinteractiveauthentication no
#           pubkeyauthentication yes
#           permitrootlogin prohibit-password

# 3. Reload (NOT restart) — keeps existing sessions alive.
sudo systemctl reload sshd
```

## 3. Verify in a SECOND session (before closing the first)

```bash
# Key login still works:
ssh -p 32323 infrasafe@95.46.96.105 'echo still-in'

# Password auth is now refused:
ssh -p 32323 -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    infrasafe@95.46.96.105
#   expect: "Permission denied (publickey)." — password not offered/accepted
```

Only once the second session is confirmed working may you close the first.

## 4. fail2ban (brute-force throttle on 32323)

Install fail2ban, then `/etc/fail2ban/jail.local`:

```ini
[sshd]
enabled  = true
port     = 32323
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
```

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd      # shows jail + banned IP count
```

## 5. Optional — IP allowlist on 32323

If the set of admin source IPs is stable, restrict the port at the firewall
(defense-in-depth on top of key-only auth):

```bash
# ufw example
sudo ufw allow from <ADMIN_IP> to any port 32323 proto tcp
sudo ufw deny 32323/tcp
sudo ufw status verbose
```

(Equivalent with nftables/iptables if ufw is not in use.) Do not enable a deny
rule until an allow rule for your own IP is in place.

## Rollback

If a session is lost mid-change and key-login breaks: use the provider console
(out-of-band) to revert `/etc/ssh/sshd_config`, `sudo sshd -t`, then
`sudo systemctl reload sshd`.

## Closure

After the operator confirms: config applied, `sshd -T` shows the hardened
values, key-login verified in a fresh session, password-login refused, fail2ban
active → update SEC-34j to **CLOSED** in `docs/audit/sprint-11-backlog.md`.
