package com.revenuedog.purchases.models

/** Duration category of a [Package], derived from its `$rd_*` identifier. */
enum class PackageType(val identifier: String?) {
    LIFETIME("\$rd_lifetime"),
    ANNUAL("\$rd_annual"),
    SIX_MONTH("\$rd_six_month"),
    THREE_MONTH("\$rd_three_month"),
    TWO_MONTH("\$rd_two_month"),
    MONTHLY("\$rd_monthly"),
    WEEKLY("\$rd_weekly"),

    /** A non-reserved identifier chosen by the developer. */
    CUSTOM(null),

    /** A reserved (`$`-prefixed) identifier this SDK version does not know. */
    UNKNOWN(null);

    companion object {
        /** Maps a package identifier to its [PackageType]. */
        fun fromIdentifier(identifier: String): PackageType =
            entries.firstOrNull { it.identifier == identifier }
                ?: if (identifier.startsWith("$")) UNKNOWN else CUSTOM
    }
}

/**
 * A purchasable entry of an [Offering], pairing a package identifier (e.g. `$rd_monthly`)
 * with the [StoreProduct] already fetched from Google Play.
 */
class Package internal constructor(
    val identifier: String,
    val packageType: PackageType,
    val storeProduct: StoreProduct,
    /** Identifier of the offering this package was presented in. */
    val offeringIdentifier: String
) {
    override fun toString(): String =
        "Package(identifier=$identifier, product=${storeProduct.productIdentifier})"
}
