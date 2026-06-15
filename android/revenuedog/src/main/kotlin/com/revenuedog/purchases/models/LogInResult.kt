package com.revenuedog.purchases.models

/**
 * The result of [com.revenuedog.purchases.Purchases.logIn].
 *
 * @property customerInfo the subscriber after the identities were aliased/merged.
 * @property created `true` when the backend created a brand-new subscriber for the app user id,
 *   `false` when an existing subscriber was reused.
 */
data class LogInResult(
    val customerInfo: CustomerInfo,
    val created: Boolean
)
