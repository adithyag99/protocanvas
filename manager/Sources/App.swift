import SwiftUI

@main
struct ProtocanvasManagerApp: App {
    @State private var manager = CanvasManager()

    var body: some Scene {
        MenuBarExtra {
            CanvasPanel(manager: manager)
        } label: {
            HStack(spacing: 3) {
                Image(systemName: manager.runningCount > 0 ? "circle.fill" : "square.grid.2x2")
                    .font(.system(size: manager.runningCount > 0 ? 5.5 : 10))
                    .foregroundStyle(manager.runningCount > 0 ? .green : .secondary)
                if manager.runningCount > 0 {
                    Text("\(manager.runningCount)")
                        .fontDesign(.monospaced)
                }
            }
        }
        .menuBarExtraStyle(.window)
    }

    init() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [manager] in
            manager.startRefreshing()
        }
    }
}
