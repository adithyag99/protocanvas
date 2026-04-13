import { memo } from "react"
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"

interface IterationEdgeData {
  label?: string
  feedbackText?: string
}

export const IterationEdge = memo(function IterationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps & { data?: IterationEdgeData }) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })


  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: "var(--edge-stroke)", strokeWidth: 1.5 }}
      />
      {/* Edge labels commented out — kept for potential future tooltip-on-hover use
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
            <div className="relative flex items-center justify-center w-8 h-8 cursor-default">
              <div
                className="absolute w-2.5 h-2.5 rounded-full border border-border bg-background shadow-sm"
                style={{
                  opacity: hovered ? 0 : 1,
                  transition: "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              />
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
      */}
    </>
  )
})
