# RevenueDog — Android SDK

The Android client for **RevenueDog**, an open-source RevenueCat alternative. It wraps Google
Play Billing for prices and purchases and talks to the RevenueDog backend (see
[`../docs/API.md`](../docs/API.md)) for entitlements, offerings and receipt validation.

- Kotlin, `minSdk 24`, AGP library module
- Google Play Billing **7.x**
- `suspend`-first API with `Callback` overloads
- SDK version `0.1.0`

## Install

This module (`:revenuedog`) publishes via `maven-publish` with coordinates
`com.revenuedog:revenuedog:0.1.0`.

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// app/build.gradle.kts
dependencies {
    implementation("com.revenuedog:revenuedog:0.1.0")
}
```

The library declares Google Play Billing as an `api` dependency, so you do not need to add
`billing-ktx` yourself.

## Quick start

### 1. Configure once (e.g. in `Application.onCreate`)

```kotlin
import com.revenuedog.purchases.Purchases
import com.revenuedog.purchases.PurchasesConfiguration
import com.revenuedog.purchases.LogLevel

class MyApp : Application() {
    override fun onCreate() {
        super.onCreate()

        Purchases.logLevel = LogLevel.DEBUG

        Purchases.configure(
            PurchasesConfiguration(this, apiKey = "pk_your_public_key") {
                // appUserId(null) -> SDK generates "$RevenueDogAnonymousID:<uuid>"
                appUserId("user_123")

                // Defaults to http://localhost:8787 in debuggable builds; required for release.
                baseUrl("https://api.yourhost.com")

                // One-time products that should be *consumed* rather than acknowledged.
                consumableProductIds(setOf("com.app.coins_100"))
            }
        )
    }
}
```

### 2. Show a paywall

```kotlin
val offerings = Purchases.sharedInstance.getOfferings()
val monthly = offerings.current?.monthly      // a Package backed by a priced StoreProduct
monthly?.let { pkg ->
    println(pkg.storeProduct.localizedPriceString)
}
```

### 3. Make a purchase

```kotlin
try {
    val result = Purchases.sharedInstance.purchase(activity, monthly!!)
    if (result.customerInfo.entitlements["pro"]?.isActive == true) {
        unlockPro()
    }
} catch (e: PurchasesError) {
    when (e.code) {
        PurchasesErrorCode.PURCHASE_CANCELLED -> { /* user backed out */ }
        PurchasesErrorCode.PENDING -> { /* deferred payment; will sync later */ }
        else -> showError(e)
    }
}
```

### 4. Observe entitlement changes

```kotlin
lifecycleScope.launch {
    Purchases.sharedInstance.customerInfoFlow.collect { info ->
        updateUi(info?.entitlements?.active?.containsKey("pro") == true)
    }
}

// or a one-shot listener (delivered on the main thread):
Purchases.sharedInstance.updatedCustomerInfoListener =
    UpdatedCustomerInfoListener { info -> updateUi(info) }
```

### 5. Identity, restore & attributes

```kotlin
val (info, created) = Purchases.sharedInstance.logIn("user_123")  // alias/merge identities
Purchases.sharedInstance.logOut()                                 // back to a new anonymous id
Purchases.sharedInstance.restorePurchases()                       // re-sync Play purchases
Purchases.sharedInstance.setEmail("a@b.com")                      // sugar for the $email attribute
```

Every `suspend` method above also has a `Callback<T>` overload (e.g.
`getOfferings(callback)`, `purchase(activity, pkg, callback)`) delivered on the main thread.

## Behavior notes

- **Caching & identity**: `CustomerInfo` is cached in memory and `SharedPreferences` per
  `appUserId`, considered stale after 5 minutes (see `FetchPolicy`). Offerings are cached for the
  session and invalidated on `logIn`/`logOut`. The current `appUserId` is persisted across launches.
- **Never lose a purchase**: after a successful Play purchase, the receipt is `POST`ed to
  `/v1/receipts` and then the purchase is acknowledged (subscriptions / non-consumables) or consumed
  (products listed in `consumableProductIds`). If the backend is unreachable, the receipt is queued
  in `SharedPreferences` and retried on the next `configure`.
- **Sweeps**: on `configure` and `restorePurchases` the SDK runs a `queryPurchasesAsync` sweep for
  `INAPP` and `SUBS`, plus a `PurchasesUpdatedListener` for out-of-band updates. `PENDING` purchases
  raise `PurchasesError(PENDING)`.
- **Entitlement expiry** is evaluated against `max(deviceNow, requestDate)` so a skewed device clock
  cannot wrongly expire an entitlement (v0 simplification, per the SDK spec).

## Building & testing

The module targets JDK 17 and Gradle 8.9+. Unit tests cover JSON parsing
(`CustomerInfo`/`Offerings`) and entitlement active/expiry logic.

```bash
cd android
./gradlew :revenuedog:compileDebugKotlin
./gradlew test
```
