package com.revenuedog.purchases.models

import com.android.billingclient.api.ProductDetails
import java.math.BigDecimal

/** Unit of a [SubscriptionPeriod]. */
enum class PeriodUnit { DAY, WEEK, MONTH, YEAR }

/**
 * A subscription billing period, parsed from the store's ISO-8601 duration (e.g. `P1M`).
 */
data class SubscriptionPeriod(val unit: PeriodUnit, val value: Int) {

    companion object {
        /** Parses an ISO-8601 single-unit duration like `P3D`, `P1W`, `P1M`, `P1Y`. */
        fun fromIso8601(iso: String): SubscriptionPeriod? {
            val match = Regex("^P(\\d+)([DWMY])$").find(iso) ?: return null
            val (value, unit) = match.destructured
            return SubscriptionPeriod(
                unit = when (unit) {
                    "D" -> PeriodUnit.DAY
                    "W" -> PeriodUnit.WEEK
                    "M" -> PeriodUnit.MONTH
                    else -> PeriodUnit.YEAR
                },
                value = value.toInt()
            )
        }
    }
}

/**
 * An introductory pricing phase (free trial or discounted intro price) exposed by the store.
 *
 * @property isFreeTrial true when the phase costs nothing.
 * @property billingCycleCount how many billing cycles the phase lasts.
 */
data class IntroductoryOffer(
    val price: BigDecimal,
    val currencyCode: String,
    val localizedPriceString: String,
    val period: SubscriptionPeriod?,
    val billingCycleCount: Int,
    val isFreeTrial: Boolean
)

/**
 * A product fetched from Google Play, wrapping the Billing Library's [ProductDetails].
 *
 * For subscriptions the price comes from the recurring (last) pricing phase of the first
 * subscription offer; [introductoryDiscount] carries any earlier discounted/free phase.
 */
class StoreProduct internal constructor(
    val productIdentifier: String,
    val localizedTitle: String,
    val localizedDescription: String,
    val price: BigDecimal,
    val currencyCode: String,
    val localizedPriceString: String,
    val subscriptionPeriod: SubscriptionPeriod?,
    val introductoryDiscount: IntroductoryOffer?,
    /** Escape hatch to the underlying Play Billing object. */
    val underlyingProductDetails: ProductDetails
) {
    override fun toString(): String =
        "StoreProduct(productIdentifier=$productIdentifier, price=$localizedPriceString)"

    override fun equals(other: Any?): Boolean =
        other is StoreProduct && other.productIdentifier == productIdentifier

    override fun hashCode(): Int = productIdentifier.hashCode()
}
