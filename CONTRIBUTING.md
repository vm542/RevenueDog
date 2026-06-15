# Contributing to RevenueDog

Thanks for helping build an open-source RevenueCat alternative! Contributions of all
kinds are welcome — code, docs, design, bug reports, and AI-assisted PRs.

## Ground rules

1. **`docs/API.md` and `docs/SDK_SURFACE.md` are the source of truth.** If a change affects
   the API or SDK shape, update the docs in the same PR (or open a docs-first PR to discuss).
2. Keep components decoupled: the backend, dashboard, iOS, and Android SDKs each stand alone
   and only depend on the documented contract.
3. Small, focused PRs are easier to review than large ones.

## Dev setup

```bash
# Backend
cd backend && npm install && npm test && npm run dev

# Dashboard
cd dashboard && npm install && npm run dev

# iOS SDK
cd ios && swift build && swift test

# Android SDK
cd android && ./gradlew test
```

## Before you open a PR

- **Backend:** `npm run build` (type-check) and `npm test` must pass. Add tests for new behavior.
- **Dashboard:** `npm run build` must pass (it type-checks).
- **SDKs:** keep the public surface aligned with `docs/SDK_SURFACE.md`; add/keep unit tests for
  JSON parsing and entitlement logic.
- Match the existing code style. No linter config is enforced yet — keep it clean and consistent.

## Good places to start

- Implement real Apple / Google receipt verification (`backend/src/services/validators.ts`).
- Flesh out the iOS and Android SDKs (`ios/`, `android/`).
- Add webhooks, a Postgres adapter, or a Docker Compose deploy.
- Dashboard polish: filters, date pickers, customer search, paywall preview.

## Commit & PR style

- Conventional-ish messages are appreciated (`feat:`, `fix:`, `docs:`, `chore:`).
- Describe the "why" in the PR body. Link any related issue.

## Code of conduct

Be kind and constructive. We're all here to ship a great tool together.
