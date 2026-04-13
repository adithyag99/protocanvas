import { create } from "zustand"

interface TerminalStore {
  isOpen: boolean
  isFocused: boolean
  isConnected: boolean
  panelHeight: number

  toggle: () => void
  open: () => void
  close: () => void
  setFocused: (focused: boolean) => void
  setConnected: (connected: boolean) => void
  setPanelHeight: (h: number) => void
}

function savePersisted(isOpen: boolean) {
  try {
    sessionStorage.setItem("protocanvas-terminal", JSON.stringify({ isOpen }))
  } catch {}
}

// Auto-open only when opened via browser icon (?terminal=1).
// When opened via cmux (no param), terminal stays off to avoid session conflicts.
function shouldAutoOpen(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('terminal') === '1'
}

// No auto-open — terminal only opens when user clicks the toolbar button.
// This prevents the embedded terminal from grabbing the Claude session
// when the user is working in cmux mode.
function checkAutoOpen() {}

export const useTerminalStore = create<TerminalStore>((set) => ({
  isOpen: shouldAutoOpen(),
  isFocused: false,
  isConnected: false,
  panelHeight: 320,

  toggle: () =>
    set((s) => {
      const next = !s.isOpen
      savePersisted(next)
      return { isOpen: next }
    }),
  open: () => {
    savePersisted(true)
    set({ isOpen: true })
  },
  close: () => {
    savePersisted(false)
    set({ isOpen: false, isFocused: false })
  },
  setFocused: (focused) => set({ isFocused: focused }),
  setConnected: (connected) => set({ isConnected: connected }),
  setPanelHeight: (h) => set({ panelHeight: h }),
}))

// Trigger auto-open check after store is created
checkAutoOpen()
