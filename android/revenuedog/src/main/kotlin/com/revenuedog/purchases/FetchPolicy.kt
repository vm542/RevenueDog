package com.revenuedog.purchases

/** Controls how [Purchases.getCustomerInfo] uses the local cache. */
enum class FetchPolicy {
    /** Return the cached value when it is less than 5 minutes old, otherwise hit the network. */
    CACHED_OR_FETCH,

    /** Always fetch from the network. */
    FETCH_CURRENT,

    /** Only return the cached value; throws [PurchasesError] when no cache exists. */
    CACHE_ONLY
}
