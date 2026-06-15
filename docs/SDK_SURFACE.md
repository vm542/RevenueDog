# RevenueDog SDK Public Surface (iOS + Android)

Both SDKs expose the same conceptual API, adapted to platform idiom. Names below
are normative. The SDKs talk to the backend per `docs/API.md` and to the native
store (StoreKit 2 / Google Play Billing) for prices and purchase flows.

## Entry point: `Purchases` singleton

| Concept | iOS (Swift) | Android (Kotlin) |
|---|---|---|
| Configure | `Purchases.configure(apiKey:appUserID:baseURL:)` | `Purchases.configure(PurchasesConfiguration(context, apiKey) { appUserId(...); baseUrl(...) })` |
| Singleton | `Purchases.shared` | `Purchases.sharedInstance` |
| Is configured | `Purchases.isConfigured` | `Purchases.isConfigured` |

- `appUserID == nil` → SDK generates `$RevenueDogAnonymousID:<uuid>` and persists it
  (Keychain-independent: UserDefaults / SharedPreferences is fine for v0).
- `baseURL` defaults to `http://localhost:8787` only in DEBUG; release builds require it.
- Configure twice → log warning, replace instance (RevenueCat behavior).

## Core methods (all async-first; Android also offers callback overloads)

```swift
// iOS — async/await, all throwing methods throw PurchasesError
var appUserID: String { get }
var isAnonymous: Bool { get }

func getOfferings() async throws -> Offerings
func getProducts(_ identifiers: [String]) async throws -> [StoreProduct]
func purchase(package: Package) async throws -> PurchaseResult
func purchase(product: StoreProduct) async throws -> PurchaseResult
func getCustomerInfo() async throws -> CustomerInfo          // cached, see policy below
func getCustomerInfo(fetchPolicy: FetchPolicy) async throws -> CustomerInfo
func restorePurchases() async throws -> CustomerInfo
func logIn(_ appUserID: String) async throws -> (customerInfo: CustomerInfo, created: Bool)
func logOut() async throws -> CustomerInfo                   // back to new anonymous id
func setAttributes(_ attributes: [String: String?]) async
func setEmail(_ email: String?) async                        // sugar for $email
var customerInfoStream: AsyncStream<CustomerInfo> { get }    // emits on every change
weak var delegate: PurchasesDelegate?                        // purchases(_:receivedUpdated:)
```

```kotlin
// Android — suspend functions + callback overloads (awaitX naming not needed; suspend is primary)
val appUserId: String
val isAnonymous: Boolean

suspend fun getOfferings(): Offerings
suspend fun getProducts(identifiers: List<String>): List<StoreProduct>
suspend fun purchase(activity: Activity, packageToPurchase: Package): PurchaseResult
suspend fun purchase(activity: Activity, product: StoreProduct): PurchaseResult
suspend fun getCustomerInfo(fetchPolicy: FetchPolicy = FetchPolicy.CACHED_OR_FETCH): CustomerInfo
suspend fun restorePurchases(): CustomerInfo
suspend fun logIn(appUserId: String): LogInResult            // (customerInfo, created)
suspend fun logOut(): CustomerInfo
suspend fun setAttributes(attributes: Map<String, String?>)
suspend fun setEmail(email: String?)
val customerInfoFlow: StateFlow<CustomerInfo?>               // emits on every change
var updatedCustomerInfoListener: UpdatedCustomerInfoListener?
```

Throwing/callback errors use a single error type `PurchasesError` with a stable
`code` enum: `networkError`, `purchaseCancelled`, `purchaseInvalid`,
`productNotFound`, `receiptValidationFailed`, `storeProblem`, `configurationError`,
`pending` (Android deferred purchases), `unknown`.

## FetchPolicy
`CACHED_OR_FETCH` (default — return cache if < 5 min old, else network),
`FETCH_CURRENT` (always network), `CACHE_ONLY`.

## Model types (shared shape, platform-native implementations)

### `Offerings`
- `current: Offering?`
- `all: [String: Offering]`
- `offering(identifier:)` / `get(identifier)`

### `Offering`
- `identifier: String`, `serverDescription: String`, `metadata: [String: Any]`
- `availablePackages: [Package]`
- Convenience accessors: `lifetime`, `annual`, `sixMonth`, `threeMonth`,
  `twoMonth`, `monthly`, `weekly` (match `$rd_*` ids), `package(identifier:)`

### `Package`
- `identifier: String` (e.g. `$rd_monthly`)
- `packageType: PackageType` (LIFETIME, ANNUAL, SIX_MONTH, THREE_MONTH, TWO_MONTH, MONTHLY, WEEKLY, CUSTOM, UNKNOWN)
- `storeProduct: StoreProduct` (already fetched from the native store)
- `offeringIdentifier: String`

A package whose product the native store cannot return is dropped from
`availablePackages` (log a warning) — never surface a package without a price.

### `StoreProduct`
- `productIdentifier: String`
- `localizedTitle: String`, `localizedDescription: String`
- `price: Decimal`/`BigDecimal`, `currencyCode: String`, `localizedPriceString: String`
- `subscriptionPeriod: SubscriptionPeriod?` (`unit` + `value`)
- `introductoryDiscount` / free-trial info where the store exposes it
- Wraps the native object (`StoreKit.Product` / `ProductDetails`) and exposes it
  (`underlyingSK2Product` / `underlyingProductDetails`) for escape hatches.

### `CustomerInfo`
- `originalAppUserId: String`
- `entitlements: EntitlementInfos` →
  - `all: [String: EntitlementInfo]`, `active: [String: EntitlementInfo]`
  - subscript / `get(identifier)`
- `EntitlementInfo`: `identifier`, `isActive: Bool`, `willRenew: Bool`,
  `periodType`, `latestPurchaseDate`, `expirationDate?`, `productIdentifier`, `store`
- `activeSubscriptions: Set<String>`, `allPurchasedProductIdentifiers: Set<String>`
- `latestExpirationDate: Date?`, `managementURL: URL?`, `requestDate: Date`
- `isActive` compares `expirationDate` against `requestDate`-anchored now
  (now = deviceNow + (requestDate − deviceReceivedAt) skew correction is NOT required for v0;
  comparing against max(deviceNow, requestDate) is acceptable — document the choice).

### `PurchaseResult`
- `customerInfo: CustomerInfo`
- `storeTransaction: StoreTransaction` (`productIdentifier`, `transactionIdentifier`, `purchaseDate`)
- iOS: `userCancelled` surfaces as thrown `purchaseCancelled` error, not a result flag.
- Android: user cancel → throw `PurchasesError(purchaseCancelled)`; `PENDING` purchases throw `pending`.

## Purchase flow (both platforms)

1. Launch native purchase (StoreKit 2 `product.purchase()` / BillingClient `launchBillingFlow`).
2. On success, obtain the token (iOS: JWS representation of the verified transaction;
   Android: `purchaseToken`).
3. `POST /v1/receipts` with product id, token, store, presented offering id, price, currency.
4. On 200: finish the transaction (iOS `transaction.finish()`; Android acknowledge or
   consume based on product type — consume only `consumable` products).
5. Update cached CustomerInfo, notify stream/listener + delegate.
6. Backend unreachable after a successful store purchase → queue the receipt
   locally and retry on next app foreground/configure (never lose a purchase).
   v0: persist pending receipts in UserDefaults/SharedPreferences and retry on configure.

`restorePurchases`: iOS — iterate `Transaction.currentEntitlements`, POST each;
Android — `queryPurchasesAsync` for INAPP + SUBS, POST each. Then return fresh CustomerInfo.

Unfinished-transaction listeners run from configure time: iOS `Transaction.updates`
task; Android `PurchasesUpdatedListener` + a `queryPurchasesAsync` sweep on configure.

## Caching & identity

- CustomerInfo cached in memory + disk per appUserId; stale after 5 min (see FetchPolicy).
- Offerings cached in memory for the session; invalidated on logIn/logOut.
- `logIn`: POST alias from current id → new id, swap identity, refresh caches.
- `logOut`: clear caches, generate new anonymous id. Error if already anonymous.

## Logging

`Purchases.logLevel: LogLevel` (`verbose|debug|info|warn|error`), default `info`,
prefix `[RevenueDog]`. Log every request (debug), every purchase lifecycle step (info).

## Packaging

- iOS: Swift Package `RevenueDog`, `// swift-tools-version:5.9`, platforms iOS 15+ / macOS 12+,
  zero external dependencies. Unit tests with mocked network + store where practical.
- Android: Gradle module `revenuedog` (AGP library), Kotlin 1.9+, minSdk 24,
  deps: billing-ktx 7.x, kotlinx-coroutines, kotlinx-serialization-json, okhttp 4.x.
  Publishable via maven-publish. Unit tests for JSON parsing + entitlement logic.
