<div align="center">

# 🐕 RevenueDog

### The open-source, self-hostable alternative to RevenueCat

In-app subscriptions & purchases for iOS and Android — with a real analytics dashboard,
entitlements, offerings/paywalls, and A/B experiments. Own your data. Pay nothing per transaction.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-orange)
![Backend](https://img.shields.io/badge/backend-Node%20%2B%20TypeScript-3178c6)
![Dashboard](https://img.shields.io/badge/dashboard-React%20%2B%20Vite-61dafb)

</div>

---

## Why RevenueDog?

RevenueCat is great — but it's a SaaS with a monthly-tracked-revenue platform fee, and it
holds your customer data. **RevenueDog gives you the same core workflow, self-hosted, with
no per-revenue fee and your data on your own box:**

- 🔁 **Drop-in RevenueCat compatibility** — the API mirrors RevenueCat's `/v1` contract
  (CustomerInfo, offerings, receipts) and issues `appl_`/`goog_` platform keys, so an
  existing app can point the official RevenueCat SDK at RevenueDog via `Purchases.proxyURL`.
  See [Migrating from RevenueCat](docs/MIGRATING_FROM_REVENUECAT.md). *(Parity is verified by
  a golden-schema test; end-to-end verification against the live RC SDK is in progress.)*
- 🧾 **Cross-platform purchases** — one SDK surface for StoreKit 2 (iOS) and Google Play Billing (Android).
- 🔑 **Entitlements** — map products to access levels; check `customerInfo.entitlements["pro"].isActive`.
- 🏷️ **Offerings & paywalls** — configure packages remotely, no app release required.
- 🧪 **Experiments** — A/B test paywalls with deterministic, sticky assignment and conversion tracking.
- 📊 **Analytics dashboard** — MRR, revenue, active subscriptions, trials, churn, revenue-by-product, recent transactions, plus a **conversion funnel, LTV, and retention cohorts**.
- 🔔 **Webhooks** — HMAC-signed events (purchase, renewal, trial, expiration, billing issue…) with a delivery log.
- 🩺 **SDK diagnostics** — see at a glance whether each app's SDK has connected, with platform & version.
- 📖 **Interactive API docs** — OpenAPI 3.1 spec served at `/docs`.
- 🗄️ **Your data** — SQLite by default; everything runs on your own box.

> ⚠️ **Alpha — do not trust it for real production payments yet without auditing receipt
> verification.** The backend and dashboard are functional and tested; Apple/Google
> server-side verification is implemented but still being hardened for production. The
> native SDKs are in progress. By default the server runs in **trust mode** (it believes
> the client) — fine for local/sandbox testing, but it refuses to boot with `NODE_ENV=production`
> unless real store validation is configured. See the [roadmap](#roadmap).

## What's in the box

| Component | Stack | Status |
|---|---|---|
| **Backend API** | Node 20+, TypeScript, Fastify, better-sqlite3, Zod | ✅ Working, 33 tests passing |
| **Dashboard** | React 19, Vite, Tailwind v4, Recharts | ✅ Working |
| **RevenueCat API compatibility** | `/v1` contract + `appl_`/`goog_` keys | 🟡 Schema-parity tested; live-SDK verification pending |
| **Apple/Google receipt verification** | StoreKit 2 JWS, Play Developer API | 🟡 Implemented, hardening for production |
| **iOS SDK** | Swift Package, StoreKit 2 | 🚧 In progress |
| **Android SDK** | Kotlin, Play Billing 7 | 🚧 In progress |
| **API contract** | [`docs/API.md`](docs/API.md) | ✅ Source of truth |
| **SDK surface** | [`docs/SDK_SURFACE.md`](docs/SDK_SURFACE.md) | ✅ Source of truth |

## Quick start

### Option A — Docker (one command)

You need **Docker**.

```bash
docker compose up --build      # backend → :8787, dashboard → :5173
docker compose logs backend | grep "Root secret key"   # grab the admin sk_ key
```

Open `http://localhost:5173`, connect to `http://localhost:8787` with the secret key, and
you're in. Data persists on the `revenuedog-data` volume.

### Option B — Node (for development)

You need **Node 20+**.

```bash
# 1. Backend — seed demo data and start the API
cd backend
npm install
npm run seed          # prints a public key (pk_…) and secret key (sk_…)
npm run dev           # API on http://localhost:8787

# 2. Dashboard — in a second terminal
cd dashboard
npm install
npm run dev           # open http://localhost:5173
```

Open the dashboard, paste `http://localhost:8787` and the **secret key** the seed printed,
and you'll land on a populated analytics overview with ~220 demo subscribers.

### Going to production

The backend **refuses to start** with `NODE_ENV=production` while receipt validation is in
trust mode or CORS is `*` — this stops you from accidentally shipping a server that accepts
forged purchases. Configure real `APPLE_VALIDATION`/`GOOGLE_VALIDATION` credentials and a
concrete `CORS_ORIGIN` (see [`.env.example`](.env.example)).

<div align="center">
<em>Overview → Customers → Products → Entitlements → Offerings → Experiments → Apps &amp; Keys</em>
</div>

## Architecture

```
┌────────────┐     pk_ key      ┌─────────────────────┐
│  iOS SDK   │ ───────────────▶ │                     │
│ (StoreKit) │                  │   RevenueDog API    │      ┌──────────────┐
├────────────┤                  │   (Fastify + SQLite)│ ◀──▶ │   SQLite DB  │
│ Android SDK│ ───────────────▶ │                     │      └──────────────┘
│ (Play)     │                  │  /v1/*    (public)  │
└────────────┘                  │  /v1/admin/* (secret)│
                                └─────────▲───────────┘
                                  sk_ key │
                                ┌─────────┴───────────┐
                                │  Dashboard (React)  │
                                └─────────────────────┘
```

- **Public endpoints** (`/v1/*`) use a per-app public key (`pk_…`) — safe to ship in apps.
- **Admin endpoints** (`/v1/admin/*`) use a secret key (`sk_…`) — used by the dashboard and CI.
- The full contract lives in [`docs/API.md`](docs/API.md). It is the single source of truth for the SDKs and backend.

## Repository layout

```
backend/     Node + TypeScript API server (Fastify, SQLite)
dashboard/   React + Vite analytics & configuration UI
ios/         Swift Package SDK (StoreKit 2)
android/     Kotlin SDK module (Play Billing)
docs/        API.md + SDK_SURFACE.md — the normative specs
```

See each folder's `README.md` for details.

## Roadmap

- [x] Backend API: subscribers, offerings, receipts, entitlements, experiments, admin CRUD
- [x] Analytics endpoints (MRR, revenue, active subs, status breakdown)
- [x] Deeper analytics: conversion funnel, LTV (ARPU/ARPPU), signup cohorts & retention
- [x] Dashboard with charts and full configuration UI
- [x] SDK connection / diagnostics indicator
- [x] OpenAPI 3.1 spec + interactive `/docs` (Redoc)
- [x] Product catalog import (CSV / bulk JSON; store-API import scaffolded)
- [x] Webhooks (initial purchase, renewal, trial, expiration, billing issue…) with HMAC signing + delivery log
- [x] RevenueCat-shaped API + `appl_`/`goog_` platform keys (drop-in compatibility, schema-parity tested)
- [x] Production safety guard (refuses to boot in prod with trust-mode validation / wildcard CORS)
- [x] Docker Compose one-command deploy + CI (tests, builds, image builds)
- [~] Apple App Store JWS verification (ES256 + x5c chain) — implemented, hardening for production
- [~] Google Play Developer API verification (service-account OAuth) — implemented, hardening for production
- [ ] iOS & Android SDKs (purchase + restore + caching) — in progress
- [ ] End-to-end verification against the live RevenueCat SDK via `proxyURL`
- [ ] App Store Server Notifications V2 + Google RTDN (server-driven renewals/refunds)
- [ ] Multi-tenancy (orgs/projects) + hosted version with self-serve accounts
- [ ] Postgres adapter for scale
- [ ] Visual paywall builder / templates
- [ ] Dashboard multi-user auth; sandbox vs production separation
- [ ] More SDKs (Flutter, React Native, Web, Unity)

## Contributing

**This project is built in the open and contributions are very welcome** — code, ideas,
docs, bug reports, or AI-assisted PRs. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[good first issues](../../issues). The API and SDK contracts in `docs/` are the place to
align before building.

## License

[MIT](LICENSE) © RevenueDog contributors. Not affiliated with RevenueCat, Apple, or Google.
