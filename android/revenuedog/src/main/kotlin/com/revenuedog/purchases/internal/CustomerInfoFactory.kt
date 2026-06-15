package com.revenuedog.purchases.internal

import android.net.Uri
import com.revenuedog.purchases.models.CustomerInfo
import com.revenuedog.purchases.models.EntitlementInfo
import com.revenuedog.purchases.models.EntitlementInfos
import com.revenuedog.purchases.models.PeriodType
import com.revenuedog.purchases.models.Store
import java.util.Date

/**
 * Builds public [CustomerInfo] objects from the backend wire shape.
 *
 * Entitlement-activeness is anchored to the server `request_date` to tolerate device clock skew:
 * an entitlement is active when its `expires_date` is `null` (lifetime) or strictly after
 * `max(deviceNow, requestDate)` (the spec permits this simplification for v0).
 */
internal object CustomerInfoFactory {

    fun fromResponse(response: CustomerInfoResponse): CustomerInfo {
        val subscriber = response.subscriber
        val requestDate = Iso8601.parse(response.requestDate) ?: Date()
        val anchorNow = maxOf(Date(), requestDate)

        val entitlements = subscriber.entitlements.mapValues { (identifier, dto) ->
            val expirationDate = Iso8601.parse(dto.expiresDate)
            val isActive = expirationDate == null || expirationDate.after(anchorNow)
            val subscription = subscriber.subscriptions[dto.productIdentifier]
            val nonSub = subscriber.nonSubscriptions[dto.productIdentifier]?.lastOrNull()
            val storeRaw = subscription?.store ?: nonSub?.store
            EntitlementInfo(
                identifier = identifier,
                isActive = isActive,
                willRenew = subscription?.willRenew ?: false,
                periodType = PeriodType.fromRaw(subscription?.periodType),
                latestPurchaseDate = Iso8601.parse(dto.purchaseDate),
                expirationDate = expirationDate,
                productIdentifier = dto.productIdentifier,
                store = Store.fromRaw(storeRaw)
            )
        }

        val activeSubscriptions = subscriber.subscriptions
            .filter { (_, sub) ->
                val expires = Iso8601.parse(sub.expiresDate)
                expires == null || expires.after(anchorNow)
            }
            .keys
            .toSet()

        val allPurchased =
            subscriber.subscriptions.keys + subscriber.nonSubscriptions.keys

        val latestExpiration = subscriber.subscriptions.values
            .mapNotNull { Iso8601.parse(it.expiresDate) }
            .maxOrNull()

        return CustomerInfo(
            originalAppUserId = subscriber.originalAppUserId,
            entitlements = EntitlementInfos(entitlements),
            activeSubscriptions = activeSubscriptions,
            allPurchasedProductIdentifiers = allPurchased,
            latestExpirationDate = latestExpiration,
            managementUrl = subscriber.managementUrl?.let { Uri.parse(it) },
            requestDate = requestDate,
            firstSeen = Iso8601.parse(subscriber.firstSeen)
        )
    }
}
