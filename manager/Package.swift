// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ProtocanvasManager",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "ProtocanvasManager",
            path: "Sources"
        )
    ]
)
