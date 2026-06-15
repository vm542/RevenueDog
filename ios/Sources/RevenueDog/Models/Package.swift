import Foundation

/// The semantic duration class of a ``Package``.
public enum PackageType: Sendable, Equatable {
    case lifetime
    case annual
    case sixMonth
    case threeMonth
    case twoMonth
    case monthly
    case weekly
    /// A package with a non-standard identifier.
    case custom
    /// A package whose identifier could not be classified.
    case unknown

    /// Derives the package type from a RevenueDog package identifier.
    ///
    /// Standard identifiers map to their corresponding case; any other
    /// `$`-prefixed identifier maps to ``custom``.
    init(identifier: String) {
        switch identifier {
        case SDKConstants.lifetimePackageID:   self = .lifetime
        case SDKConstants.annualPackageID:     self = .annual
        case SDKConstants.sixMonthPackageID:   self = .sixMonth
        case SDKConstants.threeMonthPackageID: self = .threeMonth
        case SDKConstants.twoMonthPackageID:   self = .twoMonth
        case SDKConstants.monthlyPackageID:    self = .monthly
        case SDKConstants.weeklyPackageID:     self = .weekly
        default:                               self = .custom
        }
    }
}

/// A purchasable bundle pairing a RevenueDog package identifier with a
/// concrete, store-resolved ``StoreProduct``.
public struct Package: Sendable {
    /// The RevenueDog package identifier (e.g. `"$rd_monthly"`).
    public let identifier: String
    /// The semantic duration class of the package.
    public let packageType: PackageType
    /// The fully-resolved store product (already fetched from the App Store).
    public let storeProduct: StoreProduct
    /// The identifier of the offering this package belongs to.
    public let offeringIdentifier: String

    public init(identifier: String,
                packageType: PackageType,
                storeProduct: StoreProduct,
                offeringIdentifier: String) {
        self.identifier = identifier
        self.packageType = packageType
        self.storeProduct = storeProduct
        self.offeringIdentifier = offeringIdentifier
    }
}
