import Foundation

/// A store purchase awaiting (re)submission to the backend.
///
/// Persisted to disk so that a purchase is never lost if the backend is
/// unreachable at purchase time; retried on the next ``Purchases/configure``.
struct PendingReceipt: Codable, Equatable {
    let appUserId: String
    let fetchToken: String
    let productId: String
    let store: String
    let presentedOfferingIdentifier: String?
    let price: Decimal?
    let currency: String?

    var request: ReceiptRequest {
        ReceiptRequest(
            appUserId: appUserId,
            fetchToken: fetchToken,
            productId: productId,
            store: store,
            presentedOfferingIdentifier: presentedOfferingIdentifier,
            price: price,
            currency: currency
        )
    }
}

/// Disk-backed persistence (via `UserDefaults`) for identity, cached customer
/// info, and the pending-receipt queue.
final class Storage {

    private let defaults: UserDefaults
    private let prefix = "com.revenuedog."
    private let lock = NSLock()

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Identity

    private var appUserIDKey: String { prefix + "appUserID" }

    /// The persisted app user id, if one has been stored.
    func loadAppUserID() -> String? {
        lock.lock(); defer { lock.unlock() }
        return defaults.string(forKey: appUserIDKey)
    }

    /// Persists the current app user id.
    func saveAppUserID(_ id: String) {
        lock.lock(); defer { lock.unlock() }
        defaults.set(id, forKey: appUserIDKey)
    }

    // MARK: - CustomerInfo cache

    /// Wrapper stored on disk: the raw response payload plus its fetch time.
    private struct CachedEntry: Codable {
        let cachedAt: Date
        let payload: Data
    }

    private func customerInfoKey(_ appUserId: String) -> String {
        prefix + "customerInfo." + appUserId
    }

    /// Caches the raw subscriber response body for an app user id.
    func cacheCustomerInfo(payload: Data, forAppUserId appUserId: String, at date: Date = Date()) {
        lock.lock(); defer { lock.unlock() }
        let entry = CachedEntry(cachedAt: date, payload: payload)
        if let data = try? JSONEncoder().encode(entry) {
            defaults.set(data, forKey: customerInfoKey(appUserId))
        }
    }

    /// Returns the cached subscriber payload and its age, if present.
    func loadCachedCustomerInfo(forAppUserId appUserId: String) -> (payload: Data, cachedAt: Date)? {
        lock.lock(); defer { lock.unlock() }
        guard let data = defaults.data(forKey: customerInfoKey(appUserId)),
              let entry = try? JSONDecoder().decode(CachedEntry.self, from: data) else {
            return nil
        }
        return (entry.payload, entry.cachedAt)
    }

    /// Removes the cached customer info for an app user id.
    func clearCustomerInfo(forAppUserId appUserId: String) {
        lock.lock(); defer { lock.unlock() }
        defaults.removeObject(forKey: customerInfoKey(appUserId))
    }

    // MARK: - Pending receipts

    private var pendingReceiptsKey: String { prefix + "pendingReceipts" }

    /// Returns all queued pending receipts.
    func pendingReceipts() -> [PendingReceipt] {
        lock.lock(); defer { lock.unlock() }
        guard let data = defaults.data(forKey: pendingReceiptsKey),
              let receipts = try? JSONDecoder().decode([PendingReceipt].self, from: data) else {
            return []
        }
        return receipts
    }

    /// Replaces the queued pending receipts.
    func savePendingReceipts(_ receipts: [PendingReceipt]) {
        lock.lock(); defer { lock.unlock() }
        if receipts.isEmpty {
            defaults.removeObject(forKey: pendingReceiptsKey)
        } else if let data = try? JSONEncoder().encode(receipts) {
            defaults.set(data, forKey: pendingReceiptsKey)
        }
    }

    /// Appends a pending receipt to the queue (de-duplicated by fetch token).
    func addPendingReceipt(_ receipt: PendingReceipt) {
        var receipts = pendingReceipts()
        guard !receipts.contains(where: { $0.fetchToken == receipt.fetchToken }) else { return }
        receipts.append(receipt)
        savePendingReceipts(receipts)
    }
}
