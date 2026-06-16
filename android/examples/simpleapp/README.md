# RevenueDog Android sample (Jetpack Compose)

A minimal paywall + entitlement gate demonstrating the full SDK flow:

`configure` → `getOfferings()` → `purchase(activity, package)` → check
`customerInfo.entitlements.all["pro"].isActive`.

## Run it

1. Create an Android app module (Compose enabled) that depends on the
   `:revenuedog` SDK module:
   ```kotlin
   // settings.gradle.kts already includes :revenuedog
   dependencies { implementation(project(":revenuedog")) }
   ```
2. Add [`MainActivity.kt`](MainActivity.kt) to your app module (adjust the
   `package` and register the activity in `AndroidManifest.xml`).
3. Set `API_KEY` (your app's Android key from the dashboard — `goog_…` or
   `pk_…`). `BASE_URL` defaults to `http://10.0.2.2:8787`, which is how the
   Android emulator reaches a backend running on your host machine.
4. Configure matching products in Google Play Console (and a license-tester
   account) to test real Play Billing, or run against the backend in trust
   mode for end-to-end wiring.
5. Run on an emulator or device with Google Play.

## Backend setup (once)

In the RevenueDog dashboard: create an **app** (set its `package_name`), add
**products** matching your Play product ids, an **entitlement** `pro` mapped to
them, and mark an **offering** as current.

> For production, set `GOOGLE_VALIDATION=google` with a Play service account so
> receipts are verified server-side.
