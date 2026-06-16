# RevenueDog iOS sample (SwiftUI)

A minimal paywall + entitlement gate demonstrating the full SDK flow:

`configure` → `getOfferings()` → `purchase(package:)` → check
`customerInfo.entitlements["pro"].isActive`.

## Run it

1. In Xcode, create a new **iOS App** (SwiftUI lifecycle).
2. Add the **RevenueDog** package: *File → Add Package Dependencies…* → *Add Local…*
   and pick the repo's `ios/` folder (or use the Git URL once published).
3. Replace the generated `App.swift` with [`SampleApp.swift`](SampleApp.swift).
4. Set `API_KEY` (your app's iOS key from the RevenueDog dashboard — `appl_…`
   or `pk_…`) and `BASE_URL` (your backend, e.g. `http://localhost:8787`).
5. Add a **StoreKit Configuration** file with products whose ids match the
   `store_identifier`s you configured in the dashboard, and select it in your
   scheme (*Run → Options → StoreKit Configuration*). This lets you test
   purchases in the simulator without App Store Connect.
6. Run.

## Backend setup (once)

In the RevenueDog dashboard: create an **app**, add **products** matching your
StoreKit ids, and an **entitlement** `pro` mapped to those products, then mark
an **offering** as current. The sample reads the current offering's packages.

> Local/sandbox testing uses the backend's default trust-mode validation.
> For production, configure real Apple validation (`APPLE_VALIDATION=apple`).
