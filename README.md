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

RevenueCat is great — but it's a paid SaaS that takes a cut of your revenue and holds your
customer data. **RevenueDog gives you the same core workflow, self-hosted and free:**

- 🧾 **Cross-platform purchases** — one SDK surface for StoreKit 2 (iOS) and Google Play Billing (Android).
- 🔑 **Entitlements** — map products to access levels; check `customerInfo.entitlements["pro"].isActive`.
- 🏷️ **Offerings & paywalls** — configure packages remotely, no app release required.
- 🧪 **Experiments** — A/B test paywalls with deterministic, sticky assignment and conversion tracking.
- 📊 **Analytics dashboard** — MRR, revenue, active subscriptions, trials, churn, revenue-by-product, recent transactions, plus a **conversion funnel, LTV, and retention cohorts**.
- 🔔 **Webhooks** — HMAC-signed events (purchase, renewal, trial, expiration, billing issue…) with a delivery log.
- 🩺 **SDK diagnostics** — see at a glance whether each app's SDK has connected, with platform & version.
- 📖 **Interactive API docs** — OpenAPI 3.1 spec served at `/docs`.
- 🗄️ **Your data** — SQLite by default; everything runs on your own box.

> ⚠️ **Alpha.** The backend, dashboard, and SDK scaffolding are functional and tested.
> Apple/Google server-side receipt verification ships as a pluggable interface with
> trust-mode for development. See the [roadmap](#roadmap).

## What's in the box

| Component | Stack | Status |
|---|---|---|
| **Backend API** | Node 20+, TypeScript, Fastify, better-sqlite3, Zod | ✅ Working, 14 tests passing |
| **Dashboard** | React 19, Vite, Tailwind v4, Recharts | ✅ Working |
| **iOS SDK** | Swift Package, StoreKit 2 | 🚧 In progress |
| **Android SDK** | Kotlin, Play Billing 7 | 🚧 In progress |
| **API contract** | [`docs/API.md`](docs/API.md) | ✅ Source of truth |
| **SDK surface** | [`docs/SDK_SURFACE.md`](docs/SDK_SURFACE.md) | ✅ Source of truth |

## Quick start (60 seconds)

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
- [x] Real Apple App Store JWS verification (ES256 + x5c chain, optional root pinning)
- [x] Real Google Play Developer API verification (service-account OAuth)
- [x] iOS & Android SDKs (purchase + restore + caching)
- [ ] Postgres adapter for scale
- [ ] Docker Compose one-command deploy
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
