package com.revenuedog.purchases.internal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The single [Json] instance used for all SDK (de)serialization.
 *
 * - `ignoreUnknownKeys`: forward-compatible with new backend fields.
 * - `encodeDefaults = false`: optional request fields default to `null` and are omitted, while
 *   explicitly-set `null`s (e.g. attribute deletion) are still encoded because they have no default.
 */
internal val RevenueDogJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    isLenient = true
}

/** Recursively converts a [JsonObject] into a plain `Map<String, Any>` for public `metadata`. */
internal fun JsonObject.toAnyMap(): Map<String, Any> =
    entries.mapNotNull { (key, value) ->
        value.toAnyOrNull()?.let { key to it }
    }.toMap()

private fun JsonElement.toAnyOrNull(): Any? = when (this) {
    is JsonNull -> null
    is JsonObject -> toAnyMap()
    is JsonArray -> mapNotNull { it.toAnyOrNull() }
    is JsonPrimitive -> when {
        isString -> content
        booleanOrNull != null -> booleanOrNull
        longOrNull != null -> longOrNull
        doubleOrNull != null -> doubleOrNull
        else -> content
    }
}
