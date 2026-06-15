import Foundation
#if canImport(StoreKit)
import StoreKit
#endif

/// A duration expressed as a unit and a count, e.g. 1 month.
public struct SubscriptionPeriod: Sendable, Equatable {
    /// The calendar unit of the period.
    public enum Unit: Sendable, Equatable {
        case day, week, month, year
    }

    /// The unit of time.
    public let unit: Unit
    /// The number of units (e.g. `1` for "1 month", `6` for "6 months").
    public let value: Int

    public init(unit: Unit, value: Int) {
        self.unit = unit
        self.value = value
    }
}

/// An introductory offer or free trial attached to a subscription product.
public struct StoreProductDiscount: Sendable, Equatable {
    /// How an introductory offer is billed.
    public enum PaymentMode: Sendable, Equatable {
        /// Pay a reduced price each period for a number of periods.
        case payAsYouGo
        /// Pay a single reduced price up front for the whole offer.
        case payUpFront
        /// Free for the duration of the offer.
        case freeTrial
    }

    /// The offer price (0 for a free trial).
    public let price: Decimal
    /// ISO currency code for ``price``.
    public let currencyCode: String
    /// A localized, display-ready price string.
    public let localizedPriceString: String
    /// How the offer is billed.
    public let paymentMode: PaymentMode
    /// The length of a single offer period.
    public let subscriptionPeriod: SubscriptionPeriod
    /// How many periods the offer spans.
    public let numberOfPeriods: Int

    /// Whether this discount represents a free trial.
    public var isFreeTrial: Bool { paymentMode == .freeTrial }

    public init(price: Decimal,
                currencyCode: String,
                localizedPriceString: String,
                paymentMode: PaymentMode,
                subscriptionPeriod: SubscriptionPeriod,
                numberOfPeriods: Int) {
        self.price = price
        self.currencyCode = currencyCode
        self.localizedPriceString = localizedPriceString
        self.paymentMode = paymentMode
        self.subscriptionPeriod = subscriptionPeriod
        self.numberOfPeriods = numberOfPeriods
    }
}

/// A product available for purchase, wrapping the native StoreKit 2 `Product`.
///
/// Prices and metadata are sourced from the App Store. Use
/// ``underlyingSK2Product`` as an escape hatch to the native object.
public struct StoreProduct: Sendable {
    /// The store product identifier (e.g. `"com.app.pro.monthly"`).
    public let productIdentifier: String
    /// The localized product display name.
    public let localizedTitle: String
    /// The localized product description.
    public let localizedDescription: String
    /// The product price in its native currency.
    public let price: Decimal
    /// ISO currency code for ``price``.
    public let currencyCode: String
    /// A localized, display-ready price string (e.g. `"$9.99"`).
    public let localizedPriceString: String
    /// The subscription period for auto-renewable subscriptions, else `nil`.
    public let subscriptionPeriod: SubscriptionPeriod?
    /// The introductory offer / free trial, where the store exposes one.
    public let introductoryDiscount: StoreProductDiscount?

    /// Type-erased storage for the underlying StoreKit `Product` so that this
    /// struct itself need not carry an `@available` annotation.
    private let _underlying: (any Sendable)?

    /// Designated initializer (used by tests and the StoreKit bridge).
    init(productIdentifier: String,
         localizedTitle: String,
         localizedDescription: String,
         price: Decimal,
         currencyCode: String,
         localizedPriceString: String,
         subscriptionPeriod: SubscriptionPeriod?,
         introductoryDiscount: StoreProductDiscount?,
         underlying: (any Sendable)? = nil) {
        self.productIdentifier = productIdentifier
        self.localizedTitle = localizedTitle
        self.localizedDescription = localizedDescription
        self.price = price
        self.currencyCode = currencyCode
        self.localizedPriceString = localizedPriceString
        self.subscriptionPeriod = subscriptionPeriod
        self.introductoryDiscount = introductoryDiscount
        self._underlying = underlying
    }

    #if canImport(StoreKit)
    /// The native StoreKit 2 product this instance wraps, if any.
    @available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
    public var underlyingSK2Product: Product? {
        _underlying as? Product
    }

    /// Builds a ``StoreProduct`` from a native StoreKit 2 `Product`.
    @available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
    init(sk2Product product: Product) {
        self.productIdentifier = product.id
        self.localizedTitle = product.displayName
        self.localizedDescription = product.description
        self.price = product.price
        self.currencyCode = StoreProduct.currencyCode(for: product)
        self.localizedPriceString = product.displayPrice
        self.subscriptionPeriod = product.subscription.map {
            StoreProduct.period(from: $0.subscriptionPeriod)
        }
        self.introductoryDiscount = product.subscription?.introductoryOffer.map {
            StoreProduct.discount(from: $0, currencyCode: StoreProduct.currencyCode(for: product))
        }
        self._underlying = product
    }

    @available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
    private static func currencyCode(for product: Product) -> String {
        if #available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *) {
            return product.priceFormatStyle.currencyCode
        }
        return product.priceFormatStyle.locale.currencyCode ?? ""
    }

    @available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
    private static func period(from period: Product.SubscriptionPeriod) -> SubscriptionPeriod {
        let unit: SubscriptionPeriod.Unit
        switch period.unit {
        case .day:   unit = .day
        case .week:  unit = .week
        case .month: unit = .month
        case .year:  unit = .year
        @unknown default: unit = .month
        }
        return SubscriptionPeriod(unit: unit, value: period.value)
    }

    @available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
    private static func discount(from offer: Product.SubscriptionOffer,
                                 currencyCode: String) -> StoreProductDiscount {
        let mode: StoreProductDiscount.PaymentMode
        switch offer.paymentMode {
        case .payAsYouGo: mode = .payAsYouGo
        case .payUpFront: mode = .payUpFront
        case .freeTrial:  mode = .freeTrial
        default:          mode = .payAsYouGo
        }
        return StoreProductDiscount(
            price: offer.price,
            currencyCode: currencyCode,
            localizedPriceString: offer.displayPrice,
            paymentMode: mode,
            subscriptionPeriod: period(from: offer.period),
            numberOfPeriods: offer.periodCount
        )
    }
    #endif
}
