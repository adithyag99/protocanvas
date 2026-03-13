import { create } from "zustand"
import type { AppConfig, CanvasState, FeedbackState, FeedbackEntry } from "@/types/canvas"

interface ModalVariant {
  nodeId: string
  label: string
  htmlFile: string
}

interface CanvasStore {
  // Data
  config: AppConfig | null
  canvasState: CanvasState | null
  feedback: FeedbackState
  iframeHeights: Record<string, number>
  nodeWidths: Record<string, number>
  modalVariant: ModalVariant | null

  // View
  focusMode: boolean

  // Loading
  loading: boolean

  // Actions
  toggleFocusMode: () => void
  init: () => Promise<void>
  updateNodePosition: (id: string, x: number, y: number) => void
  togglePick: (id: string) => void
  updateFeedback: (id: string, text: string) => void
  setFeedbackAction: (id: string, action: "branch" | "iterate") => void
  setIframeHeight: (id: string, height: number) => void
  updateViewport: (x: number, y: number, zoom: number) => void
  clearFeedback: () => void
  setNodeWidth: (id: string, width: number) => void
  openModal: (variant: ModalVariant) => void
  closeModal: () => void
  hideNode: (id: string) => void
  unhideNode: (id: string) => void
  removeNode: (id: string) => void
  syncState: () => Promise<void>
  syncFeedback: () => Promise<void>
  refetchState: () => Promise<void>
}

let stateSyncTimer: ReturnType<typeof setTimeout> | null = null
let feedbackSyncTimer: ReturnType<typeof setTimeout> | null = null
let viewportSyncTimer: ReturnType<typeof setTimeout> | null = null

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  config: null,
  canvasState: null,
  feedback: { picked: [], feedback: {} },
  iframeHeights: {},
  nodeWidths: {},
  modalVariant: null,
  focusMode: false,
  loading: true,

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  init: async () => {
    try {
      const [configRes, stateRes, feedbackRes] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/state"),
        fetch("/__feedback"),
      ])
      const config: AppConfig = await configRes.json()
      const canvasState: CanvasState = await stateRes.json()
      const feedback: FeedbackState = await feedbackRes.json()
      set({ config, canvasState, feedback, loading: false })
    } catch (err) {
      console.error("Failed to init canvas store:", err)
      set({ loading: false })
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
    // Debounced sync
    if (stateSyncTimer) clearTimeout(stateSyncTimer)
    stateSyncTimer = setTimeout(() => get().syncState(), 500)
  },

  togglePick: (id) => {
    const fb = get().feedback
    const picked = fb.picked.includes(id)
      ? fb.picked.filter((p) => p !== id)
      : [...fb.picked, id]
    set({ feedback: { ...fb, picked } })
    // Immediate sync on pick
    setTimeout(() => get().syncFeedback(), 0)
  },

  updateFeedback: (id, text) => {
    const fb = get().feedback
    const existing = fb.feedback[id]
    const entry: FeedbackEntry =
      typeof existing === "object" && existing !== null
        ? { ...existing, text, read: false }
        : { text, action: "branch", read: false }

    set({
      feedback: {
        ...fb,
        feedback: { ...fb.feedback, [id]: entry },
      },
    })
    // Debounced sync
    if (feedbackSyncTimer) clearTimeout(feedbackSyncTimer)
    feedbackSyncTimer = setTimeout(() => get().syncFeedback(), 400)
  },

  setFeedbackAction: (id, action) => {
    const fb = get().feedback
    const existing = fb.feedback[id]
    const entry: FeedbackEntry =
      typeof existing === "object" && existing !== null
        ? { ...existing, action }
        : { text: "", action, read: false }

    set({
      feedback: {
        ...fb,
        feedback: { ...fb.feedback, [id]: entry },
      },
    })
    setTimeout(() => get().syncFeedback(), 0)
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
      }).catch(() => {})
    }, 1000)
  },

  clearFeedback: () => {
    set({ feedback: { picked: [], feedback: {} } })
    setTimeout(() => get().syncFeedback(), 0)
  },

  setNodeWidth: (id, width) => {
    set((s) => ({ nodeWidths: { ...s.nodeWidths, [id]: width } }))
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
    }).catch(() => {})
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
    }).catch(() => {})
  },

  removeNode: (id) => {
    const state = get().canvasState
    if (!state?.nodes[id]) return
    const { [id]: _, ...remainingNodes } = state.nodes
    const remainingEdges = state.edges.filter(
      (e) => e.from !== id && e.to !== id
    )
    set({
      canvasState: {
        ...state,
        nodes: remainingNodes,
        edges: remainingEdges,
      },
    })
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeNodes: [id] }),
    }).catch(() => {})
  },

  syncState: async () => {
    const state = get().canvasState
    if (!state) return
    // Only send positions
    const positions: Record<string, { position: { x: number; y: number } }> = {}
    for (const [id, node] of Object.entries(state.nodes)) {
      positions[id] = { position: node.position }
    }
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: positions }),
      })
    } catch (err) {
      console.error("Failed to sync state:", err)
    }
  },

  syncFeedback: async () => {
    const fb = get().feedback
    try {
      await fetch("/__feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fb, null, 2),
      })
    } catch (err) {
      console.error("Failed to sync feedback:", err)
    }
  },

  refetchState: async () => {
    try {
      const res = await fetch("/api/state")
      const newState: CanvasState = await res.json()
      // Guard: don't replace current state with empty state
      const currentState = get().canvasState
      if (
        newState.nodes &&
        Object.keys(newState.nodes).length > 0
      ) {
        set({ canvasState: newState })
      } else if (!currentState || Object.keys(currentState.nodes || {}).length === 0) {
        // Only accept empty if we also have nothing
        set({ canvasState: newState })
      }
    } catch (err) {
      console.error("Failed to refetch state:", err)
    }
  },
}))
