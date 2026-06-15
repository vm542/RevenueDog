package com.revenuedog.purchases.internal

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Minimal ISO-8601 UTC date parsing/formatting that works on minSdk 24 (no `java.time`).
 *
 * Accepts the shapes the backend emits: `2026-06-10T12:00:00Z` and the fractional-second
 * variant `2026-06-10T12:00:00.123Z`. Always interprets/produces UTC.
 */
internal object Iso8601 {

    private fun formatter(pattern: String): SimpleDateFormat =
        SimpleDateFormat(pattern, Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
            isLenient = false
        }

    private val patterns = listOf(
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
    )

    /** Parses an ISO-8601 string, returning `null` for `null`/blank/unparseable input. */
    fun parse(value: String?): Date? {
        if (value.isNullOrBlank()) return null
        for (pattern in patterns) {
            try {
                return formatter(pattern).parse(value)
            } catch (_: Exception) {
                // try next pattern
            }
        }
        return null
    }

    /** Formats a [Date] as `yyyy-MM-dd'T'HH:mm:ss'Z'` in UTC. */
    fun format(date: Date): String =
        formatter("yyyy-MM-dd'T'HH:mm:ss'Z'").format(date)
}
