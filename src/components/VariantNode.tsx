import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Handle, Position, type NodeProps, useEdges } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, GitBranch, GripHorizontal, RefreshCw, Trash2 } from "lucide-react"
import { useCanvasStore } from "@/store/canvasStore"
import type { VariantNodeData } from "@/types/canvas"

type VariantNodeProps = NodeProps & {
  data: VariantNodeData & { variantWidth: number }
}

function VariantNodeInner({ id, data }: VariantNodeProps) {
  const {
    feedback,
    iframeHeights,
    nodeWidths,
    togglePick,
    updateFeedback,
    setFeedbackAction,
    setIframeHeight,
    setNodeWidth,
    openModal,
    hideNode,
    unhideNode,
    removeNode,
    focusMode,
  } = useCanvasStore()

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [rationaleOpen, setRationaleOpen] = useState(false)
  const [localSize, setLocalSize] = useState<{ w?: number; h?: number } | null>(null)

  const isHidden = data.hidden === true
  const isPicked = feedback.picked.includes(id)
  const feedbackEntry = feedback.feedback[id]
  const feedbackText =
    typeof feedbackEntry === "string"
      ? feedbackEntry
      : feedbackEntry?.text ?? ""
  const feedbackAction =
    typeof feedbackEntry === "object" && feedbackEntry !== null
      ? feedbackEntry.action
      : "branch"

  const iframeHeight = iframeHeights[id] ?? 200
  const variantWidth = nodeWidths[id] ?? data.variantWidth
  const previewHeight = localSize?.h ?? Math.min(iframeHeight, 600)
  const previewWidth = localSize?.w ?? variantWidth

  // Listen for height messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "variant-height" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        setIframeHeight(id, e.data.height)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [id, setIframeHeight])

  const handleFeedbackChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateFeedback(id, e.target.value)
    },
    [id, updateFeedback]
  )

  // Helper to get zoom from React Flow viewport transform
  const getZoom = () => {
    const vp = document.querySelector(".react-flow__viewport")
    const t = vp ? getComputedStyle(vp).transform : ""
    const m = t.match(/matrix\(([^,]+)/)
    return m ? parseFloat(m[1]) : 1
  }

  // Right edge — width resize
  const onResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = previewWidth
    const zoom = getZoom()

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(280, startW + (ev.clientX - startX) / zoom)
      setLocalSize((s) => ({ ...s, w: newW }))
      setNodeWidth(id, newW)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [id, previewWidth, setNodeWidth])

  // Bottom edge — height resize
  const onResizeBottom = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = previewHeight
    const zoom = getZoom()

    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
      setLocalSize((s) => ({ ...s, h: newH }))
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [previewHeight])

  // Corner — both
  const onResizeCorner = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = previewWidth
    const startH = previewHeight
    const zoom = getZoom()

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(280, startW + (ev.clientX - startX) / zoom)
      const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
      setLocalSize({ w: newW, h: newH })
      setNodeWidth(id, newW)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [id, previewWidth, previewHeight, setNodeWidth])

  const nodeWidth = previewWidth + 32

  // Only show handle dots when an edge is actually connected
  const edges = useEdges()
  const connectedHandles = new Set<string>()
  for (const edge of edges) {
    if (edge.source === id && edge.sourceHandle) connectedHandles.add(`${edge.sourceHandle}-source`)
    if (edge.target === id && edge.targetHandle) connectedHandles.add(`${edge.targetHandle}-target`)
  }
  const handleClass = (handleId: string, type: "source" | "target") =>
    `!w-2 !h-2 ${connectedHandles.has(`${handleId}-${type}`) ? "!bg-border" : "!bg-transparent !border-transparent"}`

  return (
    <div
      className={`overflow-visible relative ${
        focusMode
          ? "rounded-lg group"
          : "bg-card border border-border rounded-xl shadow-sm"
      }`}
      style={{ width: focusMode ? previewWidth : nodeWidth }}
    >
      {/* Focus mode drag grip — appears on hover */}
      {focusMode && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-center w-10 h-5 rounded-md bg-background/80 backdrop-blur border border-border/50 shadow-sm cursor-grab active:cursor-grabbing">
            <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Header — hidden in focus mode */}
      {!focusMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 group/header">
          <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5 uppercase tracking-wide shrink-0">
            {id}
          </span>
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex-1 truncate">
            {data.label}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
            <button
              className="nodrag h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              onClick={() => isHidden ? unhideNode(id) : hideNode(id)}
              title={isHidden ? "Unhide" : "Hide"}
            >
              {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            <button
              className="nodrag h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
              onClick={() => {
                if (window.confirm(`Remove ${id}? This cannot be undone.`)) {
                  removeNode(id)
                }
              }}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Iframe preview — click anywhere to open detail modal */}
      <div className={focusMode ? "relative" : "px-4 pt-1.5 relative"}>
        <div
          className={`rounded-lg overflow-hidden relative cursor-pointer group/preview ${focusMode ? "border-0" : "border border-border/50"}`}
          style={{ width: previewWidth, height: previewHeight }}
          onClick={() => openModal({ nodeId: id, label: data.label, htmlFile: data.htmlFile })}
        >
          <iframe
            ref={iframeRef}
            src={`/variants/${data.htmlFile}?embed`}
            className="w-full border-0"
            style={{
              width: previewWidth,
              height: iframeHeight,
              pointerEvents: "none",
            }}
            title={`${id} — ${data.label}`}
            sandbox="allow-scripts allow-same-origin"
          />
          {/* Hover overlay with expand hint */}
          <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/5 transition-colors flex items-center justify-center">
            <span className="text-xs font-medium text-foreground/70 bg-background/90 rounded-md px-3 py-1.5 shadow-sm opacity-0 group-hover/preview:opacity-100 transition-opacity">
              Click to expand
            </span>
          </div>
        </div>

        {/* Right edge handle — nodrag prevents React Flow from intercepting */}
        <div
          className={`nodrag absolute -right-1 w-3 cursor-col-resize group/rr ${focusMode ? "top-0" : "top-3"}`}
          style={{ height: previewHeight }}
          onMouseDown={onResizeRight}
        >
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-full bg-transparent group-hover/rr:bg-neutral-300 transition-colors" />
        </div>

        {/* Bottom edge handle */}
        <div
          className={`nodrag absolute -bottom-1 h-3 cursor-row-resize group/rb z-10 ${focusMode ? "left-0" : "left-4"}`}
          style={{ width: previewWidth }}
          onMouseDown={onResizeBottom}
        >
          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full bg-transparent group-hover/rb:bg-neutral-300 transition-colors" />
        </div>

        {/* Corner handle */}
        <div
          className="nodrag absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize group/rc z-10"
          onMouseDown={onResizeCorner}
        >
          <div className="absolute bottom-1 right-1 w-[5px] h-[5px] border-r-2 border-b-2 border-transparent group-hover/rc:border-neutral-300 transition-colors rounded-br-sm" />
        </div>
      </div>

      {/* Rationale (collapsible) — hidden in focus mode */}
      {!focusMode && (data.rationale || data.avoids) && (
        <div className="px-4 pt-2">
          <button
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setRationaleOpen(!rationaleOpen)}
          >
            {rationaleOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Rationale
          </button>
          {rationaleOpen && (
            <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed space-y-1">
              {data.rationale && (
                <p>
                  <span className="font-semibold text-foreground">Rationale:</span>{" "}
                  {data.rationale}
                </p>
              )}
              {data.avoids && (
                <p>
                  <span className="font-semibold text-foreground">Avoids:</span>{" "}
                  {data.avoids}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Feedback — hidden in focus mode */}
      {!focusMode && <div className="px-4 pt-2 pb-3 space-y-2">
        <Textarea
          value={feedbackText}
          onChange={handleFeedbackChange}
          placeholder="Add feedback..."
          className="text-sm min-h-[60px] resize-none"
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
            <button
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                feedbackAction === "branch"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFeedbackAction(id, "branch")}
            >
              <GitBranch className="h-4 w-4" />
              Branch
            </button>
            <button
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                feedbackAction === "iterate"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFeedbackAction(id, "iterate")}
            >
              <RefreshCw className="h-4 w-4" />
              Iterate
            </button>
          </div>
          <div className="flex-1" />
          <Button
            variant={isPicked ? "default" : "outline"}
            size="sm"
            className={`px-4 py-2 text-sm font-medium cursor-pointer ${
              isPicked
                ? "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200"
                : ""
            }`}
            onClick={() => togglePick(id)}
          >
            {isPicked && <Check className="h-4 w-4 mr-1" />}
            {isPicked ? "Picked" : "Pick"}
          </Button>
        </div>
      </div>}

      {/* Handles for edges — hidden when no edge is connected */}
      <Handle id="top" type="target" position={Position.Top} className={handleClass("top", "target")} />
      <Handle id="top" type="source" position={Position.Top} className={handleClass("top", "source")} />
      <Handle id="bottom" type="target" position={Position.Bottom} className={handleClass("bottom", "target")} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass("bottom", "source")} />
      <Handle id="left" type="target" position={Position.Left} className={handleClass("left", "target")} />
      <Handle id="left" type="source" position={Position.Left} className={handleClass("left", "source")} />
      <Handle id="right" type="target" position={Position.Right} className={handleClass("right", "target")} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass("right", "source")} />
    </div>
  )
}

export const VariantNode = memo(VariantNodeInner)
