# RevenueDog Dashboard

The analytics & configuration UI. React 19, Vite, Tailwind v4, Recharts.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

On first load, enter your backend URL (default `http://localhost:8787`) and a **secret key**
(`sk_…`, printed by the backend on boot or by `npm run seed`). The connection is stored in
your browser's localStorage and only ever talks to your backend.

## Build

```bash
npm run build    # type-checks (tsc -b) then builds to dist/
npm run preview  # serve the production build locally
```

## Pages

- **Overview** — MRR, revenue, active subscriptions, trials, customers; revenue/active/new-customer
  charts, subscription-status donut, revenue-by-product, recent transactions.
- **Customers** — subscriber list + detail (entitlements, subscriptions, attributes); grant/revoke
  promotional entitlements.
- **Products** — CRUD for store products.
- **Entitlements** — CRUD; attach products.
- **Offerings** — CRUD paywall configs with packages; set the current offering.
- **Experiments** — create/stop A/B tests; live conversion results per variant.
- **Apps & Keys** — manage apps and copy public SDK keys (`pk_…`).

All data comes from the backend's `/v1/admin/*` endpoints.
