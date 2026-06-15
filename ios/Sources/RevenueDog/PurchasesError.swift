import Foundation

/// The single error type thrown by every throwing ``Purchases`` method.
///
/// Inspect ``PurchasesError/code`` for stable, switchable error handling. The
/// ``PurchasesError/underlyingError`` carries the originating error (a
/// `URLError`, StoreKit error, decoding error, …) when one exists.
public struct PurchasesError: Error, CustomStringConvertible {

    /// Stable, machine-readable classification of the failure.
    ///
    /// These cases are part of the public contract and match the Android SDK.
    public enum Code: String, Sendable, Equatable {
        /// A network request failed (offline, timeout, transport error, 5xx).
        case networkError
        /// The user cancelled the native purchase sheet.
        case purchaseCancelled
        /// The purchase could not be completed or verified by the store.
        case purchaseInvalid
        /// A requested product or package could not be found.
        case productNotFound
        /// The backend rejected the submitted receipt (HTTP 422).
        case receiptValidationFailed
        /// A generic problem talking to the underlying store.
        case storeProblem
        /// The SDK was used incorrectly (e.g. not configured, missing key).
        case configurationError
        /// The purchase is pending external action (deferred / ask-to-buy).
        case pending
        /// An unclassified error.
        case unknown
    }

    /// The stable error classification.
    public let code: Code

    /// Human-readable description of what went wrong.
    public let message: String

    /// The originating error, when one exists.
    public let underlyingError: Error?

    public init(code: Code, message: String, underlyingError: Error? = nil) {
        self.code = code
        self.message = message
        self.underlyingError = underlyingError
    }

    public var description: String {
        var text = "PurchasesError(code: \(code.rawValue), message: \(message)"
        if let underlyingError {
            text += ", underlying: \(underlyingError)"
        }
        text += ")"
        return text
    }

    // MARK: - Convenience factories

    static func network(_ message: String, _ underlying: Error? = nil) -> PurchasesError {
        PurchasesError(code: .networkError, message: message, underlyingError: underlying)
    }

    static func configuration(_ message: String) -> PurchasesError {
        PurchasesError(code: .configurationError, message: message)
    }

    static func store(_ message: String, _ underlying: Error? = nil) -> PurchasesError {
        PurchasesError(code: .storeProblem, message: message, underlyingError: underlying)
    }

    static func cancelled(_ message: String = "The purchase was cancelled.") -> PurchasesError {
        PurchasesError(code: .purchaseCancelled, message: message)
    }

    static func productNotFound(_ message: String) -> PurchasesError {
        PurchasesError(code: .productNotFound, message: message)
    }

    static func receiptValidationFailed(_ message: String) -> PurchasesError {
        PurchasesError(code: .receiptValidationFailed, message: message)
    }

    static let pendingPurchase = PurchasesError(
        code: .pending,
        message: "The purchase is pending external confirmation."
    )

    static func unknown(_ message: String, _ underlying: Error? = nil) -> PurchasesError {
        PurchasesError(code: .unknown, message: message, underlyingError: underlying)
    }
}
