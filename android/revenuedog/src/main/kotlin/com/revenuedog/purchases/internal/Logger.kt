package com.revenuedog.purchases.internal

import android.util.Log
import com.revenuedog.purchases.LogLevel

/**
 * Internal logger that prefixes every line with `[RevenueDog]` and respects the configured
 * [LogLevel]. All `android.util.Log` calls are guarded so the SDK still works in plain JVM
 * unit tests where the framework is stubbed.
 */
internal object Logger {
    private const val TAG = "[RevenueDog]"

    @Volatile
    var logLevel: LogLevel = LogLevel.INFO

    fun verbose(message: String) = log(LogLevel.VERBOSE, message, null)
    fun debug(message: String) = log(LogLevel.DEBUG, message, null)
    fun info(message: String) = log(LogLevel.INFO, message, null)
    fun warn(message: String, throwable: Throwable? = null) = log(LogLevel.WARN, message, throwable)
    fun error(message: String, throwable: Throwable? = null) = log(LogLevel.ERROR, message, throwable)

    private fun log(level: LogLevel, message: String, throwable: Throwable?) {
        if (level.ordinal < logLevel.ordinal) return
        try {
            when (level) {
                LogLevel.VERBOSE -> Log.v(TAG, message, throwable)
                LogLevel.DEBUG -> Log.d(TAG, message, throwable)
                LogLevel.INFO -> Log.i(TAG, message, throwable)
                LogLevel.WARN -> Log.w(TAG, message, throwable)
                LogLevel.ERROR -> Log.e(TAG, message, throwable)
            }
        } catch (_: Throwable) {
            // android.util.Log is not available in unit tests; ignore.
        }
    }
}
