import { useEffect } from "react"
import { useCanvasStore } from "@/store/canvasStore"

export function SyncStatus() {
  const syncError = useCanvasStore((s) => s.syncError)
  const clearSyncError = useCanvasStore((s) => s.clearSyncError)

  useEffect(() => {
    if (!syncError) return
    const timer = setTimeout(() => clearSyncError(), 5000)
    return () => clearTimeout(timer)
  }, [syncError, clearSyncError])

  if (!syncError) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-red-600 px-4 py-2 text-white text-sm shadow-lg transition-opacity duration-200">
      <span className="truncate max-w-md">{syncError}</span>
      <button
        onClick={clearSyncError}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-red-700 transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
