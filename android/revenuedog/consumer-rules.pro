# RevenueDog consumer rules — keep kotlinx.serialization machinery for the SDK's DTOs.

-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

# Keep generated serializer lookups (Companion.serializer()).
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$Companion Companion;
}
-keepclassmembers class <2>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}

# Serializer fields generated on serializable classes.
-keepclassmembers @kotlinx.serialization.Serializable class com.revenuedog.purchases.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
