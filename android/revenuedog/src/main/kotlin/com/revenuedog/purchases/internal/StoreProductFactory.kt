package com.revenuedog.purchases.internal

import com.android.billingclient.api.ProductDetails
import com.revenuedog.purchases.models.IntroductoryOffer
import com.revenuedog.purchases.models.StoreProduct
import com.revenuedog.purchases.models.SubscriptionPeriod
import java.math.BigDecimal
import java.math.MathContext

/**
 * Converts Google Play [ProductDetails] into the SDK's [StoreProduct].
 *
 * For subscriptions the displayed price is taken from the **recurring** (final) pricing phase of
 * the first subscription offer; any earlier free/discounted phase is surfaced as
 * [StoreProduct.introductoryDiscount].
 */
internal object StoreProductFactory {

    fun from(details: ProductDetails): StoreProduct {
        return if (details.productType == com.android.billingclient.api.BillingClient.ProductType.SUBS) {
            fromSubscription(details)
        } else {
            fromOneTime(details)
        }
    }

    private fun fromOneTime(details: ProductDetails): StoreProduct {
        val offer = details.oneTimePurchaseOfferDetails
        val priceMicros = offer?.priceAmountMicros ?: 0L
        return StoreProduct(
            productIdentifier = details.productId,
            localizedTitle = details.title,
            localizedDescription = details.description,
            price = microsToDecimal(priceMicros),
            currencyCode = offer?.priceCurrencyCode.orEmpty(),
            localizedPriceString = offer?.formattedPrice.orEmpty(),
            subscriptionPeriod = null,
            introductoryDiscount = null,
            underlyingProductDetails = details
        )
    }

    private fun fromSubscription(details: ProductDetails): StoreProduct {
        val offer = details.subscriptionOfferDetails?.firstOrNull()
        val phases = offer?.pricingPhases?.pricingPhaseList.orEmpty()
        val recurring = phases.lastOrNull()
        val intro = phases.dropLast(1).firstOrNull()

        return StoreProduct(
            productIdentifier = details.productId,
            localizedTitle = details.title,
            localizedDescription = details.description,
            price = microsToDecimal(recurring?.priceAmountMicros ?: 0L),
            currencyCode = recurring?.priceCurrencyCode.orEmpty(),
            localizedPriceString = recurring?.formattedPrice.orEmpty(),
            subscriptionPeriod = recurring?.billingPeriod?.let { SubscriptionPeriod.fromIso8601(it) },
            introductoryDiscount = intro?.let {
                IntroductoryOffer(
                    price = microsToDecimal(it.priceAmountMicros),
                    currencyCode = it.priceCurrencyCode,
                    localizedPriceString = it.formattedPrice,
                    period = SubscriptionPeriod.fromIso8601(it.billingPeriod),
                    billingCycleCount = it.billingCycleCount,
                    isFreeTrial = it.priceAmountMicros == 0L
                )
            },
            underlyingProductDetails = details
        )
    }

    private fun microsToDecimal(micros: Long): BigDecimal =
        BigDecimal(micros).divide(BigDecimal(1_000_000), MathContext.DECIMAL64)
}
