import { useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"
import { useCanvasStore } from "@/store/canvasStore"

interface IterationEdgeData {
  label?: string
}

const TOOLTIP_GAP = 6
const VIEWPORT_PAD = 12

export function IterationEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps & { data?: IterationEdgeData }) {
  const [hovered, setHovered] = useState(false)
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})
  const labelRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const feedback = useCanvasStore((s) => s.feedback)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  // Get the feedback text from the source (parent) node
  const entry = feedback.feedback[source]
  const feedbackText =
    typeof entry === "string" ? entry : entry?.text ?? ""

  const positionTooltip = useCallback(() => {
    const label = labelRef.current
    const tooltip = tooltipRef.current
    if (!label || !tooltip) return

    const lr = label.getBoundingClientRect()
    const tr = tooltip.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Try below first
    let top = lr.bottom + TOOLTIP_GAP
    let placement: "below" | "above" | "right" | "left" = "below"

    if (top + tr.height > vh - VIEWPORT_PAD) {
      // Try above
      if (lr.top - TOOLTIP_GAP - tr.height > VIEWPORT_PAD) {
        top = lr.top - TOOLTIP_GAP - tr.height
        placement = "above"
      }
      // Try right
      else if (lr.right + TOOLTIP_GAP + tr.width < vw - VIEWPORT_PAD) {
        top = lr.top + (lr.height - tr.height) / 2
        placement = "right"
      }
      // Try left
      else if (lr.left - TOOLTIP_GAP - tr.width > VIEWPORT_PAD) {
        top = lr.top + (lr.height - tr.height) / 2
        placement = "left"
      }
      // Fallback: just clamp below
      else {
        top = Math.min(top, vh - VIEWPORT_PAD - tr.height)
      }
    }

    let left: number
    if (placement === "right") {
      left = lr.right + TOOLTIP_GAP
    } else if (placement === "left") {
      left = lr.left - TOOLTIP_GAP - tr.width
    } else {
      // Center horizontally under/above the label
      left = lr.left + lr.width / 2 - tr.width / 2
    }

    // Clamp horizontal to viewport
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - VIEWPORT_PAD - tr.width))
    // Clamp vertical to viewport
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - VIEWPORT_PAD - tr.height))

    setTooltipStyle({ top, left })
  }, [])

  const handleMouseEnter = useCallback(() => {
    setHovered(true)
    // Position after the tooltip renders
    requestAnimationFrame(() => positionTooltip())
  }, [positionTooltip])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: "#d4d4d8", strokeWidth: 1.5 }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="text-[10px] font-medium text-muted-foreground bg-background border border-border rounded-md px-2 py-0.5 shadow-sm hover:text-foreground hover:border-foreground/20 hover:shadow-md transition-colors cursor-default">
              {data.label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
      {hovered && feedbackText.trim() && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: "fixed",
            zIndex: 9999,
            ...tooltipStyle,
          }}
          className="w-max max-w-[280px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md pointer-events-none"
        >
          <div className="font-medium text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Feedback on {source}
          </div>
          <div className="leading-relaxed">{feedbackText}</div>
        </div>,
        document.body
      )}
    </>
  )
}
