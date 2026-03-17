import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Agentation } from 'agentation'

interface ShellProps {
  variantId: string
  children: ReactNode
}

// Error boundary to catch render errors in variant components
class ErrorBoundary extends Component<
  { variantId: string; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { variantId: string; children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24,
          fontFamily: 'monospace',
          color: '#d22223',
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
            Render error in variant "{this.props.variantId}"
          </h3>
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#fef2f2',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #fecaca',
          }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Size reporter — tells parent canvas about content dimensions
function SizeReporter({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    function reportSize() {
      if (!el) return
      const height = el.scrollHeight
      const width = el.scrollWidth
      window.parent.postMessage(
        { type: 'variant-height', height, width },
        '*'
      )
    }

    reportSize()

    const observer = new ResizeObserver(reportSize)
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return <div ref={rootRef}>{children}</div>
}

// Inject a global style to hide/show Agentation toolbar based on focus
function AgentationVisibility({ visible }: { visible: boolean }) {
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-agentation-visibility', '')
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  useEffect(() => {
    const style = document.querySelector('style[data-agentation-visibility]')
    if (style) {
      style.textContent = visible
        ? `[data-feedback-toolbar] {
            opacity: 1 !important;
            transform: translateY(0) !important;
            transition: opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1), transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1) !important;
          }`
        : `[data-feedback-toolbar] {
            opacity: 0 !important;
            transform: translateY(8px) !important;
            pointer-events: none !important;
            transition: opacity 150ms cubic-bezier(0.165, 0.84, 0.44, 1), transform 150ms cubic-bezier(0.165, 0.84, 0.44, 1) !important;
          }`
    }
  }, [visible])

  return null
}


export function Shell({ variantId, children }: ShellProps) {
  const [focused, setFocused] = useState(false)
  // Track annotations we've already sent to the parent this session
  const sentAnnotationIds = useRef(new Set<string>())

  // Forward navigation keys to parent canvas (iframe captures them otherwise)
  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Escape') {
        // Don't forward if user is typing in Agentation's textarea
        const tag = document.activeElement?.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        e.preventDefault()
        e.stopPropagation()
        window.parent.postMessage({ type: 'variant-keydown', code: e.code, key: e.key }, '*')
      }
    }
    // Forward Cmd+Shift+C to parent for variant reference copy
    const cmdCHandler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'c' || !e.shiftKey) return
      if (window.getSelection()?.toString()) return
      const tag = document.activeElement?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      e.preventDefault()
      e.stopPropagation()
      window.parent.postMessage({ type: 'variant-copy', variantId }, '*')
    }
    document.addEventListener('keydown', keyHandler, true)
    document.addEventListener('keydown', cmdCHandler, true)
    return () => {
      document.removeEventListener('keydown', keyHandler, true)
      document.removeEventListener('keydown', cmdCHandler, true)
    }
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'variant-focus') {
        setFocused(e.data.focused)
      }
      if (e.data?.type === 'clear-agentation') {
        // Remove Agentation localStorage entries, then reload so the UI clears
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i)
          if (key?.startsWith('feedback-annotations-')) {
            localStorage.removeItem(key)
          }
        }
        window.location.reload()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <ErrorBoundary variantId={variantId}>
      <SizeReporter>
        {children}
      </SizeReporter>
      <AgentationVisibility visible={focused} />
      <Agentation
        onAnnotationAdd={(annotation) => {
          if (sentAnnotationIds.current.has(annotation.id)) return
          sentAnnotationIds.current.add(annotation.id)
          window.parent.postMessage({ type: 'annotation-change', variantId, delta: 1 }, '*')
          window.parent.postMessage({ type: 'annotation-add', variantId, annotation }, '*')
        }}
        onAnnotationDelete={(annotation) => {
          window.parent.postMessage({ type: 'annotation-change', variantId, delta: -1 }, '*')
          window.parent.postMessage({ type: 'annotation-delete', variantId, annotationId: annotation.id }, '*')
        }}
        onAnnotationsClear={() => {
          window.parent.postMessage({ type: 'annotation-change', variantId, delta: 0, reset: true }, '*')
          window.parent.postMessage({ type: 'annotation-clear', variantId }, '*')
        }}
      />
    </ErrorBoundary>
  )
}
