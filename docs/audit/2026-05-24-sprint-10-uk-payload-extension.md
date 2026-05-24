# Sprint 10 — UK webhook payload extension contract

> **Date**: 2026-05-24
> **Direction**: InfraSafe → UK Management Bot (outbound HMAC webhook).
> **Endpoint**: `POST {UK_API_URL}/api/v2/webhooks/infrasafe/alert` (unchanged from Sprint 9).
> **Signing**: HMAC-SHA256 sign-at-send-time, header `X-Signature: t=<unix>,v1=<hex>` (unchanged from Sprint 9 — 300 s replay window).
> **Status**: implementation deployed dormant 2026-05-23; will go live when `ALERT_VERIFICATION_ENABLED=true` is flipped on prod.

---

## 1. What changed

Sprint 9 sent a single-shot payload per alert. Sprint 10 keeps that payload byte-compatible and **adds four optional fields** that describe the reopen chain. UK can:

1. Treat the payload exactly as in Sprint 9 (ignore the new fields) — nothing breaks. Backward-compatible by design.
2. Use the new fields to render "повторное обращение №N", inherit the original request number for context, and respect a one-step urgency bump.

No HMAC algorithm change. No endpoint change. No header changes.

---

## 2. Payload shape

### 2.1 Sprint 9 baseline (still sent)

```json
{
  "event_id": "0c9a3b…-uuid",
  "event_type": "alert.created",
  "occurred_at": "2026-05-24T07:14:33.012Z",
  "alert": {
    "infrasafe_alert_id": 42,
    "type": "LEAK_DETECTED",
    "severity": "WARNING",
    "title": "Утечка воды в стояке",
    "description": "…",
    "metric_id": 1234,
    "created_at": "2026-05-24T07:14:32.911Z"
  },
  "building": {
    "external_id": "b7f6…-uuid",
    "name": "Узбекистан, Ташкент, Чиланзар, 12",
    "address": "…"
  },
  "rule": {
    "uk_category": "Сантехника",
    "uk_urgency": "Срочная"
  },
  "idempotency_key": "alert-42-building-b7f6…"
}
```

### 2.2 Sprint 10 — new optional keys inside the `alert` object

> **⚠️ Wire-format correction 2026-05-24** (UK INT-120 review): the original
> revision of this spec showed the Sprint 10 extension keys at the envelope
> level. The **deployed sender** (`src/services/uk/alertForwarder.js:199-237`)
> puts them **inside the `alert` object**, alongside `external_id` / `type` /
> `severity`. UK INT-120 backend handler is aligned on the nested shape;
> this section now reflects that single source of truth. The envelope-level
> placement is NOT planned for any future sprint.

These keys appear inside the `alert` block on **every** outbound event (not just reopens) — the sender emits them as `null` / `1` for first-time alerts so UK schema validation sees a consistent shape regardless of event type. UK can safely ignore them when `reopen_sequence === 1` (no operational meaning).

```json
{
  "event_id": "0c9a…-uuid",
  "event": "alert.created",
  "timestamp": "...",
  "alert": {
    "external_id": "...",
    "type": "...",
    "severity": "...",
    "message": "...",
    "alert_id": 42,
    "...sprint9 keys unchanged...": "...",

    "reopen_chain_id": "f3a1c…-uuid",
    "reopen_sequence": 2,
    "related_request_number": "260523-004",
    "uk_urgency_override": "Критическая",
    "uk_category_override": null,
    "engineer_required_reason": null
  }
}
```

| Field (all under `alert.`) | Type | Always present? | Semantics |
|---|---|---|---|
| `reopen_chain_id` | UUID or null | always (null on sequence=1) | Stable identifier for the chain — same value for every reopen of the same physical fault. |
| `reopen_sequence` | int ≥ 1 | always (defaults to 1) | 1 = first-time alert, 2+ = N-th reopen. Increments by 1 on each verification → reopen transition. |
| `related_request_number` | string or null | always (null on sequence=1) | UK request number of the previous terminated request in this chain. Operator-facing context: "this is a reopen of ticket X". Format is whatever UK returned at request creation — InfraSafe does not normalise it. |
| `uk_urgency_override` | string or null | always (null when no override applies) | When non-null, UK SHOULD use this value instead of `rule.uk_urgency`. Set on reopens with `reopen_urgency_bump=true` (canonical ladder `Обычная → Средняя → Срочная → Критическая`, capped) and always set to `"Критическая"` on `alert.engineer_required` events. |
| `uk_category_override` | string or null | always (null except on engineer_required) | Always `"Инженерный разбор"` on `alert.engineer_required`, null otherwise. UK SHOULD route to engineering queue when present. |
| `engineer_required_reason` | string or null | always (null except on engineer_required) | Always `"max_reopens_per_24h"` on `alert.engineer_required` (the only trigger in v1), null otherwise. |

### 2.3 Example — second escalation of the same leak (`event = "alert.created"`, `reopen_sequence ≥ 2`)

```json
{
  "event_id": "5d2e…-uuid",
  "event": "alert.created",
  "timestamp": "2026-05-24T07:42:11.502Z",
  "alert": {
    "external_id": "b7f6…-uuid",
    "type": "LEAK_DETECTED",
    "severity": "WARNING",
    "message": "Утечка воды в стояке (повтор после закрытия 260523-004)",
    "alert_id": 87,
    "created_at": "2026-05-24T07:42:11.401Z",
    "correlation_id": null,
    "infrastructure_type": "controller",
    "infrastructure_id": "1",
    "metric_id": 1419,
    "metric_value": null,
    "metric_unit": null,
    "reopen_chain_id": "f3a1c…-uuid",
    "reopen_sequence": 2,
    "related_request_number": "260523-004",
    "uk_urgency_override": "Критическая",
    "uk_category_override": null,
    "engineer_required_reason": null
  }
}
```

### 2.4 Engineer-required hand-off (`event = "alert.engineer_required"`)

When a chain reaches `max_reopens_per_24h` (default 3), InfraSafe does **NOT** send another `alert.created` event. The alert transitions locally to status `engineer_required` and we emit a different event type. **Same envelope shape, different `event` value + three filled override fields inside `alert{}`.** Sender: `src/services/uk/alertForwarder.js` `ALERT_ENGINEER_REQUIRED` listener (hotfix 2026-05-24).

```json
{
  "event_id": "...-uuid",
  "event": "alert.engineer_required",
  "timestamp": "...",
  "alert": {
    "external_id": "b7f6…-uuid",
    "type": "LEAK_DETECTED",
    "severity": "WARNING",
    "message": "...",
    "alert_id": 142,
    "created_at": "...",
    "correlation_id": null,
    "infrastructure_type": "controller",
    "infrastructure_id": "1",
    "metric_id": null,
    "metric_value": null,
    "metric_unit": null,
    "reopen_chain_id": "f3a1c…-uuid",
    "reopen_sequence": 4,
    "related_request_number": "260523-006",
    "uk_urgency_override": "Критическая",
    "uk_category_override": "Инженерный разбор",
    "engineer_required_reason": "max_reopens_per_24h"
  }
}
```

UK should route this to the engineering escalation queue, not the normal dispatch flow. No further automatic re-escalation will happen for this chain.

---

## 3. UK-side requirements summary

What we need from the УК team to consume the new fields:

| Requirement | Priority |
|---|---|
| Verify the existing HMAC validator on `/api/v2/webhooks/infrasafe/alert` does **not** reject unknown top-level keys. (Test plan in §4.) | P0 — needed before flip |
| When `reopen_sequence ≥ 2`, render the ticket title with a reopen marker ("Повторное обращение №2", "Re-open #2", etc.). | P1 — UX |
| When `uk_urgency_override` is present, use it instead of `rule.uk_urgency` when computing dispatch priority. | P1 — UX |
| When `related_request_number` is present, surface it to the dispatcher (link to or quote the previous ticket). | P2 — UX |
| Handle `event_type: alert.engineer_required` as a separate routing branch (engineering queue, not regular dispatch). | P1 — required when chains hit max_reopens |

If any of P0/P1 is not ready, the flip can still proceed — the new fields will silently arrive, UK will treat them like Sprint 9 events, and dispatch will work (just with slightly worse UX on reopens until §3 P1 lands).

---

## 4. UK-side acceptance test plan

Before InfraSafe flips `ALERT_VERIFICATION_ENABLED=true` in prod, ask the УК team to validate against the staging instance:

```bash
# Send a Sprint 9-shape payload (no new fields) and confirm the existing pipeline still works.
curl -X POST "$UK_STAGING/api/v2/webhooks/infrasafe/alert" \
     -H "Content-Type: application/json" \
     -H "X-Signature: t=…,v1=…" \
     -d @sprint9-baseline.json
# expect: 200, request created

# Send a Sprint 10 reopen payload (with the 4 new keys). The endpoint must accept it.
curl -X POST "$UK_STAGING/api/v2/webhooks/infrasafe/alert" \
     -H "Content-Type: application/json" \
     -H "X-Signature: t=…,v1=…" \
     -d @sprint10-reopen.json
# expect: 200, request created, ideally with a reopen-marker in the title
```

If the second call returns 4xx because of an unexpected field, **block the flip** and patch УК's payload validator first.

---

## 5. InfraSafe-side reference

| Concern | Path |
|---|---|
| Where the payload is built | `src/services/uk/alertForwarder.js` (`sendAlertToUK`, `bumpUrgency`) |
| Where it's signed + POSTed | `src/clients/ukWebhookClient.js` (`send`) |
| Where it's enqueued | `src/services/uk/alertForwarder.js` (`UkOutbox.enqueue` when `UK_USE_WEBHOOK_SENDER=true`) |
| HMAC algorithm | `src/services/uk/webhookVerifier.js` (verifier — same algorithm, both directions) |
| Replay window | 300 s, hard-coded for symmetry with the verifier |
| Idempotency key | `alert-{alert_id}-building-{building_external_id}` — unchanged from Sprint 9; reopen creates a new `alert_id`, so the key naturally rotates. |
| Per-rule control of the urgency bump | `alert_rules.reopen_urgency_bump` (boolean) — toggleable from admin UI |

---

## 6. Out of scope (Sprint 11+)

- "Бригада на месте" → "Бригада не подтверждает фактический срез" → request-specific status webhook from УК to InfraSafe. Needs UK API extension and is tracked separately.
- Reverse direction (UK → InfraSafe) payload extension for the verification result feedback channel. v1 reuses the existing `/webhooks/uk/request` UK status event — no new fields needed.
