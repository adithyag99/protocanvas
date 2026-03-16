import { describe, it, expect } from "vitest"
import { snapPosition, SNAP_THRESHOLD, type SnapNode } from "../src/lib/snap"

function makeNode(id: string, x: number, y: number, w = 452, h = 300): SnapNode {
  return { id, position: { x, y }, width: w, height: h }
}

describe("snapPosition", () => {
  it("no snap when nodes are far apart", () => {
    const nodes = [
      makeNode("a", 0, 0),
      makeNode("b", 1000, 1000),
    ]
    const result = snapPosition("a", 500, 500, nodes)
    expect(result.x).toBe(500)
    expect(result.y).toBe(500)
    expect(result.guides).toEqual([])
  })

  it("snaps to left edge alignment", () => {
    const nodes = [
      makeNode("a", 0, 0),
      makeNode("b", 100, 500),
    ]
    // Move "a" to x=103 — within threshold of b's left edge at 100
    const result = snapPosition("a", 100 + SNAP_THRESHOLD - 1, 0, nodes)
    expect(result.x).toBe(100)
    expect(result.guides).toContainEqual({ pos: 100, axis: "x" })
  })

  it("snaps to right edge alignment", () => {
    const w = 452
    const nodes = [
      makeNode("a", 0, 0, w),
      makeNode("b", 100, 500, w),
    ]
    // "a" right edge = x + w. "b" right edge = 100 + w.
    // We want (x + w) close to (100 + w), so x close to 100.
    // But left edge snap fires first at x=100. Use a different offset:
    // "a" at x=95, right edge = 95+452=547. "b" right edge = 100+452=552.
    // diff = |547 - 552| = 5 < 8. Snaps right edge.
    // But left edge check: |95 - 100| = 5, also < 8. Left edge fires first.
    // Use different widths to isolate right-edge snap.
    const nodesD = [
      makeNode("a", 0, 0, 400),
      makeNode("b", 100, 500, 452),
    ]
    // "a" right = x + 400. "b" right = 100 + 452 = 552.
    // We want x + 400 close to 552, so x close to 152.
    // Left edge check: |152 - 100| = 52, not close. So right edge fires.
    const result = snapPosition("a", 152 + SNAP_THRESHOLD - 2, 0, nodesD)
    expect(result.x).toBe(152)
    expect(result.guides).toContainEqual({ pos: 552, axis: "x" })
  })

  it("snaps to center alignment (x)", () => {
    const nodes = [
      makeNode("a", 0, 0, 200),
      makeNode("b", 300, 500, 400),
    ]
    // "b" center x = 300 + 200 = 500.
    // "a" center x = x + 100.
    // For snap: x + 100 close to 500 => x close to 400.
    // Left edge: |400 - 300| = 100, not close.
    // Right edge: |400 + 200 - (300 + 400)| = |600 - 700| = 100, not close.
    // Center: |400 + 100 - 500| = 0. Snaps.
    const result = snapPosition("a", 400 + SNAP_THRESHOLD - 2, 0, nodes)
    expect(result.x).toBe(400)
    expect(result.guides).toContainEqual({ pos: 500, axis: "x" })
  })

  it("snaps to top edge alignment", () => {
    const nodes = [
      makeNode("a", 0, 0),
      makeNode("b", 1000, 200),
    ]
    // Move "a" to y close to 200
    const result = snapPosition("a", 0, 200 + SNAP_THRESHOLD - 2, nodes)
    expect(result.y).toBe(200)
    expect(result.guides).toContainEqual({ pos: 200, axis: "y" })
  })

  it("snaps to bottom edge alignment", () => {
    const nodes = [
      makeNode("a", 0, 0, 452, 250),
      makeNode("b", 1000, 100, 452, 400),
    ]
    // "b" bottom = 100 + 400 = 500. "a" bottom = y + 250.
    // y + 250 close to 500 => y close to 250.
    // Top edge: |250 - 100| = 150, not close.
    const result = snapPosition("a", 0, 250 + SNAP_THRESHOLD - 2, nodes)
    expect(result.y).toBe(250)
    expect(result.guides).toContainEqual({ pos: 500, axis: "y" })
  })

  it("snaps to middle alignment (y)", () => {
    const nodes = [
      makeNode("a", 0, 0, 452, 200),
      makeNode("b", 1000, 300, 452, 400),
    ]
    // "b" middle y = 300 + 200 = 500.
    // "a" middle y = y + 100.
    // y + 100 close to 500 => y close to 400.
    // Top edge: |400 - 300| = 100, not close.
    // Bottom edge: |400 + 200 - (300 + 400)| = |600 - 700| = 100, not close.
    const result = snapPosition("a", 0, 400 + SNAP_THRESHOLD - 2, nodes)
    expect(result.y).toBe(400)
    expect(result.guides).toContainEqual({ pos: 500, axis: "y" })
  })

  it("snaps both axes simultaneously", () => {
    const nodes = [
      makeNode("a", 0, 0),
      makeNode("b", 100, 200),
    ]
    const result = snapPosition(
      "a",
      100 + SNAP_THRESHOLD - 2,
      200 + SNAP_THRESHOLD - 2,
      nodes
    )
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
    expect(result.guides).toHaveLength(2)
    expect(result.guides).toContainEqual({ pos: 100, axis: "x" })
    expect(result.guides).toContainEqual({ pos: 200, axis: "y" })
  })

  it("returns correct guides", () => {
    const nodes = [
      makeNode("a", 0, 0, 452, 300),
      makeNode("b", 100, 500, 452, 300),
    ]
    const result = snapPosition("a", 100 + 3, 0, nodes)
    // Should snap left edge, guide at x=100
    expect(result.guides).toEqual([{ pos: 100, axis: "x" }])
  })

  it("skips self when checking alignment", () => {
    const nodes = [
      makeNode("a", 100, 200),
    ]
    // Only node is itself — should not snap to itself
    const result = snapPosition("a", 100, 200, nodes)
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
    expect(result.guides).toEqual([])
  })

  it("stops checking after first snap found per axis", () => {
    const nodes = [
      makeNode("a", 0, 0),
      makeNode("b", 100, 200),
      makeNode("c", 100 + SNAP_THRESHOLD - 1, 200 + SNAP_THRESHOLD - 1),
    ]
    // "a" dragged near b's position. b snaps first.
    // c is also close but should not produce additional guides.
    const result = snapPosition(
      "a",
      100 + SNAP_THRESHOLD - 2,
      200 + SNAP_THRESHOLD - 2,
      nodes
    )
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
    // Exactly 2 guides (one per axis), not more
    expect(result.guides).toHaveLength(2)
  })
})
