package com.revenuedog.purchases.internal

import java.util.UUID

/**
 * Owns the current app user id and the anonymous-id convention
 * (`$RevenueDogAnonymousID:<uuid>`). Persists the current id via [DeviceCache].
 */
internal class IdentityManager(private val deviceCache: DeviceCache) {

    @Volatile
    var currentAppUserId: String = ""
        private set

    val isAnonymous: Boolean
        get() = isAnonymousId(currentAppUserId)

    /**
     * Resolves the id to use at configure time: an explicit [configuredAppUserId] wins, otherwise
     * the persisted id is reused, otherwise a fresh anonymous id is generated and persisted.
     */
    fun configure(configuredAppUserId: String?) {
        val resolved = configuredAppUserId
            ?: deviceCache.appUserId
            ?: generateAnonymousId()
        currentAppUserId = resolved
        deviceCache.appUserId = resolved
    }

    /** Switches identity to [newAppUserId] (after a successful alias) and persists it. */
    fun switchTo(newAppUserId: String) {
        currentAppUserId = newAppUserId
        deviceCache.appUserId = newAppUserId
    }

    /** Generates, persists and returns a brand-new anonymous id (used by logOut). */
    fun resetToAnonymous(): String {
        val anonymous = generateAnonymousId()
        currentAppUserId = anonymous
        deviceCache.appUserId = anonymous
        return anonymous
    }

    companion object {
        private const val ANONYMOUS_PREFIX = "\$RevenueDogAnonymousID:"

        fun isAnonymousId(id: String): Boolean = id.startsWith(ANONYMOUS_PREFIX)

        private fun generateAnonymousId(): String = "$ANONYMOUS_PREFIX${UUID.randomUUID()}"
    }
}
