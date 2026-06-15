package com.revenuedog.purchases.internal

import com.revenuedog.purchases.PurchasesError
import com.revenuedog.purchases.PurchasesErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * Thin REST client for the public (`pk_`) RevenueDog endpoints described in docs/API.md.
 *
 * All calls are `suspend` and run on [Dispatchers.IO]. Transport failures map to
 * [PurchasesErrorCode.NETWORK_ERROR]; backend error bodies map their stable `code` strings to
 * [PurchasesErrorCode].
 */
internal class BackendClient(
    private val apiKey: String,
    baseUrl: String,
    private val platformVersion: String,
    private val sdkVersion: String,
    private val appVersion: String,
    private val httpClient: OkHttpClient
) {
    private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun getSubscriber(appUserId: String): CustomerInfoResponse {
        val url = base.newBuilder()
            .addPathSegment("v1").addPathSegment("subscribers").addPathSegment(appUserId)
            .build()
        return execute(buildRequest(url).get().build())
    }

    suspend fun getOfferings(appUserId: String): OfferingsResponse {
        val url = base.newBuilder()
            .addPathSegment("v1").addPathSegment("subscribers").addPathSegment(appUserId)
            .addPathSegment("offerings")
            .build()
        return execute(buildRequest(url).get().build())
    }

    suspend fun postReceipt(receipt: ReceiptRequest): CustomerInfoResponse {
        val url = base.newBuilder().addPathSegment("v1").addPathSegment("receipts").build()
        val body = RevenueDogJson.encodeToString(receipt).toRequestBody(jsonMediaType)
        return execute(buildRequest(url).post(body).build())
    }

    suspend fun alias(appUserId: String, newAppUserId: String): CustomerInfoResponse {
        val url = base.newBuilder()
            .addPathSegment("v1").addPathSegment("subscribers").addPathSegment(appUserId)
            .addPathSegment("alias")
            .build()
        val body = RevenueDogJson.encodeToString(AliasRequest(newAppUserId)).toRequestBody(jsonMediaType)
        return execute(buildRequest(url).post(body).build())
    }

    suspend fun postAttributes(appUserId: String, attributes: Map<String, String?>) {
        val url = base.newBuilder()
            .addPathSegment("v1").addPathSegment("subscribers").addPathSegment(appUserId)
            .addPathSegment("attributes")
            .build()
        val request = AttributesRequest(attributes.mapValues { AttributeValueDto(it.value) })
        val body = RevenueDogJson.encodeToString(request).toRequestBody(jsonMediaType)
        executeRaw(buildRequest(url).post(body).build())
    }

    private fun buildRequest(url: HttpUrl): Request.Builder =
        Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $apiKey")
            .header("X-Platform", "android")
            .header("X-Platform-Version", platformVersion)
            .header("X-SDK-Version", sdkVersion)
            .header("X-App-Version", appVersion)
            .header("Content-Type", "application/json")

    private suspend inline fun <reified T> execute(request: Request): T {
        val raw = executeRaw(request)
        try {
            return RevenueDogJson.decodeFromString<T>(raw)
        } catch (e: Exception) {
            throw PurchasesError(
                PurchasesErrorCode.UNKNOWN,
                "Failed to parse response from ${request.url}: ${e.message}",
                e
            )
        }
    }

    private suspend fun executeRaw(request: Request): String = withContext(Dispatchers.IO) {
        Logger.debug("→ ${request.method} ${request.url}")
        val response = try {
            httpClient.newCall(request).execute()
        } catch (e: IOException) {
            throw PurchasesError(PurchasesErrorCode.NETWORK_ERROR, e.message, e)
        }
        response.use {
            val bodyString = it.body?.string().orEmpty()
            Logger.debug("← ${it.code} ${request.url}")
            if (!it.isSuccessful) {
                throw mapError(it.code, bodyString)
            }
            bodyString
        }
    }

    private fun mapError(httpCode: Int, body: String): PurchasesError {
        val parsed = runCatching { RevenueDogJson.decodeFromString<ErrorResponse>(body) }.getOrNull()
        val code = parsed?.error?.code
        val message = parsed?.error?.message ?: "HTTP $httpCode"
        val errorCode = when (code) {
            "unauthorized", "forbidden" -> PurchasesErrorCode.CONFIGURATION_ERROR
            "invalid_request" -> PurchasesErrorCode.PURCHASE_INVALID
            "resource_not_found" -> PurchasesErrorCode.UNKNOWN
            "conflict" -> PurchasesErrorCode.PURCHASE_INVALID
            "receipt_validation_failed" -> PurchasesErrorCode.RECEIPT_VALIDATION_FAILED
            "store_problem" -> PurchasesErrorCode.STORE_PROBLEM
            "internal_error" -> PurchasesErrorCode.STORE_PROBLEM
            else -> when (httpCode) {
                401, 403 -> PurchasesErrorCode.CONFIGURATION_ERROR
                422 -> PurchasesErrorCode.RECEIPT_VALIDATION_FAILED
                in 500..599 -> PurchasesErrorCode.STORE_PROBLEM
                else -> PurchasesErrorCode.UNKNOWN
            }
        }
        return PurchasesError(errorCode, message)
    }
}
