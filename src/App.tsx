import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type OnNodesChange,
  SelectionMode,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Toolbar, type FilterMode } from "@/components/Toolbar"
import { VariantNode } from "@/components/VariantNode"
import { IterationEdge } from "@/components/IterationEdge"
import { NodeDetail } from "@/components/NodeDetail"
import { SnapGuides, type Guide } from "@/components/SnapGuides"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCanvasStore } from "@/store/canvasStore"

const nodeTypes = { variant: VariantNode }
const edgeTypes = { iteration: IterationEdge }

const SNAP_THRESHOLD = 8

type InteractionMode = "select" | "pan"

function Canvas() {
  const { fitView, getNodes } = useReactFlow()
  const {
    config,
    canvasState,
    loading,
    init,
    updateNodePosition,
    feedback,
    updateViewport,
    refetchState,
    clearFeedback,
    iframeHeights,
    focusMode,
    toggleFocusMode,
  } = useCanvasStore()

  const [mode, setMode] = useState<InteractionMode>("select")
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [filter, setFilter] = useState<FilterMode>("all")
  const [guides, setGuides] = useState<Guide[]>([])
  const localNodesRef = useRef<Node[]>([])

  const effectiveMode = spaceHeld ? "pan" : mode

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return

      if (e.code === "KeyV") { e.preventDefault(); setMode("select") }
      if (e.code === "KeyH") { e.preventDefault(); setMode("pan") }
      if (e.code === "KeyF") { e.preventDefault(); toggleFocusMode() }
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault()
        setSpaceHeld(true)
        document.body.style.cursor = "grab"
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false)
        document.body.style.cursor = ""
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [])

  useEffect(() => { init() }, [init])

  // SSE
  useEffect(() => {
    const es = new EventSource("/__reload")
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "state-changed") refetchState()
      } catch {}
    }
    return () => es.close()
  }, [refetchState])

  // Convert canvas state to React Flow nodes
  const storeNodes: Node[] = useMemo(() => {
    if (!canvasState?.nodes) return []
    return Object.values(canvasState.nodes).map((node) => ({
      id: node.id,
      type: "variant",
      position: node.position,
      data: {
        ...node,
        variantWidth: canvasState.variantWidth || 420,
      },
    }))
  }, [canvasState, iframeHeights])

  const [localNodes, setLocalNodes] = useState<Node[]>(storeNodes)

  useEffect(() => {
    setLocalNodes(storeNodes)
  }, [storeNodes])

  // Keep ref in sync for snap calculations
  useEffect(() => {
    localNodesRef.current = localNodes
  }, [localNodes])

  const hiddenCount = useMemo(() => {
    if (!canvasState?.nodes) return 0
    return Object.values(canvasState.nodes).filter((n) => n.hidden).length
  }, [canvasState])

  const nodes: Node[] = useMemo(() => {
    if (filter === "hidden") {
      return localNodes.filter((node) => {
        const storeNode = canvasState?.nodes[node.id]
        return storeNode?.hidden
      })
    }
    // Default: hide hidden nodes
    const visible = localNodes.filter((node) => {
      const storeNode = canvasState?.nodes[node.id]
      return !storeNode?.hidden
    })
    if (filter === "all") return visible
    return visible.filter((node) => {
      if (filter === "picked") return feedback.picked.includes(node.id)
      if (filter === "with-feedback") {
        const entry = feedback.feedback[node.id]
        const text = typeof entry === "string" ? entry : entry?.text ?? ""
        return text.trim().length > 0
      }
      return true
    })
  }, [localNodes, filter, feedback, canvasState])

  const edges: Edge[] = useMemo(() => {
    if (!canvasState?.edges) return []
    return canvasState.edges.map((edge, i) => {
      const sourceNode = localNodes.find((n) => n.id === edge.from)
      const targetNode = localNodes.find((n) => n.id === edge.to)

      let sourceHandle = "bottom"
      let targetHandle = "top"

      if (sourceNode && targetNode) {
        const sw = sourceNode.measured?.width ?? 452
        const sh = sourceNode.measured?.height ?? 400
        const tw = targetNode.measured?.width ?? 452

        const sx = sourceNode.position.x + sw / 2
        const sy = sourceNode.position.y + sh / 2
        const tx = targetNode.position.x + tw / 2
        const ty = targetNode.position.y

        const dx = tx - sx
        const dy = ty - sy

        // If horizontal distance is dominant, use right→left
        if (Math.abs(dx) > Math.abs(dy) * 0.8) {
          if (dx > 0) {
            sourceHandle = "right"
            targetHandle = "left"
          } else {
            sourceHandle = "left"
            targetHandle = "right"
          }
        } else if (dy < 0) {
          sourceHandle = "top"
          targetHandle = "bottom"
        }
      }

      return {
        id: `e-${edge.from}-${edge.to}-${i}`,
        source: edge.from,
        target: edge.to,
        sourceHandle,
        targetHandle,
        type: "iteration",
        data: { label: edge.label },
      }
    })
  }, [canvasState, localNodes])

  // Smart snap: check alignment with other nodes and snap if close
  const snapPosition = useCallback(
    (id: string, x: number, y: number) => {
      const allNodes = localNodesRef.current
      const draggedNode = allNodes.find((n) => n.id === id)
      if (!draggedNode) return { x, y, guides: [] as Guide[] }

      const dw = draggedNode.measured?.width ?? 452
      const dh = draggedNode.measured?.height ?? 300

      let snappedX = x
      let snappedY = y
      let didSnapX = false
      let didSnapY = false
      const newGuides: Guide[] = []

      for (const node of allNodes) {
        if (node.id === id) continue
        const nw = node.measured?.width ?? 452
        const nh = node.measured?.height ?? 300
        const nx = node.position.x
        const ny = node.position.y

        // --- Vertical guides (snap X) ---
        if (!didSnapX) {
          // Left ↔ Left
          if (Math.abs(x - nx) < SNAP_THRESHOLD) {
            snappedX = nx; didSnapX = true
            newGuides.push({ pos: nx, axis: "x" })
          }
          // Right ↔ Right
          else if (Math.abs((x + dw) - (nx + nw)) < SNAP_THRESHOLD) {
            snappedX = nx + nw - dw; didSnapX = true
            newGuides.push({ pos: nx + nw, axis: "x" })
          }
          // Center ↔ Center (X)
          else if (Math.abs((x + dw / 2) - (nx + nw / 2)) < SNAP_THRESHOLD) {
            snappedX = nx + nw / 2 - dw / 2; didSnapX = true
            newGuides.push({ pos: nx + nw / 2, axis: "x" })
          }
        }

        // --- Horizontal guides (snap Y) ---
        if (!didSnapY) {
          // Top ↔ Top
          if (Math.abs(y - ny) < SNAP_THRESHOLD) {
            snappedY = ny; didSnapY = true
            newGuides.push({ pos: ny, axis: "y" })
          }
          // Bottom ↔ Bottom
          else if (Math.abs((y + dh) - (ny + nh)) < SNAP_THRESHOLD) {
            snappedY = ny + nh - dh; didSnapY = true
            newGuides.push({ pos: ny + nh, axis: "y" })
          }
          // Center ↔ Center (Y)
          else if (Math.abs((y + dh / 2) - (ny + nh / 2)) < SNAP_THRESHOLD) {
            snappedY = ny + nh / 2 - dh / 2; didSnapY = true
            newGuides.push({ pos: ny + nh / 2, axis: "y" })
          }
        }

        if (didSnapX && didSnapY) break
      }

      return { x: snappedX, y: snappedY, guides: newGuides }
    },
    []
  )

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Process changes: snap positions during drag AND on drag end
      const processedChanges = changes.map((change) => {
        if (change.type === "position" && change.position) {
          const { x, y, guides: g } = snapPosition(
            change.id,
            change.position.x,
            change.position.y
          )
          if (change.dragging) {
            setGuides(g)
          }
          return { ...change, position: { x, y } }
        }
        return change
      })

      setLocalNodes((nds) => applyNodeChanges(processedChanges, nds))

      // Clear guides and persist on drag end
      for (const change of processedChanges) {
        if (change.type === "position" && !change.dragging) {
          setGuides([])
          if (change.position) {
            updateNodePosition(change.id, change.position.x, change.position.y)
          }
        }
      }
    },
    [snapPosition, updateNodePosition]
  )

  // Tidy up: auto-arrange nodes in a tree layout (roots in a row, children below parents)
  const tidyUp = useCallback(() => {
    const rfNodes = getNodes()
    if (rfNodes.length === 0) return

    const GAP_X = 60
    const GAP_Y = 80

    // Build parent→children map
    const childrenOf: Record<string, string[]> = {}
    const roots: string[] = []
    for (const n of rfNodes) {
      const storeNode = canvasState?.nodes[n.id]
      const parentId = storeNode?.parentId
      if (parentId && rfNodes.some((r) => r.id === parentId)) {
        if (!childrenOf[parentId]) childrenOf[parentId] = []
        childrenOf[parentId].push(n.id)
      } else {
        roots.push(n.id)
      }
    }

    // Measure node sizes from React Flow
    const sizeOf = (id: string) => {
      const n = rfNodes.find((r) => r.id === id)
      return { w: n?.measured?.width ?? 452, h: n?.measured?.height ?? 400 }
    }

    // Calculate subtree width (recursive)
    const subtreeWidth = (id: string): number => {
      const children = childrenOf[id] || []
      if (children.length === 0) return sizeOf(id).w
      const childWidths = children.map(subtreeWidth)
      return Math.max(sizeOf(id).w, childWidths.reduce((a, b) => a + b + GAP_X, -GAP_X))
    }

    // Position nodes recursively
    const positions: Record<string, { x: number; y: number }> = {}
    const placeSubtree = (id: string, x: number, y: number) => {
      const size = sizeOf(id)
      const tw = subtreeWidth(id)
      // Center this node over its subtree
      positions[id] = { x: x + (tw - size.w) / 2, y }
      const children = childrenOf[id] || []
      if (children.length === 0) return
      let cx = x
      for (const childId of children) {
        const cw = subtreeWidth(childId)
        placeSubtree(childId, cx, y + size.h + GAP_Y)
        cx += cw + GAP_X
      }
    }

    let startX = 0
    for (const rootId of roots) {
      const tw = subtreeWidth(rootId)
      placeSubtree(rootId, startX, 0)
      startX += tw + GAP_X
    }

    // Apply positions
    setLocalNodes((nds) =>
      nds.map((n) => positions[n.id] ? { ...n, position: positions[n.id] } : n)
    )
    // Persist all positions
    for (const [id, pos] of Object.entries(positions)) {
      updateNodePosition(id, pos.x, pos.y)
    }
    setTimeout(() => fitView({ padding: 0.15 }), 50)
  }, [getNodes, canvasState, setLocalNodes, updateNodePosition, fitView])

  // Fit view once
  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.15 }), 100)
    }
  }, [nodes.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading canvas...
      </div>
    )
  }

  return (
    <div className="w-screen h-screen" data-mode={effectiveMode}>
      <Toolbar
        component={config?.component ?? ""}
        nodeCount={nodes.length}
        hiddenCount={hiddenCount}
        mode={mode}
        onModeChange={setMode}
        focusMode={focusMode}
        onFocusModeToggle={toggleFocusMode}
        filter={filter}
        onFilterChange={setFilter}
        onClearFeedback={() => {
          if (window.confirm("Clear all feedback and picks?")) {
            clearFeedback()
          }
        }}
        onTidyUp={tidyUp}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        className="pt-10"
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => {
          updateViewport(viewport.x, viewport.y, viewport.zoom)
        }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: "iteration" }}
        panOnDrag={effectiveMode === "pan"}
        selectionOnDrag={effectiveMode === "select"}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={effectiveMode === "select"}
        panOnScroll={true}
        panOnScrollSpeed={1.5}
        zoomOnScroll={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d4d4d4"
          style={{ backgroundColor: "#ebebeb" }}
        />
        <SnapGuides guides={guides} />
      </ReactFlow>
      <NodeDetail />
    </div>
  )
}

export default function App() {
  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </TooltipProvider>
  )
}
