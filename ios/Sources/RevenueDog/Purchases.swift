import Foundation

/// The entry point to the RevenueDog SDK.
///
/// Configure once at app launch:
///
/// ```swift
/// Purchases.logLevel = .debug
/// Purchases.configure(apiKey: "pk_live_…")
/// ```
///
/// then access the shared instance via ``Purchases/shared``.
///
/// All throwing methods throw ``PurchasesError``. Updates to the current
/// subscriber are delivered via ``customerInfoStream`` and ``delegate``.
public final class Purchases: @unchecked Sendable {

    // MARK: - Singleton management

    private static var _shared: Purchases?
    private static let configLock = NSLock()

    /// The shared, configured instance.
    ///
    /// - Important: Traps if accessed before ``configure(apiKey:appUserID:baseURL:)``.
    public static var shared: Purchases {
        configLock.lock(); defer { configLock.unlock() }
        guard let shared = _shared else {
            fatalError("\(Logger.prefix) Purchases.shared was accessed before configure(...) was called.")
        }
        return shared
    }

    /// Whether ``configure(apiKey:appUserID:baseURL:)`` has been called.
    public static var isConfigured: Bool {
        configLock.lock(); defer { configLock.unlock() }
        return _shared != nil
    }

    /// The global SDK log level. Defaults to ``LogLevel/info``.
    public static var logLevel: LogLevel {
        get { Logger.level }
        set { Logger.level = newValue }
    }

    /// Configures the SDK. Call once, as early as possible.
    ///
    /// - Parameters:
    ///   - apiKey: The public SDK key (`pk_…`).
    ///   - appUserID: A stable identifier for the current user. Pass `nil` to
    ///     have the SDK generate and persist an anonymous id of the form
    ///     `$RevenueDogAnonymousID:<uuid>`.
    ///   - baseURL: The backend base URL. Defaults to `http://localhost:8787`
    ///     in DEBUG builds; release builds should provide one explicitly.
    /// - Returns: The configured shared instance.
    @discardableResult
    public static func configure(apiKey: String,
                                 appUserID: String? = nil,
                                 baseURL: URL? = nil) -> Purchases {
        configLock.lock()
        if _shared != nil {
            Logger.warn("configure(...) called more than once. Replacing the existing instance.")
        }
        let resolvedBaseURL = resolveBaseURL(baseURL)
        let instance = Purchases(apiKey: apiKey, requestedAppUserID: appUserID, baseURL: resolvedBaseURL)
        _shared = instance
        configLock.unlock()

        Logger.info("Configured RevenueDog \(SDKConstants.sdkVersion) for appUserID \(instance.appUserID) (base: \(resolvedBaseURL.absoluteString)).")
        instance.start()
        return instance
    }

    private static func resolveBaseURL(_ url: URL?) -> URL {
        if let url { return url }
        #if DEBUG
        return SDKConstants.debugBaseURL
        #else
        Logger.error("No baseURL was provided. Release builds must specify a baseURL; falling back to \(SDKConstants.debugBaseURL.absoluteString), which will not work in production.")
        return SDKConstants.debugBaseURL
        #endif
    }

    // MARK: - Stored state

    private let apiClient: APIClient
    private let storage: Storage
    private let storeKit: StoreKitManager
    private let baseURL: URL

    private let lock = NSRecursiveLock()

    private var _appUserID: String
    private var memoryCustomerInfo: CustomerInfo?
    private var memoryCustomerInfoDate: Date?
    private var memoryOfferings: Offerings?
    private var streamContinuations: [UUID: AsyncStream<CustomerInfo>.Continuation] = [:]
    private var updatesTask: Task<Void, Never>?

    /// The delegate notified of customer info changes.
    public weak var delegate: PurchasesDelegate?

    private init(apiKey: String, requestedAppUserID: String?, baseURL: URL) {
        self.baseURL = baseURL
        let storage = Storage()
        self.storage = storage

        let resolvedUser: String
        if let requested = requestedAppUserID, !requested.isEmpty {
            resolvedUser = requested
        } else if let existing = storage.loadAppUserID() {
            resolvedUser = existing
        } else {
            resolvedUser = SDKConstants.anonymousIDPrefix + UUID().uuidString
        }
        storage.saveAppUserID(resolvedUser)
        self._appUserID = resolvedUser

        self.apiClient = APIClient(apiKey: apiKey, baseURL: baseURL)
        self.storeKit = StoreKitManager()

        if let cached = storage.loadCachedCustomerInfo(forAppUserId: resolvedUser),
           let info = try? CustomerInfoMapper.decode(cached.payload) {
            self.memoryCustomerInfo = info
            self.memoryCustomerInfoDate = cached.cachedAt
        }
    }

    /// Spins up background work after configuration: the StoreKit transaction
    /// listener, a pending-receipt retry pass, and an initial info refresh.
    private func start() {
        updatesTask = storeKit.listenForTransactions { [weak self] purchase in
            await self?.handleStoreKitUpdate(purchase)
        }
        Task { [weak self] in
            await self?.retryPendingReceipts()
            _ = try? await self?.getCustomerInfo(fetchPolicy: .fetchCurrent)
        }
    }

    // MARK: - Identity

    /// The current app user id.
    public var appUserID: String {
        withLock { _appUserID }
    }

    /// Whether the current ``appUserID`` is an SDK-generated anonymous id.
    public var isAnonymous: Bool {
        appUserID.hasPrefix(SDKConstants.anonymousIDPrefix)
    }

    // MARK: - Offerings & products

    /// Returns the configured offerings, resolving each package against the
    /// App Store. Cached in memory for the session.
    public func getOfferings() async throws -> Offerings {
        if let cached = withLock({ memoryOfferings }) {
            return cached
        }

        let dto = try await apiClient.getOfferings(appUserId: appUserID)

        let productIds = Array(Set(dto.offerings.flatMap { $0.packages.map(\.platformProductIdentifier) }))
        let products = try await storeKit.fetchProducts(productIds)
        let productsByID = Dictionary(products.map { ($0.productIdentifier, $0) }, uniquingKeysWith: { first, _ in first })

        var allOfferings: [String: Offering] = [:]
        for offeringDTO in dto.offerings {
            var packages: [Package] = []
            for packageDTO in offeringDTO.packages {
                guard let product = productsByID[packageDTO.platformProductIdentifier] else {
                    Logger.warn("Dropping package \(packageDTO.identifier): store returned no product for \(packageDTO.platformProductIdentifier).")
                    continue
                }
                packages.append(
                    Package(
                        identifier: packageDTO.identifier,
                        packageType: PackageType(identifier: packageDTO.identifier),
                        storeProduct: product,
                        offeringIdentifier: offeringDTO.identifier
                    )
                )
            }
            allOfferings[offeringDTO.identifier] = Offering(
                identifier: offeringDTO.identifier,
                serverDescription: offeringDTO.description,
                metadata: offeringDTO.metadata.anyDictionary,
                availablePackages: packages
            )
        }

        let current = dto.currentOfferingId.flatMap { allOfferings[$0] }
        let offerings = Offerings(current: current, all: allOfferings)
        withLock { memoryOfferings = offerings }
        return offerings
    }

    /// Loads ``StoreProduct``s for the given store identifiers.
    public func getProducts(_ identifiers: [String]) async throws -> [StoreProduct] {
        try await storeKit.fetchProducts(identifiers)
    }

    // MARK: - Purchasing

    /// Purchases a ``Package`` from an offering.
    public func purchase(package: Package) async throws -> PurchaseResult {
        try await performPurchase(
            product: package.storeProduct,
            presentedOfferingIdentifier: package.offeringIdentifier
        )
    }

    /// Purchases a ``StoreProduct`` directly.
    public func purchase(product: StoreProduct) async throws -> PurchaseResult {
        try await performPurchase(product: product, presentedOfferingIdentifier: nil)
    }

    private func performPurchase(product: StoreProduct,
                                 presentedOfferingIdentifier: String?) async throws -> PurchaseResult {
        Logger.info("Starting purchase for \(product.productIdentifier).")
        let verified = try await storeKit.purchase(product)

        let receipt = PendingReceipt(
            appUserId: appUserID,
            fetchToken: verified.jws,
            productId: product.productIdentifier,
            store: Store.appStore.rawValue,
            presentedOfferingIdentifier: presentedOfferingIdentifier,
            price: product.price,
            currency: product.currencyCode
        )

        do {
            let data = try await apiClient.postReceipt(receipt.request)
            let info = try CustomerInfoMapper.decode(data)
            await verified.finish()
            cacheAndEmit(info, payload: data)
            Logger.info("Purchase of \(product.productIdentifier) completed.")
            return PurchaseResult(customerInfo: info, storeTransaction: verified.storeTransaction)
        } catch let error as PurchasesError where error.code == .networkError {
            // Store purchase succeeded but the backend is unreachable. Queue it
            // and leave the transaction unfinished so it is retried later.
            Logger.warn("Backend unreachable after purchase; queueing receipt for retry.")
            storage.addPendingReceipt(receipt)
            throw error
        }
    }

    // MARK: - Restore

    /// Restores purchases by re-submitting the user's current StoreKit
    /// entitlements, then returns a fresh ``CustomerInfo``.
    public func restorePurchases() async throws -> CustomerInfo {
        Logger.info("Restoring purchases.")
        let purchases = await storeKit.currentEntitlements()
        for purchase in purchases {
            let receipt = PendingReceipt(
                appUserId: appUserID,
                fetchToken: purchase.jws,
                productId: purchase.storeTransaction.productIdentifier,
                store: Store.appStore.rawValue,
                presentedOfferingIdentifier: nil,
                price: nil,
                currency: nil
            )
            do {
                _ = try await apiClient.postReceipt(receipt.request)
                await purchase.finish()
            } catch let error as PurchasesError where error.code == .networkError {
                storage.addPendingReceipt(receipt)
                throw error
            }
        }
        return try await getCustomerInfo(fetchPolicy: .fetchCurrent)
    }

    // MARK: - CustomerInfo

    /// Returns the customer info using the default fetch policy
    /// (``FetchPolicy/cachedOrFetch``).
    public func getCustomerInfo() async throws -> CustomerInfo {
        try await getCustomerInfo(fetchPolicy: .default)
    }

    /// Returns the customer info honoring the given ``FetchPolicy``.
    public func getCustomerInfo(fetchPolicy: FetchPolicy) async throws -> CustomerInfo {
        switch fetchPolicy {
        case .fetchCurrent:
            return try await fetchAndCacheCustomerInfo()
        case .cacheOnly:
            if let cached = cachedInfoWithDate()?.0 { return cached }
            return try await fetchAndCacheCustomerInfo()
        case .cachedOrFetch:
            if let (info, date) = cachedInfoWithDate(),
               Date().timeIntervalSince(date) < SDKConstants.cacheStaleInterval {
                return info
            }
            return try await fetchAndCacheCustomerInfo()
        }
    }

    @discardableResult
    private func fetchAndCacheCustomerInfo() async throws -> CustomerInfo {
        let user = appUserID
        let data = try await apiClient.getSubscriber(appUserId: user)
        let info = try CustomerInfoMapper.decode(data)
        cacheAndEmit(info, payload: data)
        return info
    }

    // MARK: - Identity changes

    /// Aliases the current identity to `appUserID` (login). Returns the merged
    /// customer info and whether a new subscriber was created.
    public func logIn(_ appUserID: String) async throws -> (customerInfo: CustomerInfo, created: Bool) {
        let current = self.appUserID
        guard appUserID != current else {
            return (try await getCustomerInfo(fetchPolicy: .fetchCurrent), false)
        }

        Logger.info("Logging in: \(current) → \(appUserID).")
        let data = try await apiClient.postAlias(appUserId: current, newAppUserId: appUserID)
        let (info, created) = try CustomerInfoMapper.decodeAlias(data)

        switchIdentity(to: appUserID)
        storage.cacheCustomerInfo(payload: data, forAppUserId: appUserID)
        cacheAndEmit(info, payload: nil)
        return (info, created)
    }

    /// Logs out the current user and generates a fresh anonymous identity.
    ///
    /// - Throws: ``PurchasesError`` with code `configurationError` if the
    ///   current user is already anonymous.
    public func logOut() async throws -> CustomerInfo {
        guard !isAnonymous else {
            throw PurchasesError.configuration("Cannot log out: the current user is already anonymous.")
        }
        Logger.info("Logging out \(appUserID).")
        let newAnonymous = SDKConstants.anonymousIDPrefix + UUID().uuidString
        switchIdentity(to: newAnonymous)
        return try await fetchAndCacheCustomerInfo()
    }

    private func switchIdentity(to newID: String) {
        withLock {
            let old = _appUserID
            storage.clearCustomerInfo(forAppUserId: old)
            _appUserID = newID
            memoryCustomerInfo = nil
            memoryCustomerInfoDate = nil
            memoryOfferings = nil
        }
        storage.saveAppUserID(newID)
    }

    // MARK: - Attributes

    /// Sets subscriber attributes. Pass `nil` for a key to delete it.
    public func setAttributes(_ attributes: [String: String?]) async {
        do {
            try await apiClient.postAttributes(appUserId: appUserID, attributes: attributes)
        } catch {
            Logger.error("Failed to set attributes: \(error)")
        }
    }

    /// Convenience for setting (or clearing) the reserved `$email` attribute.
    public func setEmail(_ email: String?) async {
        await setAttributes(["$email": email])
    }

    // MARK: - GDPR

    /// Deletes the current subscriber's data on the backend (GDPR delete) and
    /// clears local caches.
    public func deleteSubscriberData() async throws {
        let user = appUserID
        try await apiClient.deleteSubscriber(appUserId: user)
        storage.clearCustomerInfo(forAppUserId: user)
        withLock {
            memoryCustomerInfo = nil
            memoryCustomerInfoDate = nil
            memoryOfferings = nil
        }
    }

    // MARK: - Streaming

    /// An async sequence that emits the current ``CustomerInfo`` (if cached) on
    /// subscription and on every subsequent change.
    public var customerInfoStream: AsyncStream<CustomerInfo> {
        AsyncStream { continuation in
            let id = UUID()
            let current: CustomerInfo? = withLock {
                streamContinuations[id] = continuation
                return memoryCustomerInfo
            }
            if let current {
                continuation.yield(current)
            }
            continuation.onTermination = { [weak self] _ in
                self?.withLock { self?.streamContinuations[id] = nil }
            }
        }
    }

    // MARK: - Internal helpers

    private func handleStoreKitUpdate(_ purchase: VerifiedPurchase) async {
        Logger.info("Received StoreKit transaction update for \(purchase.storeTransaction.productIdentifier).")
        let receipt = PendingReceipt(
            appUserId: appUserID,
            fetchToken: purchase.jws,
            productId: purchase.storeTransaction.productIdentifier,
            store: Store.appStore.rawValue,
            presentedOfferingIdentifier: nil,
            price: nil,
            currency: nil
        )
        do {
            let data = try await apiClient.postReceipt(receipt.request)
            let info = try CustomerInfoMapper.decode(data)
            await purchase.finish()
            cacheAndEmit(info, payload: data)
        } catch {
            Logger.warn("Failed to process transaction update; queueing for retry: \(error)")
            storage.addPendingReceipt(receipt)
        }
    }

    private func retryPendingReceipts() async {
        let pending = storage.pendingReceipts()
        guard !pending.isEmpty else { return }
        Logger.info("Retrying \(pending.count) pending receipt(s).")

        var remaining: [PendingReceipt] = []
        var latest: (CustomerInfo, Data)?
        for receipt in pending {
            do {
                let data = try await apiClient.postReceipt(receipt.request)
                let info = try CustomerInfoMapper.decode(data)
                latest = (info, data)
            } catch let error as PurchasesError where error.code == .networkError {
                remaining.append(receipt)
            } catch {
                Logger.error("Dropping pending receipt for \(receipt.productId): \(error)")
            }
        }
        storage.savePendingReceipts(remaining)
        if let (info, data) = latest {
            cacheAndEmit(info, payload: data)
        }
    }

    private func cachedInfoWithDate() -> (CustomerInfo, Date)? {
        if let result: (CustomerInfo, Date)? = withLock({
            if let info = memoryCustomerInfo, let date = memoryCustomerInfoDate {
                return (info, date)
            }
            return nil
        }) {
            return result
        }
        let user = appUserID
        guard let cached = storage.loadCachedCustomerInfo(forAppUserId: user),
              let info = try? CustomerInfoMapper.decode(cached.payload) else {
            return nil
        }
        withLock {
            memoryCustomerInfo = info
            memoryCustomerInfoDate = cached.cachedAt
        }
        return (info, cached.cachedAt)
    }

    private func cacheAndEmit(_ info: CustomerInfo, payload: Data?) {
        let user = appUserID
        let changed: Bool = withLock {
            let changed = memoryCustomerInfo != info
            memoryCustomerInfo = info
            memoryCustomerInfoDate = Date()
            return changed
        }
        if let payload {
            storage.cacheCustomerInfo(payload: payload, forAppUserId: user)
        }
        guard changed else { return }
        emit(info)
    }

    private func emit(_ info: CustomerInfo) {
        let continuations: [AsyncStream<CustomerInfo>.Continuation] = withLock {
            Array(streamContinuations.values)
        }
        for continuation in continuations {
            continuation.yield(info)
        }
        let delegate = self.delegate
        if let delegate {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                delegate.purchases(self, receivedUpdated: info)
            }
        }
    }

    @discardableResult
    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }
}
