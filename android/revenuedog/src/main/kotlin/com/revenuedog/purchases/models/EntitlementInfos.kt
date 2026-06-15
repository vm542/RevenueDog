package com.revenuedog.purchases.models

/**
 * The full set of [EntitlementInfo]s for a subscriber.
 *
 * @property all every entitlement the subscriber has ever had, keyed by identifier.
 */
class EntitlementInfos internal constructor(
    val all: Map<String, EntitlementInfo>
) {
    /** Only the entitlements that are currently [EntitlementInfo.isActive]. */
    val active: Map<String, EntitlementInfo>
        get() = all.filterValues { it.isActive }

    /** Looks up an entitlement by identifier; also usable as `entitlements[identifier]`. */
    operator fun get(identifier: String): EntitlementInfo? = all[identifier]

    override fun toString(): String =
        "EntitlementInfos(all=${all.keys}, active=${active.keys})"
}
