package com.revenuedog.purchases.internal

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.consumePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import com.revenuedog.purchases.PurchasesError
import com.revenuedog.purchases.PurchasesErrorCode
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Wraps Google Play Billing 7.x: connection management, product-details and purchase queries,
 * launching the billing flow, and acknowledging/consuming purchases. Purchase-flow callbacks are
 * forwarded to [onPurchasesUpdated].
 */
internal class BillingWrapper(
    context: Context,
    private val onPurchasesUpdated: (BillingResult, List<Purchase>?) -> Unit
) {
    private val listener = PurchasesUpdatedListener { result, purchases ->
        onPurchasesUpdated(result, purchases)
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(context)
        .setListener(listener)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build()

    private val connectionMutex = Mutex()

    /** Connects to Google Play Billing if not already connected. Idempotent. */
    suspend fun ensureConnected() = connectionMutex.withLock {
        if (billingClient.isReady) return@withLock
        val result = suspendCoroutine<BillingResult> { continuation ->
            billingClient.startConnection(object : BillingClientStateListener {
                @Volatile private var resumed = false
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (!resumed) {
                        resumed = true
                        continuation.resume(billingResult)
                    }
                }

                override fun onBillingServiceDisconnected() {
                    if (!resumed) {
                        resumed = true
                        continuation.resume(
                            BillingResult.newBuilder()
                                .setResponseCode(BillingClient.BillingResponseCode.SERVICE_DISCONNECTED)
                                .build()
                        )
                    }
                }
            })
        }
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            throw PurchasesError(
                PurchasesErrorCode.STORE_PROBLEM,
                "Unable to connect to Google Play Billing: ${result.debugMessage}"
            )
        }
        Logger.debug("Connected to Google Play Billing.")
    }

    /**
     * Queries product details for [productIds]. Because the store does not tell us a product's
     * type up front, we query both SUBS and INAPP and merge the results (deduped by product id).
     */
    suspend fun queryProductDetails(productIds: Collection<String>): List<ProductDetails> {
        if (productIds.isEmpty()) return emptyList()
        ensureConnected()
        val subs = queryForType(productIds, BillingClient.ProductType.SUBS)
        val inApp = queryForType(productIds, BillingClient.ProductType.INAPP)
        return (subs + inApp).distinctBy { it.productId }
    }

    private suspend fun queryForType(
        productIds: Collection<String>,
        type: String
    ): List<ProductDetails> {
        val products = productIds.map { id ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(type)
                .build()
        }
        val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()
        val result = billingClient.queryProductDetails(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Logger.debug(
                "queryProductDetails($type) returned ${result.billingResult.responseCode}: " +
                    result.billingResult.debugMessage
            )
            return emptyList()
        }
        return result.productDetailsList.orEmpty()
    }

    /** Queries the user's owned purchases of [type] (`INAPP` or `SUBS`). */
    suspend fun queryPurchases(type: String): List<Purchase> {
        ensureConnected()
        val params = QueryPurchasesParams.newBuilder().setProductType(type).build()
        val result = billingClient.queryPurchasesAsync(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            return emptyList()
        }
        return result.purchasesList
    }

    /** Launches the billing flow for [details], using [offerToken] for subscriptions. */
    fun launchBillingFlow(activity: Activity, details: ProductDetails, offerToken: String?) {
        val productParamsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
        if (offerToken != null) {
            productParamsBuilder.setOfferToken(offerToken)
        }
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParamsBuilder.build()))
            .build()
        val result = billingClient.launchBillingFlow(activity, params)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            throw PurchasesError(
                PurchasesErrorCode.STORE_PROBLEM,
                "launchBillingFlow failed: ${result.debugMessage}"
            )
        }
    }

    /** The recurring subscription offer token for [details], or `null` for one-time products. */
    fun firstOfferToken(details: ProductDetails): String? =
        details.subscriptionOfferDetails?.firstOrNull()?.offerToken

    suspend fun acknowledge(purchaseToken: String) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchaseToken)
            .build()
        val result = billingClient.acknowledgePurchase(params)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Logger.warn("acknowledgePurchase failed: ${result.debugMessage}")
        }
    }

    suspend fun consume(purchaseToken: String) {
        val params = ConsumeParams.newBuilder()
            .setPurchaseToken(purchaseToken)
            .build()
        val result = billingClient.consumePurchase(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Logger.warn("consumePurchase failed: ${result.billingResult.debugMessage}")
        }
    }

    fun close() {
        runCatching { billingClient.endConnection() }
    }
}
