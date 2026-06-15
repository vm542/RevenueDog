import Foundation

/// A named collection of purchasable ``Package``s, typically backing one
/// paywall.
public struct Offering {
    /// The offering identifier (e.g. `"default"`).
    public let identifier: String
    /// The server-provided description for this offering.
    public let serverDescription: String
    /// Arbitrary server-defined metadata.
    public let metadata: [String: Any]
    /// The packages available in this offering. Packages whose product the
    /// store could not resolve are omitted.
    public let availablePackages: [Package]

    public init(identifier: String,
                serverDescription: String,
                metadata: [String: Any],
                availablePackages: [Package]) {
        self.identifier = identifier
        self.serverDescription = serverDescription
        self.metadata = metadata
        self.availablePackages = availablePackages
    }

    /// Look up a package by its RevenueDog identifier.
    public func package(identifier: String) -> Package? {
        availablePackages.first { $0.identifier == identifier }
    }

    private func package(ofType type: PackageType) -> Package? {
        availablePackages.first { $0.packageType == type }
    }

    /// The `$rd_lifetime` package, if present.
    public var lifetime: Package?   { package(ofType: .lifetime) }
    /// The `$rd_annual` package, if present.
    public var annual: Package?     { package(ofType: .annual) }
    /// The `$rd_six_month` package, if present.
    public var sixMonth: Package?   { package(ofType: .sixMonth) }
    /// The `$rd_three_month` package, if present.
    public var threeMonth: Package? { package(ofType: .threeMonth) }
    /// The `$rd_two_month` package, if present.
    public var twoMonth: Package?   { package(ofType: .twoMonth) }
    /// The `$rd_monthly` package, if present.
    public var monthly: Package?    { package(ofType: .monthly) }
    /// The `$rd_weekly` package, if present.
    public var weekly: Package?     { package(ofType: .weekly) }
}

// Allow value comparison in tests / consumers (metadata is excluded as
// `[String: Any]` is not Equatable).
extension Offering: Equatable {
    public static func == (lhs: Offering, rhs: Offering) -> Bool {
        lhs.identifier == rhs.identifier &&
        lhs.serverDescription == rhs.serverDescription &&
        lhs.availablePackages.map(\.identifier) == rhs.availablePackages.map(\.identifier)
    }
}
