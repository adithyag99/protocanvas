import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Handle, Position, type NodeProps, useEdges, useReactFlow } from "@xyflow/react"
import { Eye, EyeOff, GripHorizontal, MessageCircle, Trash2 } from "lucide-react"
import { useCanvasStore } from "@/store/canvasStore"
import type { VariantNodeData } from "@/types/canvas"

type VariantNodeProps = NodeProps & {
  data: VariantNodeData & { variantWidth: number; reloadKey?: number }
}

function VariantNodeInner({ id, data }: VariantNodeProps) {
  const { getZoom } = useReactFlow()
  const {
    config,
    iframeHeights,
    nodeWidths,
    setIframeHeight,
    setNodeWidth,
    hideNode,
    unhideNode,
    removeNode,
    focusMode,
    focusedNodeId,
    enterFocus,
  } = useCanvasStore()
  const annotationCount = useCanvasStore((s) => s.annotationCounts[id] ?? 0)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const [localSize, setLocalSize] = useState<{ w?: number; h?: number } | null>(null)
  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)

  // Clean up any dangling resize listeners on unmount
  useEffect(() => {
    return () => { resizeCleanupRef.current?.() }
  }, [])

  const isHidden = data.hidden === true
  const isFocused = focusedNodeId === id

  // Tell the iframe about focus state changes
  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'variant-focus', focused: isFocused }, '*')
    }
  }, [isFocused])

  const iframeHeight = iframeHeights[id] ?? 200
  const variantWidth = nodeWidths[id] ?? data.variantWidth
  const previewHeight = localSize?.h ?? iframeHeight
  const previewWidth = localSize?.w ?? variantWidth

  // Listen for height messages from iframe — also marks iframe as loaded
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "variant-height" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        setIframeHeight(id, e.data.height)
        if (!iframeLoaded) setIframeLoaded(true)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [id, setIframeHeight, iframeLoaded])


  // Shared resize start — locks cursor on body and sets up cleanup
  const startResize = useCallback((
    e: React.MouseEvent,
    cursor: string,
    onMove: (ev: MouseEvent) => void,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    document.body.style.cursor = cursor
    document.body.style.userSelect = "none"
    setResizeCursor(cursor)

    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setResizeCursor(null)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      resizeCleanupRef.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    resizeCleanupRef.current = onUp
  }, [])

  // Right edge — width resize
  const onResizeRight = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX
    const startW = previewWidth
    const zoom = getZoom()
    startResize(e, "col-resize", (ev) => {
      const newW = Math.max(280, startW + (ev.clientX - startX) / zoom)
      setLocalSize((s) => ({ ...s, w: newW }))
      setNodeWidth(id, newW)
    })
  }, [id, previewWidth, setNodeWidth, getZoom, startResize])

  // Bottom edge — height resize
  const onResizeBottom = useCallback((e: React.MouseEvent) => {
    const startY = e.clientY
    const startH = previewHeight
    const zoom = getZoom()
    startResize(e, "row-resize", (ev) => {
      const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
      setLocalSize((s) => ({ ...s, h: newH }))
    })
  }, [previewHeight, getZoom, startResize])

  // Corner — both
  const onResizeCorner = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX
    const startY = e.clientY
    const startW = previewWidth
    const startH = previewHeight
    const zoom = getZoom()
    startResize(e, "nwse-resize", (ev) => {
      const newW = Math.max(280, startW + (ev.clientX - startX) / zoom)
      const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
      setLocalSize({ w: newW, h: newH })
      setNodeWidth(id, newW)
    })
  }, [id, previewWidth, previewHeight, setNodeWidth, getZoom, startResize])

  const nodeWidth = previewWidth

  // Only show handle dots when an edge is actually connected
  const edges = useEdges()
  const connectedHandles = new Set<string>()
  for (const edge of edges) {
    if (edge.source === id && edge.sourceHandle) connectedHandles.add(`${edge.sourceHandle}-source`)
    if (edge.target === id && edge.targetHandle) connectedHandles.add(`${edge.targetHandle}-target`)
  }
  const handleClass = (handleId: string, type: "source" | "target") =>
    `!w-2 !h-2 ${focusMode || !connectedHandles.has(`${handleId}-${type}`) ? "!bg-transparent !border-transparent" : "!bg-border"}`

  const chromeHidden = focusMode ? "opacity-0 pointer-events-none" : "opacity-100"

  return (
    <div
      className="overflow-visible relative group rounded-2xl bg-transparent border border-transparent shadow-none"
      style={{
        width: nodeWidth,
        opacity: focusedNodeId && !isFocused ? 0.35 : 1,
        transition: "opacity 500ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      }}
    >
      {/* Focus mode drag grip — appears on hover */}
      {focusMode && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-center w-10 h-5 rounded-md bg-background/80 backdrop-blur border border-border/50 shadow-sm cursor-grab active:cursor-grabbing">
            <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Header — fades out in focus mode */}
      <div className={`flex items-center gap-2 pb-1.5 group/header transition-opacity duration-200 ${chromeHidden}`}>
        <span className={`text-[11px] font-medium rounded-[5px] px-1.5 py-0.5 uppercase tracking-wide shrink-0 transition-colors duration-200 ${
          isFocused
            ? "text-blue-600 bg-blue-50"
            : "text-muted-foreground bg-muted"
        }`}>
          {id}
        </span>
        <span className={`text-sm font-semibold uppercase tracking-wide truncate transition-colors duration-200 ${
          isFocused ? "text-blue-600" : "text-muted-foreground"
        }`}>
          {data.label}
        </span>
        {annotationCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 rounded-[5px] px-1.5 py-0.5 shrink-0">
            <MessageCircle className="h-3 w-3" />
            {annotationCount}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease">
          {/* Size indicator — editable */}
          <div className="nodrag flex items-center gap-0 text-[10px] font-mono text-muted-foreground/70 shrink-0">
            <input
              className="w-[34px] bg-transparent text-right outline-none focus:text-foreground rounded px-0.5 tabular-nums"
              value={Math.round(previewWidth)}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 280) { setLocalSize((s) => ({ ...s, w: v })); setNodeWidth(id, v) }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
            <span className="mx-[1px]">&times;</span>
            <input
              className="w-[34px] bg-transparent outline-none focus:text-foreground rounded px-0.5 tabular-nums"
              value={Math.round(previewHeight)}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 100) setLocalSize((s) => ({ ...s, h: v }))
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <div className="w-px h-3.5 bg-border/60 mx-1" />
          <button
            className="nodrag h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            onClick={() => isHidden ? unhideNode(id) : hideNode(id)}
            title={isHidden ? "Unhide" : "Hide"}
          >
            {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            className="nodrag h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
            onClick={() => removeNode(id)}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Iframe preview — stop wheel events from reaching React Flow when focused */}
      <div className="relative" onWheelCapture={isFocused ? (e) => e.stopPropagation() : undefined}>
        <div
          className={`rounded-2xl overflow-hidden relative group/preview ${
            isFocused
              ? "ring-2 ring-blue-500 border border-transparent"
              : focusMode
                ? "border border-transparent cursor-pointer"
                : "border border-black/10 cursor-pointer"
          }`}
          style={{
            width: previewWidth,
            height: previewHeight,
            transition: "box-shadow 200ms cubic-bezier(0.165, 0.84, 0.44, 1), border-color 200ms cubic-bezier(0.165, 0.84, 0.44, 1)",
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (!isFocused) enterFocus(id)
          }}
        >
          <iframe
            ref={iframeRef}
            src={
              data.type === 'tsx' && config?.vitePort
                ? `http://localhost:${config.vitePort}/${data.id}?r=${data.reloadKey ?? 0}`
                : `/variants/${data.htmlFile}?embed&r=${data.reloadKey ?? 0}`
            }
            className="w-full border-0"
            style={{
              width: previewWidth,
              height: isFocused ? Math.min(previewHeight, window.innerHeight - 100) : previewHeight,
              pointerEvents: isFocused ? "auto" : "none",
            }}
            title={`${id} — ${data.label}`}
            sandbox="allow-scripts allow-same-origin"
          />
          {/* Skeleton loading overlay — fades out when iframe reports first height */}
          {!iframeLoaded && (
            <div
              className="absolute inset-0 rounded-2xl bg-neutral-100 animate-pulse"
              style={{
                transition: "opacity 300ms ease-out",
              }}
            >
              <div className="flex flex-col gap-3 p-4">
                <div className="h-4 w-2/3 rounded bg-neutral-200" />
                <div className="h-3 w-full rounded bg-neutral-200" />
                <div className="h-3 w-5/6 rounded bg-neutral-200" />
                <div className="flex-1 mt-2 rounded-lg bg-neutral-200 min-h-[80px]" />
              </div>
            </div>
          )}
          {/* Hover overlay with hint — only when not focused */}
          {!isFocused && (
            <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/5 transition-colors flex items-center justify-center">
              <span className="text-xs font-medium text-foreground/70 bg-background rounded-md px-3 py-1.5 shadow-sm opacity-0 group-hover/preview:opacity-100 transition-opacity">
                Click to interact
              </span>
            </div>
          )}
        </div>

        {/* Right edge handle — inside the preview like the bottom one */}
        <div
          className="nodrag absolute right-2 top-0 w-4 cursor-col-resize z-10 group/rr"
          style={{ height: previewHeight }}
          onMouseDown={onResizeRight}
        >
          <div className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-transparent group-hover/rr:bg-neutral-400/60 transition-colors" />
        </div>

        {/* Bottom edge handle */}
        <div
          className="nodrag absolute bottom-0 left-0 h-4 cursor-row-resize z-10 group/rb"
          style={{ width: previewWidth }}
          onMouseDown={onResizeBottom}
        >
          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-8 rounded-full bg-transparent group-hover/rb:bg-neutral-400/60 transition-colors" />
        </div>

        {/* Corner handle */}
        <div
          className="nodrag absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-10 group/rc"
          onMouseDown={onResizeCorner}
        >
          <div className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-[2px] bg-transparent group-hover/rc:bg-neutral-400/60 transition-colors" />
        </div>
      </div>


      {/* Full-screen overlay during resize — portalled to body so it actually covers everything */}
      {resizeCursor && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            cursor: resizeCursor,
          }}
        />,
        document.body
      )}

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
