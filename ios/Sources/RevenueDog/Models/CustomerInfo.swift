import Foundation

/// The store that originated a transaction or entitlement.
public enum Store: String, Sendable, Equatable {
    case appStore     = "app_store"
    case playStore    = "play_store"
    case promotional  = "promotional"
    case unknown      = "unknown"

    init(rawValueOrUnknown raw: String?) {
        self = raw.flatMap(Store.init(rawValue:)) ?? .unknown
    }
}

/// The billing period type for a subscription / entitlement.
public enum PeriodType: String, Sendable, Equatable {
    case normal
    case trial
    case intro

    init(rawValueOrNormal raw: String?) {
        self = raw.flatMap(PeriodType.init(rawValue:)) ?? .normal
    }
}

/// Information about a single entitlement (a feature/access level unlocked by
/// one or more products).
public struct EntitlementInfo: Sendable, Equatable {
    /// The entitlement identifier (e.g. `"pro"`).
    public let identifier: String

    /// Whether the entitlement currently grants access.
    ///
    /// Computed by comparing ``expirationDate`` against an anchored "now". The
    /// anchor is `max(deviceNow, requestDate)`, which tolerates a device clock
    /// that runs behind the server. A `nil` ``expirationDate`` (lifetime
    /// purchase) is always active.
    public let isActive: Bool

    /// Whether the subscription backing this entitlement will auto-renew.
    public let willRenew: Bool

    /// The period type at the time the customer info was generated.
    public let periodType: PeriodType

    /// The most recent purchase date for the backing product.
    public let latestPurchaseDate: Date?

    /// When the entitlement expires, or `nil` for lifetime / non-expiring.
    public let expirationDate: Date?

    /// The store product identifier backing this entitlement.
    public let productIdentifier: String

    /// The store the entitlement was purchased through.
    public let store: Store

    /// Pure, testable active computation.
    ///
    /// - Parameters:
    ///   - expirationDate: The entitlement expiration, or `nil` for lifetime.
    ///   - requestDate: The server `request_date` from the customer info.
    ///   - deviceNow: The current device time (injected for testing).
    /// - Returns: `true` when the entitlement is currently active.
    static func computeIsActive(expirationDate: Date?,
                                requestDate: Date,
                                deviceNow: Date = Date()) -> Bool {
        guard let expirationDate else { return true }
        let anchor = max(deviceNow, requestDate)
        return expirationDate > anchor
    }
}

/// Collection of all of a customer's entitlements.
public struct EntitlementInfos: Sendable, Equatable {
    /// Every entitlement known for the customer, keyed by identifier.
    public let all: [String: EntitlementInfo]

    /// Only the entitlements that are currently active.
    public var active: [String: EntitlementInfo] {
        all.filter { $0.value.isActive }
    }

    /// Look up an entitlement by identifier.
    public subscript(_ identifier: String) -> EntitlementInfo? {
        all[identifier]
    }

    /// Look up an entitlement by identifier.
    public func get(_ identifier: String) -> EntitlementInfo? {
        all[identifier]
    }

    public init(all: [String: EntitlementInfo]) {
        self.all = all
    }
}

/// A snapshot of a customer's purchase state, mirroring the backend
/// `CustomerInfo` shape from the REST contract.
public struct CustomerInfo: Sendable, Equatable {
    /// The original (first) app user id this subscriber was created with.
    public let originalAppUserId: String

    /// All entitlements for the customer.
    public let entitlements: EntitlementInfos

    /// Store product identifiers of currently-active subscriptions.
    public let activeSubscriptions: Set<String>

    /// Every product identifier the customer has ever purchased
    /// (subscriptions + non-subscriptions).
    public let allPurchasedProductIdentifiers: Set<String>

    /// The latest expiration date across all subscriptions, or `nil`.
    public let latestExpirationDate: Date?

    /// A URL the customer can use to manage their subscription, if provided.
    public let managementURL: URL?

    /// The server-reported time this info was generated.
    public let requestDate: Date

    public init(originalAppUserId: String,
                entitlements: EntitlementInfos,
                activeSubscriptions: Set<String>,
                allPurchasedProductIdentifiers: Set<String>,
                latestExpirationDate: Date?,
                managementURL: URL?,
                requestDate: Date) {
        self.originalAppUserId = originalAppUserId
        self.entitlements = entitlements
        self.activeSubscriptions = activeSubscriptions
        self.allPurchasedProductIdentifiers = allPurchasedProductIdentifiers
        self.latestExpirationDate = latestExpirationDate
        self.managementURL = managementURL
        self.requestDate = requestDate
    }
}
