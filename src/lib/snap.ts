export const SNAP_THRESHOLD = 8

export interface SnapNode {
  id: string
  position: { x: number; y: number }
  width: number
  height: number
}

export interface Guide {
  pos: number
  axis: "x" | "y"
}

export function snapPosition(
  id: string,
  x: number,
  y: number,
  allNodes: SnapNode[]
): { x: number; y: number; guides: Guide[] } {
  const draggedNode = allNodes.find((n) => n.id === id)
  if (!draggedNode) return { x, y, guides: [] }

  const dw = draggedNode.width
  const dh = draggedNode.height

  let snappedX = x
  let snappedY = y
  let didSnapX = false
  let didSnapY = false
  const newGuides: Guide[] = []

  for (const node of allNodes) {
    if (node.id === id) continue
    const nw = node.width
    const nh = node.height
    const nx = node.position.x
    const ny = node.position.y

    if (!didSnapX) {
      if (Math.abs(x - nx) < SNAP_THRESHOLD) {
        snappedX = nx; didSnapX = true
        newGuides.push({ pos: nx, axis: "x" })
      }
      else if (Math.abs((x + dw) - (nx + nw)) < SNAP_THRESHOLD) {
        snappedX = nx + nw - dw; didSnapX = true
        newGuides.push({ pos: nx + nw, axis: "x" })
      }
      else if (Math.abs((x + dw / 2) - (nx + nw / 2)) < SNAP_THRESHOLD) {
        snappedX = nx + nw / 2 - dw / 2; didSnapX = true
        newGuides.push({ pos: nx + nw / 2, axis: "x" })
      }
    }

    if (!didSnapY) {
      if (Math.abs(y - ny) < SNAP_THRESHOLD) {
        snappedY = ny; didSnapY = true
        newGuides.push({ pos: ny, axis: "y" })
      }
      else if (Math.abs((y + dh) - (ny + nh)) < SNAP_THRESHOLD) {
        snappedY = ny + nh - dh; didSnapY = true
        newGuides.push({ pos: ny + nh, axis: "y" })
      }
      else if (Math.abs((y + dh / 2) - (ny + nh / 2)) < SNAP_THRESHOLD) {
        snappedY = ny + nh / 2 - dh / 2; didSnapY = true
        newGuides.push({ pos: ny + nh / 2, axis: "y" })
      }
    }

    if (didSnapX && didSnapY) break
  }

  return { x: snappedX, y: snappedY, guides: newGuides }
}
