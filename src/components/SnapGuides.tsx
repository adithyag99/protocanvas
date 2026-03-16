import { useReactFlow } from "@xyflow/react"
import type { Guide } from "@/lib/snap"

export function SnapGuides({ guides }: { guides: Guide[] }) {
  const { getViewport } = useReactFlow()

  if (guides.length === 0) return null

  const vp = getViewport()

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 5,
        overflow: "visible",
      }}
    >
      {guides.map((g, i) => {
        if (g.axis === "x") {
          const screenX = g.pos * vp.zoom + vp.x
          return (
            <line
              key={i}
              x1={screenX}
              y1={0}
              x2={screenX}
              y2="100%"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )
        } else {
          const screenY = g.pos * vp.zoom + vp.y
          return (
            <line
              key={i}
              x1={0}
              y1={screenY}
              x2="100%"
              y2={screenY}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )
        }
      })}
    </svg>
  )
}
