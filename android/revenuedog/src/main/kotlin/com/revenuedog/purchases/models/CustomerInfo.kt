package com.revenuedog.purchases.models

import android.net.Uri
import java.util.Date

/**
 * A snapshot of a subscriber's purchases and entitlements, parsed from the backend
 * `GET /v1/subscribers/{app_user_id}` (and related) responses.
 *
 * @property originalAppUserId the subscriber's original (first-seen) app user id.
 * @property entitlements the subscriber's entitlements.
 * @property activeSubscriptions product identifiers of currently active subscriptions.
 * @property allPurchasedProductIdentifiers every product the subscriber has ever purchased
 *   (subscriptions and one-time purchases).
 * @property latestExpirationDate the latest expiration date across all subscriptions, or `null`.
 * @property managementUrl the store-management URL, when the backend supplies one.
 * @property requestDate the server time the snapshot was generated; entitlement expiry is
 *   evaluated against this to tolerate device clock skew.
 */
class CustomerInfo internal constructor(
    val originalAppUserId: String,
    val entitlements: EntitlementInfos,
    val activeSubscriptions: Set<String>,
    val allPurchasedProductIdentifiers: Set<String>,
    val latestExpirationDate: Date?,
    val managementUrl: Uri?,
    val requestDate: Date,
    /** First time the backend saw this subscriber, when supplied. */
    val firstSeen: Date?
) {
    override fun toString(): String =
        "CustomerInfo(originalAppUserId=$originalAppUserId, " +
            "activeEntitlements=${entitlements.active.keys}, " +
            "activeSubscriptions=$activeSubscriptions)"

    override fun equals(other: Any?): Boolean =
        other is CustomerInfo &&
            other.originalAppUserId == originalAppUserId &&
            other.entitlements.all == entitlements.all &&
            other.activeSubscriptions == activeSubscriptions &&
            other.allPurchasedProductIdentifiers == allPurchasedProductIdentifiers &&
            other.latestExpirationDate == latestExpirationDate

    override fun hashCode(): Int {
        var result = originalAppUserId.hashCode()
        result = 31 * result + entitlements.all.hashCode()
        result = 31 * result + activeSubscriptions.hashCode()
        result = 31 * result + allPurchasedProductIdentifiers.hashCode()
        result = 31 * result + (latestExpirationDate?.hashCode() ?: 0)
        return result
    }
}
