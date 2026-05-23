# FIX-007 — InfraSafe public key for UK_WEBHOOK_SECRET exchange

> **To:** UK team
> **From:** InfraSafe operator
> **Date:** 2026-05-23
> **Re:** FIX-007 Sprint 9 secret rotation — InfraSafe-side `age` public key

## Context

Sprint 9 deployed on InfraSafe prod (dormant, `UK_USE_WEBHOOK_SENDER=false`).
Per FIX-007 round Q1, secret exchange channel is `age` (public-key
encryption). InfraSafe side has generated the keypair; this message ships
the **public** half so UK can encrypt the new `UK_WEBHOOK_SECRET` value
when Phase 2 is ready.

## InfraSafe `age` public key

```
age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm
```

This key is **public** and safe to share via any channel (chat, email,
git). The corresponding private key is stored only on the InfraSafe
operator workstation.

## What UK needs to do when ready

When UK Phase 2 (alert → request handler) is deployed and ready for InfraSafe
to start sending real events:

### 1. Mint new outbound secret (InfraSafe → UK direction)

```bash
NEW_UK_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

This is the value InfraSafe will sign with and UK will verify on
`POST /api/v2/webhooks/infrasafe/alert`.

### 2. Encrypt under InfraSafe's public key

```bash
# Save InfraSafe's public key to a file
cat > /tmp/is-pubkey.txt <<'EOF'
age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm
EOF

# Encrypt the secret value
echo -n "$NEW_UK_WEBHOOK_SECRET" | age -R /tmp/is-pubkey.txt -o uk-webhook-secret.age

# Verify the artifact exists and is non-empty
ls -la uk-webhook-secret.age
file uk-webhook-secret.age   # → "data"
```

### 3. Deliver `uk-webhook-secret.age` to InfraSafe

Any channel works — the file is already encrypted under InfraSafe's
public key, so even plain email / Slack / GitHub is fine. Only the
holder of the matching private key can decrypt.

### 4. Set on UK side simultaneously

UK's `.env` should have:

```
UK_WEBHOOK_SECRET=<same value as $NEW_UK_WEBHOOK_SECRET above>
```

Plus, per the rotation playbook (FIX-007 §5):

```
UK_WEBHOOK_SECRET_NEXT=<optional, for future rotations>
```

UK accepts either `UK_WEBHOOK_SECRET` or `UK_WEBHOOK_SECRET_NEXT` for
incoming InfraSafe signatures during the rotation window.

## What InfraSafe will do after receiving the encrypted file

```bash
# On operator workstation:
age -d -i ~/.infrasafe-secrets/uk-secret-exchange.key uk-webhook-secret.age
# → prints decrypted value to stdout
```

Operator then propagates the value to prod `.env`:

- `UK_WEBHOOK_SECRET=<decrypted value>` (replaces the legacy value which
  is now `INFRASAFE_WEBHOOK_SECRET`)
- `UK_API_URL=<bare host, e.g. https://uk.infrasafe.uz>`
- `UK_USE_WEBHOOK_SENDER=true`

Restart app → drain worker activates → first events flow to UK.

## What still blocks the cutover (from UK side)

Per the FIX-007 contract Q4/Q5:

- [ ] UK Phase 2 implementation: alert → request handler with
      `external_id` → building resolution
- [ ] ARCH-113 fix (bot-originated requests emit `request.*` webhooks)
      — not a hard blocker but blocks our local counter accuracy
- [ ] UK side `UK_WEBHOOK_SECRET` in `.env` (after this exchange)

InfraSafe side is ready and waiting. Phases 1 + 2 of the deployment plan
(prod schema + secret rename) are done; phase 3 (this message) is in
flight; phase 4 is "wait UK"; phase 5 is the cutover.

## Reference

- Sprint 9 PR: https://github.com/a-afanasyev/infrasafe/pull/39 (merged)
- Deployment plan: `docs/audit/2026-05-22-sprint-9-deployment-plan.md`
- Runbook: `docs/audit/2026-05-22-secret-split-runbook.md`
- Contract record: `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md`
