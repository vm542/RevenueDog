package com.revenuedog.purchases

/**
 * Stable error codes thrown by every RevenueDog SDK operation, shared verbatim with the iOS SDK.
 */
enum class PurchasesErrorCode(val description: String) {
    /** The backend could not be reached (timeout, DNS, connection failure). */
    NETWORK_ERROR("A network error occurred."),

    /** The user cancelled the purchase flow. */
    PURCHASE_CANCELLED("The purchase was cancelled by the user."),

    /** The purchase request was invalid (e.g. item already owned, malformed request). */
    PURCHASE_INVALID("The purchase request was invalid."),

    /** The requested product could not be found on the store. */
    PRODUCT_NOT_FOUND("The product was not found on the store."),

    /** The backend's store validator rejected the receipt. */
    RECEIPT_VALIDATION_FAILED("Receipt validation failed."),

    /** Google Play Billing reported a problem. */
    STORE_PROBLEM("There was a problem with the Play Store."),

    /** The SDK is misconfigured (bad API key, missing base URL, logOut while anonymous, ...). */
    CONFIGURATION_ERROR("The SDK is not configured correctly."),

    /** The purchase is pending external action (e.g. cash payment); no receipt was posted. */
    PENDING("The purchase is pending and not yet complete."),

    /** Anything else. */
    UNKNOWN("An unknown error occurred.")
}

/**
 * The single error type thrown by all RevenueDog APIs.
 *
 * @property code stable, programmatically matchable error code.
 * @property underlyingErrorMessage detail from the backend or Play Billing, when available.
 */
class PurchasesError(
    val code: PurchasesErrorCode,
    val underlyingErrorMessage: String? = null,
    cause: Throwable? = null
) : Exception(underlyingErrorMessage ?: code.description, cause) {

    override fun toString(): String =
        "PurchasesError(code=$code, message=${underlyingErrorMessage ?: code.description})"
}
