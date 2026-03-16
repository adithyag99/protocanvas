import { create } from "zustand"
import type { AppConfig, CanvasState, VariantNodeData, CanvasEdge } from "@/types/canvas"

// Undo history entry
interface UndoEntry {
  type: "remove"
  nodes: Record<string, VariantNodeData>
  edges: CanvasEdge[]
}

interface ModalVariant {
  nodeId: string
  label: string
  htmlFile: string
  type?: "html" | "tsx"
}

interface CanvasStore {
  // Data
  config: AppConfig | null
  canvasState: CanvasState | null
  iframeHeights: Record<string, number>
  nodeWidths: Record<string, number>
  annotationCounts: Record<string, number>
  modalVariant: ModalVariant | null

  // View
  focusMode: boolean
  focusedNodeId: string | null
  preFocusViewport: { x: number; y: number; zoom: number } | null

  // Undo
  undoStack: UndoEntry[]

  // Loading
  loading: boolean

  // Error
  syncError: string | null

  // Actions
  toggleFocusMode: () => void
  enterFocus: (nodeId: string) => void
  exitFocus: () => void
  removeNodes: (ids: string[]) => void
  undo: () => void
  init: () => Promise<void>
  updateNodePosition: (id: string, x: number, y: number) => void
  setIframeHeight: (id: string, height: number) => void
  updateViewport: (x: number, y: number, zoom: number) => void
  setNodeWidth: (id: string, width: number) => void
  openModal: (variant: ModalVariant) => void
  closeModal: () => void
  hideNode: (id: string) => void
  unhideNode: (id: string) => void
  removeNode: (id: string) => void
  syncState: () => Promise<void>
  refetchState: () => Promise<void>
  clearSyncError: () => void
}

let positionSyncTimer: ReturnType<typeof setTimeout> | null = null
let widthSyncTimer: ReturnType<typeof setTimeout> | null = null
let viewportSyncTimer: ReturnType<typeof setTimeout> | null = null

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  config: null,
  canvasState: null,
  iframeHeights: {},
  nodeWidths: {},
  annotationCounts: {},
  modalVariant: null,
  focusMode: false,
  focusedNodeId: null,
  preFocusViewport: null,
  undoStack: [],
  loading: true,
  syncError: null,

  clearSyncError: () => set({ syncError: null }),

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  enterFocus: (nodeId: string) => {
    set({ focusedNodeId: nodeId })
  },

  exitFocus: () => {
    set({ focusedNodeId: null, preFocusViewport: null })
  },

  init: async () => {
    try {
      const [configRes, stateRes] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/state"),
      ])
      const config: AppConfig = await configRes.json()
      const canvasState: CanvasState = await stateRes.json()
      // Restore persisted custom widths
      const nodeWidths: Record<string, number> = {}
      for (const [id, node] of Object.entries(canvasState.nodes)) {
        if (node.customWidth) nodeWidths[id] = node.customWidth
      }
      set({ config, canvasState, nodeWidths, loading: false })
    } catch (err) {
      console.error("Failed to init canvas store:", err)
      set({ loading: false, syncError: err instanceof Error ? err.message : 'Failed to initialize canvas' })
    }
  },

  updateNodePosition: (id, x, y) => {
    const state = get().canvasState
    if (!state?.nodes[id]) return
    set({
      canvasState: {
        ...state,
        nodes: {
          ...state.nodes,
          [id]: { ...state.nodes[id], position: { x, y } },
        },
      },
    })
    if (positionSyncTimer) clearTimeout(positionSyncTimer)
    positionSyncTimer = setTimeout(() => get().syncState(), 500)
  },

  setIframeHeight: (id, height) => {
    set((s) => ({
      iframeHeights: { ...s.iframeHeights, [id]: height },
    }))
  },

  updateViewport: (x, y, zoom) => {
    const state = get().canvasState
    if (!state) return
    set({
      canvasState: { ...state, viewport: { x, y, zoom } },
    })
    if (viewportSyncTimer) clearTimeout(viewportSyncTimer)
    viewportSyncTimer = setTimeout(() => {
      fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewport: { x, y, zoom } }),
      }).catch((err) => { set({ syncError: err.message || 'Sync failed' }) })
    }, 1000)
  },

  setNodeWidth: (id, width) => {
    set((s) => {
      const state = s.canvasState
      if (state?.nodes[id]) {
        return {
          nodeWidths: { ...s.nodeWidths, [id]: width },
          canvasState: {
            ...state,
            nodes: {
              ...state.nodes,
              [id]: { ...state.nodes[id], customWidth: width },
            },
          },
        }
      }
      return { nodeWidths: { ...s.nodeWidths, [id]: width } }
    })
    if (widthSyncTimer) clearTimeout(widthSyncTimer)
    widthSyncTimer = setTimeout(() => get().syncState(), 500)
  },

  openModal: (variant) => set({ modalVariant: variant }),
  closeModal: () => set({ modalVariant: null }),

  hideNode: (id) => {
    const state = get().canvasState
    if (!state?.nodes[id]) return
    set({
      canvasState: {
        ...state,
        nodes: {
          ...state.nodes,
          [id]: { ...state.nodes[id], hidden: true },
        },
      },
    })
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: { [id]: { hidden: true } } }),
    }).catch((err) => { set({ syncError: err.message || 'Sync failed' }) })
  },

  unhideNode: (id) => {
    const state = get().canvasState
    if (!state?.nodes[id]) return
    set({
      canvasState: {
        ...state,
        nodes: {
          ...state.nodes,
          [id]: { ...state.nodes[id], hidden: false },
        },
      },
    })
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: { [id]: { hidden: false } } }),
    }).catch((err) => { set({ syncError: err.message || 'Sync failed' }) })
  },

  removeNode: (id) => {
    get().removeNodes([id])
  },

  removeNodes: (ids) => {
    const state = get().canvasState
    if (!state) return

    // Save removed nodes and affected edges for undo
    const removedNodes: Record<string, VariantNodeData> = {}
    for (const id of ids) {
      if (state.nodes[id]) removedNodes[id] = state.nodes[id]
    }
    const removedEdges = state.edges.filter(
      (e) => ids.includes(e.from) || ids.includes(e.to)
    )

    if (Object.keys(removedNodes).length === 0) return

    // Push to undo stack (max 20 entries)
    const undoStack = [...get().undoStack, { type: "remove" as const, nodes: removedNodes, edges: removedEdges }].slice(-20)

    const remainingNodes = { ...state.nodes }
    for (const id of ids) delete remainingNodes[id]
    const remainingEdges = state.edges.filter(
      (e) => !ids.includes(e.from) && !ids.includes(e.to)
    )

    set({
      canvasState: { ...state, nodes: remainingNodes, edges: remainingEdges },
      undoStack,
    })
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeNodes: ids }),
    }).catch((err) => { set({ syncError: err.message || 'Sync failed' }) })
  },

  undo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    const state = get().canvasState
    if (!state) return

    if (entry.type === "remove") {
      // Restore removed nodes and edges
      const restoredNodes = { ...state.nodes, ...entry.nodes }
      const restoredEdges = [...state.edges, ...entry.edges]

      set({
        canvasState: { ...state, nodes: restoredNodes, edges: restoredEdges },
        undoStack: stack.slice(0, -1),
      })

      // Sync restored state to server
      fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: entry.nodes, edges: restoredEdges }),
      }).catch((err) => { set({ syncError: err.message || 'Sync failed' }) })
    }
  },

  syncState: async () => {
    const state = get().canvasState
    if (!state) return
    const nodeData: Record<string, { position: { x: number; y: number }; customWidth?: number }> = {}
    for (const [id, node] of Object.entries(state.nodes)) {
      nodeData[id] = { position: node.position }
      if (node.customWidth) nodeData[id].customWidth = node.customWidth
    }
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: nodeData }),
      })
    } catch (err) {
      console.error("Failed to sync state:", err)
      set({ syncError: err instanceof Error ? err.message : 'Sync failed' })
    }
  },

  refetchState: async () => {
    try {
      const res = await fetch("/api/state")
      const newState: CanvasState = await res.json()
      set({ canvasState: newState })
    } catch (err) {
      console.error("Failed to refetch state:", err)
      set({ syncError: err instanceof Error ? err.message : 'Failed to refresh state' })
    }
  },
}))
