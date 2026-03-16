import { memo, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"


interface IterationEdgeData {
  label?: string
  feedbackText?: string
}

const TOOLTIP_GAP = 6
const VIEWPORT_PAD = 12

export const IterationEdge = memo(function IterationEdge({
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const feedbackText = data?.feedbackText || ""

  // Strip "branch" from the label for display
  const displayLabel = data?.label
    ?.replace(/^branch$/i, "")
    .replace(/^branch\s*[:\-–—]\s*/i, "")
    .trim()

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
      if (lr.top - TOOLTIP_GAP - tr.height > VIEWPORT_PAD) {
        top = lr.top - TOOLTIP_GAP - tr.height
        placement = "above"
      } else if (lr.right + TOOLTIP_GAP + tr.width < vw - VIEWPORT_PAD) {
        top = lr.top + (lr.height - tr.height) / 2
        placement = "right"
      } else if (lr.left - TOOLTIP_GAP - tr.width > VIEWPORT_PAD) {
        top = lr.top + (lr.height - tr.height) / 2
        placement = "left"
      } else {
        top = Math.min(top, vh - VIEWPORT_PAD - tr.height)
      }
    }

    let left: number
    if (placement === "right") {
      left = lr.right + TOOLTIP_GAP
    } else if (placement === "left") {
      left = lr.left - TOOLTIP_GAP - tr.width
    } else {
      left = lr.left + lr.width / 2 - tr.width / 2
    }

    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - VIEWPORT_PAD - tr.width))
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - VIEWPORT_PAD - tr.height))

    setTooltipStyle({ top, left })
  }, [])

  const handleMouseEnter = useCallback(() => {
    setHovered(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => positionTooltip())
    })
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
            {/* Hover zone — fixed size so cursor doesn't jump */}
            <div className="relative flex items-center justify-center w-8 h-8 cursor-default">
              {/* Dot — fades out on hover */}
              <div
                className="absolute w-2.5 h-2.5 rounded-full border border-border bg-background shadow-sm"
                style={{
                  opacity: hovered ? 0 : 1,
                  transition: "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              />
              {/* Pill — fades in + scales from 0.95 on hover */}
              <div
                className="absolute flex items-center justify-center px-2 py-0.5 rounded-full border border-border bg-background shadow-md will-change-transform"
                style={{
                  opacity: hovered ? 1 : 0,
                  transform: hovered ? "scale(1)" : "scale(0.92)",
                  transition: "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 150ms cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <span className="text-[10px] font-medium text-foreground whitespace-nowrap">
                  {displayLabel}
                </span>
              </div>
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
          className="w-max max-w-[280px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md pointer-events-none animate-in fade-in zoom-in-95 duration-150"
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
})
