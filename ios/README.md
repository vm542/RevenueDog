# RevenueDog iOS SDK

The iOS SDK for **RevenueDog**, an open-source RevenueCat alternative. It wraps
StoreKit 2 for prices and purchases and talks to the RevenueDog backend for
entitlements, offerings, and customer info.

- Swift Package, `// swift-tools-version:5.9`
- Platforms: iOS 15+ / macOS 12+
- Zero external dependencies
- RevenueCat-style API surface

## Installation (Swift Package Manager)

### Xcode

File → Add Package Dependencies… and enter the repository URL, or add it to your
`Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/your-org/revenuedog-ios.git", from: "0.1.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "RevenueDog", package: "revenuedog-ios")
        ]
    )
]
```

### Local path

```swift
.package(path: "../ios")
```

## Quick start

```swift
import RevenueDog

// 1. Configure once at launch. Pass `appUserID: nil` to use an anonymous id.
Purchases.logLevel = .debug
Purchases.configure(
    apiKey: "pk_your_public_key",
    appUserID: nil,
    baseURL: URL(string: "https://api.yourhost.com")   // DEBUG defaults to http://localhost:8787
)

// 2. Show a paywall from the current offering.
let offerings = try await Purchases.shared.getOfferings()
if let monthly = offerings.current?.monthly {
    print(monthly.storeProduct.localizedPriceString)

    // 3. Purchase. User cancellation throws PurchasesError(.purchaseCancelled).
    do {
        let result = try await Purchases.shared.purchase(package: monthly)
        if result.customerInfo.entitlements["pro"]?.isActive == true {
            // Unlock pro features.
        }
    } catch let error as PurchasesError where error.code == .purchaseCancelled {
        // User backed out — no-op.
    }
}

// 4. Gate features off cached customer info.
let info = try await Purchases.shared.getCustomerInfo()
let isPro = info.entitlements["pro"]?.isActive ?? false

// 5. React to changes (e.g. renewals, restores) anywhere in your app.
Task {
    for await info in Purchases.shared.customerInfoStream {
        updateUI(isPro: info.entitlements["pro"]?.isActive ?? false)
    }
}
```

### Identity

```swift
// Log in a known user (merges the anonymous identity into it).
let (info, created) = try await Purchases.shared.logIn("user_123")

// Log out — generates a fresh anonymous id.
let anonInfo = try await Purchases.shared.logOut()

// Attributes (pass nil to delete).
await Purchases.shared.setEmail("a@b.com")
await Purchases.shared.setAttributes(["plan_intent": "pro"])
```

### Restore

```swift
let info = try await Purchases.shared.restorePurchases()
```

## Error handling

Every throwing method throws ``PurchasesError``. Switch on its stable
`code` (`networkError`, `purchaseCancelled`, `purchaseInvalid`,
`productNotFound`, `receiptValidationFailed`, `storeProblem`,
`configurationError`, `pending`, `unknown`).

## Notes on behavior

- **Anonymous ids** look like `$RevenueDogAnonymousID:<uuid>` and are persisted
  in `UserDefaults`.
- **CustomerInfo** is cached in memory and on disk per app user id; the default
  `FetchPolicy.cachedOrFetch` returns the cache when it is younger than 5
  minutes.
- **Offerings** are cached in memory for the session and invalidated on
  `logIn` / `logOut`.
- **Never lose a purchase:** if the backend is unreachable after a successful
  store purchase, the receipt is persisted and retried on the next
  `configure`, alongside a `Transaction.updates` listener.
- **Entitlement activeness** compares `expirationDate` against
  `max(deviceNow, requestDate)` to tolerate a device clock running behind the
  server.

## Development

```bash
cd ios
swift build
swift test
```

The test suite covers JSON parsing of `CustomerInfo` / `Offerings` and the
entitlement active/expiry logic, and runs without network or StoreKit.
