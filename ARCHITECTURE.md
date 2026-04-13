# Protocanvas — Architecture

Deep internal documentation for the Protocanvas codebase. For user-facing setup and usage, see [README.md](README.md).

---

## 1. Overview

Protocanvas is a three-process system: a **Node.js canvas server** that manages state, annotations, and file watching; a **React canvas app** (built with React Flow + Zustand) served from `dist/` that renders variant cards on an infinite canvas; and a **Vite dev server** (the variant renderer) spawned as a child process to compile and hot-reload TSX variant files inside iframes. The server is the central hub — it persists state, broadcasts changes via SSE, serves HTML variants with injected scripts, and spawns the Vite renderer on demand.

---

## 2. Process Architecture

```
┌────────────────────────────────────────────────────────┐
│  Browser                                                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Canvas App (React 19 + React Flow + Zustand)   │   │
│  │  Served from dist/ by canvas server             │   │
│  │                                                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │ iframe   │  │ iframe   │  │ iframe   │ ...  │   │
│  │  │ (v1.tsx) │  │ (v2.tsx) │  │ (v3.html)│      │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘      │   │
│  │       │ postMessage  │             │             │   │
│  └───────┼──────────────┼─────────────┼─────────────┘   │
│          │              │             │                  │
└──────────┼──────────────┼─────────────┼──────────────────┘
           │              │             │
     Vite HMR      Vite HMR      SSE reload
           │              │             │
┌──────────▼──────────────▼─────┐  ┌────▼──────────────────────────┐
│  Variant Renderer (Vite)      │  │  Canvas Server (Node.js)      │
│  Port: stablePort(name+'-vite')│  │  Port: stablePort(name)       │
│  Child process of server      │  │                                │
│                               │  │  HTTP REST ◄──► Canvas App     │
│  Renders TSX variants as      │  │  SSE ──────► Canvas App        │
│  live React components        │  │  Serves dist/, HTML variants   │
│                               │  │  Manages state + annotations   │
│  Agentation toolbar inside    │  │  File watching + broadcast     │
│  each variant                 │  │  Spawns Vite renderer          │
└───────────────────────────────┘  └───────────────────────────────┘
```

**Communication channels:**
- **HTTP REST** — Canvas App ↔ Server (state CRUD, annotation CRUD, config)
- **SSE** — Server → Canvas App (`/__reload` endpoint, pushes state/variant/annotation changes)
- **postMessage** — iframe ↔ Canvas App (size reporting, keyboard forwarding, annotation CRUD, focus state)
- **Vite HMR** — Variant Renderer → iframe (instant TSX hot-reload on file edit)
- **SSE reload** — Server → HTML iframe (via injected `inject-reload.js`, triggers `location.reload()`)
- **WebSocket** — Canvas App ↔ Server (`/ws/terminal`, raw text for PTY I/O, JSON for resize)

---

## 3. Server Internals (`.protocanvas-server.mjs`)

Single-file Node.js HTTP server (~650 lines). No frameworks — raw `node:http`.

### 3.1 Startup Sequence

```
1. Parse CLI args: PROJECT_DIR, COMPONENT, VARIANTS_DIR_NAME, CANVAS_DIST
2. Derive paths: VARIANTS_DIR, STATE_FILE, ANNOTATIONS_FILE
3. Load annotations from disk (ANNOTATIONS_FILE)
4. Load state from disk (STATE_FILE) into stateCache
5. Start file watchers (state file, variants dir, dist dir)
6. Start Vite renderer if .tsx variants exist
7. Listen on stable port (kill stale process if needed)
8. Auto-register in protocanvas registry (registry.json)
```

**CLI args:**

| Arg | Default | Description |
|-----|---------|-------------|
| `argv[2]` | `.` | `PROJECT_DIR` — root directory for this canvas session |
| `argv[3]` | `test` | `COMPONENT` — component name, used for port derivation and file naming |
| `argv[4]` | `{COMPONENT}-variants` | `VARIANTS_DIR_NAME` — subdirectory name for variant files |
| `argv[5]` | `{protocanvas}/dist` | `CANVAS_DIST` — built canvas app directory |

**Derived paths:**
- `VARIANTS_DIR` = `{PROJECT_DIR}/{VARIANTS_DIR_NAME}`
- `STATE_FILE` = `{PROJECT_DIR}/{COMPONENT}-canvas-state.json`
- `ANNOTATIONS_FILE` = `{PROJECT_DIR}/{COMPONENT}-annotations.json`

### 3.2 Port Derivation

```javascript
function stablePort(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;  // Convert to 32-bit integer
  }
  return 10000 + (Math.abs(hash) % 50000);  // Range: 10000–59999
}
```

- **Canvas port**: `stablePort(COMPONENT)` — e.g., `stablePort("Chart v2")` → `37022`
- **Vite port**: `stablePort(COMPONENT + '-vite')` — always different from canvas port

**Collision handling** (`listenOnPort()`):
1. Try to bind to the derived port
2. If `EADDRINUSE`: try `lsof -ti :{port}` to find the PID, `kill -9` it, wait 500ms, retry
3. If still busy: fall back to `port + 1`

### 3.3 API Endpoints

#### `GET /__reload` — SSE Stream

Server-Sent Events endpoint. Canvas app connects on init and stays connected.

**Response headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**On connect:** sends `{ type: "connected" }`

Clients tracked in a `Set()`. Cleaned up on `req.close`.

---

#### `GET /api/config`

Returns server configuration.

**Response:**
```json
{
  "component": "Chart v2",
  "dir": "/Users/chace/SUStuff/web-app/general-tab/chart",
  "variantsDir": "chart-v2-variants",
  "port": 37022,
  "vitePort": 47293
}
```

`vitePort` is `null` if no TSX variants exist (Vite not started).

---

#### `GET /api/state`

Returns the full canvas state from in-memory cache.

**Response (with state):**
```json
{
  "component": "Chart v2",
  "sourceFile": "Chart.tsx",
  "variantWidth": 420,
  "nodes": {
    "v1": {
      "id": "v1",
      "label": "Compact",
      "parentId": null,
      "position": { "x": 0, "y": 0 },
      "htmlFile": "v1.tsx",
      "type": "tsx",
      "createdAt": "2026-03-21T..."
    }
  },
  "edges": [
    { "from": "v1", "to": "v1a", "label": "branch: wider layout" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

**Response (no state file):**
```json
{
  "component": "Chart v2",
  "nodes": {},
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

---

#### `POST /api/state` — Partial State Update

Deep-merges the request body into the existing state, writes atomically, broadcasts `state-changed` via SSE.

**Input validation:**
- Body must be a plain object (not null, not array)
- `nodes` (if present) must be a plain object
- `edges` (if present) must be an array
- `removeNodes` (if present) must be an array of strings
- `viewport` (if present) must have numeric `x`, `y`, `zoom`
- Returns `400` with specific error messages on validation failure

**Merge semantics** (see `server/deep-merge-state.mjs`):

| Key | Behavior |
|-----|----------|
| `nodes` | Shallow-merge per node ID. Existing fields preserved unless overwritten. New IDs added. |
| `edges` | **Full replacement.** Must include ALL existing edges plus new ones. |
| `viewport` | **Full replacement.** |
| `removeNodes` | Deletes listed node IDs from `nodes` dict AND removes edges referencing them. |
| Any other key | Direct assignment (pass-through). |

**Examples:**
```json
// Update just v1's position (all other v1 fields preserved)
{ "nodes": { "v1": { "position": { "x": 150, "y": 250 } } } }

// Add a new node
{ "nodes": { "v3a": { "id": "v3a", "label": "...", "parentId": "v3", ... } } }

// Remove nodes and their edges
{ "removeNodes": ["v3", "v4"] }

// Replace entire edges array
{ "edges": [{ "from": "v1", "to": "v2", "label": "branch" }] }

// Update viewport
{ "viewport": { "x": 50, "y": 100, "zoom": 1.2 } }

// Combined: remove nodes AND add new ones in one request
{ "removeNodes": ["v3"], "nodes": { "v3b": { ... } }, "edges": [...] }
```

**Response:** `{ "ok": true }` (200) or error (400/500)

**Write process:**
1. Deep-merge partial into `stateCache`
2. Serialize to JSON with 2-space indentation
3. Store serialized string as `lastWrittenContent` (for file watcher to ignore)
4. Write to `{STATE_FILE}.tmp`
5. Rename `.tmp` → `STATE_FILE` (atomic)
6. Broadcast `{ type: "state-changed" }` via SSE

---

#### `GET /api/annotations`

Returns annotations, filtered by query params.

**Query params:**

| Param | Default | Behavior |
|-------|---------|----------|
| `variantId` | (none) | Filter to specific variant |
| `status` | (excludes `applied`) | `pending` — only pending; `applied` — only applied; `all` — everything |

**Default behavior:** Excludes annotations with `status: "applied"`. This is important — Claude reads pending annotations, and applied ones are filtered out by default.

**Response:**
```json
{
  "count": 2,
  "annotations": [
    {
      "id": "anno-uuid",
      "variantId": "v2",
      "status": "pending",
      "comment": "Make button more prominent",
      "elementPath": "button.primary",
      "element": "button",
      "x": 150,
      "y": 200,
      "boundingBox": { "x": 140, "y": 190, "width": 100, "height": 36 },
      "cssClasses": ["primary"],
      "computedStyles": { "font-size": "14px", "color": "#fff" },
      "reactComponents": ["V2", "Shell"],
      "nearbyText": "Submit Order"
    }
  ]
}
```

---

#### `POST /api/annotations`

Adds a new annotation. Deduplicates by `annotation.id`.

**Request body:**
```json
{
  "variantId": "v2",
  "annotation": {
    "id": "anno-uuid",
    "comment": "Make button more prominent",
    "elementPath": "button.primary",
    ...
  }
}
```

**Behavior:**
1. Flattens: `{ variantId, ...annotation, status: "pending" }`
2. If annotation ID already exists: returns `{ ok: true, id, duplicate: true }` (no-op)
3. Otherwise: pushes to array, saves to disk (debounced 300ms), broadcasts `annotation-added`

**Response:** `{ "ok": true, "id": "anno-uuid" }` or `{ "ok": true, "id": "anno-uuid", "duplicate": true }`

---

#### `DELETE /api/annotations/:id`

Removes a specific annotation by ID. Broadcasts `annotations-resolved` with the removed annotation's `variantId`.

**Response:** `{ "ok": true }` (always 200, even if ID not found)

---

#### `DELETE /api/annotations?variantId=X`

Removes ALL annotations for a variant. Broadcasts `annotations-resolved`.

**Response:** `{ "ok": true }`

---

#### `POST /api/session`

Links a Claude Code session to this canvas in the registry.

**Request body:** `{ "sessionId": "uuid" }`

**Behavior:**
1. Loads registry from `registry.json`
2. Finds this component's entry
3. Adds session to front of `sessions[]` (deduplicates, max 10)
4. Saves registry

**Response:** `{ "ok": true }`

---

#### `GET /variants/{file}`

Serves HTML variant files from `VARIANTS_DIR` with script injection.

**Security:** Path traversal prevention — resolved path must start with `VARIANTS_DIR`.

**Processing pipeline:**
1. Read HTML file from disk
2. Strip UI chrome:
   - `.toggle-bar` div
   - `.variant-label` div
   - `.variant-rationale` paragraph
   - `.feedback-box` div
   - `.feedback-block` div
   - `padding: 80px` → `padding: 16px`
3. Inject scripts before `</body>`:
   - **Without `?embed`**: `inject-reload.js` (SSE listener) + `inject-shared.js` (tabs, size reporting)
   - **With `?embed`**: `inject-shared.js` only (no auto-reload — used in NodeDetail modal)

---

#### `GET /*` — Canvas App (SPA Fallback)

Serves built canvas app from `dist/`.

**Cache headers:**
- `.html` files: `no-cache, no-store, must-revalidate`
- Other files (JS/CSS with hashed names): `public, max-age=31536000, immutable`

**SPA fallback:** Unknown paths serve `index.html`. If `index.html` is missing during a rebuild, retries once after 300ms.

---

#### Body Size Limit

All POST endpoints enforce a **1MB** max request body. Returns `413` if exceeded.

---

#### CORS

All responses include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

`OPTIONS` requests return `204` immediately.

### 3.4 State Persistence

- **In-memory cache** (`stateCache`) is the runtime source of truth
- **Atomic writes:** serialize → write to `.tmp` file → `rename()` to final path. Prevents corruption if the process crashes mid-write.
- **Own-write detection:** Before writing, the serialized JSON string is stored in `lastWrittenContent`. The file watcher compares disk content against this to distinguish own writes from external edits. This replaced an earlier `suppressStateChangeCount` approach that was racy (macOS `fs.watch` can coalesce multiple events).
- **Load semantics:** `loadStateFromDisk()` only overwrites the cache if the parsed state has non-empty `nodes`, OR if no cache exists yet. This prevents an empty/corrupt file from wiping good state.

### 3.5 Annotation Persistence

- **In-memory array** (`annotations`) loaded from `ANNOTATIONS_FILE` on startup
- **Debounced save** (300ms): `saveAnnotations()` writes to disk via `writeFile()` (not atomic — annotations are lower-stakes than state)
- **File:** `{PROJECT_DIR}/{COMPONENT}-annotations.json`

### 3.6 File Watching

Three independent file watchers using `fs.watch()`:

| Target | Debounce | Event Type | Trigger |
|--------|----------|------------|---------|
| `STATE_FILE` | None (immediate, but filters own writes) | `state-changed` | External edit to canvas state JSON |
| `VARIANTS_DIR` (`.html`, `.tsx`) | 300ms per-file | `variant-changed` | Variant file saved. Also auto-starts Vite if new `.tsx` detected |
| `CANVAS_DIST` (`.html`) | 500ms | `app-rebuilt` | Canvas app rebuilt (Vite deletes then recreates dist/) |

**macOS note:** `fs.watch` fires multiple events per save on macOS. The per-file debounce Map (`variantTimers`) ensures each file change produces exactly one broadcast.

### 3.7 SSE Event Types

| Event | Payload | When |
|-------|---------|------|
| `connected` | `{}` | Client first connects to `/__reload` |
| `state-changed` | `{}` | After POST /api/state write, or external state file edit |
| `variant-changed` | `{ file: "v3.tsx" }` | `.tsx` or `.html` file changed in variants dir |
| `app-rebuilt` | `{}` | `dist/index.html` changed (canvas app rebuilt) |
| `annotation-added` | `{ variantId }` | After POST /api/annotations |
| `annotations-resolved` | `{ variantId }` | After DELETE /api/annotations (single or batch) |

### 3.8 Vite Renderer Spawning

The server spawns a Vite dev server as a child process to render TSX variants.

**Trigger:** `startViteRenderer()` called on startup. Also called when a new `.tsx` file appears in the variants dir and Vite isn't running.

**Spawn details:**
- Binary: `{variant-renderer}/node_modules/.bin/vite`
- Args: `--port {VITE_PORT}`
- CWD: `variant-renderer/`
- Env vars: `VARIANTS_DIR` (absolute path), `VITE_PORT`
- stdio: stdout/stderr piped and prefixed with `[vite]`

**Lifecycle:**
1. Check `hasTsxVariants()` — returns false if no `.tsx` files in variants dir
2. Kill stale process on Vite port (`lsof -ti :{port}` → `kill -9`)
3. Spawn Vite process
4. Wait up to 10s for port to respond (`waitForPort()` polls every 200ms)
5. If timeout: kill process, set `vitePort = null`

**Cleanup:** `cleanupVite()` sends `SIGTERM` to Vite process on `exit`, `SIGINT`, `SIGTERM`.

### 3.9 HTML Variant Injection

When serving HTML variants via `GET /variants/{file}`, the server injects scripts that enable:

**`inject-reload.js`** (only for non-embed iframes):
- Opens `EventSource` to `/__reload`
- On `variant-changed` matching current filename: `location.reload()`
- On SSE error: auto-reload after 2s (reconnect fallback)

**`inject-shared.js`** (all HTML variants):
- **Tab interaction:** `[data-tab]` buttons toggle `[data-panel]` visibility. Supports `data-owner` for scoped tab groups.
- **Period interaction:** `[data-period]` buttons toggle `active` class among siblings.
- **Size reporting:** `postMessage({ type: 'variant-height', height, width })` on load + `ResizeObserver` on body.

### 3.10 Registry Auto-Registration

On startup (after listening), the server calls `upsertCanvas()` from `bin/registry.mjs` to register itself in `registry.json`. This enables the CLI (`protocanvas ls`, `protocanvas open`, etc.) to discover and manage canvas sessions. Registration includes `component`, `projectDir`, `variantsDir`, `port`, `stateFile`, and `lastOpenedAt`.

---

## 4. Canvas App Internals (`src/`)

React 19 + React Flow 12 + Zustand 5 + Tailwind v4 + Base UI.

### 4.1 Component Tree

```
App
└── TooltipProvider
    └── ReactFlowProvider
        └── Canvas
            ├── Toolbar (fixed top bar — title left, controls right)
            ├── ReactFlow
            │   ├── Background (dots, #ebebeb)
            │   ├── SnapGuides (SVG overlay during drag)
            │   ├── MiniMap (optional, M key toggle)
            │   ├── VariantNode[] (custom node — card with iframe)
            │   │   ├── iframe (variant content)
            │   │   ├── Handle[] (8 handles: 4 positions × source/target)
            │   │   └── Resize handles (right, bottom, corner)
            │   └── IterationEdge[] (custom edge — bezier with tooltip)
            ├── NodeDetail (full-screen modal preview)
            ├── ContextMenu (right-click menu)
            └── SyncStatus (error toast)
```

### 4.2 Zustand Store (`store/canvasStore.ts`)

**State fields:**

| Field | Type | Description |
|-------|------|-------------|
| `config` | `AppConfig \| null` | Server config from `GET /api/config` |
| `canvasState` | `CanvasState \| null` | Full canvas state from `GET /api/state` |
| `iframeHeights` | `Record<string, number>` | Content height reported by each iframe via postMessage |
| `nodeWidths` | `Record<string, number>` | Custom widths set by user (persisted as `customWidth` in state) |
| `annotationCounts` | `Record<string, number>` | Pending annotation count per variant (fetched from server) |
| `modalVariant` | `ModalVariant \| null` | NodeDetail modal state (nodeId, label, htmlFile, type) |
| `focusMode` | `boolean` | Whether focus mode is active (chrome hidden) |
| `focusedNodeId` | `string \| null` | Which card is currently focused |
| `preFocusViewport` | `{ x, y, zoom } \| null` | Saved viewport before focus zoom (restored on exit) |
| `undoStack` | `UndoEntry[]` | Max 20 entries, currently only "remove" type |
| `loading` | `boolean` | True until `init()` completes |
| `syncError` | `string \| null` | Displayed by SyncStatus toast, auto-dismisses 5s |

**Actions:**

| Action | Debounce | Description |
|--------|----------|-------------|
| `init()` | — | Parallel fetch of `/api/config` and `/api/state`, restores `nodeWidths` from persisted `customWidth` |
| `updateNodePosition(id, x, y)` | 500ms | Updates local state immediately, debounced `syncState()` |
| `setNodeWidth(id, width)` | 500ms | Updates `nodeWidths` + `canvasState.nodes[id].customWidth`, debounced `syncState()` |
| `updateViewport(x, y, zoom)` | 1000ms | Updates local state, debounced direct POST to `/api/state` |
| `hideNode(id)` / `unhideNode(id)` | — | Immediate local + immediate POST `{ nodes: { [id]: { hidden: true/false } } }` |
| `removeNodes(ids)` | — | Pushes to undo stack, immediate POST `{ removeNodes: ids }` |
| `undo()` | — | Pops last entry, restores nodes+edges, POSTs restored state |
| `syncState()` | — | Bulk POST of all node positions + customWidths |
| `refetchState()` | — | GET `/api/state`, replaces entire `canvasState` |

**Debounce timers** (module-level, not per-instance):
- `positionSyncTimer`: 500ms — triggers `syncState()` after drag ends
- `widthSyncTimer`: 500ms — triggers `syncState()` after resize
- `viewportSyncTimer`: 1000ms — triggers viewport POST after pan/zoom

### 4.3 Focus Mode

**Enter:** Click a card → `enterFocus(nodeId)`.

**Viewport animation:**
1. Save current viewport as `preFocusViewport`
2. Calculate center position: horizontally always centered, vertically centered if card fits, else aligned to top with 64px padding
3. Animate to `zoom: 1` with 300ms duration

**Visual effects when focused:**
- Non-focused cards: `opacity: 0.35`
- Card headers, resize handles: `opacity: 0`, `pointer-events: none`
- Edges: hidden entirely (`edges={focusMode ? [] : edges}`)
- Focused iframe: `pointerEvents: 'auto'` (all others: `'none'`)
- Agentation toolbar: fades in (visible) via injected CSS in Shell

**Exit:**
- Escape (two-stage), click pane, or toolbar button
- Restores `preFocusViewport` with 300ms animation

**Two-stage Escape:**
1. First press: dispatches `Escape` KeyboardEvent into the focused iframe (closes Agentation popups). Sets `escPressedRef = true` with 500ms timeout.
2. Second press within 500ms: calls `exitFocus()`
3. Cross-origin iframes (TSX via Vite): `dispatchEvent` fails silently → `exitFocus()` immediately

**Arrow key navigation:**
- Only when `focusedNodeId` is set
- Filters to visible (non-hidden) nodes
- Calculates weighted distance: `primary_axis + secondary_axis * 0.3`
- Primary axis = direction of arrow key, secondary = cross-axis
- Only considers nodes in the positive direction of travel
- Focuses the nearest node by weighted distance

### 4.4 Snap Alignment (`lib/snap.ts`)

- **Threshold:** `SNAP_THRESHOLD = 8` pixels
- Iterates all other nodes (not just visible neighbors)
- **X-axis checks** (priority order — first match wins):
  1. Left edges aligned (`x === nx`)
  2. Right edges aligned (`x + dw === nx + nw`)
  3. Centers aligned (`x + dw/2 === nx + nw/2`)
- **Y-axis checks** (same priority):
  1. Top edges aligned
  2. Bottom edges aligned
  3. Centers aligned
- Stops checking more nodes once both axes are snapped
- Returns `{ x, y, guides }` where guides are `{ pos, axis }` for SVG overlay lines
- Guides cleared when drag ends (`change.dragging === false`)

### 4.5 Resize System (in VariantNode)

Three resize handles on each card:
- **Right edge:** width only (`col-resize` cursor)
- **Bottom edge:** height only (`row-resize` cursor)
- **Corner:** both axes (`nwse-resize` cursor)

**Zoom-aware:** Divides mouse delta by `getZoom()` so resize feels 1:1 at any zoom level.

**During drag:** A full-screen portal overlay with the matching cursor is rendered. This prevents the iframe from stealing pointer events when the mouse moves over it.

**Constraints:**
- Min width: 280px
- Min height: 100px
- Width persisted to server via `setNodeWidth()` → debounced `syncState()` (500ms)
- Height is local-only (not persisted)

### 4.6 Iframe Communication Protocol (postMessage)

**iframe → parent (Canvas App):**

| Message Type | Payload | Handler |
|-------------|---------|---------|
| `variant-height` | `{ height, width }` | `setIframeHeight()`, marks iframe as loaded |
| `variant-keydown` | `{ code, key, metaKey?, ctrlKey? }` | Re-dispatched through `handleKeyDown` |
| `variant-copy` | `{ variantId }` | `copyVariantReference(variantId)` |
| `annotation-change` | `{ variantId, delta }` | Ignored — triggers `refetchAnnotationCounts()` from server |
| `annotation-add` | `{ variantId, annotation }` | `POST /api/annotations` |
| `annotation-delete` | `{ variantId, annotationId }` | `DELETE /api/annotations/{id}` |
| `annotation-clear` | `{ variantId }` | `DELETE /api/annotations?variantId=` |

**parent (Canvas App) → iframe:**

| Message Type | Payload | Purpose |
|-------------|---------|---------|
| `variant-focus` | `{ focused: boolean }` | Show/hide Agentation toolbar |
| `clear-agentation` | `{}` | Clears `feedback-annotations-*` localStorage keys, triggers reload |

### 4.7 Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `V` | Global (not in input) | Switch to select mode |
| `H` | Global | Switch to pan mode |
| `F` | Global | Toggle focus mode |
| `M` | Global | Toggle minimap |
| `R` | Global | Reset zoom to 1x (300ms animation) |
| `Space` (hold) | Global | Temporary pan mode, `grab` cursor |
| `Escape` (1st) | Focused | Forward Escape into iframe (close Agentation popups) |
| `Escape` (2nd, <500ms) | Focused | Exit focus mode |
| `Escape` | Not focused | Close context menu |
| `Arrow keys` | Focused | Navigate to nearest card in direction (weighted distance) |
| `Cmd/Ctrl+Z` | Global | Undo (node deletions only) |
| `Cmd/Ctrl+Shift+C` | Focused | Copy variant reference to clipboard |

### 4.8 SSE Handling

Canvas App creates an `EventSource('/__reload')` on mount.

| SSE Event | Canvas App Response |
|-----------|-------------------|
| `state-changed` | `refetchState()` — pulls latest from server |
| `variant-changed` + `.html` | Increments per-variant `reloadKey` (forces iframe re-render) |
| `variant-changed` + `.tsx` | `refetchState()` (Vite HMR handles the actual component update) |
| `app-rebuilt` | `window.location.reload()` |
| `annotation-added` | `refetchAnnotationCounts()` |
| `annotations-resolved` | `refetchAnnotationCounts()` + sends `clear-agentation` postMessage to ALL iframes |

### 4.9 Tidy-Up Auto-Layout

Tree layout algorithm triggered by toolbar button:

1. **Build tree:** Group nodes by `parentId`. Nodes with no parent (or parent not in canvas) are roots.
2. **Assign depths:** Recursive depth assignment from roots.
3. **Compute max height per depth level.**
4. **Compute Y positions:** Each depth level starts after the previous level's max height + `GAP_Y` (80px).
5. **Compute subtree widths:** Recursive — max of own width vs. sum of children's subtree widths + `GAP_X` (60px) gaps.
6. **Place nodes:** Each node horizontally centered within its subtree width.
7. **Persist:** Updates all positions in store and calls `syncState()`.
8. **Fit view:** `fitView({ padding: 0.15 })` after 50ms delay.

### 4.10 Edge Routing

Dynamic source/target handle selection based on relative node positions:

```
if |dx| > |dy| * 0.8:
  horizontal: source=right/left, target=left/right (based on dx direction)
else if dy < 0:
  upward: source=top, target=bottom
else:
  downward (default): source=bottom, target=top
```

Each node has 8 handles (4 positions × source/target). Handles are hidden (invisible) unless an edge connects to them.

Edge labels: static 2.5px dot at midpoint, expanding to a pill badge with label text on hover. Strips `"branch"` prefix from label. Feedback tooltip appears below (or repositions if viewport-clamped) when hovering the label and `feedbackText` exists.

### 4.11 React Flow Configuration

```
minZoom: 0.1
maxZoom: 2
panOnDrag: [1] (middle mouse) in select mode, [0, 1] (left+middle) in pan mode
selectionOnDrag: true in select mode, false when focused
panOnScroll: true (speed: 1.5)
zoomOnScroll: false
zoomOnPinch: true (disabled when focused)
zoomOnDoubleClick: false
Background: dots, gap=20, size=1, color=#d4d4d4, bg=#ebebeb
```

---

## 5. Variant Renderer Internals (`variant-renderer/`)

Standalone Vite dev server spawned as a child process by the canvas server. Renders TSX variants as live React components inside iframes.

### 5.1 Dynamic Import (`main.tsx`)

1. Read variant ID from URL pathname: `/v19` → `"v19"`. Falls back to `?id=` query param.
2. Dynamic import: `import('/variants/${id}.tsx')` — Vite resolves `/variants` alias to the actual variants directory.
3. Reads `mod.default` — each variant must have a default export function component.
4. Wraps in `<Shell variantId={id}>` and renders.
5. On import failure: renders red error panel inside Shell (so SizeReporter still works).

### 5.2 Shell Wrapper (`Shell.tsx`)

Wraps every variant component with three layers:

**ErrorBoundary:**
- React class component with `getDerivedStateFromError`
- Catches render errors, displays red error panel with variant ID and error message
- Monospace font, `#fef2f2` background

**SizeReporter:**
- Wraps children in a `<div ref={rootRef}>`
- `ResizeObserver` on the root div reports `scrollHeight` and `scrollWidth`
- Reports to parent via `postMessage({ type: 'variant-height', height, width })`
- Reports on mount and on every resize

**AgentationVisibility:**
- Injects a `<style>` element targeting `[data-feedback-toolbar]`
- When `focused=true`: `opacity: 1`, `transform: translateY(0)`, transitions 200ms
- When `focused=false`: `opacity: 0`, `transform: translateY(8px)`, `pointer-events: none`, transitions 150ms
- Controlled by `variant-focus` postMessage from parent

**Agentation component:**
- Renders the Agentation annotation toolbar
- `onAnnotationAdd`: Deduplicates via `sentAnnotationIds` Set (ref), forwards to parent as `annotation-add` + `annotation-change`
- `onAnnotationDelete`: Forwards as `annotation-delete` + `annotation-change`
- `onAnnotationsClear`: Forwards as `annotation-clear` + `annotation-change` (with `reset: true`)

### 5.3 Key Forwarding

**Forwarded keys** (captured in `keydown`, event phase):
- Arrow keys (Up, Down, Left, Right)
- Escape
- Cmd/Ctrl+Shift+C (for copy reference)

**Suppressed in:** `TEXTAREA` and `INPUT` elements (Agentation's comment box). For Cmd+Shift+C, also suppressed if text is selected.

**How:** `e.preventDefault()`, `e.stopPropagation()`, then `postMessage({ type: 'variant-keydown', ... })` or `variant-copy` to parent.

### 5.4 postMessage Listeners

**From parent:**
- `variant-focus`: `{ focused: boolean }` → sets local `focused` state → triggers AgentationVisibility CSS update
- `clear-agentation`: Clears all localStorage keys matching `feedback-annotations-*`, then `window.location.reload()`. This removes stale annotation markers after Claude resolves them.

### 5.5 Vite Config (`vite.config.ts`)

**Required env var:** `VARIANTS_DIR` (absolute path to variants directory, set by canvas server on spawn).

**Key configuration:**

| Setting | Value | Purpose |
|---------|-------|---------|
| `resolve.alias['/variants']` | `resolvedVariantsDir` | Enables `import('/variants/v3.tsx')` to resolve to actual file |
| `resolve.alias['@number-flow/react']` | Explicit path | Prevents resolution issues with this library |
| `resolve.dedupe` | `['react', 'react-dom']` | Prevents duplicate React instances when variants import external packages |
| `cacheDir` | `node_modules/.vite-{VITE_PORT}` | Per-instance cache prevents concurrent Vite instances fighting over `_metadata.json` |
| `server.fs.allow` | `[resolvedVariantsDir, '.']` | Allows Vite to serve files from variants directory |
| `appType` | `'spa'` | SPA fallback so `/v19` serves `index.html` |
| `optimizeDeps.include` | `@number-flow/react`, etc. | Pre-bundle these deps for faster HMR |

**`serveVariantsStatic()` plugin:**
- Vite middleware that intercepts `/variants/*` requests
- Serves static assets (images, fonts, etc.) from the variants directory
- Supports: `.png`, `.jpg`, `.jpeg`, `.svg`, `.gif`, `.webp`, `.ico`, `.woff`, `.woff2`
- Cache: `public, max-age=3600`
- Path traversal prevention: resolved path must start with `resolvedVariantsDir`

---

## 6. State Schemas

### VariantNodeData

```typescript
interface VariantNodeData {
  id: string                    // Variant ID, e.g., "v1", "v3a2"
  label: string                 // Human-readable name, e.g., "Compact Layout"
  parentId: string | null       // Parent variant ID for lineage tracking
  position: { x: number; y: number }  // Canvas position
  htmlFile: string              // Filename, e.g., "v3a2.tsx" or "v3a2.html"
  createdAt: string             // ISO 8601 timestamp
  hidden?: boolean              // Filtered out on canvas (default: false)
  customWidth?: number          // User-set card width in pixels
  type?: "html" | "tsx"         // Render mode (default: "html" if omitted)
}
```

### CanvasEdge

```typescript
interface CanvasEdge {
  from: string                  // Source variant ID
  to: string                    // Target variant ID
  label: string                 // Edge label, e.g., "branch: wider layout"
  feedbackText?: string         // Feedback summary shown on hover tooltip
}
```

### CanvasState

```typescript
interface CanvasState {
  component: string             // Component name, e.g., "Chart v2"
  sourceFile: string            // Original source file the variants are based on
  variantWidth: number          // Default card width in pixels (e.g., 420)
  nodes: Record<string, VariantNodeData>  // Variant ID → node data
  edges: CanvasEdge[]           // All edges (replaced entirely on POST)
  viewport: { x: number; y: number; zoom: number }  // Saved pan/zoom state
}
```

### AppConfig

```typescript
interface AppConfig {
  component: string             // Component name
  dir: string                   // Project directory (absolute)
  variantsDir: string           // Variants subdirectory name (relative)
  port: number                  // Canvas server port
  vitePort?: number             // Vite renderer port (null if no TSX variants)
}
```

### Annotation (server-side)

```typescript
// Flattened from POST body: { variantId, ...annotation, status: 'pending' }
interface Annotation {
  id: string                    // Unique annotation ID (from Agentation)
  variantId: string             // Which variant this annotation belongs to
  status: "pending" | "applied" // Filtering: default GET excludes "applied"
  comment: string               // User's feedback comment
  elementPath: string           // CSS selector of annotated element
  element: string               // Tag name or React component name
  x: number                     // Annotation marker X position
  y: number                     // Annotation marker Y position
  boundingBox: {                // Element bounding rect
    x: number; y: number; width: number; height: number
  }
  cssClasses: string[]          // CSS classes on the element
  computedStyles: Record<string, string>  // Key computed CSS values
  reactComponents: string[]     // React component tree path (if available)
  nearbyText: string            // Surrounding text content for context
}
```

### Registry Entry

```typescript
// Stored in registry.json at protocanvas root
interface RegistryEntry {
  component: string             // Component name (also the dict key)
  projectDir: string            // Absolute path to project directory
  variantsDir: string           // Relative subdirectory name
  port: number                  // Stable port (derived from name hash)
  stateFile: string             // Absolute path to canvas state JSON
  lastOpenedAt?: string         // ISO timestamp of last server start
  sessions?: Array<{            // Linked Claude Code sessions (max 10)
    sessionId: string
    linkedAt: string            // ISO timestamp
  }>
}
```

---

## 7. Data Flow Diagrams

### 7.1 Annotation Lifecycle

```
User clicks element in focused variant iframe
  ↓
Agentation creates annotation in localStorage
  ↓
Agentation calls onAnnotationAdd(annotation)
  ↓
Shell deduplicates via sentAnnotationIds Set
  ↓
Shell posts to parent: { type: 'annotation-add', variantId, annotation }
  ↓
Canvas App receives postMessage
  ↓
Canvas App POSTs to /api/annotations { variantId, annotation }
  ↓
Server deduplicates by annotation.id
Server stores in memory + debounced save to disk (300ms)
Server broadcasts SSE: { type: 'annotation-added', variantId }
  ↓
Canvas App receives SSE → refetchAnnotationCounts()
Badge updates on the variant card
  ↓
Claude Code reads: GET /api/annotations (default: pending only)
Claude applies changes to variant TSX/HTML file
Claude DELETEs: /api/annotations/{id}
  ↓
Server removes annotation, broadcasts SSE: { type: 'annotations-resolved', variantId }
  ↓
Canvas App receives SSE → refetchAnnotationCounts()
Canvas App sends postMessage { type: 'clear-agentation' } to ALL iframes
  ↓
Each iframe clears feedback-annotations-* from localStorage, reloads
Annotation markers disappear from the UI
```

### 7.2 State Sync

```
User drags a node on the canvas
  ↓
onNodesChange → applyNodeChanges (local state update, immediate)
Snap alignment applied (8px threshold)
Snap guides rendered as SVG overlay
  ↓
Drag ends (change.dragging === false)
Snap guides cleared
  ↓
updateNodePosition(id, x, y) called
Local canvasState updated immediately
positionSyncTimer started (500ms debounce)
  ↓
500ms passes with no more drags
  ↓
syncState() → POST /api/state { nodes: { [id]: { position } } }
  ↓
Server deep-merges into stateCache
Atomic write: serialize → .tmp → rename
lastWrittenContent updated (for file watcher to ignore)
Broadcast SSE: { type: 'state-changed' }
  ↓
Other browser tabs receive SSE
  → refetchState() → GET /api/state → replace canvasState
  ↓
External tool edits the JSON file directly
  ↓
fs.watch fires 'change' event
Server reads file, compares against lastWrittenContent
Content differs → external edit detected
Server updates stateCache
Broadcast SSE: { type: 'state-changed' }
  ↓
Canvas App → refetchState()
```

### 7.3 TSX Variant Rendering

```
Canvas server starts, detects .tsx files in variants dir
  ↓
startViteRenderer() spawns Vite child process
  env: VARIANTS_DIR={absolute_path}, VITE_PORT={port}
  cwd: variant-renderer/
  ↓
Vite reads config:
  alias /variants → VARIANTS_DIR
  dedupe react, react-dom
  SPA fallback for /{variantId}
  ↓
Canvas App renders VariantNode with iframe:
  src = http://localhost:{vitePort}/{variantId}
  (e.g., http://localhost:47293/v3a)
  ↓
Vite serves index.html (SPA fallback)
  ↓
main.tsx extracts variant ID from pathname
  /v3a → "v3a"
  ↓
Dynamic import: import('/variants/v3a.tsx')
  Vite resolves alias → {VARIANTS_DIR}/v3a.tsx
  ↓
Module loaded, mod.default = V3a function component
  ↓
Rendered inside Shell:
  <ErrorBoundary>
    <SizeReporter>
      <V3a />
    </SizeReporter>
    <AgentationVisibility />
    <Agentation />
  </ErrorBoundary>
  ↓
SizeReporter measures scrollHeight/scrollWidth
Posts to parent: { type: 'variant-height', height, width }
  ↓
VariantNode receives message → setIframeHeight()
Card resizes to fit content
  ↓
User edits v3a.tsx file
  ↓
Vite HMR detects change → hot-updates the module in the iframe
Component re-renders with new code (no full reload)
SizeReporter re-measures and reports new size
```

---

## 8. CLI (`bin/`)

### 8.1 Commands

The CLI executable is `bin/protocanvas.mjs` (hashbang `#!/usr/bin/env node`).

| Command | Usage | Description |
|---------|-------|-------------|
| `ls` / `list` | `protocanvas ls` | List all registered canvases with status (running/stopped), port, variant count, last modified, directory |
| `open` | `protocanvas open <name\|#>` | Start server as detached process (logs to `logs/`), open browser. If already running, just opens. Polls up to 15s. |
| `stop` | `protocanvas stop <name\|#>` | Kill the server process on the canvas's port via `lsof` + `kill` |
| `stop-all` | `protocanvas stop-all` | Stop all running canvas servers |
| `scan` | `protocanvas scan [dir]` | Walk directory tree (max 8 levels deep), find `*-canvas-state.json` files, infer variants directory, register in registry |
| `resume` | `protocanvas resume <name\|#>` | Resume linked Claude Code session via `claude --resume <sessionId>`, or start fresh if no linked session |
| `url` | `protocanvas url <name\|#>` | Print the canvas URL to stdout |

**Canvas resolution:** All commands accept either a canvas name (case-insensitive) or a 1-based index number (from the sorted `ls` output).

### 8.2 Registry System (`bin/registry.mjs`)

**File:** `{protocanvas-root}/registry.json`

**Functions:**
- `stablePort(name)` — Same hash function as server (duplicated for standalone use)
- `getRegistryPath()` — Returns absolute path to registry.json
- `loadRegistry()` — Parse registry.json, returns `{ canvases: {} }` if missing
- `saveRegistry(registry)` — Write with 2-space JSON + trailing newline
- `upsertCanvas(component, data)` — Shallow-merge into existing entry (preserves sessions, etc.)
- `resolveCanvas(nameOrIndex, registry?)` — Resolve by 1-based index or case-insensitive name match. Canvases sorted alphabetically by component name.

### 8.3 `open` Flow

1. Resolve canvas by name or index
2. Check if already running (`GET /api/config` with 500ms timeout)
3. If running: just `open` the URL
4. If not: spawn detached `node .protocanvas-server.mjs` with stdout/stderr redirected to `logs/{component}.log`
5. Poll `isRunning(port)` every 300ms for up to 15s
6. When ready: `open` the URL

### 8.4 `scan` Flow

1. Walk directory tree from given dir (default: cwd), max 8 levels, skip `node_modules` and `.git`
2. Find files matching `*-canvas-state.json`
3. For each: parse JSON, extract `component` name
4. Infer `variantsDir` by checking sibling directories containing `variant` in the name, matching against node htmlFile values (≥50% match threshold)
5. Fallback: slugify component name + `-variants`
6. Register via `upsertCanvas()`

---

## 9. Injected Scripts (`server/`)

These scripts are injected into HTML variant files when served by `GET /variants/{file}`.

### 9.1 `inject-shared.js`

Injected into ALL HTML variants (both canvas iframes and modal embeds).

**Tab interaction:**
- Click handler on `[data-tab]` elements
- Toggles `active` class on clicked tab, removes from siblings
- Shows/hides `[data-panel]` elements matching the tab value
- Supports scoped groups via `data-owner` attribute

**Period interaction:**
- Click handler on `[data-period]` elements
- Toggles `active` class among siblings in the same parent

**Size reporting:**
- On `load`: posts `{ type: 'variant-height', height: document.body.scrollHeight, width: document.body.scrollWidth }` to parent
- `ResizeObserver` on `document.body`: re-reports on any body size change
- Cleaned up on `beforeunload`

### 9.2 `inject-reload.js`

Injected into HTML variants in the canvas (NOT in `?embed` modal mode).

- Opens `EventSource('/__reload')` to receive SSE events
- On `variant-changed` event: if `data.file` matches current page filename (extracted from `location.pathname`), calls `location.reload()`
- On SSE error: `setTimeout(() => location.reload(), 2000)` — reconnect fallback

---

## 10. Terminal System

Embeds a Claude Code (or shell) terminal directly inside the canvas browser tab via PTY + WebSocket + xterm.js.

### 10.1 Architecture

```
Browser Tab
├── React Flow Canvas (existing)
└── TerminalPanel (floating window)
    └── xterm.js ←→ WebSocket (/ws/terminal) ←→ Canvas Server ←→ node-pty ←→ claude process
```

### 10.2 Server: Terminal Manager (`server/terminal-manager.mjs`)

Manages a single PTY process and bridges it to WebSocket clients.

**Initialization:** `createTerminalManager(httpServer, { projectDir, component, claudeSessionId })`

- Creates a `WebSocketServer({ noServer: true })` — upgrade handled manually via path filter
- If `claudeSessionId` is provided, spawns `claude --resume <id>` instead of `/bin/zsh`
- Walks up from `projectDir` to find the correct CWD where the Claude session was created (sessions are project-scoped)
- Falls back to `/bin/zsh` if Claude spawn fails

**WebSocket protocol:** Raw text, following the official xterm.js pattern.
- PTY output → `ws.send(data)` (raw text)
- WebSocket input → `pty.write(data)` (raw text)
- Resize: JSON messages `{ type: "resize", cols, rows }` (detected by `startsWith('{')`)

**Reconnection:**
- On WebSocket close: 5-minute kill timer starts. PTY stays alive.
- On reconnect within window: timer cancelled, sends `Ctrl+L` to force prompt redraw
- "Last writer wins": new connection replaces old (old gets close code 4001)

**PTY exit handling:**
- Sends WebSocket close code `4002` to tell client not to auto-reconnect
- Client shows exit overlay with Restart button

**Exports:** `{ handleUpgrade, shutdown, getStatus }`

### 10.3 Server Integration (`.protocanvas-server.mjs`)

- `server.on('upgrade')` routes `/ws/terminal` to `termManager.handleUpgrade()`
- `GET /api/terminal/status` returns `{ available, active, pid, claudeSessionId }`
- Terminal manager initialized after `server.listen()` with linked session ID from registry
- `termManager.shutdown()` called on SIGINT/SIGTERM alongside Vite cleanup

### 10.4 Client: Terminal Store (`src/store/terminalStore.ts`)

Zustand store with: `isOpen`, `isFocused`, `isConnected`.

- `isOpen` persisted to `sessionStorage` (survives refresh, not across tabs)
- Auto-open: on first visit, checks `/api/terminal/status` — if a Claude session is linked, auto-opens
- `toggle()`, `open()`, `close()` manage visibility

### 10.5 Client: Terminal Panel (`src/components/TerminalPanel.tsx`)

Floating, draggable, resizable window with xterm.js.

**Window features:**
- Draggable header bar (grab to move anywhere on screen)
- 8 resize handles (4 edges + 4 corners)
- Collapse/expand (minus button → header-only pill)
- Close button (hides panel, WebSocket stays alive)
- Exit overlay with Restart button when process exits

**xterm.js lifecycle:**
- Terminal instance created once on mount (never recreated)
- Hidden via `display: none` when closed (preserves state)
- FitAddon auto-fits on container resize (ResizeObserver, debounced 100ms)
- WebSocket connects on mount, auto-reconnects on network issues

**Focus isolation:**
- `onKeyDownCapture` with `stopPropagation()` on terminal container
- Canvas shortcuts (V, H, F, backtick, arrows) don't fire when terminal is focused
- `useTerminalStore.isFocused` checked in App.tsx keyboard handler

**Keyboard shortcut:** Backtick (`` ` ``) toggles terminal open/closed (in App.tsx)

### 10.6 Dependencies

- `node-pty` (native addon, requires Xcode CLI tools on macOS) — PTY spawning
- `ws` — WebSocket server
- `@xterm/xterm` — terminal emulator
- `@xterm/addon-fit` — auto-resize to container
- `@xterm/addon-web-links` — clickable URLs

**Known issue:** `node-pty` prebuild `spawn-helper` may need execute permission: `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
