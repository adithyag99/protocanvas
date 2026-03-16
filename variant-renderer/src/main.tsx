import { createRoot } from 'react-dom/client'
import { Shell } from './Shell'

// Read variant ID from pathname: /v19 → "v19"
// Falls back to ?id= query param for backward compat
const pathId = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '') || null
const queryId = new URLSearchParams(window.location.search).get('id')
const id = pathId || queryId

if (!id) {
  document.body.style.fontFamily = 'system-ui, sans-serif'
  document.body.style.padding = '24px'
  document.body.textContent = 'Missing ?id= parameter'
} else {
  const root = createRoot(document.getElementById('root')!)

  import(/* @vite-ignore */ `/variants/${id}.tsx`)
    .then((mod) => {
      const Component = mod.default
      if (!Component) {
        throw new Error(`Variant "${id}" does not have a default export`)
      }
      root.render(
        <Shell variantId={id}>
          <Component />
        </Shell>
      )
    })
    .catch((err) => {
      root.render(
        <Shell variantId={id}>
          <div style={{
            padding: 24,
            fontFamily: 'monospace',
            color: '#d22223',
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
              Failed to load variant "{id}"
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
              {err.message}
            </pre>
          </div>
        </Shell>
      )
    })
}
