// RevenueDog Android sample (Jetpack Compose).
//
// A minimal paywall + entitlement gate showing the full SDK flow:
// configure → getOfferings() → purchase(activity, package) → customerInfo entitlement.
//
// To run: add this as an Activity in an Android app module that depends on the
// `:revenuedog` SDK module, set API_KEY + BASE_URL, and configure matching
// products in Google Play (or use Play's billing test tracks).
//
// API_KEY is the app's Android key from the RevenueDog dashboard (goog_… or pk_…).

package com.revenuedog.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.revenuedog.purchases.Purchases
import com.revenuedog.purchases.PurchasesConfiguration
import com.revenuedog.purchases.models.Package
import kotlinx.coroutines.launch

private const val API_KEY = "goog_your_android_key_here"
private const val BASE_URL = "http://10.0.2.2:8787" // host machine from the emulator
private const val ENTITLEMENT = "pro"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Purchases.configure(
            PurchasesConfiguration.Builder(this, API_KEY).baseUrl(BASE_URL).build(),
        )

        setContent { MaterialTheme { Paywall() } }
    }

    @Composable
    private fun Paywall() {
        var packages by remember { mutableStateOf<List<Package>>(emptyList()) }
        var isPro by remember { mutableStateOf(false) }
        var status by remember { mutableStateOf("Loading…") }

        LaunchedEffect(Unit) {
            runCatching {
                val offerings = Purchases.sharedInstance.getOfferings()
                packages = offerings.current?.availablePackages ?: emptyList()
                isPro = Purchases.sharedInstance.getCustomerInfo()
                    .entitlements.all[ENTITLEMENT]?.isActive == true
                status = "${packages.size} package(s)"
            }.onFailure { status = "Failed: ${it.message}" }
        }

        Scaffold(topBar = { TopAppBar(title = { Text("RevenueDog") }) }) { pad ->
            Column(Modifier.padding(pad).fillMaxSize()) {
                if (isPro) {
                    Column(
                        Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text("You're Pro 🎉", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(12.dp))
                        TextButton(onClick = { restore { isPro = it; status = "Restored" } }) {
                            Text("Restore Purchases")
                        }
                    }
                } else {
                    LazyColumn(Modifier.weight(1f)) {
                        items(packages) { pkg ->
                            ListItem(
                                headlineContent = { Text(pkg.storeProduct.localizedTitle) },
                                trailingContent = { Text(pkg.storeProduct.localizedPriceString) },
                                modifier = Modifier.clickable {
                                    buy(pkg) { isPro = it; status = if (it) "Purchased!" else "Done" }
                                },
                            )
                            HorizontalDivider()
                        }
                    }
                    TextButton(onClick = { restore { isPro = it; status = "Restored" } }) {
                        Text("Restore Purchases")
                    }
                }
                Text(status, Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
    }

    private fun buy(pkg: Package, onResult: (Boolean) -> Unit) {
        lifecycleScope.launch {
            runCatching {
                val result = Purchases.sharedInstance.purchase(this@MainActivity, pkg)
                result.customerInfo.entitlements.all[ENTITLEMENT]?.isActive == true
            }.onSuccess(onResult)
        }
    }

    private fun restore(onResult: (Boolean) -> Unit) {
        lifecycleScope.launch {
            runCatching {
                Purchases.sharedInstance.restorePurchases()
                    .entitlements.all[ENTITLEMENT]?.isActive == true
            }.onSuccess(onResult)
        }
    }
}
