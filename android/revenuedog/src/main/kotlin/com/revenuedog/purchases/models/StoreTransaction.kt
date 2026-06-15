package com.revenuedog.purchases.models

import com.android.billingclient.api.Purchase
import java.util.Date

/**
 * A completed Google Play purchase, returned inside a [PurchaseResult].
 *
 * @property productIdentifier the purchased product id.
 * @property transactionIdentifier a stable identifier for the transaction (Play `orderId` when
 *   present, otherwise the purchase token).
 * @property purchaseDate when the purchase completed.
 * @property purchaseToken the Play Billing purchase token submitted to the backend.
 * @property underlyingPurchase escape hatch to the Play Billing [Purchase].
 */
class StoreTransaction internal constructor(
    val productIdentifier: String,
    val transactionIdentifier: String,
    val purchaseDate: Date,
    val purchaseToken: String,
    val underlyingPurchase: Purchase
) {
    override fun toString(): String =
        "StoreTransaction(productIdentifier=$productIdentifier, " +
            "transactionIdentifier=$transactionIdentifier, purchaseDate=$purchaseDate)"
}
