# Migrating from RevenueCat

RevenueDog implements RevenueCat's `/v1` REST contract closely enough that, in most cases,
you can keep using the **official RevenueCat SDK** and just point it at your RevenueDog
server. No rewrite of your purchase code.

> **Status:** the response schema is locked to RevenueCat's documented shape by an automated
> golden-schema test, and the pieces that matter for the SDK (CustomerInfo, offerings,
> receipts, platform-prefixed keys) are in place. End-to-end verification against the live
> RevenueCat SDK is still in progress — **test in sandbox before you switch production
> traffic.** If you hit a schema mismatch, please open an issue with the failing payload.

---

## How it works

The RevenueCat SDKs support a `proxyURL` setting that routes all API traffic through a host
you control. RevenueDog speaks the same protocol, so the SDK talks to it the same way it
talks to RevenueCat.

### 1. Recreate your configuration in RevenueDog

In the dashboard (or via the admin API), create:

- An **app** — this issues an iOS key (`appl_…`) and an Android key (`goog_…`), matching
  RevenueCat's per-platform key model.
- Your **products** (store identifiers), **entitlements**, and **offerings/packages** —
  same identifiers you use today (e.g. `pro`, `$rc_monthly`).

### 2. Point the SDK at RevenueDog

**iOS (Swift):**

```swift
Purchases.proxyURL = URL(string: "https://your-revenuedog.example.com")!
Purchases.configure(withAPIKey: "appl_your_revenuedog_ios_key")
```

**Android (Kotlin):**

```kotlin
Purchases.proxyURL = URL("https://your-revenuedog.example.com")
Purchases.configure(
    PurchasesConfiguration.Builder(context, "goog_your_revenuedog_android_key").build()
)
```

Everything else — `getOfferings()`, `purchase(package:)`, `restorePurchases()`,
`customerInfo`, entitlement checks like `customerInfo.entitlements["pro"]?.isActive` — stays
the same.

---

## What's compatible

| Area | Notes |
|---|---|
| `GET /v1/subscribers/{app_user_id}` | Returns RevenueCat's `CustomerInfo` shape: `entitlements`, `subscriptions`, `non_subscriptions`, `subscriber_attributes`, `request_date(_ms)`, `original_purchase_date`, per-subscription `ownership_type`/`price`/`store`/`period_type`/grace & billing fields. |
| `GET /v1/subscribers/{id}/offerings` | `current_offering_id` + `offerings[].packages[].platform_product_identifier` (and `platform_product_plan_identifier` for Google base plans). |
| `POST /v1/receipts` | Accepts the SDK's body; `store` is inferred from the `X-Platform` header when the SDK omits it. |
| `POST /v1/subscribers/{id}/attributes`, `/alias` | Subscriber attributes and aliasing. |
| Platform keys | `appl_`/`goog_` keys authenticate exactly like RevenueCat keys. |

## Known gaps / caveats

- **Server-side store notifications** (App Store Server Notifications V2, Google RTDN) are
  not wired up yet, so renewals/refunds/expirations are reflected when the client next syncs
  rather than pushed server-side. On the roadmap.
- **Receipt verification** runs in trust mode by default. For production, configure real
  Apple/Google validation (`APPLE_VALIDATION=apple`, `GOOGLE_VALIDATION=google`) — the server
  refuses to start in `NODE_ENV=production` otherwise.
- **Historical data** is not auto-imported from RevenueCat. Use the admin
  `POST /v1/admin/imports` endpoint to backfill known receipts, or start fresh and let the
  SDK re-sync active subscribers on next launch.
- Fields RevenueDog does not yet source (e.g. `original_application_version`) are returned
  with RevenueCat's documented defaults (`null`) so the SDK still decodes cleanly.

## Not using the RevenueCat SDK?

You can also call the REST API directly — see [`API.md`](API.md) — or use the RevenueDog
native SDKs once they ship (see the [SDK surface](SDK_SURFACE.md)).
