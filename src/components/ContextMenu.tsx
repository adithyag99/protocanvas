import { useEffect, useRef } from "react"
import { Eye, EyeOff, Trash2, Focus, Copy, Clipboard } from "lucide-react"
import { useCanvasStore } from "@/store/canvasStore"

interface ContextMenuProps {
  x: number
  y: number
  nodeId: string
  onClose: () => void
  onCopyReference?: (nodeId: string) => void
}

export function ContextMenu({ x, y, nodeId, onClose, onCopyReference }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const {
    canvasState,
    enterFocus,
    hideNode,
    unhideNode,
    removeNodes,
  } = useCanvasStore()

  const node = canvasState?.nodes[nodeId]
  const isHidden = node?.hidden === true

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose()
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [onClose])

  // Clamp position so menu doesn't go off-screen
  const menuW = 210
  const menuH = 200
  const clampedX = Math.min(x, window.innerWidth - menuW - 8)
  const clampedY = Math.min(y, window.innerHeight - menuH - 8)

  const items = [
    {
      label: "Focus",
      icon: Focus,
      onClick: () => { enterFocus(nodeId); onClose() },
    },
    {
      label: "Copy Reference",
      icon: Clipboard,
      shortcut: "⇧⌘C",
      onClick: () => { onCopyReference?.(nodeId); onClose() },
    },
    {
      label: isHidden ? "Unhide" : "Hide",
      icon: isHidden ? Eye : EyeOff,
      onClick: () => { isHidden ? unhideNode(nodeId) : hideNode(nodeId); onClose() },
    },
    {
      label: "Duplicate",
      icon: Copy,
      onClick: () => {
        if (!canvasState || !node) return
        fetch("/api/duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: nodeId }),
        }).then(() => useCanvasStore.getState().refetchState())
          .catch((err) => { useCanvasStore.setState({ syncError: err.message || 'Failed to duplicate' }) })
        onClose()
      },
    },
    { type: "separator" as const },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      onClick: () => { removeNodes([nodeId]); onClose() },
    },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 9998,
      }}
      className="w-[210px] bg-popover border border-border rounded-lg shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, i) => {
        if ('type' in item && item.type === "separator") {
          return <div key={i} className="h-px bg-border my-1 mx-2" />
        }
        const Icon = item.icon!
        return (
          <button
            key={i}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
              'danger' in item && item.danger
                ? "text-red-500 hover:bg-red-50"
                : "text-foreground hover:bg-muted"
            }`}
            onClick={item.onClick}
          >
            <Icon className="h-3.5 w-3.5 opacity-60 shrink-0" />
            <span className="whitespace-nowrap">{item.label}</span>
            {'shortcut' in item && item.shortcut && (
              <span className="ml-auto text-[11px] text-muted-foreground/50 font-mono">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
