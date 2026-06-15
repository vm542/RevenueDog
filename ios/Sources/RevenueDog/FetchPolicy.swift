import Foundation

/// Controls how ``Purchases/getCustomerInfo(fetchPolicy:)`` resolves
/// ``CustomerInfo`` between the local cache and the network.
public enum FetchPolicy: Sendable, Equatable {
    /// Return the cached value if it is younger than 5 minutes, otherwise hit
    /// the network. This is the default.
    case cachedOrFetch
    /// Always fetch a fresh value from the backend.
    case fetchCurrent
    /// Return the cached value if present and never hit the network. If no
    /// cache exists the SDK falls back to a network fetch (so a value is
    /// always returned).
    case cacheOnly

    /// The default policy used by ``Purchases/getCustomerInfo()``.
    public static let `default`: FetchPolicy = .cachedOrFetch
}
