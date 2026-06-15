package com.revenuedog.purchases.models

import java.util.Date

/**
 * The status of a single entitlement (e.g. `pro`) for the subscriber.
 *
 * @property identifier the entitlement identifier configured on the backend.
 * @property isActive whether the entitlement currently unlocks content. Computed at parse time
 *   by comparing [expirationDate] against the request-date anchored "now"
 *   (`max(deviceNow, requestDate)`), so a stale device clock cannot wrongly expire an entitlement.
 *   A `null` [expirationDate] denotes a lifetime (non-expiring) entitlement and is always active.
 * @property willRenew whether the underlying subscription is set to auto-renew.
 * @property periodType the billing period kind (normal / trial / intro).
 * @property latestPurchaseDate the most recent purchase date of the backing product.
 * @property expirationDate when the entitlement expires, or `null` for lifetime entitlements.
 * @property productIdentifier the store product backing this entitlement.
 * @property store the store that granted the entitlement.
 */
class EntitlementInfo internal constructor(
    val identifier: String,
    val isActive: Boolean,
    val willRenew: Boolean,
    val periodType: PeriodType,
    val latestPurchaseDate: Date?,
    val expirationDate: Date?,
    val productIdentifier: String,
    val store: Store
) {
    override fun toString(): String =
        "EntitlementInfo(identifier=$identifier, isActive=$isActive, " +
            "expirationDate=$expirationDate, productIdentifier=$productIdentifier)"

    override fun equals(other: Any?): Boolean =
        other is EntitlementInfo &&
            other.identifier == identifier &&
            other.isActive == isActive &&
            other.expirationDate == expirationDate &&
            other.productIdentifier == productIdentifier

    override fun hashCode(): Int {
        var result = identifier.hashCode()
        result = 31 * result + isActive.hashCode()
        result = 31 * result + (expirationDate?.hashCode() ?: 0)
        result = 31 * result + productIdentifier.hashCode()
        return result
    }
}
