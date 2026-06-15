package com.revenuedog.purchases

import com.revenuedog.purchases.models.CustomerInfo
import com.revenuedog.purchases.models.LogInResult
import com.revenuedog.purchases.models.Offerings
import com.revenuedog.purchases.models.PurchaseResult
import com.revenuedog.purchases.models.StoreProduct

/**
 * Generic success/error callback for the callback-style overloads of the `suspend` API.
 * Callbacks are always delivered on the main thread.
 */
interface Callback<T> {
    fun onSuccess(value: T)
    fun onError(error: PurchasesError)
}

/** Callback for [Purchases.getOfferings]. */
typealias ReceiveOfferingsCallback = Callback<Offerings>

/** Callback for [Purchases.getProducts]. */
typealias ReceiveProductsCallback = Callback<List<StoreProduct>>

/** Callback for [Purchases.getCustomerInfo] / [Purchases.restorePurchases]. */
typealias ReceiveCustomerInfoCallback = Callback<CustomerInfo>

/** Callback for [Purchases.purchase]. A user cancellation surfaces as `PURCHASE_CANCELLED`. */
typealias PurchaseCallback = Callback<PurchaseResult>

/** Callback for [Purchases.logIn]. */
typealias LogInCallback = Callback<LogInResult>
