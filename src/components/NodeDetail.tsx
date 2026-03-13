import { useCallback, useEffect, useRef, useState } from "react"
import { XIcon } from "lucide-react"
import { useCanvasStore } from "@/store/canvasStore"

export function NodeDetail() {
  const modalVariant = useCanvasStore((s) => s.modalVariant)
  const closeModal = useCanvasStore((s) => s.closeModal)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Reset size when variant changes
  useEffect(() => {
    if (modalVariant) {
      setSize(null)
      setContentSize(null)
    }
  }, [modalVariant?.htmlFile])

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
          // Only set once on initial load (don't keep resizing)
          if (!prev) return { w, h }
          return prev
        })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [modalVariant])

  // The displayed size: user-resized > content-measured > fallback
  const displaySize = size ?? contentSize

  const getOrInitSize = useCallback(() => {
    if (size) return size
    if (contentSize) return contentSize
    const body = bodyRef.current
    if (!body) return { w: 600, h: 400 }
    return { w: body.clientWidth - 80, h: body.clientHeight - 80 }
  }, [size, contentSize])

  // Close on Escape
  useEffect(() => {
    if (!modalVariant) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal()
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
  }, [modalVariant, closeModal])

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
        w: axis !== "y" ? Math.max(280, s.w + dx * 2) : s.w,  // *2 because centered
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

  if (!modalVariant) return null
  const { nodeId, label, htmlFile } = modalVariant
  const shownSize = displaySize ?? size

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Backdrop */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundColor: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)",
        }}
        onClick={closeModal}
      />
      {/* Modal shell */}
      <div style={{
        position: "absolute", top: 16, right: 16, bottom: 16, left: 16,
        display: "flex", flexDirection: "column",
        borderRadius: 12, backgroundColor: "#e8e8e8",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 16px", borderBottom: "1px solid #d4d4d4", flexShrink: 0,
          backgroundColor: "white",
        }}>
          <span style={{
            fontSize: 12, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.05em", color: "#737373",
          }}>
            {nodeId} — {label}
          </span>
          {shownSize && (
            <span style={{
              fontSize: 11, color: "#a3a3a3", fontVariantNumeric: "tabular-nums",
            }}>
              {Math.round(shownSize.w)} × {Math.round(shownSize.h)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {size && (
            <button
              onClick={() => setSize(null)}
              style={{
                fontSize: 11, fontWeight: 500, color: "#a3a3a3",
                border: "none", background: "none", cursor: "pointer",
                padding: "4px 8px", borderRadius: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#525252"; e.currentTarget.style.backgroundColor = "#f5f5f5" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#a3a3a3"; e.currentTarget.style.backgroundColor = "transparent" }}
            >
              Reset size
            </button>
          )}
          <button
            onClick={closeModal}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: 6,
              border: "none", backgroundColor: "transparent",
              cursor: "pointer", color: "#737373",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <XIcon style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          style={{
            flex: 1, minHeight: 0, position: "relative",
            display: "flex", justifyContent: "center", alignItems: "center",
            backgroundColor: "#e8e8e8",
            overflow: "auto",
          }}
        >
          {/* Iframe viewport */}
          <div style={{
            width: displaySize?.w ?? 600,
            height: displaySize?.h ?? 400,
            position: "relative",
            flexShrink: 0,
            backgroundColor: "white",
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            borderRadius: 4,
            overflow: "hidden",
          }}>
            <iframe
              ref={iframeRef}
              src={`/variants/${htmlFile}`}
              style={{
                width: "100%", height: "100%", border: "none", display: "block",
                pointerEvents: dragging ? "none" : "auto",
              }}
              title={`${nodeId} — ${label}`}
            />

            {/* Right handle */}
            <div
              onMouseDown={(e) => startDrag("x", e)}
              style={{
                position: "absolute", top: 0, right: 0, width: 12, height: "100%",
                cursor: "col-resize", display: "flex", alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{
                width: 4, height: 40, borderRadius: 2,
                backgroundColor: "rgba(0,0,0,0.15)",
              }} />
            </div>

            {/* Bottom handle */}
            <div
              onMouseDown={(e) => startDrag("y", e)}
              style={{
                position: "absolute", bottom: 0, left: 0, height: 12, width: "100%",
                cursor: "row-resize", display: "flex", alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{
                height: 4, width: 40, borderRadius: 2,
                backgroundColor: "rgba(0,0,0,0.15)",
              }} />
            </div>

            {/* Corner handle */}
            <div
              onMouseDown={(e) => startDrag("both", e)}
              style={{
                position: "absolute", bottom: 0, right: 0, width: 16, height: 16,
                cursor: "nwse-resize", display: "flex", alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.3 }}>
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
