import Foundation
import SwiftUI
import Darwin

private let CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin"
private let LOG_FILE = NSHomeDirectory() + "/SUStuff/protocanvas/logs/manager-debug.log"

private func logDebug(_ msg: String) {
    let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(msg)\n"
    if let data = line.data(using: .utf8) {
        if FileManager.default.fileExists(atPath: LOG_FILE) {
            if let fh = FileHandle(forWritingAtPath: LOG_FILE) {
                fh.seekToEndOfFile()
                fh.write(data)
                fh.closeFile()
            }
        } else {
            FileManager.default.createFile(atPath: LOG_FILE, contents: data)
        }
    }
}

private let CMUX_PATH = CMUX_BIN + "/cmux"

/// Run cmux command directly. Returns output string.
@discardableResult
private func runCmux(_ arguments: [String]) -> String {
    logDebug("CMUX: \(arguments.joined(separator: " "))")
    let task = Process()
    task.executableURL = URL(fileURLWithPath: CMUX_PATH)
    task.arguments = arguments
    let outPipe = Pipe()
    let errPipe = Pipe()
    task.standardOutput = outPipe
    task.standardError = errPipe
    do {
        try task.run()
        task.waitUntilExit()
        let out = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !err.isEmpty { logDebug("CMUX err: \(err)") }
        logDebug("CMUX done: exit=\(task.terminationStatus) out=\(out)")
        return out
    } catch {
        logDebug("CMUX FAILED: \(error)")
        return ""
    }
}

/// Run a shell command via /bin/sh. Fire and forget on background thread.
private func shellRun(_ command: String) {
    logDebug("CMD: \(command)")
    DispatchQueue.global(qos: .userInitiated).async {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", command]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try? task.run()
    }
}

@MainActor
@Observable
class CanvasManager {
    var canvases: [CanvasItem] = []
    var isLoading = false
    var runningCount: Int { canvases.filter { $0.isRunning }.count }
    private var recentlyKilled: [Int: Date] = [:]

    private let registryPath: String
    private let serverPath: String
    private let distPath: String
    private let logsDir: String
    private var refreshTimer: Timer?
    private var fileMonitor: DispatchSourceFileSystemObject?

    init() {
        // Derive paths from the manager binary location or use hardcoded paths
        let protocanvasRoot = Self.findProtocanvasRoot()
        self.registryPath = (protocanvasRoot as NSString).appendingPathComponent("registry.json")
        self.serverPath = (protocanvasRoot as NSString).appendingPathComponent(".protocanvas-server.mjs")
        self.distPath = (protocanvasRoot as NSString).appendingPathComponent("dist")
        self.logsDir = (protocanvasRoot as NSString).appendingPathComponent("logs")
    }

    private static func findProtocanvasRoot() -> String {
        // Walk up from the executable to find the protocanvas root
        let execPath = CommandLine.arguments[0]
        var path = (execPath as NSString).deletingLastPathComponent
        // If we're in an .app bundle, go up past Contents/MacOS
        if path.hasSuffix("/Contents/MacOS") {
            path = ((path as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent
            path = (path as NSString).deletingLastPathComponent
        }
        // Check if registry.json or .protocanvas-server.mjs exists here
        let fm = FileManager.default
        if fm.fileExists(atPath: (path as NSString).appendingPathComponent(".protocanvas-server.mjs")) {
            return path
        }
        // Fallback: try common location
        let home = NSHomeDirectory()
        let fallback = (home as NSString).appendingPathComponent("SUStuff/protocanvas")
        if fm.fileExists(atPath: (fallback as NSString).appendingPathComponent(".protocanvas-server.mjs")) {
            return fallback
        }
        return path
    }

    func startRefreshing() {
        Task { await refresh() }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
            }
        }
        watchRegistryFile()

        // Sleep/wake handling — pause polling during sleep
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshTimer?.invalidate()
            self?.refreshTimer = nil
        }
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                guard let self else { return }
                await self.refresh()
                self.refreshTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
                    Task { @MainActor in
                        await self?.refresh()
                    }
                }
            }
        }
    }

    func stopRefreshing() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        fileMonitor?.cancel()
        fileMonitor = nil
    }

    func refresh() async {
        let registry = loadRegistry()
        let entries = registry.canvases.values.sorted { $0.component < $1.component }

        // Prune recently killed (8-second window)
        let cutoff = Date().addingTimeInterval(-8)
        recentlyKilled = recentlyKilled.filter { $0.value > cutoff }

        // Get all PIDs for our ports in one lsof call
        let portPids = await fetchPortPids(ports: entries.map { $0.port })

        var items: [CanvasItem] = []
        for entry in entries {
            // Filter out recently killed ports to prevent UI flicker
            let wasRecentlyKilled = recentlyKilled[entry.port] != nil
            let pid = wasRecentlyKilled ? nil : portPids[entry.port]
            let running = pid != nil
            let count = countVariants(projectDir: entry.projectDir, variantsDir: entry.variantsDir)
            let modified = fileModified(path: entry.stateFile)
            items.append(CanvasItem(
                id: entry.component,
                entry: entry,
                isRunning: running,
                pid: pid,
                variantCount: count,
                lastModified: modified
            ))
        }

        self.canvases = items
    }

    // MARK: - Registry

    private func loadRegistry() -> CanvasRegistry {
        guard let data = FileManager.default.contents(atPath: registryPath),
              let registry = try? JSONDecoder().decode(CanvasRegistry.self, from: data) else {
            return CanvasRegistry(canvases: [:])
        }
        return registry
    }

    private func watchRegistryFile() {
        let fd = open(registryPath, O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename],
            queue: .main
        )
        source.setEventHandler { [weak self] in
            Task { @MainActor in
                await self?.refresh()
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        fileMonitor = source
    }

    // MARK: - Status

    func isPortRunning(_ port: Int) async -> Bool {
        let pids = await fetchPortPids(ports: [port])
        return pids[port] != nil
    }

    /// Fetch PIDs for all given ports in a single lsof call (runs off main thread)
    private func fetchPortPids(ports: [Int]) async -> [Int: Int32] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                var result: [Int: Int32] = [:]
                let pipe = Pipe()
                var pid: pid_t = 0
                let cmd = "/usr/sbin/lsof -iTCP -sTCP:LISTEN -n -P -F pn"
                var args = [strdup("/bin/sh"), strdup("-c"), strdup(cmd), nil]

                var fileActions: posix_spawn_file_actions_t?
                posix_spawn_file_actions_init(&fileActions)
                posix_spawn_file_actions_adddup2(&fileActions, pipe.fileHandleForWriting.fileDescriptor, 1)
                posix_spawn_file_actions_addclose(&fileActions, pipe.fileHandleForReading.fileDescriptor)

                let spawnResult = posix_spawn(&pid, "/bin/sh", &fileActions, nil, &args, nil)
                posix_spawn_file_actions_destroy(&fileActions)
                args.forEach { if let p = $0 { free(p) } }

                pipe.fileHandleForWriting.closeFile()

                guard spawnResult == 0 else {
                    continuation.resume(returning: result)
                    return
                }

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                var status: Int32 = 0
                waitpid(pid, &status, 0)

                // Parse lsof -F output: p=PID, n=name (contains :port)
                let output = String(data: data, encoding: .utf8) ?? ""
                var currentPid: Int32 = 0
                let portSet = Set(ports)

                for line in output.split(separator: "\n") {
                    if line.hasPrefix("p") {
                        currentPid = Int32(line.dropFirst()) ?? 0
                    } else if line.hasPrefix("n") && currentPid > 0 {
                        // Format: n*:PORT or n127.0.0.1:PORT
                        if let colonIdx = line.lastIndex(of: ":") {
                            let portStr = line[line.index(after: colonIdx)...]
                            if let port = Int(portStr), portSet.contains(port) {
                                result[port] = currentPid
                            }
                        }
                    }
                }

                continuation.resume(returning: result)
            }
        }
    }

    private func checkRunning(port: Int) async -> Bool {
        guard let url = URL(string: "http://localhost:\(port)/api/config") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func countVariants(projectDir: String, variantsDir: String) -> Int {
        let path = (projectDir as NSString).appendingPathComponent(variantsDir)
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: path) else { return 0 }
        return files.filter { $0.hasSuffix(".tsx") || $0.hasSuffix(".html") }.count
    }

    private func fileModified(path: String) -> Date? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path) else { return nil }
        return attrs[.modificationDate] as? Date
    }

    // MARK: - Actions

    func startCanvas(_ item: CanvasItem) {
        let entry = item.entry
        let serverPath = self.serverPath
        let distPath = self.distPath
        let logsDir = self.logsDir

        // Ensure logs dir
        try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)

        let safeName = entry.component.replacingOccurrences(of: "[^a-zA-Z0-9\\-_ ]", with: "", options: .regularExpression)
        let logPath = (logsDir as NSString).appendingPathComponent(safeName + ".log")

        // Launch server detached via shell (& makes it background, nohup keeps it alive)
        let cmd = "cd \"\(entry.projectDir)\" && nohup node \"\(serverPath)\" \"\(entry.projectDir)\" \"\(entry.component)\" \"\(entry.variantsDir)\" \"\(distPath)\" >> \"\(logPath)\" 2>&1 &"
        shellRun(cmd)

        // Poll for readiness then refresh
        let port = entry.port
        Task {
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 300_000_000)
                if await checkRunning(port: port) {
                    await refresh()
                    return
                }
            }
            await refresh()
        }
    }

    func createNewCanvas(component: String, projectDir: String, variantsDir: String) {
        // Ensure variants directory exists
        let variantsPath = (projectDir as NSString).appendingPathComponent(variantsDir)
        try? FileManager.default.createDirectory(atPath: variantsPath, withIntermediateDirectories: true)

        // Ensure logs dir
        try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)

        let safeName = component.replacingOccurrences(of: "[^a-zA-Z0-9\\-_ ]", with: "", options: .regularExpression)
        let logPath = (logsDir as NSString).appendingPathComponent(safeName + ".log")

        // Start server — it will auto-register in the registry
        let cmd = "cd \"\(projectDir)\" && nohup node \"\(serverPath)\" \"\(projectDir)\" \"\(component)\" \"\(variantsDir)\" \"\(distPath)\" >> \"\(logPath)\" 2>&1 &"
        shellRun(cmd)

        // Derive port (same hash as registry.mjs)
        let port = stablePort(component)

        // Poll for readiness then open browser
        Task {
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 300_000_000)
                if await isPortRunning(port) {
                    await refresh()
                    // Open in default browser
                    if let url = URL(string: "http://localhost:\(port)") {
                        NSWorkspace.shared.open(url)
                    }
                    return
                }
            }
            await refresh()
        }
    }

    /// Deterministic port from component name (must match registry.mjs stablePort)
    private func stablePort(_ name: String) -> Int {
        var hash: Int32 = 0
        for char in name.unicodeScalars {
            hash = ((hash &<< 5) &- hash) &+ Int32(char.value)
        }
        return 10000 + Int(abs(hash)) % 50000
    }

    func stopCanvas(_ item: CanvasItem) {
        // Direct SIGTERM — no shell, no process spawning, just a C function call
        if let pid = item.pid, pid > 0 {
            kill(pid, SIGTERM)
            recentlyKilled[item.entry.port] = Date()
            logDebug("KILL: sent SIGTERM to pid \(pid) for \(item.entry.component)")
        }
        // Mark as stopped immediately in the UI — the 5s poll will confirm
        if let idx = canvases.firstIndex(where: { $0.id == item.id }) {
            canvases[idx].isRunning = false
            canvases[idx].pid = nil
        }
    }

    func stopAll() {
        for item in canvases where item.isRunning {
            if let pid = item.pid, pid > 0 {
                kill(pid, SIGTERM)
                recentlyKilled[item.entry.port] = Date()
            }
        }
        for i in canvases.indices {
            canvases[i].isRunning = false
            canvases[i].pid = nil
        }
    }

    func openInBrowser(_ item: CanvasItem) {
        let urlStr = "http://localhost:\(item.entry.port)"
        // Try CMUX first — opens in a browser pane within CMUX
        shellRun("cmux browser open \"\(urlStr)\" 2>/dev/null || open \"\(urlStr)\"")
    }

    /// Open in default browser with ?terminal=1 to auto-open the embedded terminal
    func openInBrowserWithTerminal(_ item: CanvasItem) {
        let urlStr = "http://localhost:\(item.entry.port)?terminal=1"
        if let url = URL(string: urlStr) { NSWorkspace.shared.open(url) }
    }

    /// Start server, wait for ready, then open in cmux
    func startAndOpenInCmux(_ item: CanvasItem) {
        startCanvas(item)
        let port = item.entry.port
        Task {
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 300_000_000)
                if await isPortRunning(port) {
                    openInCmux(item)
                    return
                }
            }
            openInCmux(item)
        }
    }

    /// Start server, wait for ready, then open in browser with embedded terminal
    func startAndOpenInBrowser(_ item: CanvasItem) {
        startCanvas(item)
        let port = item.entry.port
        Task {
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 300_000_000)
                if await isPortRunning(port) {
                    await MainActor.run { openInBrowserWithTerminal(item) }
                    return
                }
            }
            await MainActor.run { openInBrowserWithTerminal(item) }
        }
    }

    /// Open a full CMUX workspace: Claude Code on left, canvas browser on right
    func openInCmux(_ item: CanvasItem) {
        let urlStr = "http://localhost:\(item.entry.port)"
        let component = item.entry.component

        let claudeCmd: String
        let cdPrefix = "cd \"\(item.entry.projectDir)\" && "
        if let sid = item.entry.mostRecentSessionId {
            claudeCmd = cdPrefix + "claude --resume \(sid)"
        } else {
            claudeCmd = cdPrefix + "claude --name 'protocanvas: \(component)'"
        }

        DispatchQueue.global(qos: .userInitiated).async { [self] in
            // 1. Create workspace with Claude Code
            let wsOut = runCmux(["new-workspace", "--command", claudeCmd])
            // Parse workspace ID from "OK <uuid>"
            let wsId = wsOut.components(separatedBy: " ").last ?? ""
            guard !wsId.isEmpty else {
                // Fallback to default browser
                DispatchQueue.main.async {
                    if let url = URL(string: urlStr) { NSWorkspace.shared.open(url) }
                }
                return
            }
            // 2. Rename workspace
            runCmux(["rename-workspace", "--workspace", wsId, component])
            // 3. Open browser split
            Thread.sleep(forTimeInterval: 0.3)
            runCmux(["browser", "open", urlStr, "--workspace", wsId])
        }
    }

    /// Just open in CMUX browser (no Claude session)
    func openBrowserOnly(_ item: CanvasItem) {
        let urlStr = "http://localhost:\(item.entry.port)"
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let out = runCmux(["browser", "open", urlStr])
            if out.isEmpty {
                // CMUX not available, fallback
                DispatchQueue.main.async {
                    if let url = URL(string: urlStr) { NSWorkspace.shared.open(url) }
                }
            }
        }
    }

    /// Copy a combined command: cd + start server + resume Claude session
    func copyURL(_ item: CanvasItem) {
        let pb = NSPasteboard.general
        pb.clearContents()
        let entry = item.entry
        var parts: [String] = []
        // Start the server (opens browser too)
        parts.append("protocanvas open \"\(entry.component)\"")
        // Resume Claude session
        if let sid = entry.mostRecentSessionId {
            parts.append("claude --resume \(sid)")
        }
        pb.setString(parts.joined(separator: " && "), forType: .string)
    }

    func copyResumeCommand(_ item: CanvasItem) {
        let pb = NSPasteboard.general
        pb.clearContents()
        if let sid = item.entry.mostRecentSessionId {
            pb.setString("claude --resume \(sid)", forType: .string)
        } else {
            pb.setString("claude --name \"protocanvas: \(item.entry.component)\"", forType: .string)
        }
    }

    // MARK: - Helpers

    func relativeTime(_ date: Date?) -> String {
        guard let date = date else { return "-" }
        let diff = Date().timeIntervalSince(date)
        let mins = Int(diff / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        let hrs = mins / 60
        if hrs < 24 { return "\(hrs)h ago" }
        let days = hrs / 24
        return "\(days)d ago"
    }

    func shortDir(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}
