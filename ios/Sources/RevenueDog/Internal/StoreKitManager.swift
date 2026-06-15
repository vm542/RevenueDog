import Foundation
#if canImport(StoreKit)
import StoreKit
#endif

/// Closure invoked to finish (acknowledge) a transaction once the backend has
/// recorded it.
typealias FinishTransaction = @Sendable () async -> Void

/// A verified store purchase ready to be submitted to the backend.
struct VerifiedPurchase {
    /// The JWS representation of the verified transaction (the `fetch_token`).
    let jws: String
    /// Store-agnostic transaction summary.
    let storeTransaction: StoreTransaction
    /// Finishes the underlying StoreKit transaction.
    let finish: FinishTransaction
}

/// Wraps StoreKit 2 product loading and the purchase / restore / update flows.
///
/// All StoreKit usage is gated behind `#if canImport(StoreKit)` so the package
/// still compiles on platforms that lack StoreKit; on those platforms the
/// store methods fail gracefully with a `storeProblem` error.
final class StoreKitManager {

    #if canImport(StoreKit)

    /// Loads ``StoreProduct``s for the given identifiers from the App Store.
    func fetchProducts(_ identifiers: [String]) async throws -> [StoreProduct] {
        do {
            let products = try await Product.products(for: identifiers)
            return products.map { StoreProduct(sk2Product: $0) }
        } catch {
            throw PurchasesError.store("Failed to load products from the App Store.", error)
        }
    }

    /// Launches the native purchase flow and returns the verified purchase.
    ///
    /// - Throws: ``PurchasesError`` with `purchaseCancelled` on user cancel,
    ///   `pending` for deferred purchases, `receiptValidationFailed` if the
    ///   transaction fails JWS verification, or `storeProblem` otherwise.
    func purchase(_ storeProduct: StoreProduct) async throws -> VerifiedPurchase {
        guard let product = storeProduct.underlyingSK2Product else {
            throw PurchasesError.productNotFound("StoreProduct has no underlying StoreKit product.")
        }

        let result: Product.PurchaseResult
        do {
            result = try await product.purchase()
        } catch {
            throw PurchasesError.store("The purchase could not be started.", error)
        }

        switch result {
        case .success(let verification):
            let transaction = try Self.verify(verification)
            return VerifiedPurchase(
                jws: verification.jwsRepresentation,
                storeTransaction: Self.makeStoreTransaction(transaction),
                finish: { await transaction.finish() }
            )
        case .userCancelled:
            throw PurchasesError.cancelled()
        case .pending:
            throw PurchasesError.pendingPurchase
        @unknown default:
            throw PurchasesError.unknown("Unknown StoreKit purchase result.")
        }
    }

    /// Returns the verified transactions currently entitling the user, used by
    /// `restorePurchases`.
    func currentEntitlements() async -> [VerifiedPurchase] {
        var purchases: [VerifiedPurchase] = []
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? Self.verify(result) else { continue }
            purchases.append(
                VerifiedPurchase(
                    jws: result.jwsRepresentation,
                    storeTransaction: Self.makeStoreTransaction(transaction),
                    finish: { await transaction.finish() }
                )
            )
        }
        return purchases
    }

    /// Starts a long-lived task observing `Transaction.updates` for
    /// out-of-band transactions (renewals, Ask-to-Buy approvals, etc.).
    func listenForTransactions(
        _ handler: @escaping @Sendable (VerifiedPurchase) async -> Void
    ) -> Task<Void, Never> {
        Task.detached {
            for await result in Transaction.updates {
                guard let transaction = try? Self.verify(result) else { continue }
                let purchase = VerifiedPurchase(
                    jws: result.jwsRepresentation,
                    storeTransaction: Self.makeStoreTransaction(transaction),
                    finish: { await transaction.finish() }
                )
                await handler(purchase)
            }
        }
    }

    private static func verify(_ result: VerificationResult<Transaction>) throws -> Transaction {
        switch result {
        case .verified(let transaction):
            return transaction
        case .unverified(_, let error):
            throw PurchasesError.receiptValidationFailed(
                "Transaction failed StoreKit verification: \(error)"
            )
        }
    }

    private static func makeStoreTransaction(_ transaction: Transaction) -> StoreTransaction {
        StoreTransaction(
            productIdentifier: transaction.productID,
            transactionIdentifier: String(transaction.id),
            purchaseDate: transaction.purchaseDate
        )
    }

    #else

    func fetchProducts(_ identifiers: [String]) async throws -> [StoreProduct] {
        throw PurchasesError.store("StoreKit is unavailable on this platform.")
    }

    func purchase(_ storeProduct: StoreProduct) async throws -> VerifiedPurchase {
        throw PurchasesError.store("StoreKit is unavailable on this platform.")
    }

    func currentEntitlements() async -> [VerifiedPurchase] { [] }

    func listenForTransactions(
        _ handler: @escaping @Sendable (VerifiedPurchase) async -> Void
    ) -> Task<Void, Never> {
        Task {}
    }

    #endif
}
