import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { XIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { useCanvasStore } from "@/store/canvasStore"

export function NodeDetail() {
  const modalVariant = useCanvasStore((s) => s.modalVariant)
  const closeModal = useCanvasStore((s) => s.closeModal)
  const openModal = useCanvasStore((s) => s.openModal)
  const canvasState = useCanvasStore((s) => s.canvasState)
  const config = useCanvasStore((s) => s.config)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  const nodeId = modalVariant?.nodeId ?? ""

  // Animate in on mount
  useEffect(() => {
    if (modalVariant && !isClosing) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    }
  }, [modalVariant?.nodeId])

  // Animated close
  const handleClose = useCallback(() => {
    setIsClosing(true)
    setIsVisible(false)
    setTimeout(() => {
      setIsClosing(false)
      closeModal()
    }, 180)
  }, [closeModal])

  // Sorted visible node IDs for arrow navigation
  const sortedNodeIds = useMemo(() => {
    if (!canvasState?.nodes) return []
    return Object.values(canvasState.nodes)
      .filter((n) => !n.hidden)
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id)
  }, [canvasState])

  const currentIndex = modalVariant ? sortedNodeIds.indexOf(modalVariant.nodeId) : -1

  // Reset size when variant changes
  useEffect(() => {
    if (modalVariant) {
      setSize(null)
      setContentSize(null)
    }
  }, [modalVariant?.nodeId])

  // Listen for content size from iframe
  useEffect(() => {
    if (!modalVariant) return
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "variant-height" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        const body = bodyRef.current
        const maxW = body ? body.clientWidth - 80 : 800
        const maxH = body ? body.clientHeight - 80 : 600
        const w = Math.min(e.data.width || 600, maxW)
        const h = Math.min(e.data.height || 400, maxH)
        setContentSize((prev) => {
          if (!prev) return { w, h }
          return prev
        })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [modalVariant])

  const displaySize = size ?? contentSize

  const getOrInitSize = useCallback(() => {
    if (size) return size
    if (contentSize) return contentSize
    const body = bodyRef.current
    if (!body) return { w: 600, h: 400 }
    return { w: body.clientWidth - 80, h: body.clientHeight - 80 }
  }, [size, contentSize])

  // Navigate to adjacent variant
  const navigateTo = useCallback((direction: -1 | 1) => {
    if (sortedNodeIds.length === 0 || currentIndex === -1) return
    const nextIndex = (currentIndex + direction + sortedNodeIds.length) % sortedNodeIds.length
    const nextId = sortedNodeIds[nextIndex]
    const nextNode = canvasState?.nodes[nextId]
    if (nextNode) {
      openModal({ nodeId: nextNode.id, label: nextNode.label, htmlFile: nextNode.htmlFile, type: nextNode.type })
    }
  }, [sortedNodeIds, currentIndex, canvasState, openModal])

  // Keyboard: Escape to close, ArrowLeft/Right to navigate
  useEffect(() => {
    if (!modalVariant) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose()
        return
      }
      const tag = document.activeElement?.tagName
      if (tag === "TEXTAREA" || tag === "INPUT") return

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        navigateTo(-1)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        navigateTo(1)
      }
    }
    window.addEventListener("keydown", handler)
    const iframe = iframeRef.current
    const onLoad = () => {
      try { iframe?.contentWindow?.addEventListener("keydown", handler) } catch {}
    }
    iframe?.addEventListener("load", onLoad)
    return () => {
      window.removeEventListener("keydown", handler)
      iframe?.removeEventListener("load", onLoad)
      try { iframe?.contentWindow?.removeEventListener("keydown", handler) } catch {}
    }
  }, [modalVariant, handleClose, navigateTo])

  const startDrag = useCallback((
    axis: "x" | "y" | "both",
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const startX = e.clientX
    const startY = e.clientY
    const s = getOrInitSize()

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      setSize({
        w: axis !== "y" ? Math.max(280, s.w + dx * 2) : s.w,
        h: axis !== "x" ? Math.max(200, s.h + dy) : s.h,
      })
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [getOrInitSize])

  if (!modalVariant && !isClosing) return null
  if (!modalVariant) return null
  const { label, htmlFile, type: variantType } = modalVariant
  const shownSize = displaySize

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-all duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]"
        style={{
          backgroundColor: isVisible ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)",
          backdropFilter: isVisible ? "blur(4px)" : "blur(0px)",
        }}
        onClick={handleClose}
      />
      {/* Modal shell */}
      <div
        className="absolute inset-4 flex flex-col rounded-xl bg-neutral-200 shadow-2xl overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "scale(1)" : "scale(0.97)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-300 shrink-0 bg-white">
          {/* Nav arrows */}
          {sortedNodeIds.length > 1 && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                onClick={() => navigateTo(-1)}
                className="flex items-center justify-center w-6 h-6 rounded border-none bg-transparent cursor-pointer text-neutral-500 hover:bg-neutral-100 transition-colors"
                title="Previous variant (←)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => navigateTo(1)}
                className="flex items-center justify-center w-6 h-6 rounded border-none bg-transparent cursor-pointer text-neutral-500 hover:bg-neutral-100 transition-colors"
                title="Next variant (→)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {nodeId} — {label}
          </span>
          {sortedNodeIds.length > 1 && currentIndex !== -1 && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {currentIndex + 1} of {sortedNodeIds.length}
            </span>
          )}
          {shownSize && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {Math.round(shownSize.w)} × {Math.round(shownSize.h)}
            </span>
          )}
          <div className="flex-1" />
          {size && (
            <button
              onClick={() => setSize(null)}
              className="text-[11px] font-medium text-neutral-400 border-none bg-transparent cursor-pointer px-2 py-1 rounded hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              Reset size
            </button>
          )}
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent cursor-pointer text-neutral-500 hover:bg-neutral-100 transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          className="flex-1 min-h-0 relative flex justify-center items-center bg-neutral-200 overflow-auto"
        >
          {/* Iframe viewport */}
          <div
            className="relative shrink-0 bg-white shadow-sm rounded overflow-hidden"
            style={{
              width: displaySize?.w ?? 600,
              height: displaySize?.h ?? 400,
            }}
          >
            <iframe
              ref={iframeRef}
              src={
                variantType === 'tsx' && config?.vitePort
                  ? `http://localhost:${config.vitePort}/${nodeId}`
                  : `/variants/${htmlFile}`
              }
              className="w-full h-full border-none block"
              style={{
                pointerEvents: dragging ? "none" : "auto",
              }}
              title={`${nodeId} — ${label}`}
            />

            {/* Right handle */}
            <div
              onMouseDown={(e) => startDrag("x", e)}
              className="absolute top-0 right-0 w-3 h-full cursor-col-resize flex items-center justify-center"
            >
              <div className="w-1 h-10 rounded-sm bg-black/15" />
            </div>

            {/* Bottom handle */}
            <div
              onMouseDown={(e) => startDrag("y", e)}
              className="absolute bottom-0 left-0 h-3 w-full cursor-row-resize flex items-center justify-center"
            >
              <div className="h-1 w-10 rounded-sm bg-black/15" />
            </div>

            {/* Corner handle */}
            <div
              onMouseDown={(e) => startDrag("both", e)}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-center justify-center"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" className="opacity-30">
                <path d="M7 1v6H1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M7 4v3H4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
