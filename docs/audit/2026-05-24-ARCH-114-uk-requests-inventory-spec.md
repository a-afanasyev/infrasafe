# ARCH-114 — UK requests inventory endpoint (response to UK spec request)

> **Date**: 2026-05-24
> **Direction**: response to UK ARCH-114 spec request (set-diff reconciliation safety-net).
> **InfraSafe-side status**: endpoint implemented in branch `feat/uk-requests-inventory-endpoint` (PR TBD), behind no feature flag — ships hot.
> **UK-side ETA per their request**: 3h impl + tests, deploy within 1–2 days of this spec.

---

## TL;DR

`GET /api/uk-requests-metrics?limit=5000` is live in InfraSafe `main` as of this PR. It returns every `uk_request_number` we have on file, regardless of status. UK side can set-diff against the local `requests` table and `queue_webhook("request.created", ...)` for any missing entries — our receiver is idempotent on both `request.created` (matched by `source_event_id`) and `request.status_changed` (matched by `request_number`), so replay is safe.

---

## Answers to the 8 questions

### Q1 — URL endpoint

✅ **`GET /api/uk-requests-metrics`** — mirror of `/api/buildings-metrics`.
Query param: `?limit=N` (default 5000, cap 10 000).

### Q2 — Response shape

Mirror the buildings-metrics envelope but slimmer (no metric data to fold in):

```json
{
  "data": [
    {
      "uk_request_number": "260523-004",
      "status": "resolved",
      "building_external_id": "b7f6…-uuid",
      "updated_at": "2026-05-23T14:32:08.123Z"
    },
    {
      "uk_request_number": "260524-001",
      "status": "active",
      "building_external_id": "c2a1…-uuid",
      "updated_at": "2026-05-24T07:42:11.502Z"
    }
  ],
  "total": 2,
  "limit": 5000
}
```

`uk_request_number` is the only field you strictly need to set-diff. The other three are added for debugging on your side (e.g. quick "is this terminal or active?" check before deciding what kind of replay event to enqueue). If you want them stripped, ignore them — there's no contract penalty for over-returning.

> **Updated 2026-06-07 (SEC-19):** the internal `infrasafe_alert_id` field was **removed** from this endpoint's response and source query. The endpoint is public (no auth, mirror of `/buildings-metrics`), and `infrasafe_alert_id` is an internal primary key UK never needs — set-diff is on `uk_request_number` only (we already flagged the extra fields as debug-only and ignorable above). No action required on the UK side.

### Q3 — Auth

✅ **No auth required** (mirror of `/api/buildings-metrics`).

Reasoning:
- Endpoint is read-only and returns identifiers that УК already owns — no information disclosure beyond what UK is replaying back to us.
- Reachable from the docker `uk-network` plus the InfraSafe internal network (same as buildings-metrics today).
- We added it to the default-deny middleware's public allowlist in `src/routes/index.js` alongside `/buildings-metrics`.

If/when SEC-115 lands on your side and you want service-token auth for both inventory endpoints, we'll add it to **both** in one go — keeping them symmetric is more valuable than rolling per-endpoint auth.

### Q4 — Pagination

✅ **`?limit=N`** (default 5000, cap 10 000). No cursor in v1.

Reasoning: today prod has **1 row** in `alert_request_map`. With UK churn of "единицы-десятки заявок/мес" we hit 5000 in ~30 years. If the rate climbs (e.g. you wire up additional event types), we'll add cursor pagination in a follow-up — but premature now.

The cap of 10 000 is a soft safety so an accidental `?limit=999999` doesn't blow up our DB; we'd rather paginate explicitly if you ever need more.

### Q5 — Source query

```sql
SELECT
  uk_request_number,
  status,
  building_external_id,
  updated_at
FROM alert_request_map
WHERE uk_request_number IS NOT NULL
ORDER BY updated_at DESC
LIMIT $1
```

> **SEC-19 (2026-06-07):** `infrasafe_alert_id` removed from the SELECT (internal PK, not needed for reconciliation; endpoint is public).

No status filter. Full inventory. `uk_request_number IS NOT NULL` skips ARM rows that never received the `request.created` ack from your side (race window / failed sends).

### Q6 — Include resolved / cancelled rows?

✅ **Yes — include everything.**

Reasoning:
- The whole point of the reconciliation is to find rows you have but we don't. Filtering out terminal rows would create false replay events for entries we've completed.
- Volume concern is theoretical at current rates. When real data justifies it, we'll add `?include_terminal=false` as an opt-in parameter — but defaulting to include is safer.
- Our receiver short-circuits on `request.created` when the ARM already has `uk_request_number` set, so a replay of a terminal entry is a no-op on our side anyway.

If/when volume grows enough to matter, we'll likely introduce an archive policy on ARM rows older than N months (terminal-only) rather than complicating this endpoint.

### Q7 — ARM rows we've deleted (your example: 260523-002)

❌ **Not returned.** We don't keep tombstones.

Operational consequence: if you have `uk_request_number=X` and our ARM row for X is gone, your reconcile will see it as "missing" and replay forever. Two ways to handle that on your side:

1. **Local skip-list**: maintain a `requests.dont_replay BOOL` (or equivalent) for known-cleaned entries. Lowest friction.
2. **Idempotency on replay**: our receiver for `request.status_changed` no-ops cleanly when the mapping is missing (see `src/services/uk/requestProcessor.js:135` — "no mapping for request X (manual UK request or stale ARM)"). So even an unbounded replay loop only produces `integration_log.success` rows on our side, not duplicate ARM entries.

We'd recommend option 1 (skip-list) for cleanliness, but option 2 is acceptable if you'd rather keep your reconcile logic stateless.

### Q8 — Idempotency of replay

✅ **Yes, both event types are idempotent on our side.**

Concrete behaviour by event type:

| Event | Match path | If matched | If not matched |
|---|---|---|---|
| `request.created` (with `source_event_id`) | `AlertRequestMap.findByIdempotencyKey(source_event_id)` | `markSent(uk_request_number)` — fills in number if not already set; UNIQUE on (alert_id, building_external_id) prevents double-create | log only, no DB change |
| `request.created` (no `source_event_id` — manual UK request) | n/a | log only — no mapping to attach to | n/a |
| `request.status_changed` | `AlertRequestMap.findByRequestNumber(request_number)` | `updateStatus(...)` + maybe `UK_REQUEST_RESOLVED` emit if terminal | log only, no DB change |

The per-event de-dup invariant is enforced at the integration-log layer too: `IntegrationLog.create({event_id})` has a UNIQUE constraint, so a replay with the same `event_id` is rejected before any business logic runs (`requestProcessor.js:60-65`). If your replay uses a **fresh** `event_id` per attempt (which it does — `uuid4()` per `queue_webhook` call), we go through the full handler but the per-business-key match (above) keeps it idempotent.

Bottom line: replay as aggressively as you want; worst case is a few extra `integration_log` rows on our side, no data corruption.

---

## Recommendation for UK's replay event choice

Given the table above, the **safest replay event is `request.status_changed`** with `new_status` set to your local current state. Reasons:

- If our ARM row exists, we update its status (and possibly trigger auto-resolve if terminal). Net positive.
- If our ARM row is missing (deleted / stale / manual), we log and no-op. No state leakage.
- `request.created` requires us to match by `source_event_id`, which UK has only for outbound-originated requests, not for ones created via your dashboard. So `request.status_changed` covers more replay cases.

If UK still wants to send `request.created` (e.g. for completeness), that's fine — just be aware that we won't backfill an ARM row from it; we'll only fill in `uk_request_number` if there's already a matching `source_event_id`. To actually create ARM rows for orphaned UK requests, we'd need a different event shape (something like `request.reconcile` with the buildings reference) — happy to spec that in a follow-up if it's actually a real ask.

---

## Implementation on InfraSafe side (what this PR does)

| Change | Path |
|---|---|
| Endpoint route + public-allowlist entry | `src/routes/index.js` |
| New route file | `src/routes/ukRequestsMetricsRoutes.js` |
| Controller | `src/controllers/ukRequestsMetricsController.js` |
| Model method `AlertRequestMap.listInventory({limit})` | `src/models/AlertRequestMap.js` |
| Unit tests | `tests/jest/unit/alertRequestMapInventory.test.js`, `tests/jest/unit/ukRequestsMetricsController.test.js` |

Endpoint is live the moment this PR ships to prod (no feature flag). UK can wire up `INFRASAFE_REQUESTS_INVENTORY_URL=https://infrasafe.uz/api/uk-requests-metrics` and start reconciling on the next deploy.

---

## Reference

- UK ARCH-114 ask: this conversation, 2026-05-24
- InfraSafe buildings-metrics (the mirror endpoint): `src/routes/buildingMetricsRoutes.js` + `src/controllers/buildingMetricsController.js`
- ARM model (data source): `src/models/AlertRequestMap.js`
- Receiver idempotency: `src/services/uk/requestProcessor.js:43-160`
- Public allowlist (default-deny): `src/routes/index.js:87-115`
