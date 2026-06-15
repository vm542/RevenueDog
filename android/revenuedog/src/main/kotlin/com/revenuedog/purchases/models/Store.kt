package com.revenuedog.purchases.models

/** The store that produced a transaction or entitlement. Mirrors the backend `store` strings. */
enum class Store(val raw: String) {
    APP_STORE("app_store"),
    PLAY_STORE("play_store"),
    PROMOTIONAL("promotional"),
    UNKNOWN("unknown");

    companion object {
        /** Maps a backend `store` string to a [Store], defaulting to [UNKNOWN]. */
        fun fromRaw(raw: String?): Store =
            entries.firstOrNull { it.raw == raw } ?: UNKNOWN
    }
}

/** Billing period kind for an [EntitlementInfo]. Mirrors the backend `period_type` strings. */
enum class PeriodType(val raw: String) {
    NORMAL("normal"),
    TRIAL("trial"),
    INTRO("intro");

    companion object {
        /** Maps a backend `period_type` string to a [PeriodType], defaulting to [NORMAL]. */
        fun fromRaw(raw: String?): PeriodType =
            entries.firstOrNull { it.raw == raw } ?: NORMAL
    }
}
