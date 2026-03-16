# Protocanvas

Prototype playground you can plug and play into production. Built with React Flow, powered by Claude Code.

Generate multiple design variants of a component as real TSX (or HTML) files, lay them out on an interactive canvas, focus on individual variants to interact with them live, and annotate specific elements with [Agentation](https://www.agentation.com/) for precise feedback that Claude Code can read and act on.

## How It Works

1. **Claude Code generates variants** — Given a component, Claude creates 5+ design alternatives as standalone TSX (or HTML) files
2. **Variants appear on the canvas** — Each variant renders in its own iframe on a React Flow canvas with smart snap alignment
3. **You explore and compare** — Click a card to focus and interact with it at 100% zoom. Arrow keys navigate between variants. Tidy-up auto-arranges into a tree layout.
4. **You annotate elements** — Click specific elements inside a variant to leave annotation markers with comments via the Agentation toolbar
5. **Claude reads and iterates** — Claude Code reads your annotations, infers whether to edit in place or branch a new variant, applies the changes, and resolves the annotations
6. **Ship it** — The winning variant's TSX is production-ready code. Copy it straight into your project.

## Features

- **Interactive canvas** — Pan, zoom, drag, snap-align, minimap, tidy-up auto-layout
- **Focus mode** — Click a card to zoom to 100% and interact with the live variant
- **Element-level annotations** — Click any element inside a variant to annotate it with feedback
- **Hot reload** — Edit a variant file and the canvas updates instantly (SSE for HTML, Vite HMR for TSX)
- **Stable ports** — Same component always gets the same port across restarts
- **Persistent annotations** — Annotations survive server restarts
- **Lineage versioning** — Variant IDs encode ancestry: `v3a2` = second child of first branch of v3
- **Undo** — Ctrl/Cmd+Z to undo node deletions
- **Resizable cards** — Drag edges or type exact dimensions
- **TSX + HTML support** — React components rendered by Vite, or plain HTML served directly
- **Keyboard shortcuts** — `V` select, `H` pan, `F` focus mode, `M` minimap, `R` reset zoom, arrow keys to navigate

## Architecture

```
┌─────────────────────────────────────────────┐
│  Canvas App (React + React Flow + Zustand)  │
│  - VariantNode cards with iframes           │
│  - Snap alignment, focus mode, undo         │
│  - SSE listener for hot reload              │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE
┌──────────────────▼──────────────────────────┐
│  Canvas Server (Node.js)                     │
│  - Serves canvas app from dist/              │
│  - Serves HTML variants with script injection│
│  - Manages canvas state (JSON persistence)   │
│  - Annotation storage (JSON persistence)     │
│  - File watching + SSE broadcast             │
│  - Stable port per component (hash-based)    │
│  - Spawns Vite renderer for TSX variants     │
└──────────────────┬──────────────────────────┘
                   │ Child process
┌──────────────────▼──────────────────────────┐
│  Variant Renderer (Vite dev server)          │
│  - Renders TSX variants as live React        │
│  - Agentation toolbar for annotations        │
│  - Size reporting to parent iframe           │
│  - Vite HMR for instant updates              │
└─────────────────────────────────────────────┘
```

## Setup

```bash
# Install dependencies
npm install

# Build the canvas app
npm run build

# Start the canvas server
node .protocanvas-server.mjs <project-dir> <component-name> <variants-dir>

# Example
node .protocanvas-server.mjs ./my-project "Dashboard Card" dashboard-card-variants
```

The server starts on a stable port derived from the component name:
```
DESIGN_CANVAS_PORT=30047
Canvas app: http://localhost:30047
```

Same component = same port every time. If TSX variants are detected, the Vite renderer starts automatically on a separate stable port.

## Usage with Claude Code

This project is designed to be used with Claude Code via the `protocanvas` skill. The skill handles:

- Generating variant files from your component
- Starting the canvas server
- Reading annotations from the canvas server
- Iterating on variants based on your feedback
- Lineage-based variant naming (v3 → v3a → v3a1)

See the skill definition for the full workflow.

## Project Structure

```
src/
├── App.tsx                    # Main canvas with React Flow
├── components/
│   ├── VariantNode.tsx        # Card with iframe, resize handles, focus mode
│   ├── NodeDetail.tsx         # Full-screen modal preview
│   ├── IterationEdge.tsx      # Bezier edges with feedback tooltips
│   ├── Toolbar.tsx            # Floating controls with bidirectional fade
│   ├── ContextMenu.tsx        # Right-click menu
│   ├── SnapGuides.tsx         # Visual alignment guides
│   └── SyncStatus.tsx         # Error notification toast
├── store/
│   └── canvasStore.ts         # Zustand state management
├── lib/
│   ├── snap.ts                # Snap alignment algorithm
│   └── utils.ts               # Tailwind class merge utility
└── types/
    └── canvas.ts              # TypeScript interfaces

server/
├── deep-merge-state.mjs       # State merge logic (tested)
├── inject-shared.js           # Scripts injected into HTML variant iframes
└── inject-reload.js           # SSE reload listener for HTML variants

variant-renderer/              # Vite dev server for TSX variants
├── src/
│   ├── main.tsx               # Dynamic variant loader
│   └── Shell.tsx              # Error boundary + size reporter + Agentation
└── vite.config.ts

tests/
├── deep-merge-state.test.ts   # State merge tests
└── snap-position.test.ts      # Snap alignment tests
```

## API

The canvas server exposes:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Server configuration (component, ports, dirs) |
| `/api/state` | GET | Current canvas state |
| `/api/state` | POST | Partial state update (deep merge) |
| `/api/annotations` | GET | All pending annotations (optionally filter by `?variantId=`) |
| `/api/annotations` | POST | Add annotation (deduplicates by ID) |
| `/api/annotations/:id` | DELETE | Remove a specific annotation |
| `/api/annotations?variantId=` | DELETE | Remove all annotations for a variant |
| `/__reload` | GET | SSE stream for hot reload events |
| `/variants/{file}` | GET | Serve HTML variant with injected scripts |

### State Update Semantics

```json
// Nodes are shallow-merged per ID (update position without resending everything)
{ "nodes": { "v1": { "position": { "x": 100, "y": 200 } } } }

// Edges are replaced entirely
{ "edges": [{ "from": "v1", "to": "v2", "label": "branch" }] }

// Remove nodes and their connected edges
{ "removeNodes": ["v3", "v4"] }

// Update viewport
{ "viewport": { "x": 0, "y": 0, "zoom": 1 } }
```

## Development

```bash
npm run dev      # Start canvas app in dev mode
npm run build    # Build for production
npm run test     # Run tests
npm run lint     # Lint with ESLint
```

## License

MIT
