// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RevenueDog",
    platforms: [
        .iOS(.v15),
        .macOS(.v12)
    ],
    products: [
        .library(
            name: "RevenueDog",
            targets: ["RevenueDog"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "RevenueDog",
            dependencies: [],
            path: "Sources/RevenueDog"
        ),
        .testTarget(
            name: "RevenueDogTests",
            dependencies: ["RevenueDog"],
            path: "Tests/RevenueDogTests"
        )
    ]
)
