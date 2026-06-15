package com.revenuedog.purchases

import com.revenuedog.purchases.internal.CustomerInfoFactory
import com.revenuedog.purchases.internal.CustomerInfoResponse
import com.revenuedog.purchases.internal.RevenueDogJson
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exercises the active/expiry rules for [com.revenuedog.purchases.models.EntitlementInfo]. */
class EntitlementLogicTest {

    private fun parse(json: String) =
        CustomerInfoFactory.fromResponse(RevenueDogJson.decodeFromString<CustomerInfoResponse>(json))

    @Test
    fun `future expiration is active`() {
        val info = parse(
            """
            {
              "request_date": "2026-06-10T12:00:00Z",
              "subscriber": {
                "original_app_user_id": "u1",
                "entitlements": {
                  "pro": { "product_identifier": "p.monthly", "expires_date": "2999-01-01T00:00:00Z" }
                }
              }
            }
            """.trimIndent()
        )
        assertTrue(info.entitlements["pro"]!!.isActive)
        assertEquals(setOf("pro"), info.entitlements.active.keys)
    }

    @Test
    fun `past expiration is inactive`() {
        val info = parse(
            """
            {
              "request_date": "2026-06-10T12:00:00Z",
              "subscriber": {
                "original_app_user_id": "u1",
                "entitlements": {
                  "pro": { "product_identifier": "p.monthly", "expires_date": "2000-01-01T00:00:00Z" }
                }
              }
            }
            """.trimIndent()
        )
        assertFalse(info.entitlements["pro"]!!.isActive)
        assertTrue(info.entitlements.active.isEmpty())
    }

    @Test
    fun `null expiration is a lifetime active entitlement`() {
        val info = parse(
            """
            {
              "request_date": "2026-06-10T12:00:00Z",
              "subscriber": {
                "original_app_user_id": "u1",
                "entitlements": {
                  "lifetime": { "product_identifier": "p.lifetime", "expires_date": null }
                },
                "non_subscriptions": {
                  "p.lifetime": [ { "id": "t1", "store": "play_store" } ]
                }
              }
            }
            """.trimIndent()
        )
        val ent = info.entitlements["lifetime"]!!
        assertTrue(ent.isActive)
        assertNull(ent.expirationDate)
        assertNull(info.latestExpirationDate)
    }

    @Test
    fun `mixes active and expired entitlements`() {
        val info = parse(
            """
            {
              "request_date": "2026-06-10T12:00:00Z",
              "subscriber": {
                "original_app_user_id": "u1",
                "entitlements": {
                  "pro": { "product_identifier": "p.monthly", "expires_date": "2999-01-01T00:00:00Z" },
                  "old": { "product_identifier": "p.old", "expires_date": "2001-01-01T00:00:00Z" }
                },
                "subscriptions": {
                  "p.monthly": { "expires_date": "2999-01-01T00:00:00Z", "store": "play_store", "will_renew": true },
                  "p.old": { "expires_date": "2001-01-01T00:00:00Z", "store": "play_store", "will_renew": false }
                }
              }
            }
            """.trimIndent()
        )
        assertEquals(setOf("pro"), info.entitlements.active.keys)
        assertEquals(2, info.entitlements.all.size)
        assertEquals(setOf("p.monthly"), info.activeSubscriptions)
    }
}
