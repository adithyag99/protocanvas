import SwiftUI

struct CanvasPanel: View {
    @Bindable var manager: CanvasManager
    @State private var searchText = ""
    @State private var showRunningOnly = false
    @State private var showQuitConfirm = false
    @State private var showNewCanvas = false

    private var filtered: [CanvasItem] {
        var items = manager.canvases
        if showRunningOnly {
            items = items.filter { $0.isRunning }
        }
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            items = items.filter { $0.entry.component.lowercased().contains(query) }
        }
        return items
    }

    private var runningCount: Int {
        manager.canvases.filter { $0.isRunning }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 10) {
                Text("Protocanvas")
                    .font(.headline)
                Spacer()
                HStack(spacing: 2) {
                    HeaderButton(icon: "plus", destructive: false) {
                        showNewCanvas = true
                    }
                    if runningCount > 0 {
                        HeaderButton(label: "Stop all", destructive: true) {
                            manager.stopAll()
                        }
                    }
                    HeaderButton(icon: "power", destructive: false) {
                        showQuitConfirm = true
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .alert("Quit Protocanvas Manager?", isPresented: $showQuitConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Quit", role: .destructive) {
                    NSApplication.shared.terminate(nil)
                }
            } message: {
                Text("Running canvas servers will not be affected.")
            }

            if showNewCanvas {
                // Inline new canvas form
                NewCanvasForm(manager: manager, isPresented: $showNewCanvas)
            } else {
                // Search
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.tertiary)
                        .font(.system(size: 12))
                    TextField("Search canvases...", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.tertiary)
                                .font(.system(size: 11))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.quaternary.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .padding(.horizontal, 14)
                .padding(.bottom, 6)

                // Segmented toggle
                HStack(spacing: 2) {
                    SegmentButton(title: "All", count: manager.canvases.count, isActive: !showRunningOnly) {
                        showRunningOnly = false
                    }
                    SegmentButton(title: "Running", count: runningCount, isActive: showRunningOnly) {
                        showRunningOnly = true
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 6)

                Divider()
                    .padding(.horizontal, 16)

                // Canvas list
                if filtered.isEmpty {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 24))
                            .foregroundStyle(.quaternary)
                        Text(showRunningOnly ? "No canvases running" : (searchText.isEmpty ? "No canvases found" : "No matches"))
                            .font(.callout.bold())
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(filtered) { item in
                                CanvasRow(item: item, manager: manager, isRunningTab: showRunningOnly)
                            }
                        }
                        .padding(.vertical, 4)
                        .padding(.horizontal, 4)
                    }
                    .frame(maxHeight: 380)
                }
            }
        }
        .frame(width: 340, height: 420)
    }
}

// MARK: - Header Button (Port Menu style capsule)

struct HeaderButton: View {
    var label: String? = nil
    var icon: String? = nil
    let destructive: Bool
    let action: () -> Void

    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: action) {
            Group {
                if let label {
                    Text(label)
                        .font(.caption)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 12, height: 14)
                }
            }
            .padding(.horizontal, destructive ? 10 : 7)
            .padding(.vertical, 4)
            .foregroundStyle(destructive && isHovered ? .red : .secondary)
            .background(
                Capsule().fill(
                    isPressed ? Color.primary.opacity(destructive ? 0.18 : 0.14)
                    : isHovered ? Color.primary.opacity(destructive ? 0.12 : 0.08)
                    : Color.clear
                )
            )
            .clipShape(Capsule())
            .scaleEffect(isPressed ? 0.92 : isHovered ? 1.04 : 1.0)
        }
        .buttonStyle(.plain)
        .onHover { h in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = h
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = false
                    }
                }
        )
    }
}

// MARK: - Segment Button

struct SegmentButton: View {
    let title: String
    let count: Int
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 11, weight: isActive ? .semibold : .regular))
                Text("\(count)")
                    .font(.system(size: 10))
                    .foregroundStyle(isActive ? .primary : .tertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(isActive ? Color.primary.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

// MARK: - Canvas Row

struct CanvasRow: View {
    let item: CanvasItem
    let manager: CanvasManager
    let isRunningTab: Bool
    @State private var isHovered = false
    @State private var slidOut = false
    @State private var copiedText: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // Top line: dot + name + actions/time
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle()
                    .fill(item.isRunning ? Color.green : Color.gray.opacity(0.4))
                    .frame(width: 6, height: 6)
                    .offset(y: -1)

                Text(item.entry.component)
                    .font(.system(.body, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: 4)

                Group {
                    if isHovered {
                        HStack(spacing: 4) {
                            if let copied = copiedText {
                                Text(copied)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .transition(.opacity)
                            } else if item.isRunning {
                                RowIconButton(icon: "terminal") {
                                    manager.openInCmux(item)
                                }
                                RowIconButton(icon: "safari") {
                                    manager.openInBrowserWithTerminal(item)
                                }
                                RowIconButton(icon: "doc.on.doc") {
                                    showCopied("Copied!")
                                    manager.copyURL(item)
                                }
                                RowIconButton(icon: "stop.fill", destructive: true) {
                                    killWithAnimation()
                                }
                            } else {
                                RowIconButton(icon: "terminal") {
                                    manager.startAndOpenInCmux(item)
                                }
                                RowIconButton(icon: "safari") {
                                    manager.startAndOpenInBrowser(item)
                                }
                                RowIconButton(icon: "doc.on.doc") {
                                    showCopied("Copied!")
                                    manager.copyURL(item)
                                }
                            }
                        }
                        .transition(.asymmetric(
                            insertion: .scale(scale: 0.85, anchor: .trailing)
                                .combined(with: .opacity)
                                .combined(with: .offset(x: 6)),
                            removal: .opacity
                        ))
                    } else {
                        Text(manager.relativeTime(item.lastModified))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .transition(.opacity)
                    }
                }
                .frame(height: 22)
            }

            // Bottom line: port + variants
            HStack(spacing: 6) {
                Text(":" + String(item.entry.port))
                    .font(.caption)
                    .fontDesign(.monospaced)
                    .foregroundStyle(.tertiary)

                if item.variantCount > 0 {
                    Text("\(item.variantCount) variants")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.leading, 12)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .background(isHovered ? Color.primary.opacity(0.05) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .blur(radius: slidOut ? 8 : 0)
        .opacity(slidOut ? 0 : 1)
        .offset(x: slidOut ? 340 : 0)
        .onHover { h in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovered = h
            }
        }
        .onTapGesture {
            if item.isRunning {
                manager.openInCmux(item)
            } else {
                manager.startCanvas(item)
                let port = item.entry.port
                Task {
                    for _ in 0..<50 {
                        try? await Task.sleep(nanoseconds: 300_000_000)
                        if await manager.isPortRunning(port) {
                            manager.openInCmux(item)
                            return
                        }
                    }
                    manager.openInCmux(item)
                }
            }
        }
        .contextMenu {
            Button("Open in Browser") { manager.openBrowserOnly(item) }
            Button("Open with Claude Code") { manager.openInCmux(item) }
            Divider()
            Button("Copy URL") { manager.copyURL(item) }
            if item.entry.mostRecentSessionId != nil {
                Button("Copy Resume Command") { manager.copyResumeCommand(item) }
            }
            Divider()
            if item.isRunning {
                Button("Stop Server", role: .destructive) { killWithAnimation() }
            } else {
                Button("Start Server") { manager.startCanvas(item) }
            }
        }
    }

    private func showCopied(_ text: String) {
        withAnimation(.easeInOut(duration: 0.15)) { copiedText = text }
        Task {
            try? await Task.sleep(for: .seconds(1.0))
            withAnimation(.easeInOut(duration: 0.15)) { copiedText = nil }
        }
    }

    private func killWithAnimation() {
        if isRunningTab {
            withAnimation(.easeOut(duration: 0.3)) {
                slidOut = true
            }
            Task {
                try? await Task.sleep(for: .seconds(0.3))
                manager.stopCanvas(item)
                slidOut = false
            }
        } else {
            manager.stopCanvas(item)
        }
    }
}

// MARK: - Row Button (Port Menu capsule style)

struct RowButton: View {
    let label: String
    var destructive: Bool = false
    let action: () -> Void

    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .foregroundStyle(destructive && isHovered ? .red : .primary)
                .background(
                    Capsule().fill(
                        isPressed ? Color.primary.opacity(0.15)
                        : isHovered ? (destructive ? Color.red.opacity(0.15) : Color.primary.opacity(0.1))
                        : Color.primary.opacity(0.05)
                    )
                )
                .clipShape(Capsule())
                .scaleEffect(isPressed ? 0.92 : isHovered ? 1.04 : 1.0)
        }
        .buttonStyle(.plain)
        .onHover { h in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = h
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = false
                    }
                }
        )
    }
}

// MARK: - Row Icon Button (SF Symbol, same capsule style as RowButton)

struct RowIconButton: View {
    let icon: String
    var destructive: Bool = false
    let action: () -> Void

    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
                .frame(width: 14, height: 14)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .foregroundStyle(destructive && isHovered ? .red : isHovered ? .primary : .secondary)
                .background(
                    Capsule().fill(
                        isPressed ? Color.primary.opacity(destructive ? 0.18 : 0.15)
                        : isHovered ? (destructive ? Color.red.opacity(0.15) : Color.primary.opacity(0.1))
                        : Color.primary.opacity(0.05)
                    )
                )
                .clipShape(Capsule())
                .scaleEffect(isPressed ? 0.92 : isHovered ? 1.04 : 1.0)
        }
        .buttonStyle(.plain)
        .onHover { h in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = h
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                        isPressed = false
                    }
                }
        )
    }
}

// MARK: - New Canvas Form (inline, replaces list content)

struct NewCanvasForm: View {
    let manager: CanvasManager
    @Binding var isPresented: Bool
    @State private var componentName = ""
    @State private var projectDir = ""
    @State private var isCreating = false

    private var variantsDir: String {
        let slug = componentName.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? "" : slug + "-variants"
    }

    private var canCreate: Bool {
        !componentName.trimmingCharacters(in: .whitespaces).isEmpty &&
        !projectDir.isEmpty &&
        FileManager.default.fileExists(atPath: projectDir)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Component name")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("e.g. Metrics Table", text: $componentName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Project directory")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    TextField("~/path/to/project", text: $projectDir)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))
                    Button("Browse") {
                        let panel = NSOpenPanel()
                        panel.canChooseFiles = false
                        panel.canChooseDirectories = true
                        panel.allowsMultipleSelection = false
                        panel.message = "Choose the project directory for this canvas"
                        if panel.runModal() == .OK, let url = panel.url {
                            projectDir = url.path
                        }
                    }
                    .font(.caption)
                }
            }

            if !variantsDir.isEmpty {
                HStack(spacing: 4) {
                    Text("Variants:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(variantsDir)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            HStack {
                Button("Cancel") {
                    isPresented = false
                }

                Spacer()

                Button("Create") {
                    guard canCreate else { return }
                    isCreating = true
                    manager.createNewCanvas(
                        component: componentName.trimmingCharacters(in: .whitespaces),
                        projectDir: projectDir,
                        variantsDir: variantsDir
                    )
                    isPresented = false
                }
                .disabled(!canCreate || isCreating)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}
