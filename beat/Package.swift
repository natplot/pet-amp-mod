// swift-tools-version: 6.0
import PackageDescription

// Mac Pulse Beat: listens to what the Mac plays and publishes its tempo and
// beat for the Tape Club mod. BeatCore holds the estimator, kept apart so the
// tests can reach it.
let package = Package(
    name: "MacPulseBeat",
    platforms: [.macOS(.v15)],
    targets: [
        .target(name: "BeatCore"),
        .executableTarget(name: "MacPulseBeat", dependencies: ["BeatCore"],
                          linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("CoreAudio"), .linkedFramework("Accelerate")]),
        .testTarget(name: "BeatCoreTests", dependencies: ["BeatCore"]),
    ],
    swiftLanguageModes: [.v5]
)
