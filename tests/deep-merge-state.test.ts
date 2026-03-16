import { describe, it, expect } from "vitest"
import { deepMergeState } from "../server/deep-merge-state.mjs"

describe("deepMergeState", () => {
  it("merges node position updates into existing nodes", () => {
    const existing = {
      nodes: {
        a: { id: "a", position: { x: 0, y: 0 }, label: "A" },
        b: { id: "b", position: { x: 100, y: 100 }, label: "B" },
      },
    }
    const partial = {
      nodes: {
        a: { position: { x: 50, y: 50 } },
      },
    }
    const result = deepMergeState(existing, partial)
    expect(result.nodes.a.position).toEqual({ x: 50, y: 50 })
    expect(result.nodes.a.label).toBe("A")
    expect(result.nodes.b).toEqual(existing.nodes.b)
  })

  it("adds new nodes that don't exist yet", () => {
    const existing = {
      nodes: {
        a: { id: "a", position: { x: 0, y: 0 } },
      },
    }
    const partial = {
      nodes: {
        b: { id: "b", position: { x: 200, y: 200 }, label: "New" },
      },
    }
    const result = deepMergeState(existing, partial)
    expect(result.nodes.a).toEqual(existing.nodes.a)
    expect(result.nodes.b).toEqual({ id: "b", position: { x: 200, y: 200 }, label: "New" })
  })

  it("removes nodes via removeNodes array", () => {
    const existing = {
      nodes: {
        a: { id: "a" },
        b: { id: "b" },
        c: { id: "c" },
      },
    }
    const partial = { removeNodes: ["b"] }
    const result = deepMergeState(existing, partial)
    expect(result.nodes.a).toEqual({ id: "a" })
    expect(result.nodes.b).toBeUndefined()
    expect(result.nodes.c).toEqual({ id: "c" })
  })

  it("removes edges connected to removed nodes", () => {
    const existing = {
      nodes: {
        a: { id: "a" },
        b: { id: "b" },
        c: { id: "c" },
      },
      edges: [
        { from: "a", to: "b", label: "ab" },
        { from: "b", to: "c", label: "bc" },
        { from: "a", to: "c", label: "ac" },
      ],
    }
    const partial = { removeNodes: ["b"] }
    const result = deepMergeState(existing, partial)
    expect(result.edges).toEqual([{ from: "a", to: "c", label: "ac" }])
  })

  it("replaces edges array entirely when edges key is provided", () => {
    const existing = {
      edges: [{ from: "a", to: "b" }],
    }
    const newEdges = [{ from: "x", to: "y" }, { from: "y", to: "z" }]
    const partial = { edges: newEdges }
    const result = deepMergeState(existing, partial)
    expect(result.edges).toEqual(newEdges)
  })

  it("updates viewport", () => {
    const existing = {
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const partial = {
      viewport: { x: 100, y: -50, zoom: 1.5 },
    }
    const result = deepMergeState(existing, partial)
    expect(result.viewport).toEqual({ x: 100, y: -50, zoom: 1.5 })
  })

  it("handles empty existing state gracefully", () => {
    const existing = {}
    const partial = {
      nodes: {
        a: { id: "a", position: { x: 10, y: 20 } },
      },
    }
    const result = deepMergeState(existing, partial)
    expect(result.nodes.a).toEqual({ id: "a", position: { x: 10, y: 20 } })
  })

  it("preserves unrelated fields during merge", () => {
    const existing = {
      component: "my-button",
      nodes: { a: { id: "a" } },
      someCustomField: 42,
    }
    const partial = {
      nodes: { a: { id: "a", label: "Updated" } },
    }
    const result = deepMergeState(existing, partial)
    expect(result.component).toBe("my-button")
    expect(result.someCustomField).toBe(42)
  })

  it("handles multiple operations in one partial (removeNodes + add new nodes)", () => {
    const existing = {
      nodes: {
        a: { id: "a" },
        b: { id: "b" },
      },
      edges: [
        { from: "a", to: "b" },
      ],
    }
    // Note: when both removeNodes and nodes are present, the nodes key
    // rebuilds from `existing.nodes`, so "b" persists in nodes.
    // The edges are still filtered by removeNodes.
    const partial = {
      removeNodes: ["b"],
      nodes: {
        c: { id: "c", position: { x: 300, y: 300 } },
      },
    }
    const result = deepMergeState(existing, partial)
    // "c" should be added
    expect(result.nodes.c).toEqual({ id: "c", position: { x: 300, y: 300 } })
    // "a" preserved
    expect(result.nodes.a).toEqual({ id: "a" })
    // Edge from a->b should be removed by removeNodes
    expect(result.edges).toEqual([])
  })

  it("removeNodes alone removes nodes and their edges", () => {
    const existing = {
      nodes: {
        a: { id: "a" },
        b: { id: "b" },
        c: { id: "c" },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
    }
    const partial = { removeNodes: ["b"] }
    const result = deepMergeState(existing, partial)
    expect(result.nodes.b).toBeUndefined()
    expect(result.nodes.a).toEqual({ id: "a" })
    expect(result.nodes.c).toEqual({ id: "c" })
    expect(result.edges).toEqual([{ from: "a", to: "c" }])
  })
})
