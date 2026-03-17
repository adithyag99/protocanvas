import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
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
import { SnapGuides } from "@/components/SnapGuides"
import { snapPosition, type Guide } from "@/lib/snap"
import { ContextMenu } from "@/components/ContextMenu"
import { SyncStatus } from "@/components/SyncStatus"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCanvasStore } from "@/store/canvasStore"

const nodeTypes = { variant: VariantNode }
const edgeTypes = { iteration: IterationEdge }

type InteractionMode = "select" | "pan"

function Canvas() {
  const { fitView, getNodes, getNode, getViewport, setViewport, zoomTo } = useReactFlow()
  const {
    config,
    canvasState,
    loading,
    init,
    updateNodePosition,
    updateViewport,
    refetchState,
    focusMode,
    toggleFocusMode,
    focusedNodeId,
    exitFocus,
  } = useCanvasStore()

  const [mode, setMode] = useState<InteractionMode>("select")
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [filter, setFilter] = useState<FilterMode>("all")
  const [guides, setGuides] = useState<Guide[]>([])
  const [showMinimap, setShowMinimap] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const localNodesRef = useRef<Node[]>([])
  const escPressedRef = useRef(false)
  const [toast, setToast] = useState<string | null>(null)

  const effectiveMode = spaceHeld ? "pan" : mode

  // Copy variant reference to clipboard
  const copyVariantReference = useCallback((nodeId: string) => {
    const cs = useCanvasStore.getState().canvasState
    const cfg = useCanvasStore.getState().config
    if (!cs?.nodes[nodeId] || !cfg) return
    const node = cs.nodes[nodeId]
    const lineage: string[] = []
    let cur: typeof node | undefined = node
    while (cur) {
      lineage.unshift(cur.id)
      cur = cur.parentId ? cs.nodes[cur.parentId] : undefined
    }
    const filePath = `${cfg.dir}/${cfg.variantsDir}/${node.htmlFile}`
    const block = [
      `**${node.id}** — ${node.label}`,
      `Component: ${cfg.component}`,
      `File: ${filePath}`,
      `Lineage: ${lineage.join(" → ")}`,
      `URL: http://localhost:${cfg.port} (variant ${node.id})`,
    ].filter(Boolean).join("\n")
    navigator.clipboard.writeText(block).then(() => {
      setToast(`Copied ${node.id} reference`)
      setTimeout(() => setToast(null), 1500)
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return

      // Two-stage Escape: first press sends Escape into iframe (closes Agentation popups),
      // second press defocuses the card
      if (e.code === "Escape") {
        const fid = useCanvasStore.getState().focusedNodeId
        if (fid) {
          e.preventDefault()
          // Find the focused iframe and try to dispatch Escape into it
          const iframes = document.querySelectorAll('iframe')
          let forwarded = false
          for (const iframe of iframes) {
            if (iframe.style.pointerEvents === 'auto') {
              try {
                iframe.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Escape', code: 'Escape', bubbles: true,
                }))
                forwarded = true
              } catch { /* cross-origin — can't forward */ }
            }
          }
          // If we couldn't forward (cross-origin TSX iframe), or it's a second press, defocus
          if (!forwarded) {
            exitFocus()
          } else {
            // Give Agentation a frame to close, then check if we should defocus too
            // Use a flag so second Escape always defocuses
            if (escPressedRef.current) {
              exitFocus()
              escPressedRef.current = false
            } else {
              escPressedRef.current = true
              setTimeout(() => { escPressedRef.current = false }, 500)
            }
          }
          return
        }
        setContextMenu(null)
        return
      }
      if (e.code === "KeyZ" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        useCanvasStore.getState().undo()
        return
      }
      // Cmd+Shift+C — copy focused variant reference to clipboard
      if (e.key === "c" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const fid = useCanvasStore.getState().focusedNodeId
        if (fid) {
          e.preventDefault()
          copyVariantReference(fid)
          return
        }
      }
      // Arrow key navigation between nodes
      if (e.code === "ArrowRight" || e.code === "ArrowLeft" || e.code === "ArrowUp" || e.code === "ArrowDown") {
        const fid = useCanvasStore.getState().focusedNodeId
        if (fid) {
          e.preventDefault()
          const cs = useCanvasStore.getState().canvasState
          const allNodes = localNodesRef.current.filter(n => {
            const sn = cs?.nodes[n.id]
            return sn && !sn.hidden
          })
          if (allNodes.length <= 1) return
          const current = allNodes.find(n => n.id === fid)
          if (!current) return

          // primary = axis of travel, secondary = cross-axis (weighted 0.3)
          const horiz = e.code === "ArrowRight" || e.code === "ArrowLeft"
          const positive = e.code === "ArrowRight" || e.code === "ArrowDown"
          const next = allNodes
            .filter(n => {
              if (n.id === fid) return false
              const delta = horiz
                ? n.position.x - current.position.x
                : n.position.y - current.position.y
              return positive ? delta > 0 : delta < 0
            })
            .sort((a, b) => {
              const dist = (n: Node) => {
                const primary = horiz
                  ? Math.abs(n.position.x - current.position.x)
                  : Math.abs(n.position.y - current.position.y)
                const secondary = horiz
                  ? Math.abs(n.position.y - current.position.y)
                  : Math.abs(n.position.x - current.position.x)
                return primary + secondary * 0.3
              }
              return dist(a) - dist(b)
            })[0]
          if (next) {
            useCanvasStore.getState().enterFocus(next.id)
          }
          return
        }
      }
      if (e.code === "KeyV") { e.preventDefault(); setMode("select") }
      if (e.code === "KeyH") { e.preventDefault(); setMode("pan") }
      if (e.code === "KeyF") { e.preventDefault(); toggleFocusMode() }
      if (e.code === "KeyM") { e.preventDefault(); setShowMinimap(s => !s) }
      if (e.code === "KeyR") { e.preventDefault(); zoomTo(1, { duration: 300 }) }
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
    // Listen for forwarded keys and annotation changes from iframes
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'variant-keydown') {
        handleKeyDown(new KeyboardEvent('keydown', { code: e.data.code, key: e.data.key, metaKey: !!e.data.metaKey, ctrlKey: !!e.data.ctrlKey }))
      }
      if (e.data?.type === 'variant-copy') {
        copyVariantReference(e.data.variantId)
      }
      if (e.data?.type === 'annotation-change') {
        // Ignore iframe-reported deltas — refetch authoritative count from server instead
        refetchAnnotationCounts()
      }
      // Store annotations on the canvas server
      if (e.data?.type === 'annotation-add') {
        fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId: e.data.variantId, annotation: e.data.annotation }),
        }).catch(() => {})
      }
      if (e.data?.type === 'annotation-delete') {
        fetch(`/api/annotations/${e.data.annotationId}`, { method: 'DELETE' }).catch(() => {})
      }
      if (e.data?.type === 'annotation-clear') {
        fetch(`/api/annotations?variantId=${e.data.variantId}`, { method: 'DELETE' }).catch(() => {})
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("message", handleMessage)
    }
  }, [])

  // Double-click focus: zoom to 100% and center on the focused node
  useEffect(() => {
    if (!focusedNodeId) return

    // Save current viewport for restoration
    const currentVP = getViewport()
    useCanvasStore.setState({ preFocusViewport: currentVP })

    const node = getNode(focusedNodeId)
    if (!node) return

    const nodeW = node.measured?.width ?? 452
    const nodeH = node.measured?.height ?? 400
    const windowW = window.innerWidth
    const windowH = window.innerHeight

    // Center with padding on all sides
    // Center horizontally always
    const x = -(node.position.x - (windowW - nodeW) / 2)

    // Vertically: center if it fits, align to top (with padding) if taller than viewport
    const topPadding = 64
    const fitsVertically = nodeH < windowH - topPadding * 2
    const y = fitsVertically
      ? -(node.position.y - (windowH - nodeH) / 2)
      : -(node.position.y - topPadding)

    setViewport({ x, y, zoom: 1 }, { duration: 300 })
  }, [focusedNodeId, getNode, getViewport, setViewport])

  // Restore viewport when exiting focus
  const prevFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevFocusedRef.current && !focusedNodeId) {
      const preFocusVP = useCanvasStore.getState().preFocusViewport
      if (preFocusVP) {
        setViewport(preFocusVP, { duration: 300 })
      }
    }
    prevFocusedRef.current = focusedNodeId
  }, [focusedNodeId, setViewport])

  useEffect(() => { init() }, [init])

  // Fetch authoritative annotation counts from canvas server
  const refetchAnnotationCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/annotations')
      if (!res.ok) return
      const data = await res.json()
      const counts: Record<string, number> = {}
      for (const ann of data.annotations) {
        if (ann.status === 'applied') continue
        counts[ann.variantId] = (counts[ann.variantId] ?? 0) + 1
      }
      useCanvasStore.setState({ annotationCounts: counts })
    } catch { /* server not ready */ }
  }, [])

  // Fetch on load
  useEffect(() => {
    if (!canvasState?.nodes) return
    refetchAnnotationCounts()
  }, [canvasState?.nodes ? "loaded" : "", refetchAnnotationCounts])

  // SSE — listen for state changes and variant file changes
  // Per-variant reload keys: only the changed HTML variant reloads. TSX variants use Vite HMR.
  const [variantReloadKeys, setVariantReloadKeys] = useState<Record<string, number>>({})
  useEffect(() => {
    const es = new EventSource("/__reload")
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "state-changed") refetchState()
        if (data.type === "variant-changed" && data.file) {
          if (data.file.endsWith('.html')) {
            // Force-reload HTML variants (no HMR)
            const variantId = data.file.replace('.html', '')
            setVariantReloadKeys((prev) => ({ ...prev, [variantId]: (prev[variantId] ?? 0) + 1 }))
          } else if (data.file.endsWith('.tsx')) {
            // New TSX file? Refetch state so the card appears (Vite HMR only works for existing modules)
            refetchState()
          }
        }
        if (data.type === "app-rebuilt") window.location.reload()
        if (data.type === "annotation-added") {
          refetchAnnotationCounts()
        }
        if (data.type === "annotations-resolved") {
          refetchAnnotationCounts()
          // Clear Agentation localStorage in the affected variant's iframe
          // Safe from loops: server-side dedup + sentAnnotationIds prevent re-POSTing
          const iframes = document.querySelectorAll('iframe')
          for (const iframe of iframes) {
            try {
              iframe.contentWindow?.postMessage({ type: 'clear-agentation' }, '*')
            } catch { /* cross-origin */ }
          }
        }
      } catch {}
    }
    return () => es.close()
  }, [refetchState, refetchAnnotationCounts])

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
        reloadKey: variantReloadKeys[node.id] ?? 0,
      },
    }))
  }, [canvasState, variantReloadKeys])

  const [localNodes, setLocalNodes] = useState<Node[]>(storeNodes)

  useEffect(() => {
    setLocalNodes((prev) => {
      // Merge store nodes into local nodes — preserve local positions during drag
      const prevMap = new Map(prev.map((n) => [n.id, n]))
      const prevIds = new Set(prev.map((n) => n.id))

      // Quick check: if same IDs and same count, merge positions only
      const sameSet = storeNodes.length === prev.length && storeNodes.every((n) => prevIds.has(n.id))

      const merged = storeNodes.map((sn) => {
        const local = prevMap.get(sn.id)
        if (local) {
          return { ...sn, position: local.position, measured: local.measured }
        }
        return sn
      })

      // Always update if nodes were added or removed
      if (!sameSet) return merged

      // Same nodes — only update if data changed (new reload key, label change, etc.)
      const dataChanged = merged.some((n, i) => {
        const p = prev[i]
        return !p || n.id !== p.id || n.data !== p.data
      })
      return dataChanged ? merged : prev
    })
  }, [storeNodes])

  // Keep ref in sync for snap calculations
  useEffect(() => {
    localNodesRef.current = localNodes
  }, [localNodes])

  const hiddenCount = useMemo(() => {
    if (!canvasState?.nodes) return 0
    return Object.values(canvasState.nodes).filter((n) => n.hidden).length
  }, [canvasState])

  // Auto-switch back to "all" when no hidden cards remain
  useEffect(() => {
    if (filter === "hidden" && hiddenCount === 0) {
      setFilter("all")
    }
  }, [hiddenCount, filter])

  const nodes: Node[] = useMemo(() => {
    if (filter === "hidden") {
      // Show all cards — both visible and hidden
      return localNodes
    }
    // Default: hide hidden nodes
    return localNodes.filter((node) => {
      const storeNode = canvasState?.nodes[node.id]
      return !storeNode?.hidden
    })
  }, [localNodes, filter, canvasState])

  const edges: Edge[] = useMemo(() => {
    if (!canvasState?.edges) return []
    const nodeMap = new Map(localNodes.map((n) => [n.id, n]))
    return canvasState.edges.map((edge, i) => {
      const sourceNode = nodeMap.get(edge.from)
      const targetNode = nodeMap.get(edge.to)

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
        data: { label: edge.label, feedbackText: edge.feedbackText },
      }
    })
  }, [canvasState, localNodes])

  const removeNodes = useCanvasStore((s) => s.removeNodes)

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Collect removals and handle them via store (persists + supports undo)
      const removeIds = changes
        .filter((c) => c.type === "remove")
        .map((c) => c.id)

      if (removeIds.length > 0) {
        removeNodes(removeIds)
      }

      // Process non-remove changes (position, selection, etc.)
      const nonRemoveChanges = changes.filter((c) => c.type !== "remove")

      const snapNodes = localNodesRef.current.map((n) => ({
        id: n.id,
        position: n.position,
        width: n.measured?.width ?? 452,
        height: n.measured?.height ?? 300,
      }))

      const processedChanges = nonRemoveChanges.map((change) => {
        if (change.type === "position" && change.position) {
          const { x, y, guides: g } = snapPosition(
            change.id,
            change.position.x,
            change.position.y,
            snapNodes
          )
          if (change.dragging) {
            setGuides(g)
          }
          return { ...change, position: { x, y } }
        }
        return change
      })

      if (processedChanges.length > 0) {
        setLocalNodes((nds) => applyNodeChanges(processedChanges, nds))
      }

      for (const change of processedChanges) {
        if (change.type === "position" && !change.dragging) {
          setGuides([])
          if (change.position) {
            updateNodePosition(change.id, change.position.x, change.position.y)
          }
        }
      }
    },
    [updateNodePosition, removeNodes]
  )

  // Tidy up: auto-arrange nodes in a tree layout
  const tidyUp = useCallback(() => {
    const rfNodes = getNodes()
    if (rfNodes.length === 0) return

    const GAP_X = 60
    const GAP_Y = 80

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

    const sizeOf = (id: string) => {
      const n = rfNodes.find((r) => r.id === id)
      return { w: n?.measured?.width ?? 452, h: n?.measured?.height ?? 400 }
    }

    const depthOf: Record<string, number> = {}
    const assignDepths = (id: string, depth: number) => {
      depthOf[id] = depth
      for (const childId of childrenOf[id] || []) {
        assignDepths(childId, depth + 1)
      }
    }
    for (const rootId of roots) assignDepths(rootId, 0)

    const maxHeightAtDepth: Record<number, number> = {}
    for (const [id, depth] of Object.entries(depthOf)) {
      const h = sizeOf(id).h
      maxHeightAtDepth[depth] = Math.max(maxHeightAtDepth[depth] ?? 0, h)
    }

    const yAtDepth: Record<number, number> = { 0: 0 }
    const maxDepth = Math.max(...Object.keys(maxHeightAtDepth).map(Number))
    for (let d = 1; d <= maxDepth; d++) {
      yAtDepth[d] = yAtDepth[d - 1] + (maxHeightAtDepth[d - 1] ?? 0) + GAP_Y
    }

    const subtreeWidth = (id: string): number => {
      const children = childrenOf[id] || []
      if (children.length === 0) return sizeOf(id).w
      const childWidths = children.map(subtreeWidth)
      return Math.max(sizeOf(id).w, childWidths.reduce((a, b) => a + b + GAP_X, -GAP_X))
    }

    const positions: Record<string, { x: number; y: number }> = {}
    const placeSubtree = (id: string, x: number) => {
      const size = sizeOf(id)
      const tw = subtreeWidth(id)
      const depth = depthOf[id]
      positions[id] = { x: x + (tw - size.w) / 2, y: yAtDepth[depth] }
      const children = childrenOf[id] || []
      if (children.length === 0) return
      let cx = x
      for (const childId of children) {
        const cw = subtreeWidth(childId)
        placeSubtree(childId, cx)
        cx += cw + GAP_X
      }
    }

    let startX = 0
    for (const rootId of roots) {
      const tw = subtreeWidth(rootId)
      placeSubtree(rootId, startX)
      startX += tw + GAP_X
    }

    setLocalNodes((nds) =>
      nds.map((n) => positions[n.id] ? { ...n, position: positions[n.id] } : n)
    )
    const state = useCanvasStore.getState().canvasState
    if (state) {
      const updatedNodes = { ...state.nodes }
      for (const [id, pos] of Object.entries(positions)) {
        if (updatedNodes[id]) {
          updatedNodes[id] = { ...updatedNodes[id], position: pos }
        }
      }
      useCanvasStore.setState({
        canvasState: { ...state, nodes: updatedNodes },
      })
      useCanvasStore.getState().syncState()
    }
    setTimeout(() => fitView({ padding: 0.15 }), 50)
  }, [getNodes, canvasState, setLocalNodes, fitView])

  // Restore saved viewport on initial load, or fitView if no saved viewport
  const hasFittedRef = useRef(false)
  useEffect(() => {
    if (storeNodes.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true
      const vp = canvasState?.viewport
      if (vp && (vp.x !== 0 || vp.y !== 0 || vp.zoom !== 1)) {
        // Restore saved viewport
        setTimeout(() => setViewport(vp, { duration: 0 }), 100)
      } else {
        setTimeout(() => fitView({ padding: 0.15 }), 100)
      }
    }
  }, [storeNodes.length, fitView, setViewport, canvasState?.viewport])

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
        hiddenCount={hiddenCount}
        focusMode={focusMode}
        onFocusModeToggle={toggleFocusMode}
        filter={filter}
        onFilterChange={setFilter}
        onTidyUp={tidyUp}
        onExitFocus={focusedNodeId ? exitFocus : undefined}
      />
      <ReactFlow
        nodes={nodes}
        edges={focusMode ? [] : edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className="pt-10"
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => {
          updateViewport(viewport.x, viewport.y, viewport.zoom)
        }}
        onPaneClick={() => {
          if (focusedNodeId) exitFocus()
          setContextMenu(null)
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
        }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: "iteration" }}
        panOnDrag={effectiveMode === "pan" ? [0, 1] : [1]}
        selectionOnDrag={focusedNodeId ? false : effectiveMode === "select"}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={!focusedNodeId && effectiveMode === "select"}
        panOnScroll={true}
        panOnScrollSpeed={1.5}
        zoomOnScroll={false}
        zoomOnPinch={!focusedNodeId}
        zoomOnDoubleClick={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d4d4d4"
          style={{ backgroundColor: "#ebebeb" }}
        />
        <SnapGuides guides={guides} />
        {showMinimap && (
          <MiniMap
            style={{ bottom: 16, right: 16, width: 160, height: 100 }}
            maskColor="rgba(0,0,0,0.08)"
            pannable
            zoomable
          />
        )}
      </ReactFlow>
      <NodeDetail />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
          onCopyReference={copyVariantReference}
        />
      )}
      <SyncStatus />
      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {toast}
        </div>
      )}
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
