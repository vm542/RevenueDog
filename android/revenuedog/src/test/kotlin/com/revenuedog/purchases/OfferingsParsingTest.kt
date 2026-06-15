package com.revenuedog.purchases

import com.revenuedog.purchases.internal.OfferingsResponse
import com.revenuedog.purchases.internal.RevenueDogJson
import com.revenuedog.purchases.internal.toAnyMap
import com.revenuedog.purchases.models.PackageType
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parses the Offerings shape from docs/API.md. RevenueDog uses `$rd_*` standard package
 * identifiers (not the doc's `$oc_*`), so the sample below reflects that.
 */
class OfferingsParsingTest {

    private val sampleJson = """
        {
          "current_offering_id": "default",
          "offerings": [
            {
              "identifier": "default",
              "description": "Standard paywall",
              "metadata": { "badge": "popular", "rank": 1 },
              "packages": [
                { "identifier": "${'$'}rd_monthly", "platform_product_identifier": "com.app.pro.monthly" },
                { "identifier": "${'$'}rd_annual", "platform_product_identifier": "com.app.pro.annual" }
              ]
            }
          ],
          "experiment": { "id": "exp_1", "variant": "treatment" }
        }
    """.trimIndent()

    @Test
    fun `parses offerings and packages`() {
        val response = RevenueDogJson.decodeFromString<OfferingsResponse>(sampleJson)

        assertEquals("default", response.currentOfferingId)
        assertEquals(1, response.offerings.size)

        val offering = response.offerings.first()
        assertEquals("default", offering.identifier)
        assertEquals("Standard paywall", offering.description)
        assertEquals(2, offering.packages.size)
        assertEquals("\$rd_monthly", offering.packages[0].identifier)
        assertEquals("com.app.pro.monthly", offering.packages[0].platformProductIdentifier)
        assertEquals("exp_1", response.experiment?.id)
    }

    @Test
    fun `maps standard package identifiers to package types`() {
        assertEquals(PackageType.MONTHLY, PackageType.fromIdentifier("\$rd_monthly"))
        assertEquals(PackageType.ANNUAL, PackageType.fromIdentifier("\$rd_annual"))
        assertEquals(PackageType.LIFETIME, PackageType.fromIdentifier("\$rd_lifetime"))
        assertEquals(PackageType.SIX_MONTH, PackageType.fromIdentifier("\$rd_six_month"))
        assertEquals(PackageType.CUSTOM, PackageType.fromIdentifier("my_custom_pkg"))
        assertEquals(PackageType.UNKNOWN, PackageType.fromIdentifier("\$rd_future"))
    }

    @Test
    fun `exposes metadata as a plain map`() {
        val response = RevenueDogJson.decodeFromString<OfferingsResponse>(sampleJson)
        val metadata = response.offerings.first().metadata.toAnyMap()
        assertEquals("popular", metadata["badge"])
        assertEquals(1L, metadata["rank"])
    }

    @Test
    fun `experiment is null when absent`() {
        val json = """
            { "current_offering_id": null, "offerings": [] }
        """.trimIndent()
        val response = RevenueDogJson.decodeFromString<OfferingsResponse>(json)
        assertNull(response.experiment)
        assertNull(response.currentOfferingId)
        assertTrue(response.offerings.isEmpty())
    }
}
