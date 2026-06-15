import Foundation

/// A lightweight, store-agnostic record of a completed transaction.
public struct StoreTransaction: Sendable, Equatable {
    /// The purchased store product identifier.
    public let productIdentifier: String
    /// The store's transaction identifier.
    public let transactionIdentifier: String
    /// When the purchase occurred.
    public let purchaseDate: Date

    public init(productIdentifier: String,
                transactionIdentifier: String,
                purchaseDate: Date) {
        self.productIdentifier = productIdentifier
        self.transactionIdentifier = transactionIdentifier
        self.purchaseDate = purchaseDate
    }
}

/// The result of a successful purchase.
///
/// On iOS, a user cancellation surfaces as a thrown
/// ``PurchasesError`` with code ``PurchasesError/Code/purchaseCancelled``
/// rather than a flag on this result.
public struct PurchaseResult: Sendable {
    /// The customer info reflecting the new purchase.
    public let customerInfo: CustomerInfo
    /// The transaction that was completed.
    public let storeTransaction: StoreTransaction

    public init(customerInfo: CustomerInfo, storeTransaction: StoreTransaction) {
        self.customerInfo = customerInfo
        self.storeTransaction = storeTransaction
    }
}
