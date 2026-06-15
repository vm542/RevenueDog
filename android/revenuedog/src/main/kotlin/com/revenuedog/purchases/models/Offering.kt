package com.revenuedog.purchases.models

/**
 * A paywall configuration: an ordered list of [Package]s the app can present.
 *
 * Packages whose product Google Play could not return are dropped before the offering
 * is surfaced — a package always has a price.
 */
class Offering internal constructor(
    val identifier: String,
    val serverDescription: String,
    /** Free-form metadata configured on the backend. */
    val metadata: Map<String, Any>,
    val availablePackages: List<Package>
) {
    /** The `$rd_lifetime` package, if present. */
    val lifetime: Package? get() = byType(PackageType.LIFETIME)

    /** The `$rd_annual` package, if present. */
    val annual: Package? get() = byType(PackageType.ANNUAL)

    /** The `$rd_six_month` package, if present. */
    val sixMonth: Package? get() = byType(PackageType.SIX_MONTH)

    /** The `$rd_three_month` package, if present. */
    val threeMonth: Package? get() = byType(PackageType.THREE_MONTH)

    /** The `$rd_two_month` package, if present. */
    val twoMonth: Package? get() = byType(PackageType.TWO_MONTH)

    /** The `$rd_monthly` package, if present. */
    val monthly: Package? get() = byType(PackageType.MONTHLY)

    /** The `$rd_weekly` package, if present. */
    val weekly: Package? get() = byType(PackageType.WEEKLY)

    /** Looks up a package by its full identifier (reserved or custom). */
    fun getPackage(identifier: String): Package? =
        availablePackages.firstOrNull { it.identifier == identifier }

    private fun byType(type: PackageType): Package? =
        availablePackages.firstOrNull { it.packageType == type }

    override fun toString(): String =
        "Offering(identifier=$identifier, packages=${availablePackages.map { it.identifier }})"
}
