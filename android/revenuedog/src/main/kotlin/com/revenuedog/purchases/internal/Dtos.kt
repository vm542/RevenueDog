package com.revenuedog.purchases.internal

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// ---------------------------------------------------------------------------
// Wire DTOs — these map 1:1 to the JSON shapes in docs/API.md (snake_case).
// They are kept separate from the public model types so the public surface stays
// store/transport agnostic.
// ---------------------------------------------------------------------------

@Serializable
internal data class CustomerInfoResponse(
    @SerialName("request_date") val requestDate: String? = null,
    val subscriber: SubscriberDto,
    /** Present on the alias (logIn) response. */
    val created: Boolean? = null
)

@Serializable
internal data class SubscriberDto(
    @SerialName("original_app_user_id") val originalAppUserId: String,
    @SerialName("first_seen") val firstSeen: String? = null,
    @SerialName("last_seen") val lastSeen: String? = null,
    @SerialName("management_url") val managementUrl: String? = null,
    val entitlements: Map<String, EntitlementDto> = emptyMap(),
    val subscriptions: Map<String, SubscriptionDto> = emptyMap(),
    @SerialName("non_subscriptions") val nonSubscriptions: Map<String, List<NonSubscriptionDto>> = emptyMap(),
    @SerialName("subscriber_attributes") val subscriberAttributes: Map<String, AttributeDto> = emptyMap()
)

@Serializable
internal data class EntitlementDto(
    @SerialName("expires_date") val expiresDate: String? = null,
    @SerialName("purchase_date") val purchaseDate: String? = null,
    @SerialName("product_identifier") val productIdentifier: String,
    @SerialName("grace_period_expires_date") val gracePeriodExpiresDate: String? = null
)

@Serializable
internal data class SubscriptionDto(
    @SerialName("purchase_date") val purchaseDate: String? = null,
    @SerialName("original_purchase_date") val originalPurchaseDate: String? = null,
    @SerialName("expires_date") val expiresDate: String? = null,
    val store: String? = null,
    @SerialName("unsubscribe_detected_at") val unsubscribeDetectedAt: String? = null,
    @SerialName("billing_issues_detected_at") val billingIssuesDetectedAt: String? = null,
    @SerialName("grace_period_expires_date") val gracePeriodExpiresDate: String? = null,
    @SerialName("is_sandbox") val isSandbox: Boolean = false,
    @SerialName("period_type") val periodType: String? = null,
    @SerialName("will_renew") val willRenew: Boolean = false
)

@Serializable
internal data class NonSubscriptionDto(
    val id: String? = null,
    @SerialName("purchase_date") val purchaseDate: String? = null,
    val store: String? = null,
    @SerialName("is_sandbox") val isSandbox: Boolean = false
)

@Serializable
internal data class AttributeDto(
    val value: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

// --- Offerings ---

@Serializable
internal data class OfferingsResponse(
    @SerialName("current_offering_id") val currentOfferingId: String? = null,
    val offerings: List<OfferingDto> = emptyList(),
    val experiment: ExperimentDto? = null
)

@Serializable
internal data class OfferingDto(
    val identifier: String,
    val description: String = "",
    val metadata: JsonObject = JsonObject(emptyMap()),
    val packages: List<PackageDto> = emptyList()
)

@Serializable
internal data class PackageDto(
    val identifier: String,
    @SerialName("platform_product_identifier") val platformProductIdentifier: String
)

@Serializable
internal data class ExperimentDto(
    val id: String? = null,
    val variant: String? = null
)

// --- Requests ---

@Serializable
internal data class ReceiptRequest(
    @SerialName("app_user_id") val appUserId: String,
    @SerialName("fetch_token") val fetchToken: String,
    @SerialName("product_id") val productId: String,
    val store: String,
    @SerialName("presented_offering_identifier") val presentedOfferingIdentifier: String? = null,
    val price: Double? = null,
    val currency: String? = null
)

@Serializable
internal data class AliasRequest(
    @SerialName("new_app_user_id") val newAppUserId: String
)

@Serializable
internal data class AttributesRequest(
    val attributes: Map<String, AttributeValueDto>
)

@Serializable
internal data class AttributeValueDto(
    val value: String? = null
)

// --- Errors ---

@Serializable
internal data class ErrorResponse(
    val error: ErrorBody? = null
)

@Serializable
internal data class ErrorBody(
    val code: String? = null,
    val message: String? = null
)

internal fun JsonElement.toRawMetadata(): Map<String, Any> =
    (this as? JsonObject)?.toAnyMap() ?: emptyMap()
