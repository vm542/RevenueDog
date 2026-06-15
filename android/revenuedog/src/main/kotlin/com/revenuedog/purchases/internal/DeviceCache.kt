package com.revenuedog.purchases.internal

import android.content.Context
import android.content.SharedPreferences
import com.revenuedog.purchases.models.CustomerInfo
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString

/** A cached [CustomerInfo] together with the wall-clock time (ms) it was fetched. */
internal data class CachedCustomerInfo(val info: CustomerInfo, val fetchedAtMillis: Long)

/**
 * Disk + in-memory persistence backed by [SharedPreferences].
 *
 * - CustomerInfo is cached **per appUserId** as the raw backend JSON plus a fetch timestamp.
 * - The current appUserId is persisted so identity survives process death.
 * - Receipts that could not reach the backend are queued and retried on the next configure.
 */
internal class DeviceCache(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val memoryCache = HashMap<String, CachedCustomerInfo>()

    // --- Identity ---

    var appUserId: String?
        get() = prefs.getString(KEY_APP_USER_ID, null)
        set(value) {
            prefs.edit().putString(KEY_APP_USER_ID, value).apply()
        }

    // --- CustomerInfo ---

    fun cacheCustomerInfo(appUserId: String, response: CustomerInfoResponse, info: CustomerInfo) {
        val now = System.currentTimeMillis()
        memoryCache[appUserId] = CachedCustomerInfo(info, now)
        prefs.edit()
            .putString(infoKey(appUserId), RevenueDogJson.encodeToString(response))
            .putLong(infoTsKey(appUserId), now)
            .apply()
    }

    fun getCachedCustomerInfo(appUserId: String): CachedCustomerInfo? {
        memoryCache[appUserId]?.let { return it }
        val raw = prefs.getString(infoKey(appUserId), null) ?: return null
        val ts = prefs.getLong(infoTsKey(appUserId), 0L)
        val response = runCatching {
            RevenueDogJson.decodeFromString<CustomerInfoResponse>(raw)
        }.getOrNull() ?: return null
        val info = CustomerInfoFactory.fromResponse(response)
        return CachedCustomerInfo(info, ts).also { memoryCache[appUserId] = it }
    }

    fun clearCustomerInfo(appUserId: String) {
        memoryCache.remove(appUserId)
        prefs.edit()
            .remove(infoKey(appUserId))
            .remove(infoTsKey(appUserId))
            .apply()
    }

    // --- Pending receipts (retried on configure) ---

    fun queuePendingReceipt(receipt: ReceiptRequest) {
        val current = getPendingReceipts().toMutableList()
        if (current.none { it.fetchToken == receipt.fetchToken }) {
            current.add(receipt)
            writePendingReceipts(current)
        }
    }

    fun getPendingReceipts(): List<ReceiptRequest> {
        val raw = prefs.getString(KEY_PENDING_RECEIPTS, null) ?: return emptyList()
        return runCatching {
            RevenueDogJson.decodeFromString(ListSerializer(ReceiptRequest.serializer()), raw)
        }.getOrDefault(emptyList())
    }

    fun removePendingReceipt(receipt: ReceiptRequest) {
        val remaining = getPendingReceipts().filterNot { it.fetchToken == receipt.fetchToken }
        writePendingReceipts(remaining)
    }

    private fun writePendingReceipts(receipts: List<ReceiptRequest>) {
        prefs.edit()
            .putString(
                KEY_PENDING_RECEIPTS,
                RevenueDogJson.encodeToString(ListSerializer(ReceiptRequest.serializer()), receipts)
            )
            .apply()
    }

    private fun infoKey(appUserId: String) = "$KEY_CUSTOMER_INFO.$appUserId"
    private fun infoTsKey(appUserId: String) = "$KEY_CUSTOMER_INFO_TS.$appUserId"

    companion object {
        private const val PREFS_NAME = "com.revenuedog.purchases"
        private const val KEY_APP_USER_ID = "app_user_id"
        private const val KEY_CUSTOMER_INFO = "customer_info"
        private const val KEY_CUSTOMER_INFO_TS = "customer_info_ts"
        private const val KEY_PENDING_RECEIPTS = "pending_receipts"
    }
}
