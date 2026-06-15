# RevenueDog REST API Contract (v1)

This document is the **single source of truth** for the RevenueDog backend API.
The Android and iOS SDKs and the backend MUST implement exactly these shapes.

Base URL: `https://<your-host>` (local dev: `http://localhost:8787`)

## Authentication

Two key types, sent as `Authorization: Bearer <key>`:

- **Public SDK key** (`pk_...`) — used by mobile SDKs. Scoped to one app.
- **Secret key** (`sk_...`) — used for admin/configuration endpoints. Never ship in an app.

Public-key endpoints are namespaced under `/v1/`. Secret-key endpoints under `/v1/admin/`.

Headers sent by SDKs on every request:

| Header | Example | Notes |
|---|---|---|
| `Authorization` | `Bearer pk_abc123` | required |
| `X-Platform` | `ios` \| `android` | required |
| `X-Platform-Version` | `17.4` / `34` | OS version |
| `X-SDK-Version` | `0.1.0` | RevenueDog SDK version |
| `X-App-Version` | `1.2.3` | host app version |
| `Content-Type` | `application/json` | on bodies |

## Error shape

All errors:

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "No subscriber with that app_user_id."
  }
}
```

HTTP status codes: 400 invalid request, 401 bad/missing key, 403 wrong key type,
404 not found, 409 conflict, 422 store validation failed, 500 internal.

Error codes (stable strings): `invalid_request`, `unauthorized`, `forbidden`,
`resource_not_found`, `conflict`, `receipt_validation_failed`, `store_problem`,
`internal_error`.

---

## Core data shapes

### CustomerInfo (a.k.a. Subscriber)

Returned by every endpoint that touches a subscriber. Dates are ISO-8601 UTC strings or `null`.

```json
{
  "request_date": "2026-06-10T12:00:00Z",
  "subscriber": {
    "original_app_user_id": "user_123",
    "first_seen": "2026-01-01T00:00:00Z",
    "last_seen": "2026-06-10T12:00:00Z",
    "management_url": null,
    "entitlements": {
      "pro": {
        "expires_date": "2026-07-10T12:00:00Z",
        "purchase_date": "2026-06-10T12:00:00Z",
        "product_identifier": "com.app.pro.monthly",
        "grace_period_expires_date": null
      }
    },
    "subscriptions": {
      "com.app.pro.monthly": {
        "purchase_date": "2026-06-10T12:00:00Z",
        "original_purchase_date": "2026-06-10T12:00:00Z",
        "expires_date": "2026-07-10T12:00:00Z",
        "store": "app_store",
        "unsubscribe_detected_at": null,
        "billing_issues_detected_at": null,
        "grace_period_expires_date": null,
        "is_sandbox": true,
        "period_type": "normal",
        "will_renew": true
      }
    },
    "non_subscriptions": {
      "com.app.lifetime": [
        {
          "id": "txn_abc",
          "purchase_date": "2026-06-10T12:00:00Z",
          "store": "play_store",
          "is_sandbox": false
        }
      ]
    },
    "subscriber_attributes": {
      "$email": { "value": "a@b.com", "updated_at": "2026-06-10T12:00:00Z" }
    }
  }
}
```

Notes:
- An entitlement is **active** if `expires_date` is `null` (lifetime) or in the future
  (client compares against `request_date` to tolerate clock skew).
- `period_type`: `normal` | `trial` | `intro`.
- `store`: `app_store` | `play_store` | `promotional`.

### Offerings response

```json
{
  "current_offering_id": "default",
  "offerings": [
    {
      "identifier": "default",
      "description": "Standard paywall",
      "metadata": {},
      "packages": [
        {
          "identifier": "$rd_monthly",
          "platform_product_identifier": "com.app.pro.monthly"
        },
        {
          "identifier": "$rd_annual",
          "platform_product_identifier": "com.app.pro.annual"
        }
      ]
    }
  ],
  "experiment": {
    "id": "exp_1",
    "variant": "treatment"
  }
}
```

Notes:
- `packages[].platform_product_identifier` is already resolved for the calling
  platform (`X-Platform` header) — the SDK then fetches price/title from the store.
- Standard package identifiers: `$rd_lifetime`, `$rd_annual`, `$rd_six_month`,
  `$rd_three_month`, `$rd_two_month`, `$rd_monthly`, `$rd_weekly`, plus custom ids.
- `experiment` is `null` unless the subscriber is enrolled in a running experiment;
  when enrolled, `current_offering_id` already reflects the assigned variant's offering.

---

## Public (SDK) endpoints

### `GET /v1/subscribers/{app_user_id}`
Returns CustomerInfo. **Creates the subscriber if it does not exist** (first-seen registration).

### `GET /v1/subscribers/{app_user_id}/offerings`
Returns the Offerings response (resolved for `X-Platform`, experiment-aware,
deterministic variant assignment per subscriber).

### `POST /v1/receipts`
Submit a purchase. Body:

```json
{
  "app_user_id": "user_123",
  "fetch_token": "<store receipt token>",
  "product_id": "com.app.pro.monthly",
  "store": "app_store",
  "presented_offering_identifier": "default",
  "price": 9.99,
  "currency": "USD"
}
```

- `fetch_token`: App Store = JWS transaction representation / receipt data;
  Play Store = purchase token.
- Validates via the configured store validator (trust-mode in dev), upserts the
  subscription/non-subscription, unlocks entitlements mapped to `product_id`.
- Returns CustomerInfo (200). Duplicate submissions are idempotent (still 200).
- 422 with `receipt_validation_failed` if the validator rejects.

### `POST /v1/subscribers/{app_user_id}/alias`
Body: `{ "new_app_user_id": "user_456" }`. Merges/aliases identities (logIn).
Both ids afterwards resolve to the same subscriber; entitlements are merged.
Returns CustomerInfo of the resulting subscriber plus `"created": true|false`.

### `POST /v1/subscribers/{app_user_id}/attributes`
Body: `{ "attributes": { "$email": { "value": "a@b.com" }, "plan_intent": { "value": "pro" } } }`
Reserved keys start with `$` ( `$email`, `$displayName`, `$phoneNumber`, `$pushToken` ).
Setting `"value": null` deletes an attribute. Returns `{ "ok": true }`.

### `DELETE /v1/subscribers/{app_user_id}`
GDPR-style delete. Returns `{ "ok": true }`.

---

## Admin (secret key) endpoints

All CRUD follows the same pattern; list endpoints return `{ "items": [...] }`.

### Products — `/v1/admin/products`
```json
{
  "id": "prod_x",
  "store_identifier": "com.app.pro.monthly",
  "type": "subscription",          // subscription | non_consumable | consumable
  "store": "app_store",            // app_store | play_store
  "display_name": "Pro Monthly",
  "duration": "P1M"                // ISO-8601 duration, null for non-subs
}
```
`POST` create, `GET` list, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`.
The pair (`store_identifier`, `store`) is unique.

### Entitlements — `/v1/admin/entitlements`
```json
{ "id": "ent_x", "identifier": "pro", "display_name": "Pro access", "product_ids": ["prod_x", "prod_y"] }
```
Attach/detach products via `PATCH` with full `product_ids` array.

### Offerings — `/v1/admin/offerings`
```json
{
  "id": "off_x",
  "identifier": "default",
  "description": "Standard paywall",
  "metadata": {},
  "is_current": true,
  "packages": [
    { "identifier": "$rd_monthly", "product_ids": ["prod_app_store_monthly", "prod_play_store_monthly"] }
  ]
}
```
A package carries one product per store; resolution picks the product matching `X-Platform`.
Setting `is_current: true` unsets the previous current offering.

### Experiments — `/v1/admin/experiments`
```json
{
  "id": "exp_1",
  "name": "Annual-first paywall",
  "status": "running",             // draft | running | stopped
  "control_offering_id": "off_x",
  "treatment_offering_id": "off_y",
  "traffic_pct": 50                 // % of NEW enrollments going to treatment
}
```
Assignment: deterministic hash of (experiment id, subscriber id) — sticky for the
subscriber's lifetime, recorded at first offerings fetch while `running`.
`POST /{id}/stop` stops it (enrolled users fall back to the real current offering).
`GET /{id}/results` returns enrollment + conversion counts per variant:
```json
{ "control": { "enrolled": 120, "purchases": 9, "revenue": 89.91 },
  "treatment": { "enrolled": 118, "purchases": 14, "revenue": 139.86 } }
```

### Receipt imports — `POST /v1/admin/imports`
Bulk-import historical purchases (migration from another system):
```json
{
  "receipts": [
    { "app_user_id": "u1", "fetch_token": "...", "product_id": "com.app.pro.monthly", "store": "play_store" }
  ]
}
```
Processes each like `POST /v1/receipts` (trust-mode validation), returns
`{ "imported": 42, "failed": [ { "index": 3, "error": "..." } ] }`.

### Apps & keys — `/v1/admin/apps`
```json
{ "id": "app_x", "name": "My App", "public_api_key": "pk_...", "bundle_id": "com.app", "package_name": "com.app" }
```
`POST` creates an app and generates its `pk_` key. The server bootstraps a root
`sk_` key on first run (printed to stdout, stored in DB).

### Subscriber lookup — `GET /v1/admin/subscribers/{app_user_id}`
Same CustomerInfo shape; also `POST /v1/admin/subscribers/{app_user_id}/entitlements/{identifier}/grant`
with body `{ "expires_date": null }` for promotional grants (store = `promotional`),
and `.../revoke`.

---

## Receipt validation modes

Configured per store via env:

- `trust` (default): accept the client's claim; compute `expires_date` from the
  product's `duration`. For local dev and sandbox testing.
- `apple`: verify the JWS transaction via Apple App Store Server API
  (requires `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`).
- `google`: verify the purchase token via Google Play Developer API
  (requires `GOOGLE_SERVICE_ACCOUNT_JSON`).

Validators are a pluggable interface; `apple`/`google` implementations may start
as scaffolds that fail with `store_problem` if credentials are missing.
