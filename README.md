# Protocanvas

**Prototype playground you can plug and play into production.**

Protocanvas is an iterative UI design tool where you design with real code, not mockups. Generate multiple design variants of a component as real TSX files, lay them out on an interactive canvas, compare them side-by-side, annotate specific elements with feedback, and let [Claude Code](https://docs.anthropic.com/en/docs/claude-code) iterate on them — all without leaving your terminal. The output is production-ready code you can ship directly.

Built with [React Flow](https://reactflow.dev/), annotations powered by [Agentation](https://www.agentation.com/).

## How It Works

1. **Claude Code generates variants** — Given a component, Claude creates 5+ design alternatives as standalone TSX (or HTML) files
2. **Variants appear on the canvas** — Each variant renders in its own iframe on a React Flow canvas with smart snap alignment
3. **You explore and compare** — Click a card to focus and interact with it at 100% zoom. Arrow keys navigate between variants.
4. **You annotate elements** — In focus mode, click specific elements inside a variant to leave annotation markers with comments via the [Agentation](https://github.com/anthropics/agentation) toolbar
5. **Claude reads and iterates** — Claude Code reads your annotations, infers whether to edit in place or branch a new variant, applies the changes, and resolves the annotations
6. **Ship it** — The winning variant's TSX is production-ready code. Copy it straight into your project.

## Features

- **Interactive canvas** — Pan, zoom, drag, snap-align, minimap, tidy-up auto-layout
- **Focus mode** — Click a card to zoom to 100% and interact with the live variant. All UI chrome hides — just the variant and a focus toggle.
- **Element-level annotations** — Powered by [Agentation](https://www.agentation.com/). Click any element inside a focused variant to annotate it with feedback. Annotations are stored on the canvas server as the single source of truth.
- **Hot reload** — Edit a variant file and the canvas updates instantly (SSE for HTML, Vite HMR for TSX)
- **Stable ports** — Same component always gets the same port across restarts. No more broken URLs.
- **Persistent annotations** — Annotations survive server restarts (saved to `{component}-annotations.json`)
- **Lineage versioning** — Variant IDs encode ancestry: `v3a2` = second child of first branch of v3
- **Undo** — Ctrl/Cmd+Z to undo node deletions
- **Resizable cards** — Drag edges or type exact width/height dimensions in the card header
- **TSX + HTML support** — React components rendered by Vite, or plain HTML served directly
- **Keyboard shortcuts** — `V` select, `H` pan, `F` focus mode, `M` minimap, `R` reset zoom, arrow keys to navigate

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (for the full variant generation + iteration workflow)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/adithyag99/protocanvas.git
cd protocanvas

# Install canvas app dependencies
npm install

# Install variant renderer dependencies
cd variant-renderer && npm install && cd ..
```

### 2. Build the canvas app

```bash
npm run build
```

### 3. Start the canvas server

```bash
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

### 4. Open the canvas

Navigate to `http://localhost:{port}` in your browser. The canvas is now live.

## Agentation (Annotations)

[Agentation](https://www.agentation.com/) provides the element-level annotation toolbar inside each variant iframe. When you focus a card and click an element, Agentation lets you leave a comment pinned to that exact element.

- **No external server needed** — Agentation runs in localStorage-only mode. No agentation-mcp server required.
- **Canvas server is the source of truth** — Annotations are forwarded from the iframe to the canvas server via `POST /api/annotations` and persisted to disk.
- **Claude reads from the canvas server** — `GET /api/annotations` returns all pending annotations for Claude to process.
- Agentation is installed as an npm dependency in the variant renderer (`variant-renderer/package.json`).

## Usage with Claude Code

Protocanvas is designed to be used with Claude Code via the `protocanvas` skill. The skill automates the full workflow:

- Generating variant files from your component
- Starting the canvas server
- Reading annotations from the canvas server
- Iterating on variants based on your feedback
- Lineage-based variant naming (v3 → v3a → v3a1)

The skill is not yet bundled in the repo (paths are still hardcoded). See [IDEAS.md](IDEAS.md) for the portability plan.

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

## Project Structure

```
src/                               # Canvas app (React)
├── App.tsx                        # Main canvas with React Flow
├── components/
│   ├── VariantNode.tsx            # Card with iframe, resize handles, focus mode
│   ├── NodeDetail.tsx             # Full-screen modal preview
│   ├── IterationEdge.tsx          # Bezier edges with feedback tooltips
│   ├── Toolbar.tsx                # Floating controls with bidirectional fade
│   ├── ContextMenu.tsx            # Right-click menu
│   ├── SnapGuides.tsx             # Visual alignment guides
│   └── SyncStatus.tsx             # Error notification toast
├── store/
│   └── canvasStore.ts             # Zustand state management
├── lib/
│   ├── snap.ts                    # Snap alignment algorithm
│   └── utils.ts                   # Tailwind class merge utility
└── types/
    └── canvas.ts                  # TypeScript interfaces

server/                            # Canvas server utilities
├── deep-merge-state.mjs           # State merge logic (tested)
├── inject-shared.js               # Scripts injected into HTML variant iframes
└── inject-reload.js               # SSE reload listener for HTML variants

variant-renderer/                  # Vite dev server for TSX variants
├── src/
│   ├── main.tsx                   # Dynamic variant loader
│   └── Shell.tsx                  # Error boundary + size reporter + Agentation
└── vite.config.ts

tests/
├── deep-merge-state.test.ts       # State merge tests
└── snap-position.test.ts          # Snap alignment tests
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
