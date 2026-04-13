import { useCallback, useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import "@xterm/xterm/css/xterm.css"

const hideCursorCSS = `
  .xterm-cursor { display: none !important; }
`

// Complete xterm.js ITheme — all 18 ANSI colors + chrome
// Setting `theme` on the terminal instance updates everything at once
const DARK_THEME = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#cccccc",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#6a9955",
  yellow: "#d7ba7d",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#4ec9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f14c4c",
  brightGreen: "#73c991",
  brightYellow: "#e2c08d",
  brightBlue: "#6cb6ff",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
}

// Claude Code's hardcoded background RGB values → light mode equivalents
const LIGHT_BG_MAP: Record<string, string> = {
  "48;2;55;55;55":   "48;2;230;230;230",   // user input bg: dark grey → light grey
  "48;2;0;0;0":      "48;2;245;245;245",   // pure black bg → match terminal bg
  "48;2;2;40;0":     "48;2;220;243;220",   // diff added (dark green) → light green
  "48;2;4;71;0":     "48;2;200;235;200",   // diff added (brighter green) → lighter green
  "48;2;61;1;0":     "48;2;243;220;220",   // diff removed (dark red) → light red
  "48;2;92;2;0":     "48;2;235;200;200",   // diff removed (brighter red) → lighter red
}

// Regex for true-color background sequences
const BG_RGB_RE = /\x1b\[(48;2;\d+;\d+;\d+)m/g

function remapLightColors(data: string): string {
  return data.replace(BG_RGB_RE, (match, seq) => {
    const replacement = LIGHT_BG_MAP[seq]
    return replacement ? `\x1b[${replacement}m` : match
  })
}

const LIGHT_THEME = {
  background: "#f5f5f5",
  foreground: "#383a42",
  cursor: "#383a42",
  cursorAccent: "#f5f5f5",
  selectionBackground: "#bfceff",
  selectionForeground: "#383a42",
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#a0a1a7",
  brightBlack: "#4f525e",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
}
import { RotateCcw, ChevronDown, Moon, Sun } from "lucide-react"
import { useTerminalStore } from "@/store/terminalStore"

const DEFAULT_W = 440
const DEFAULT_H = 620
const MIN_W = 400
const MIN_H = 200
const HEADER_H = 32
const COLLAPSED_H = 36 // 32 + 2px border + 2px bottom padding

export function TerminalPanel() {
  const isOpen = useTerminalStore((s) => s.isOpen)
  const isFocused = useTerminalStore((s) => s.isFocused)
  const setFocused = useTerminalStore((s) => s.setFocused)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)

  // Window state — persisted to sessionStorage
  const [pos, _setPos] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("protocanvas-terminal-layout") || "{}")
      if (saved.x != null) return { x: saved.x, y: saved.y }
    } catch {}
    return { x: -1, y: -1 }
  })
  const [size, _setSize] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("protocanvas-terminal-layout") || "{}")
      if (saved.w) return { w: saved.w, h: saved.h }
    } catch {}
    return { w: DEFAULT_W, h: DEFAULT_H }
  })
  const [collapsed, setCollapsed] = useState(false)
  const [exited, setExited] = useState(false)
  const [termDark, setTermDark] = useState(() => {
    try { return sessionStorage.getItem("protocanvas-term-dark") !== "false" } catch { return true }
  })
  const [kickedByTab, setKickedByTab] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Persist layout changes
  const setPos = useCallback((p: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => {
    _setPos((prev) => {
      const next = typeof p === "function" ? p(prev) : p
      try {
        const saved = JSON.parse(sessionStorage.getItem("protocanvas-terminal-layout") || "{}")
        sessionStorage.setItem("protocanvas-terminal-layout", JSON.stringify({ ...saved, x: next.x, y: next.y }))
      } catch {}
      return next
    })
  }, [])
  const setSize = useCallback((s: { w: number; h: number } | ((prev: { w: number; h: number }) => { w: number; h: number })) => {
    _setSize((prev) => {
      const next = typeof s === "function" ? s(prev) : s
      try {
        const saved = JSON.parse(sessionStorage.getItem("protocanvas-terminal-layout") || "{}")
        sessionStorage.setItem("protocanvas-terminal-layout", JSON.stringify({ ...saved, w: next.w, h: next.h }))
      } catch {}
      return next
    })
  }, [])

  // Initialize position to bottom-left on first open
  useEffect(() => {
    if (isOpen && pos.x === -1) {
      setPos({
        x: 16,
        y: window.innerHeight - DEFAULT_H - 16,
      })
    }
  }, [isOpen, pos.x, setPos])

  // Create terminal once on mount
  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Geist Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      fontWeight: 400,
      scrollback: 10000,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      theme: (() => { try { return sessionStorage.getItem("protocanvas-term-dark") !== "false" } catch { return true } })() ? DARK_THEME : LIGHT_THEME,
      minimumContrastRatio: (() => { try { return sessionStorage.getItem("protocanvas-term-dark") !== "false" } catch { return true } })() ? 1 : 4.5,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    // Map macOS shortcuts to terminal equivalents
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      // Cmd+Backspace → Ctrl+U (kill line)
      if (event.metaKey && event.key === "Backspace") {
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) ws.send("\x15")
        return false
      }
      // Cmd+K → Ctrl+K (kill to end of line)
      if (event.metaKey && event.key === "k") {
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) ws.send("\x0b")
        return false
      }
      return true
    })

    // Hide xterm cursor — Claude Code renders its own
    const style = document.createElement("style")
    style.textContent = hideCursorCSS
    document.head.appendChild(style)

    termRef.current = term
    fitRef.current = fit

    // Safe fit that preserves scroll position
    const origFit = fit.fit.bind(fit)
    fit.fit = () => {
      const scrollTop = term.buffer.active.viewportY
      origFit()
      // Restore scroll position after fit
      if (term.buffer.active.viewportY !== scrollTop) {
        term.scrollToLine(scrollTop)
      }
    }

    return () => { term.dispose(); termRef.current = null; fitRef.current = null }
  }, [])

  // Apply terminal theme when toggled
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = termDark ? DARK_THEME : LIGHT_THEME
    term.options.minimumContrastRatio = termDark ? 1 : 4.5
  }, [termDark])

  // Intercept image paste — upload to /tmp, type file path into terminal
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          e.preventDefault()
          e.stopPropagation()

          const file = item.getAsFile()
          if (!file) continue

          const formData = new FormData()
          formData.append("file", file, file.name || "paste.png")

          try {
            const res = await fetch("/api/clipboard/upload", {
              method: "POST",
              body: formData,
            })
            if (res.ok) {
              const { filePath } = await res.json()
              // Type the path into the terminal
              const ws = wsRef.current
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(filePath)
              }
            }
          } catch (err) {
            console.error("Image paste failed:", err)
          }
          return // only handle first image
        }
      }
    }

    container.addEventListener("paste", handlePaste, true) // capture phase — before xterm
    return () => container.removeEventListener("paste", handlePaste, true)
  }, [])

  // Attach terminal to DOM
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    const container = containerRef.current
    if (!isOpen || !term || !fit || !container) return
    if (!term.element) term.open(container)
    fit.fit()
    let roTimer: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(roTimer)
      roTimer = setTimeout(() => fit.fit(), 100)
    })
    ro.observe(container)
    return () => { ro.disconnect(); clearTimeout(roTimer) }
  }, [isOpen])

  // Re-fit on size change or uncollapse
  useEffect(() => {
    if (isOpen && !collapsed && fitRef.current && termRef.current?.element) {
      setTimeout(() => fitRef.current?.fit(), 50)
    }
  }, [isOpen, collapsed, size.w, size.h])

  // WebSocket connection
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:"
      const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal`)
      wsRef.current = ws

      ws.onopen = () => {
        useTerminalStore.setState({ isConnected: true })
        reconnectDelayRef.current = 1000
        setExited(false)
        ws.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }))
        term!.focus()
      }

      ws.onmessage = (e) => {
        const isDark = sessionStorage.getItem("protocanvas-term-dark") !== "false"
        term!.write(isDark ? e.data : remapLightColors(e.data))
      }

      ws.onclose = (event) => {
        useTerminalStore.setState({ isConnected: false })
        wsRef.current = null
        if (event.code === 4002) {
          // Process exited — show restart prompt, don't auto-respawn
          setExited(true)
          return
        }
        if (event.code === 4001) {
          setKickedByTab(true)
          return
        }
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
          connect()
        }, reconnectDelayRef.current)
      }

      ws.onerror = () => {}
    }

    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }))
      }
    })

    connectRef.current = connect
    connect()

    return () => {
      dataDisposable.dispose()
      resizeDisposable.dispose()
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const ws = wsRef.current
      if (ws) { ws.onclose = null; ws.close(); wsRef.current = null }
      useTerminalStore.setState({ isConnected: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shared connect function (used by useEffect and handleRestart)
  const connectRef = useRef<(() => void) | null>(null)

  // Restart / reconnect
  const handleRestart = useCallback(() => {
    setExited(false)
    setKickedByTab(false)
    // Don't clear terminal — keep existing content visible
    // Close existing WebSocket cleanly
    const oldWs = wsRef.current
    if (oldWs) {
      oldWs.onclose = null // prevent auto-reconnect from firing
      oldWs.close()
      wsRef.current = null
    }
    useTerminalStore.setState({ isConnected: false })
    // Reconnect after a brief delay (let server process the close)
    setTimeout(() => { connectRef.current?.() }, 300)
  }, [])

  // Drag header to move window
  const startMove = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...pos }

    const onMove = (ev: MouseEvent) => {
      setPos({
        x: Math.max(0, Math.min(startPos.x + ev.clientX - startX, window.innerWidth - 100)),
        y: Math.max(0, Math.min(startPos.y + ev.clientY - startY, window.innerHeight - HEADER_H)),
      })
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [pos])

  // Resize from edges/corners
  const startResize = useCallback((edge: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const startX = e.clientX
    const startY = e.clientY
    const startSize = { ...size }
    const startPos = { ...pos }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const next = { ...startSize }
      const nextPos = { ...startPos }

      if (edge.includes("e")) next.w = Math.max(MIN_W, startSize.w + dx)
      if (edge.includes("s")) next.h = Math.max(MIN_H, startSize.h + dy)
      if (edge.includes("w")) {
        const dw = Math.min(dx, startSize.w - MIN_W)
        next.w = startSize.w - dw
        nextPos.x = startPos.x + dw
      }
      if (edge.includes("n")) {
        const dh = Math.min(dy, startSize.h - MIN_H)
        next.h = startSize.h - dh
        nextPos.y = startPos.y + dh
      }

      setSize(next)
      setPos(nextPos)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      setTimeout(() => fitRef.current?.fit(), 50)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [size, pos])

  // Anchor from bottom edge — bottom stays fixed, top slides
  const bottomFromViewport = window.innerHeight - (pos.y + size.h)
  const displayH = collapsed ? COLLAPSED_H : size.h

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        bottom: bottomFromViewport,
        width: size.w,
        height: displayH,
        zIndex: 9999,
        display: isOpen ? "flex" : "none",
        flexDirection: "column",
        background: termDark ? "#1e1e1e" : "#f5f5f5",
        borderRadius: 12,
        boxSizing: "border-box",
        border: isFocused ? "2px solid #3b82f6" : (termDark ? "2px solid #333" : "2px solid #ddd"),
        transition: dragging ? "none" : "height 300ms cubic-bezier(0.25, 0, 0, 1), border-color 200ms ease",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      {/* Resize handles — wider grab areas for easier resizing */}
      {!collapsed && <>
        <div style={{ position: "absolute", top: -4, left: 12, right: 12, height: 8, cursor: "n-resize", zIndex: 6 }} onMouseDown={(e) => startResize("n", e)} />
        <div style={{ position: "absolute", bottom: -4, left: 12, right: 12, height: 8, cursor: "s-resize", zIndex: 2 }} onMouseDown={(e) => startResize("s", e)} />
        <div style={{ position: "absolute", left: -4, top: 12, bottom: 12, width: 8, cursor: "w-resize", zIndex: 2 }} onMouseDown={(e) => startResize("w", e)} />
        <div style={{ position: "absolute", right: -4, top: 12, bottom: 12, width: 8, cursor: "e-resize", zIndex: 2 }} onMouseDown={(e) => startResize("e", e)} />
        <div style={{ position: "absolute", top: 0, left: 0, width: 16, height: 16, cursor: "nw-resize", zIndex: 6 }} onMouseDown={(e) => startResize("nw", e)} />
        <div style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, cursor: "ne-resize", zIndex: 6 }} onMouseDown={(e) => startResize("ne", e)} />
        <div style={{ position: "absolute", bottom: 0, left: 0, width: 16, height: 16, cursor: "sw-resize", zIndex: 3 }} onMouseDown={(e) => startResize("sw", e)} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "se-resize", zIndex: 3 }} onMouseDown={(e) => startResize("se", e)} />
      </>}

      {/* Terminal container — absolute, full size, never changes dimensions */}
      <div
        ref={containerRef}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false)
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: size.h,
          padding: "4px 2px 2px 4px",
          overflow: "hidden",
          zIndex: 1,
          visibility: collapsed ? "hidden" : "visible",
        }}
      />

      {/* Opaque cover — always rendered, fades in/out */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: termDark ? "#2a2a2a" : "#e8e8e8",
        zIndex: 4,
        opacity: collapsed ? 1 : 0,
        transition: "opacity 100ms ease",
        pointerEvents: collapsed ? "auto" : "none",
      }} />

      {/* Drag zone — invisible, full width */}
      <div
        onMouseDown={startMove}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: HEADER_H,
          cursor: "grab",
          zIndex: 4,
          userSelect: "none",
        }}
      />

      {/* Label — only visible when collapsed */}
      {collapsed && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: HEADER_H,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          paddingLeft: 14,
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#888",
            fontFamily: "'Geist Mono', Menlo, Monaco, monospace",
          }}>
            Claude Code
          </span>
        </div>
      )}

      {/* Buttons — top-right */}
      <div style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: collapsed ? undefined : 160,
        height: collapsed ? HEADER_H : 48,
        zIndex: 5,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        background: collapsed ? "transparent" : `radial-gradient(ellipse at top right, ${termDark ? "#1e1e1e" : "#f5f5f5"} 35%, transparent 70%)`,
        borderRadius: 0,
      }}>
        <button
          onClick={(e) => {
            const next = !termDark
            setTermDark(next)
            try { sessionStorage.setItem("protocanvas-term-dark", String(next)) } catch {}
            e.currentTarget.style.color = "#888"
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", color: "#888", width: 32, height: 32, alignItems: "center", justifyContent: "center",
            transition: "color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = termDark ? "#fff" : "#1c1d22")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          title={termDark ? "Light terminal" : "Dark terminal"}
        >
          {termDark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        {/* Refresh button — commented out, auto-reconnect handles it
        <button
          onClick={handleRestart}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", color: "#888", width: 32, height: 32, alignItems: "center", justifyContent: "center",
            transition: "color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = termDark ? "#fff" : "#1c1d22")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          title="Reconnect"
        >
          <RefreshCw size={13} />
        </button>
        */}
        <button
          onClick={() => {
            if (collapsed) {
              setCollapsed(false)
              setPos((p) => ({
                x: Math.min(p.x, window.innerWidth - size.w - 8),
                y: Math.min(p.y, window.innerHeight - size.h - 8),
              }))
              setTimeout(() => fitRef.current?.fit(), 100)
            } else {
              setCollapsed(true)
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", color: "#888", width: 32, height: 32, alignItems: "center", justifyContent: "center",
            marginRight: 4,
            transition: "color 150ms ease, transform 300ms cubic-bezier(0.25, 0, 0, 1)",
            transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = termDark ? "#fff" : "#1c1d22")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Exit / kicked overlay */}
      {!collapsed && (exited || kickedByTab) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            zIndex: 6,
          }}
        >
          <span style={{ color: "#e0e0e0", fontSize: 14 }}>
            {kickedByTab ? "Terminal is open in another tab" : "Process exited"}
          </span>
          <button
            onClick={handleRestart}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 20px", fontSize: 13, fontWeight: 600,
              background: "#fff", color: "#1e1e1e", border: "none",
              borderRadius: 6, cursor: "pointer",
            }}
          >
            <RotateCcw size={14} />
            {kickedByTab ? "Take Over" : "Restart"}
          </button>
        </div>
      )}
    </div>
  )
}
