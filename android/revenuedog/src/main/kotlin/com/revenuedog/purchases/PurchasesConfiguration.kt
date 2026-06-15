package com.revenuedog.purchases

import android.content.Context

/**
 * Configuration for [Purchases.configure].
 *
 * ```kotlin
 * Purchases.configure(
 *     PurchasesConfiguration(context, "pk_abc123") {
 *         appUserId("user_123")
 *         baseUrl("https://api.example.com")
 *     }
 * )
 * ```
 *
 * @param context any context; the application context is retained.
 * @param apiKey the app's public SDK key (`pk_...`).
 * @param block optional builder block to set [appUserId], [baseUrl] and consumable product ids.
 */
class PurchasesConfiguration(
    context: Context,
    val apiKey: String,
    block: PurchasesConfiguration.() -> Unit = {}
) {
    val context: Context = context.applicationContext

    internal var appUserId: String? = null
        private set

    internal var baseUrl: String? = null
        private set

    internal var consumableProductIds: Set<String> = emptySet()
        private set

    init {
        block()
    }

    /**
     * Identifies the user. When omitted the SDK generates and persists an anonymous id
     * of the form `$RevenueDogAnonymousID:<uuid>`.
     */
    fun appUserId(appUserId: String?) = apply { this.appUserId = appUserId }

    /**
     * Backend base URL. Defaults to `http://localhost:8787` in debuggable builds;
     * release builds must set it explicitly or [Purchases.configure] throws.
     */
    fun baseUrl(baseUrl: String) = apply { this.baseUrl = baseUrl }

    /**
     * One-time product identifiers that should be **consumed** (rather than acknowledged)
     * after a successful purchase. Google Play does not report whether an in-app product is
     * consumable, so the host app declares its consumables here. Anything not listed is
     * acknowledged (subscriptions and non-consumables).
     */
    fun consumableProductIds(ids: Set<String>) = apply { this.consumableProductIds = ids }
}
