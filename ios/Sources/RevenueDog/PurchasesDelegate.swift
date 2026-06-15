import Foundation

/// Receives push-style updates from the SDK.
///
/// Assign an object to ``Purchases/delegate`` to be notified whenever the
/// SDK observes a change to the current subscriber's ``CustomerInfo`` (for
/// example after a purchase, a restore, a `logIn`, or a background
/// `Transaction.updates` event). For an `async` sequence alternative, use
/// ``Purchases/customerInfoStream``.
public protocol PurchasesDelegate: AnyObject {
    /// Called on the main thread whenever an updated ``CustomerInfo`` is
    /// available.
    ///
    /// - Parameters:
    ///   - purchases: The shared ``Purchases`` instance.
    ///   - customerInfo: The latest customer information.
    func purchases(_ purchases: Purchases, receivedUpdated customerInfo: CustomerInfo)
}
