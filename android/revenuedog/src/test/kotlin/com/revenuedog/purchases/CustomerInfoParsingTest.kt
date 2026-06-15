package com.revenuedog.purchases

import com.revenuedog.purchases.internal.CustomerInfoFactory
import com.revenuedog.purchases.internal.CustomerInfoResponse
import com.revenuedog.purchases.internal.Iso8601
import com.revenuedog.purchases.internal.RevenueDogJson
import com.revenuedog.purchases.models.PeriodType
import com.revenuedog.purchases.models.Store
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parses the `CustomerInfo` shape from docs/API.md and verifies the wire-to-model mapping.
 * Dates use far-future / far-past values so the active/expired assertions are stable over time.
 */
class CustomerInfoParsingTest {

    private val sampleJson = """
        {
          "request_date": "2026-06-10T12:00:00Z",
          "subscriber": {
            "original_app_user_id": "user_123",
            "first_seen": "2026-01-01T00:00:00Z",
            "last_seen": "2026-06-10T12:00:00Z",
            "management_url": null,
            "entitlements": {
              "pro": {
                "expires_date": "2999-07-10T12:00:00Z",
                "purchase_date": "2026-06-10T12:00:00Z",
                "product_identifier": "com.app.pro.monthly",
                "grace_period_expires_date": null
              }
            },
            "subscriptions": {
              "com.app.pro.monthly": {
                "purchase_date": "2026-06-10T12:00:00Z",
                "original_purchase_date": "2026-06-10T12:00:00Z",
                "expires_date": "2999-07-10T12:00:00Z",
                "store": "play_store",
                "unsubscribe_detected_at": null,
                "billing_issues_detected_at": null,
                "grace_period_expires_date": null,
                "is_sandbox": true,
                "period_type": "trial",
                "will_renew": true
              }
            },
            "non_subscriptions": {
              "com.app.lifetime": [
                {
                  "id": "txn_abc",
                  "purchase_date": "2026-06-10T12:00:00Z",
                  "store": "play_store",
                  "is_sandbox": false
                }
              ]
            },
            "subscriber_attributes": {
              "${'$'}email": { "value": "a@b.com", "updated_at": "2026-06-10T12:00:00Z" }
            }
          }
        }
    """.trimIndent()

    @Test
    fun `parses subscriber identity and request date`() {
        val response = RevenueDogJson.decodeFromString<CustomerInfoResponse>(sampleJson)
        val info = CustomerInfoFactory.fromResponse(response)

        assertEquals("user_123", info.originalAppUserId)
        assertEquals(Iso8601.parse("2026-06-10T12:00:00Z"), info.requestDate)
        assertNull(info.managementUrl)
    }

    @Test
    fun `maps active entitlement with subscription metadata`() {
        val response = RevenueDogJson.decodeFromString<CustomerInfoResponse>(sampleJson)
        val info = CustomerInfoFactory.fromResponse(response)

        val pro = info.entitlements["pro"]!!
        assertTrue(pro.isActive)
        assertTrue(pro.willRenew)
        assertEquals(PeriodType.TRIAL, pro.periodType)
        assertEquals(Store.PLAY_STORE, pro.store)
        assertEquals("com.app.pro.monthly", pro.productIdentifier)
        assertEquals(setOf("pro"), info.entitlements.active.keys)
    }

    @Test
    fun `collects active subscriptions and all purchased products`() {
        val response = RevenueDogJson.decodeFromString<CustomerInfoResponse>(sampleJson)
        val info = CustomerInfoFactory.fromResponse(response)

        assertEquals(setOf("com.app.pro.monthly"), info.activeSubscriptions)
        assertEquals(
            setOf("com.app.pro.monthly", "com.app.lifetime"),
            info.allPurchasedProductIdentifiers
        )
        assertEquals(Iso8601.parse("2999-07-10T12:00:00Z"), info.latestExpirationDate)
    }

    @Test
    fun `tolerates missing optional collections`() {
        val minimal = """
            {
              "request_date": "2026-06-10T12:00:00Z",
              "subscriber": { "original_app_user_id": "u1" }
            }
        """.trimIndent()
        val info = CustomerInfoFactory.fromResponse(
            RevenueDogJson.decodeFromString<CustomerInfoResponse>(minimal)
        )
        assertEquals("u1", info.originalAppUserId)
        assertTrue(info.entitlements.all.isEmpty())
        assertTrue(info.activeSubscriptions.isEmpty())
        assertFalse(info.entitlements.active.containsKey("pro"))
    }
}
