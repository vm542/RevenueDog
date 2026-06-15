package com.revenuedog.purchases.models

/**
 * The successful outcome of a purchase.
 *
 * A user cancellation surfaces as a thrown `PurchasesError(PURCHASE_CANCELLED)` rather than a
 * result flag; a `PENDING` (deferred) purchase throws `PurchasesError(PENDING)`.
 *
 * @property customerInfo the subscriber's updated info after the purchase was validated.
 * @property storeTransaction the underlying Google Play transaction.
 */
class PurchaseResult internal constructor(
    val customerInfo: CustomerInfo,
    val storeTransaction: StoreTransaction
) {
    override fun toString(): String =
        "PurchaseResult(storeTransaction=$storeTransaction)"
}
