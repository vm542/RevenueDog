package com.revenuedog.purchases

import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Purchase
import com.revenuedog.purchases.internal.BackendClient
import com.revenuedog.purchases.internal.BillingWrapper
import com.revenuedog.purchases.internal.CustomerInfoFactory
import com.revenuedog.purchases.internal.CustomerInfoResponse
import com.revenuedog.purchases.internal.DeviceCache
import com.revenuedog.purchases.internal.IdentityManager
import com.revenuedog.purchases.internal.Logger
import com.revenuedog.purchases.internal.ReceiptRequest
import com.revenuedog.purchases.internal.StoreProductFactory
import com.revenuedog.purchases.internal.toAnyMap
import com.revenuedog.purchases.models.CustomerInfo
import com.revenuedog.purchases.models.LogInResult
import com.revenuedog.purchases.models.Offering
import com.revenuedog.purchases.models.Offerings
import com.revenuedog.purchases.models.Package
import com.revenuedog.purchases.models.PackageType
import com.revenuedog.purchases.models.PurchaseResult
import com.revenuedog.purchases.models.StoreProduct
import com.revenuedog.purchases.models.StoreTransaction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.Date
import java.util.concurrent.TimeUnit

/**
 * The entry point of the RevenueDog SDK.
 *
 * Configure once at startup with [configure], then use [sharedInstance]. All network methods are
 * `suspend` (primary API) with `Callback` overloads for Java/legacy callers. Errors are reported
 * as [PurchasesError].
 */
class Purchases internal constructor(
    private val configuration: PurchasesConfiguration,
    private val backend: BackendClient,
    private val deviceCache: DeviceCache,
    private val identity: IdentityManager,
    context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mainHandler = Handler(Looper.getMainLooper())

    private val billing = BillingWrapper(context) { result, purchases ->
        handlePurchasesUpdated(result, purchases)
    }

    private val purchaseLock = Any()
    @Volatile
    private var pendingPurchase: CompletableDeferred<Purchase>? = null

    @Volatile
    private var cachedOfferings: Offerings? = null

    private val _customerInfoFlow = MutableStateFlow<CustomerInfo?>(null)

    // --- Public identity ---

    /** The current app user id (the configured id, a restored id, or a generated anonymous id). */
    val appUserId: String get() = identity.currentAppUserId

    /** Whether the current [appUserId] is an SDK-generated anonymous id. */
    val isAnonymous: Boolean get() = identity.isAnonymous

    /** Emits the latest [CustomerInfo] on every change (purchase, restore, logIn/logOut, refresh). */
    val customerInfoFlow: StateFlow<CustomerInfo?> = _customerInfoFlow.asStateFlow()

    /** Invoked on the main thread whenever [CustomerInfo] changes. */
    @Volatile
    var updatedCustomerInfoListener: UpdatedCustomerInfoListener? = null
        set(value) {
            field = value
            _customerInfoFlow.value?.let { info -> value?.let { mainHandler.post { it.onReceived(info) } } }
        }

    // --- Lifecycle ---

    internal fun start() {
        _customerInfoFlow.value = deviceCache.getCachedCustomerInfo(identity.currentAppUserId)?.info
        scope.launch {
            runCatching { billing.ensureConnected() }
                .onFailure { Logger.warn("Billing connection failed at configure.", it) }
            runCatching { retryPendingReceipts() }
                .onFailure { Logger.warn("Failed retrying pending receipts.", it) }
            runCatching { sweepUnfinishedPurchases() }
                .onFailure { Logger.warn("Purchase sweep failed.", it) }
            runCatching { fetchCustomerInfo(identity.currentAppUserId) }
                .onFailure { Logger.debug("Initial CustomerInfo refresh failed: ${it.message}") }
        }
    }

    internal fun close() {
        billing.close()
        scope.cancel()
    }

    // --- Offerings & products ---

    suspend fun getOfferings(): Offerings {
        cachedOfferings?.let { return it }

        val response = backend.getOfferings(identity.currentAppUserId)
        val productIds = response.offerings
            .flatMap { offering -> offering.packages.map { it.platformProductIdentifier } }
            .distinct()
        val storeProducts = billing.queryProductDetails(productIds)
            .associate { it.productId to StoreProductFactory.from(it) }

        val offeringsMap = LinkedHashMap<String, Offering>()
        for (dto in response.offerings) {
            val packages = dto.packages.mapNotNull { pkgDto ->
                val product = storeProducts[pkgDto.platformProductIdentifier]
                if (product == null) {
                    Logger.warn(
                        "Dropping package '${pkgDto.identifier}': Google Play returned no product " +
                            "for '${pkgDto.platformProductIdentifier}'."
                    )
                    null
                } else {
                    Package(
                        identifier = pkgDto.identifier,
                        packageType = PackageType.fromIdentifier(pkgDto.identifier),
                        storeProduct = product,
                        offeringIdentifier = dto.identifier
                    )
                }
            }
            offeringsMap[dto.identifier] = Offering(
                identifier = dto.identifier,
                serverDescription = dto.description,
                metadata = dto.metadata.toAnyMap(),
                availablePackages = packages
            )
        }

        val current = response.currentOfferingId?.let { offeringsMap[it] }
        return Offerings(current, offeringsMap).also { cachedOfferings = it }
    }

    suspend fun getProducts(identifiers: List<String>): List<StoreProduct> {
        return billing.queryProductDetails(identifiers).map { StoreProductFactory.from(it) }
    }

    // --- Purchasing ---

    suspend fun purchase(activity: Activity, packageToPurchase: Package): PurchaseResult =
        purchaseInternal(activity, packageToPurchase.storeProduct, packageToPurchase.offeringIdentifier)

    suspend fun purchase(activity: Activity, product: StoreProduct): PurchaseResult =
        purchaseInternal(activity, product, null)

    private suspend fun purchaseInternal(
        activity: Activity,
        product: StoreProduct,
        presentedOfferingIdentifier: String?
    ): PurchaseResult {
        billing.ensureConnected()
        val details = product.underlyingProductDetails
        val offerToken = billing.firstOfferToken(details)

        val deferred = CompletableDeferred<Purchase>()
        synchronized(purchaseLock) {
            if (pendingPurchase != null) {
                throw PurchasesError(
                    PurchasesErrorCode.PURCHASE_INVALID,
                    "Another purchase is already in progress."
                )
            }
            pendingPurchase = deferred
        }

        try {
            Logger.info("Launching purchase for ${product.productIdentifier}.")
            billing.launchBillingFlow(activity, details, offerToken)
            val purchase = deferred.await()

            val customerInfo = syncPurchase(
                purchase = purchase,
                presentedOfferingIdentifier = presentedOfferingIdentifier,
                price = product.price.toDouble(),
                currency = product.currencyCode
            )
            val transaction = StoreTransaction(
                productIdentifier = product.productIdentifier,
                transactionIdentifier = purchase.orderId ?: purchase.purchaseToken,
                purchaseDate = Date(purchase.purchaseTime),
                purchaseToken = purchase.purchaseToken,
                underlyingPurchase = purchase
            )
            Logger.info("Purchase of ${product.productIdentifier} completed.")
            return PurchaseResult(customerInfo, transaction)
        } finally {
            synchronized(purchaseLock) { pendingPurchase = null }
        }
    }

    private fun handlePurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        val deferred = synchronized(purchaseLock) { pendingPurchase }
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val purchase = purchases?.firstOrNull()
                if (purchase == null) {
                    deferred?.completeExceptionally(
                        PurchasesError(PurchasesErrorCode.STORE_PROBLEM, "No purchase returned by the store.")
                    )
                    return
                }
                when (purchase.purchaseState) {
                    Purchase.PurchaseState.PURCHASED -> {
                        if (deferred != null) {
                            deferred.complete(purchase)
                        } else {
                            Logger.info("Received out-of-band purchase; syncing with backend.")
                            scope.launch {
                                runCatching {
                                    syncPurchase(purchase, null, null, null)
                                }.onFailure { Logger.warn("Failed to sync out-of-band purchase.", it) }
                            }
                        }
                    }
                    Purchase.PurchaseState.PENDING -> {
                        Logger.info("Purchase is pending external action.")
                        deferred?.completeExceptionally(PurchasesError(PurchasesErrorCode.PENDING))
                    }
                    else -> deferred?.completeExceptionally(
                        PurchasesError(PurchasesErrorCode.PURCHASE_INVALID, "Purchase is in an unspecified state.")
                    )
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED ->
                deferred?.completeExceptionally(PurchasesError(PurchasesErrorCode.PURCHASE_CANCELLED))
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ->
                deferred?.completeExceptionally(
                    PurchasesError(PurchasesErrorCode.PURCHASE_INVALID, "Item is already owned.")
                )
            else -> deferred?.completeExceptionally(
                PurchasesError(PurchasesErrorCode.STORE_PROBLEM, result.debugMessage)
            )
        }
    }

    /**
     * POSTs a purchase to `/v1/receipts`, then finishes it on the store. If the backend is
     * unreachable, the receipt is queued for retry and the purchase is still finished so the entitlement
     * is never lost; a [PurchasesErrorCode.NETWORK_ERROR] is re-thrown to the caller.
     */
    private suspend fun syncPurchase(
        purchase: Purchase,
        presentedOfferingIdentifier: String?,
        price: Double?,
        currency: String?
    ): CustomerInfo {
        val productId = purchase.products.firstOrNull()
            ?: throw PurchasesError(PurchasesErrorCode.PURCHASE_INVALID, "Purchase has no product id.")

        val receipt = ReceiptRequest(
            appUserId = identity.currentAppUserId,
            fetchToken = purchase.purchaseToken,
            productId = productId,
            store = "play_store",
            presentedOfferingIdentifier = presentedOfferingIdentifier,
            price = price,
            currency = currency
        )

        val response = try {
            backend.postReceipt(receipt)
        } catch (e: PurchasesError) {
            if (e.code == PurchasesErrorCode.NETWORK_ERROR) {
                Logger.warn("Backend unreachable after purchase; queuing receipt for retry.")
                deviceCache.queuePendingReceipt(receipt)
                finishPurchase(purchase)
            }
            throw e
        }

        finishPurchase(purchase)
        return updateCustomerInfo(response)
    }

    /** Consumes products declared consumable; otherwise acknowledges (subscriptions + non-consumables). */
    private suspend fun finishPurchase(purchase: Purchase) {
        val productId = purchase.products.firstOrNull()
        when {
            productId != null && configuration.consumableProductIds.contains(productId) -> {
                Logger.debug("Consuming $productId.")
                billing.consume(purchase.purchaseToken)
            }
            !purchase.isAcknowledged -> {
                Logger.debug("Acknowledging ${purchase.products}.")
                billing.acknowledge(purchase.purchaseToken)
            }
        }
    }

    // --- Customer info ---

    suspend fun getCustomerInfo(fetchPolicy: FetchPolicy = FetchPolicy.CACHED_OR_FETCH): CustomerInfo {
        val appUserId = identity.currentAppUserId
        return when (fetchPolicy) {
            FetchPolicy.CACHE_ONLY ->
                deviceCache.getCachedCustomerInfo(appUserId)?.info
                    ?: throw PurchasesError(
                        PurchasesErrorCode.CONFIGURATION_ERROR,
                        "No cached CustomerInfo available."
                    )

            FetchPolicy.CACHED_OR_FETCH -> {
                val cached = deviceCache.getCachedCustomerInfo(appUserId)
                if (cached != null && System.currentTimeMillis() - cached.fetchedAtMillis < CACHE_TTL_MS) {
                    cached.info
                } else {
                    fetchCustomerInfo(appUserId)
                }
            }

            FetchPolicy.FETCH_CURRENT -> fetchCustomerInfo(appUserId)
        }
    }

    suspend fun restorePurchases(): CustomerInfo {
        billing.ensureConnected()
        val purchases = billing.queryPurchases(BillingClient.ProductType.INAPP) +
            billing.queryPurchases(BillingClient.ProductType.SUBS)
        for (purchase in purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }) {
            runCatching { syncPurchase(purchase, null, null, null) }
                .onFailure { Logger.warn("Failed to restore purchase ${purchase.products}.", it) }
        }
        return fetchCustomerInfo(identity.currentAppUserId)
    }

    // --- Identity changes ---

    suspend fun logIn(appUserId: String): LogInResult {
        if (appUserId == identity.currentAppUserId) {
            return LogInResult(fetchCustomerInfo(appUserId), created = false)
        }
        val response = backend.alias(identity.currentAppUserId, appUserId)
        identity.switchTo(appUserId)
        cachedOfferings = null
        val info = updateCustomerInfo(response)
        return LogInResult(info, created = response.created ?: false)
    }

    suspend fun logOut(): CustomerInfo {
        if (identity.isAnonymous) {
            throw PurchasesError(
                PurchasesErrorCode.CONFIGURATION_ERROR,
                "Called logOut but the current user is already anonymous."
            )
        }
        deviceCache.clearCustomerInfo(identity.currentAppUserId)
        cachedOfferings = null
        identity.resetToAnonymous()
        return fetchCustomerInfo(identity.currentAppUserId)
    }

    // --- Attributes ---

    suspend fun setAttributes(attributes: Map<String, String?>) {
        backend.postAttributes(identity.currentAppUserId, attributes)
    }

    suspend fun setEmail(email: String?) = setAttributes(mapOf("\$email" to email))

    // --- Internal helpers ---

    private suspend fun fetchCustomerInfo(appUserId: String): CustomerInfo {
        val response = backend.getSubscriber(appUserId)
        return updateCustomerInfo(response)
    }

    private fun updateCustomerInfo(response: CustomerInfoResponse): CustomerInfo {
        val info = CustomerInfoFactory.fromResponse(response)
        deviceCache.cacheCustomerInfo(identity.currentAppUserId, response, info)
        notifyCustomerInfo(info)
        return info
    }

    private fun notifyCustomerInfo(info: CustomerInfo) {
        _customerInfoFlow.value = info
        updatedCustomerInfoListener?.let { listener ->
            mainHandler.post { listener.onReceived(info) }
        }
    }

    private suspend fun retryPendingReceipts() {
        val pending = deviceCache.getPendingReceipts()
        if (pending.isEmpty()) return
        Logger.info("Retrying ${pending.size} pending receipt(s).")
        for (receipt in pending) {
            try {
                val response = backend.postReceipt(receipt)
                deviceCache.removePendingReceipt(receipt)
                updateCustomerInfo(response)
            } catch (e: PurchasesError) {
                if (e.code == PurchasesErrorCode.NETWORK_ERROR) {
                    Logger.debug("Still offline; keeping pending receipt for later.")
                    break
                } else {
                    Logger.warn("Dropping pending receipt after permanent error: ${e.message}")
                    deviceCache.removePendingReceipt(receipt)
                }
            }
        }
    }

    private suspend fun sweepUnfinishedPurchases() {
        val purchases = billing.queryPurchases(BillingClient.ProductType.INAPP) +
            billing.queryPurchases(BillingClient.ProductType.SUBS)
        for (purchase in purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }) {
            runCatching { syncPurchase(purchase, null, null, null) }
                .onFailure { Logger.debug("Sweep could not sync ${purchase.products}: ${it.message}") }
        }
    }

    // --- Callback overloads (delivered on the main thread) ---

    fun getOfferings(callback: ReceiveOfferingsCallback) = dispatch(callback) { getOfferings() }

    fun getProducts(identifiers: List<String>, callback: ReceiveProductsCallback) =
        dispatch(callback) { getProducts(identifiers) }

    fun purchase(activity: Activity, packageToPurchase: Package, callback: PurchaseCallback) =
        dispatch(callback) { purchase(activity, packageToPurchase) }

    fun purchase(activity: Activity, product: StoreProduct, callback: PurchaseCallback) =
        dispatch(callback) { purchase(activity, product) }

    fun getCustomerInfo(fetchPolicy: FetchPolicy, callback: ReceiveCustomerInfoCallback) =
        dispatch(callback) { getCustomerInfo(fetchPolicy) }

    fun getCustomerInfo(callback: ReceiveCustomerInfoCallback) =
        dispatch(callback) { getCustomerInfo() }

    fun restorePurchases(callback: ReceiveCustomerInfoCallback) =
        dispatch(callback) { restorePurchases() }

    fun logIn(appUserId: String, callback: LogInCallback) = dispatch(callback) { logIn(appUserId) }

    fun logOut(callback: ReceiveCustomerInfoCallback) = dispatch(callback) { logOut() }

    private fun <T> dispatch(callback: Callback<T>, block: suspend () -> T) {
        scope.launch(Dispatchers.Main) {
            try {
                callback.onSuccess(block())
            } catch (e: CancellationException) {
                throw e
            } catch (e: PurchasesError) {
                callback.onError(e)
            } catch (e: Throwable) {
                callback.onError(PurchasesError(PurchasesErrorCode.UNKNOWN, e.message, e))
            }
        }
    }

    companion object {
        /** The RevenueDog Android SDK version (sent as `X-SDK-Version`). */
        const val SDK_VERSION: String = "0.1.0"

        private const val DEFAULT_DEBUG_BASE_URL = "http://localhost:8787"
        private const val CACHE_TTL_MS = 5 * 60 * 1000L

        @Volatile
        private var instance: Purchases? = null
        private val configureLock = Any()

        /** Global log verbosity. Default [LogLevel.INFO]. */
        var logLevel: LogLevel
            get() = Logger.logLevel
            set(value) {
                Logger.logLevel = value
            }

        /** Whether [configure] has been called. */
        val isConfigured: Boolean
            get() = instance != null

        /** The configured shared instance. Throws [PurchasesError] if [configure] was not called. */
        val sharedInstance: Purchases
            get() = instance ?: throw PurchasesError(
                PurchasesErrorCode.CONFIGURATION_ERROR,
                "Purchases has not been configured. Call Purchases.configure() first."
            )

        /**
         * Configures the SDK. Calling more than once logs a warning and replaces the instance
         * (RevenueCat behavior).
         */
        fun configure(configuration: PurchasesConfiguration): Purchases =
            synchronized(configureLock) {
                instance?.let {
                    Logger.warn("Purchases.configure() called again; replacing the existing instance.")
                    it.close()
                }
                build(configuration).also {
                    instance = it
                    it.start()
                }
            }

        private fun build(configuration: PurchasesConfiguration): Purchases {
            if (configuration.apiKey.isBlank()) {
                throw PurchasesError(
                    PurchasesErrorCode.CONFIGURATION_ERROR,
                    "A public SDK key (pk_...) is required."
                )
            }
            val context = configuration.context
            val debuggable =
                (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
            val baseUrl = configuration.baseUrl ?: if (debuggable) {
                DEFAULT_DEBUG_BASE_URL
            } else {
                throw PurchasesError(
                    PurchasesErrorCode.CONFIGURATION_ERROR,
                    "baseUrl must be set explicitly for release builds."
                )
            }

            val deviceCache = DeviceCache(context)
            val identity = IdentityManager(deviceCache)
            identity.configure(configuration.appUserId)

            val httpClient = OkHttpClient.Builder()
                .callTimeout(30, TimeUnit.SECONDS)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()

            val backend = BackendClient(
                apiKey = configuration.apiKey,
                baseUrl = baseUrl,
                platformVersion = Build.VERSION.SDK_INT.toString(),
                sdkVersion = SDK_VERSION,
                appVersion = appVersion(context),
                httpClient = httpClient
            )

            return Purchases(configuration, backend, deviceCache, identity, context)
        }

        private fun appVersion(context: Context): String =
            runCatching {
                context.packageManager.getPackageInfo(context.packageName, 0).versionName
            }.getOrNull() ?: "unknown"
    }
}
