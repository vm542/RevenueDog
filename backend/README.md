# RevenueDog Backend

The open-source subscription/IAP management API. Node 20+, TypeScript, Fastify, SQLite.

Implements [`../docs/API.md`](../docs/API.md) exactly.

## Run

```bash
npm install
npm run seed     # optional: populate demo data, prints pk_ / sk_ keys
npm run dev      # http://localhost:8787 (prints the root secret key)
```

On first run the server bootstraps a root secret key (`sk_…`) and prints it. Use it as
`Authorization: Bearer sk_…` for `/v1/admin/*` endpoints (and to log into the dashboard).

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Watch-mode dev server (tsx) |
| `npm run build` | Type-check + compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run seed` | Seed a demo app, products, offerings, an experiment, and ~220 subscribers |
| `npm test` | Run the Vitest suite |

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `0.0.0.0` | |
| `DATABASE_PATH` | `./data/revenuedog.db` | SQLite file (`:memory:` for ephemeral) |
| `CORS_ORIGIN` | `*` | Lock down to your dashboard origin in prod |
| `APPLE_VALIDATION` | `trust` | `apple` to enable App Store Server API (scaffold) |
| `GOOGLE_VALIDATION` | `trust` | `google` to enable Play Developer API (scaffold) |

## Layout

```
src/
  app.ts            Fastify app: error handling, CORS, route registration
  index.ts          Server entry
  config.ts         Env config
  db.ts             SQLite schema + connection
  auth.ts           pk_/sk_ key guards + root key bootstrap
  repo/             Data access (apps, products, entitlements, offerings, experiments, subscribers, receipts)
  services/         Business logic (customerInfo, offerings resolver, receipts, validators, analytics)
  routes/           public.ts (SDK) + admin.ts (dashboard/admin)
scripts/seed.ts     Demo data generator
test/               Vitest API + unit tests
```

## Receipt validation

Validators are pluggable (`src/services/validators.ts`). `trust` mode (default) accepts the
client's claim and computes expiry from the product's configured ISO-8601 duration — ideal for
local dev and sandbox. `apple`/`google` modes are scaffolds awaiting real implementations
(great first contributions!).
