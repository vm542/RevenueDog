package com.revenuedog.purchases

import com.revenuedog.purchases.internal.IdentityManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Verifies the `$RevenueDogAnonymousID:<uuid>` convention. */
class IdentityTest {

    @Test
    fun `recognizes anonymous ids`() {
        assertTrue(IdentityManager.isAnonymousId("\$RevenueDogAnonymousID:123e4567-e89b-12d3-a456-426614174000"))
    }

    @Test
    fun `treats explicit ids as non-anonymous`() {
        assertFalse(IdentityManager.isAnonymousId("user_123"))
        assertFalse(IdentityManager.isAnonymousId("\$OpenCatAnonymousID:abc"))
    }
}
