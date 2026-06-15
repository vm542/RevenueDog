package com.revenuedog.purchases.models

/**
 * All offerings configured on the backend, resolved for this platform and subscriber
 * (experiment-aware: [current] already reflects any assigned experiment variant).
 */
class Offerings internal constructor(
    /** The offering marked current on the backend, or null when none is set. */
    val current: Offering?,
    /** All offerings keyed by identifier. */
    val all: Map<String, Offering>
) {
    /** Looks up an offering by identifier. */
    fun getOffering(identifier: String): Offering? = all[identifier]

    /** Operator sugar for [getOffering]. */
    operator fun get(identifier: String): Offering? = all[identifier]

    override fun toString(): String =
        "Offerings(current=${current?.identifier}, all=${all.keys})"
}
