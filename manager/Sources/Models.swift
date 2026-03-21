import Foundation

struct CanvasRegistry: Codable {
    var canvases: [String: CanvasEntry]
}

struct CanvasEntry: Codable, Identifiable {
    var id: String { component }
    let component: String
    let projectDir: String
    let variantsDir: String
    let port: Int
    let stateFile: String
    var lastOpenedAt: String?
    var sessions: [SessionLink]?

    var mostRecentSessionId: String? {
        sessions?.first?.sessionId
    }
}

struct SessionLink: Codable {
    let sessionId: String
    let linkedAt: String
}

struct CanvasItem: Identifiable {
    let id: String
    let entry: CanvasEntry
    var isRunning: Bool
    var pid: Int32? = nil
    var variantCount: Int
    var lastModified: Date?
}
