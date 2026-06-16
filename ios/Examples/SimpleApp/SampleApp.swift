// RevenueDog iOS sample (SwiftUI).
//
// A minimal paywall + entitlement gate showing the full SDK flow:
// configure → getOfferings → purchase(package:) → customerInfo entitlement.
//
// To run: create a SwiftUI app in Xcode, add the RevenueDog package
// (../../ via local Swift Package or a Git dependency), drop in this file as
// your @main App, set API_KEY + BASE_URL below, and add StoreKit products to a
// StoreKit configuration file or App Store Connect.
//
// API_KEY is the app's iOS key from the RevenueDog dashboard (appl_… or pk_…).
// BASE_URL points at your RevenueDog backend (omit to use the default).

import SwiftUI
import RevenueDog

private let API_KEY = "appl_your_ios_key_here"
private let BASE_URL = URL(string: "http://localhost:8787")!
private let ENTITLEMENT = "pro"

@main
struct RevenueDogSampleApp: App {
    init() {
        Purchases.logLevel = .debug
        Purchases.configure(apiKey: API_KEY, baseURL: BASE_URL)
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @State private var packages: [Package] = []
    @State private var isPro = false
    @State private var status = "Loading…"
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Group {
                if isPro {
                    VStack(spacing: 12) {
                        Image(systemName: "crown.fill").font(.largeTitle).foregroundStyle(.yellow)
                        Text("You're Pro 🎉").font(.title2.bold())
                        Button("Restore Purchases") { Task { await restore() } }
                    }
                } else {
                    List {
                        Section("Upgrade to Pro") {
                            ForEach(packages, id: \.identifier) { pkg in
                                Button {
                                    Task { await purchase(pkg) }
                                } label: {
                                    HStack {
                                        Text(pkg.storeProduct.localizedTitle)
                                        Spacer()
                                        Text(pkg.storeProduct.localizedPriceString).foregroundStyle(.secondary)
                                    }
                                }
                                .disabled(busy)
                            }
                        }
                        Section { Button("Restore Purchases") { Task { await restore() } } }
                    }
                }
            }
            .navigationTitle("RevenueDog")
            .overlay(alignment: .bottom) { Text(status).font(.footnote).foregroundStyle(.secondary).padding() }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            let offerings = try await Purchases.shared.getOfferings()
            packages = offerings.current?.availablePackages ?? []
            await refreshEntitlement()
            status = "\(packages.count) package(s)"
        } catch {
            status = "Failed to load offerings: \(error.localizedDescription)"
        }
    }

    private func purchase(_ package: Package) async {
        busy = true; defer { busy = false }
        do {
            let result = try await Purchases.shared.purchase(package: package)
            isPro = result.customerInfo.entitlements[ENTITLEMENT]?.isActive == true
            status = isPro ? "Purchased!" : "Purchase completed."
        } catch {
            status = "Purchase failed: \(error.localizedDescription)"
        }
    }

    private func restore() async {
        do {
            let info = try await Purchases.shared.restorePurchases()
            isPro = info.entitlements[ENTITLEMENT]?.isActive == true
            status = isPro ? "Restored Pro." : "Nothing to restore."
        } catch {
            status = "Restore failed: \(error.localizedDescription)"
        }
    }

    private func refreshEntitlement() async {
        if let info = try? await Purchases.shared.getCustomerInfo() {
            isPro = info.entitlements[ENTITLEMENT]?.isActive == true
        }
    }
}
