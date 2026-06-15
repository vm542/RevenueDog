package com.revenuedog.purchases

import com.revenuedog.purchases.models.CustomerInfo

/**
 * Listener invoked on the main thread whenever [CustomerInfo] changes
 * (purchase, restore, logIn/logOut, refresh). Set via [Purchases.updatedCustomerInfoListener].
 */
fun interface UpdatedCustomerInfoListener {
    fun onReceived(customerInfo: CustomerInfo)
}
