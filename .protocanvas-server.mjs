import { createServer } from 'node:http';
import { readFileSync, readFile, writeFile, rename, watch, stat, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { deepMergeState } from './server/deep-merge-state.mjs';
import { createTerminalManager } from './server/terminal-manager.mjs';

// ── Args ──
const PROJECT_DIR = resolve(process.argv[2] || '.');
const COMPONENT = process.argv[3] || 'test';
const VARIANTS_DIR_NAME = process.argv[4] || `${COMPONENT}-variants`;
const CANVAS_DIST = resolve(process.argv[5] || join(import.meta.dirname, 'dist'));

const VARIANTS_DIR = join(PROJECT_DIR, VARIANTS_DIR_NAME);
const STATE_FILE = join(PROJECT_DIR, `${COMPONENT}-canvas-state.json`);
const ANNOTATIONS_FILE = join(PROJECT_DIR, `${COMPONENT}-annotations.json`);
const VARIANT_RENDERER_DIR = join(import.meta.dirname, 'variant-renderer');

// ── Stable port derivation ──
// Derive a deterministic port from a name so the same component always gets the same port.
function stablePort(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return 10000 + (Math.abs(hash) % 50000);
}

/**
 * Try to listen on the given port. If busy, try killing the existing process
 * on that port, then retry. Falls back to port+1 if still busy.
 */
function listenOnPort(srv, port) {
  return new Promise((resolve) => {
    srv.once('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        // Try to kill whatever is on this port (likely a stale instance)
        try {
          const { execSync } = await import('node:child_process');
          const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
          if (pid) {
            console.log(`Port ${port} in use by PID ${pid} — killing...`);
            execSync(`kill -9 ${pid}`);
            await new Promise(r => setTimeout(r, 500));
          }
        } catch { /* lsof or kill failed — port may have freed itself */ }

        // Retry same port
        srv.once('error', (err2) => {
          if (err2.code === 'EADDRINUSE') {
            // Fall back to port+1
            srv.listen(port + 1, () => resolve(port + 1));
          }
        });
        srv.listen(port, () => resolve(port));
      }
    });
    srv.listen(port, () => resolve(port));
  });
}

const CANVAS_PORT = stablePort(COMPONENT);
const VITE_PORT = stablePort(COMPONENT + '-vite');

// ── Vite variant renderer ──
let viteProcess = null;
let vitePort = null;

function hasTsxVariants() {
  try {
    const files = readdirSync(VARIANTS_DIR);
    return files.some(f => f.endsWith('.tsx'));
  } catch {
    return false;
  }
}

// findFreePort removed — using stablePort() for deterministic ports

async function waitForPort(port, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      if (res.ok || res.status === 404) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

/**
 * Start the Vite dev server for rendering .tsx variants.
 * Only starts if .tsx files exist in the variants directory.
 * Sets `vitePort` and `viteProcess` on success.
 * @returns {Promise<void>}
 */
async function startViteRenderer() {
  if (!hasTsxVariants()) {
    console.log('No .tsx variants found — Vite renderer not started');
    return;
  }

  const port = VITE_PORT;
  vitePort = port;

  // Kill any stale process on the Vite port
  try {
    const { execSync } = await import('node:child_process');
    const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (pid) {
      console.log(`Vite port ${port} in use by PID ${pid} — killing...`);
      execSync(`kill -9 ${pid}`);
      await new Promise(r => setTimeout(r, 500));
    }
  } catch { /* port is free */ }

  viteProcess = spawn(join(VARIANT_RENDERER_DIR, 'node_modules', '.bin', 'vite'), ['--port', String(port)], {
    cwd: VARIANT_RENDERER_DIR,
    env: {
      ...process.env,
      VARIANTS_DIR: VARIANTS_DIR,
      VITE_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  viteProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[vite] ${line}`);
  });
  viteProcess.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.error(`[vite] ${line}`);
  });
  viteProcess.on('error', (err) => {
    console.error(`[vite] failed to start: ${err.message}`);
    viteProcess = null;
    vitePort = null;
  });
  viteProcess.on('exit', (code) => {
    console.log(`[vite] exited with code ${code}`);
    viteProcess = null;
    vitePort = null;
  });

  const ready = await waitForPort(port);
  if (ready) {
    console.log(`VITE_RENDERER_PORT=${port}`);
    console.log(`Vite renderer: http://localhost:${port}`);
  } else {
    console.error('Vite renderer failed to start within 10s');
    viteProcess?.kill();
    viteProcess = null;
    vitePort = null;
  }
}

// Clean up Vite on exit
function cleanupVite() {
  if (viteProcess) {
    viteProcess.kill('SIGTERM');
    viteProcess = null;
  }
}
let termManager = null;

function cleanupAll() {
  cleanupVite();
  if (termManager) termManager.shutdown();
}
process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(); });

// ── In-memory state cache ──
let stateCache = null;

// ── Agent activity tracking ──
// Tracks which variants are being actively worked on. Ephemeral — not persisted.
// Each entry auto-expires after ACTIVITY_TTL ms of no updates.
const ACTIVITY_TTL = 8000; // 8 seconds
const agentActivity = new Map(); // variantId → { action, updatedAt, timer }

function setActivity(variantId, action) {
  const existing = agentActivity.get(variantId);
  if (existing?.timer) clearTimeout(existing.timer);

  if (action === 'idle') {
    agentActivity.delete(variantId);
    broadcast({ type: 'agent-activity', variantId, action: 'idle' });
    return;
  }

  const timer = setTimeout(() => {
    agentActivity.delete(variantId);
    broadcast({ type: 'agent-activity', variantId, action: 'idle' });
  }, ACTIVITY_TTL);

  agentActivity.set(variantId, { action, updatedAt: Date.now(), timer });
  broadcast({ type: 'agent-activity', variantId, action });
}

// ── Persistent annotation storage ──
// Annotations from Agentation are forwarded here via the canvas app.
// Claude reads these via GET /api/annotations. No dependency on agentation-mcp.
// Persisted to disk so they survive server restarts.
let annotations = [];
try {
  annotations = JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf8'));
} catch { /* file doesn't exist yet */ }

let annotationSaveTimer = null;
function saveAnnotations() {
  if (annotationSaveTimer) clearTimeout(annotationSaveTimer);
  annotationSaveTimer = setTimeout(() => {
    writeFile(ANNOTATIONS_FILE, JSON.stringify(annotations, null, 2), 'utf8', (err) => {
      if (err) console.error('Failed to save annotations:', err.message);
    });
  }, 300);
}

/**
 * Read and parse the JSON state file from disk into `stateCache`.
 * Silently ignores missing or invalid files. Only overwrites the cache
 * if the parsed state has non-empty nodes (or no cache exists yet).
 * @returns {void}
 */
function loadStateFromDisk() {
  try {
    const data = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object') {
      if (parsed.nodes && Object.keys(parsed.nodes).length > 0) {
        stateCache = parsed;
      } else if (!stateCache) {
        stateCache = parsed;
      }
    }
  } catch {
    // File doesn't exist or is invalid — keep existing cache
  }
}

loadStateFromDisk();

// ── SSE clients ──
const clients = new Set();

// Track the last content WE wrote so we can distinguish our own writes from external edits.
// The old suppressStateChangeCount approach was racy — fs.watch can coalesce multiple rapid
// file changes into a single event, causing external edits to be silently suppressed.
let lastWrittenContent = null;

/**
 * Send an SSE message to all connected clients.
 * @param {Record<string, unknown>} eventData - Data to JSON-serialize and broadcast
 * @returns {void}
 */
function broadcast(eventData) {
  const msg = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const res of clients) {
    res.write(msg);
  }
}

// ── File watching ──
try {
  watch(STATE_FILE, { persistent: true }, (eventType) => {
    if (eventType === 'change') {
      try {
        const diskContent = readFileSync(STATE_FILE, 'utf8');
        if (diskContent === lastWrittenContent) {
          // Our own write — ignore
          return;
        }
        // External edit — load it
        const parsed = JSON.parse(diskContent);
        if (parsed && typeof parsed === 'object') {
          if (parsed.nodes && Object.keys(parsed.nodes).length > 0) {
            stateCache = parsed;
          } else if (!stateCache) {
            stateCache = parsed;
          }
        }
        broadcast({ type: 'state-changed' });
      } catch { /* file read/parse error — ignore */ }
    }
  });
} catch { /* file may not exist yet */ }

// ── Auto-create node helpers ──
// Infer parent ID from variant ID scheme: v3a → v3, v3a2 → v3a, v1 → null
function inferParentId(variantId) {
  if (/^\d+$/.test(variantId.slice(1))) return null; // v1, v2, etc. — root variants
  // Strip trailing letter or number segment: v3a2b → v3a2, v3a → v3
  const match = variantId.match(/^(.+?)([a-z]\d*|\d+[a-z]*)$/);
  if (match) {
    const candidate = match[1];
    if (candidate.length >= 2) return candidate; // at least "v1"
  }
  return null;
}

// Compute position for auto-created node: below parent, or end of row for roots
// Uses both parentId field AND ID-scheme inference to count siblings correctly
function autoNodePosition(variantId, nodes) {
  const parentId = inferParentId(variantId);
  if (parentId && nodes[parentId]) {
    const parent = nodes[parentId];
    // Count siblings by BOTH parentId field and ID-scheme inference
    // (Claude sessions may not set parentId on nodes they create)
    const siblings = Object.values(nodes).filter(n => {
      if (n.id === variantId) return false; // don't count self
      return n.parentId === parentId || inferParentId(n.id) === parentId;
    });
    return {
      x: parent.position.x + siblings.length * 512,
      y: parent.position.y + 400,
    };
  }
  // Root variant — place at end of row
  const rootNodes = Object.values(nodes).filter(n => {
    if (n.id === variantId) return false;
    return !n.parentId && inferParentId(n.id) === null;
  });
  const maxX = rootNodes.length > 0
    ? Math.max(...rootNodes.map(n => n.position.x))
    : -512;
  return { x: maxX + 512, y: 0 };
}

// Watch variants directory — both .html and .tsx
// Debounced per-file: macOS fires multiple events per save
const variantTimers = new Map();
try {
  watch(VARIANTS_DIR, { persistent: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.html') || filename.endsWith('.tsx'))) {
      if (variantTimers.has(filename)) clearTimeout(variantTimers.get(filename));
      variantTimers.set(filename, setTimeout(() => {
        variantTimers.delete(filename);

        // Auto-create node if variant file is new and no node exists yet
        const variantId = filename.replace(/\.(tsx|html)$/, '');
        const ext = filename.endsWith('.tsx') ? 'tsx' : 'html';
        const nodes = stateCache?.nodes || {};
        if (!nodes[variantId]) {
          const parentId = inferParentId(variantId);
          const position = autoNodePosition(variantId, nodes);
          const newNode = {
            id: variantId,
            label: variantId,
            parentId,
            type: ext,
            position,
            htmlFile: filename,
            createdAt: new Date().toISOString(),
          };
          const partial = { nodes: { [variantId]: newNode } };
          // If there's a parent, auto-create the edge (only if no edge TO this node exists yet)
          if (parentId && nodes[parentId]) {
            const existingEdges = stateCache?.edges || [];
            const alreadyConnected = existingEdges.some(e => e.to === variantId);
            if (!alreadyConnected) {
              partial.edges = [...existingEdges, { from: parentId, to: variantId, label: 'auto' }];
            }
          }
          const merged = deepMergeState(stateCache || {}, partial);
          stateCache = merged;
          const jsonStr = JSON.stringify(merged, null, 2);
          lastWrittenContent = jsonStr;
          const tmpFile = STATE_FILE + '.tmp';
          writeFile(tmpFile, jsonStr, 'utf8', (writeErr) => {
            if (writeErr) { lastWrittenContent = null; return; }
            rename(tmpFile, STATE_FILE, (renameErr) => {
              if (renameErr) { lastWrittenContent = null; return; }
              broadcast({ type: 'state-changed' });
              console.log(`[watcher] Auto-created node for ${variantId}`);
            });
          });
        }

        // Signal agent activity — variant is being edited
        setActivity(variantId, 'editing');

        broadcast({ type: 'variant-changed', file: filename });

        // If a new .tsx file appears and Vite isn't running, start it
        if (filename.endsWith('.tsx') && !viteProcess) {
          startViteRenderer().catch(err => console.error('Failed to start Vite:', err));
        }
      }, 300));
    }
  });
} catch { /* directory may not exist yet */ }

// Watch dist directory — broadcast reload when canvas app is rebuilt
// Debounced: Vite build deletes then recreates dist/, so we wait for it to settle
let appRebuiltTimer = null;
try {
  watch(CANVAS_DIST, { persistent: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.html')) {
      if (appRebuiltTimer) clearTimeout(appRebuiltTimer);
      appRebuiltTimer = setTimeout(() => broadcast({ type: 'app-rebuilt' }), 500);
    }
  });
} catch { /* dist may not exist yet */ }

// ── Body size limit (1MB) ──
const MAX_BODY = 1024 * 1024;

/**
 * Read the full request body as a string, enforcing `MAX_BODY` size limit.
 * Responds with 413 if the body exceeds the limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {(body: string) => void} cb - Called with the raw body string on success
 * @returns {void}
 */
function readBody(req, res, cb) {
  let body = '';
  let oversize = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY) { oversize = true; req.destroy(); }
  });
  req.on('end', () => {
    if (oversize) { res.writeHead(413); res.end('Body too large'); return; }
    cb(body);
  });
}

// ── MIME types ──
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ── Scripts injected into HTML variant iframes ──

const INJECT_SHARED_SRC = readFileSync(join(import.meta.dirname, 'server', 'inject-shared.js'), 'utf8');
const INJECT_RELOAD_SRC = readFileSync(join(import.meta.dirname, 'server', 'inject-reload.js'), 'utf8');

const INJECT_SCRIPTS_FULL = `
<script>
${INJECT_RELOAD_SRC}

${INJECT_SHARED_SRC}
</script>`;

const INJECT_SCRIPTS_EMBED = `
<script>
${INJECT_SHARED_SRC}
</script>`;

// ── Server ──
const server = createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── SSE endpoint ──
  if (pathname === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ── GET /api/config ──
  if (pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      component: COMPONENT,
      dir: PROJECT_DIR,
      variantsDir: VARIANTS_DIR_NAME,
      port: server.address().port,
      vitePort: vitePort,
    }));
    return;
  }

  // ── GET /api/state ──
  if (pathname === '/api/state' && req.method === 'GET') {
    if (stateCache) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stateCache));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ component: COMPONENT, nodes: {}, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }));
    }
    return;
  }

  // ── POST /api/state ──
  if (pathname === '/api/state' && req.method === 'POST') {
    readBody(req, res, (body) => {
      let partial;
      try { partial = JSON.parse(body); } catch {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }

      // ── Input validation ──
      if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
        res.writeHead(400); res.end('Body must be a plain object'); return;
      }
      if (partial.nodes !== undefined) {
        if (partial.nodes === null || typeof partial.nodes !== 'object' || Array.isArray(partial.nodes)) {
          res.writeHead(400); res.end('"nodes" must be a plain object'); return;
        }
      }
      if (partial.edges !== undefined) {
        if (!Array.isArray(partial.edges)) {
          res.writeHead(400); res.end('"edges" must be an array'); return;
        }
      }
      if (partial.removeNodes !== undefined) {
        if (!Array.isArray(partial.removeNodes) || !partial.removeNodes.every(id => typeof id === 'string')) {
          res.writeHead(400); res.end('"removeNodes" must be an array of strings'); return;
        }
      }
      if (partial.viewport !== undefined) {
        const vp = partial.viewport;
        if (vp === null || typeof vp !== 'object' || Array.isArray(vp)
            || typeof vp.x !== 'number' || typeof vp.y !== 'number' || typeof vp.zoom !== 'number') {
          res.writeHead(400); res.end('"viewport" must have numeric x, y, and zoom'); return;
        }
      }

      const existing = stateCache || {};
      const merged = deepMergeState(existing, partial);
      stateCache = merged;

      const jsonStr = JSON.stringify(merged, null, 2);
      lastWrittenContent = jsonStr;
      const tmpFile = STATE_FILE + '.tmp';
      writeFile(tmpFile, jsonStr, 'utf8', (writeErr) => {
        if (writeErr) {
          lastWrittenContent = null;
          res.writeHead(500); res.end('Write error'); return;
        }
        rename(tmpFile, STATE_FILE, (renameErr) => {
          if (renameErr) {
            lastWrittenContent = null;
            res.writeHead(500); res.end('Write error'); return;
          }
          broadcast({ type: 'state-changed' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
      });
    });
    return;
  }

  // ── Annotations storage (persisted to disk, queryable by Claude) ──
  if (pathname === '/api/annotations' && req.method === 'GET') {
    const variantId = url.searchParams.get('variantId');
    const statusFilter = url.searchParams.get('status');
    let result = variantId
      ? annotations.filter(a => a.variantId === variantId)
      : annotations;
    // Default to pending-only for count accuracy; pass ?status=all to get everything
    if (statusFilter === 'all') {
      // return all
    } else if (statusFilter) {
      result = result.filter(a => a.status === statusFilter);
    } else {
      result = result.filter(a => a.status !== 'applied');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: result.length, annotations: result }));
    return;
  }

  if (pathname === '/api/annotations' && req.method === 'POST') {
    readBody(req, res, (body) => {
      let data;
      try { data = JSON.parse(body); } catch {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      const entry = { variantId: data.variantId, ...data.annotation, status: 'pending' };
      // Deduplicate — skip if this annotation ID already exists
      if (entry.id && annotations.some(a => a.id === entry.id)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: entry.id, duplicate: true }));
        return;
      }
      annotations.push(entry);
      saveAnnotations();
      broadcast({ type: 'annotation-added', variantId: data.variantId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: entry.id }));
    });
    return;
  }

  if (pathname.startsWith('/api/annotations/') && req.method === 'DELETE') {
    const annotationId = pathname.slice('/api/annotations/'.length);
    const idx = annotations.findIndex(a => a.id === annotationId);
    const removed = idx !== -1 ? annotations.splice(idx, 1)[0] : null;
    if (removed) {
      saveAnnotations();
      broadcast({ type: 'annotations-resolved', variantId: removed.variantId });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (pathname === '/api/annotations' && req.method === 'DELETE') {
    const variantId = url.searchParams.get('variantId');
    if (variantId) {
      let removed = false;
      for (let i = annotations.length - 1; i >= 0; i--) {
        if (annotations[i].variantId === variantId) { annotations.splice(i, 1); removed = true; }
      }
      if (removed) saveAnnotations();
      broadcast({ type: 'annotations-resolved', variantId });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // ── POST /api/session — link a Claude Code session to this canvas ──
  if (pathname === '/api/session' && req.method === 'POST') {
    readBody(req, res, async (raw) => {
      try {
        const { sessionId } = JSON.parse(raw);
        if (!sessionId) { res.writeHead(400); res.end('{"error":"sessionId required"}'); return; }
        const { loadRegistry, saveRegistry } = await import('./bin/registry.mjs');
        const registry = loadRegistry();
        const entry = registry.canvases[COMPONENT];
        if (entry) {
          if (!entry.sessions) entry.sessions = [];
          entry.sessions = entry.sessions.filter(s => s.sessionId !== sessionId);
          entry.sessions.unshift({ sessionId, linkedAt: new Date().toISOString() });
          if (entry.sessions.length > 10) entry.sessions.length = 10;
          saveRegistry(registry);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(`{"error":"${e.message}"}`);
      }
    });
    return;
  }

  // ── Agent activity ──
  // POST /api/activity — report agent activity on a variant (editing, reading)
  // GET /api/activity — get all active variants
  if (pathname === '/api/activity' && req.method === 'POST') {
    readBody(req, res, (body) => {
      let data;
      try { data = JSON.parse(body); } catch {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      const { variantId, action } = data;
      if (!variantId || !action) {
        res.writeHead(400); res.end('{"error":"variantId and action required"}'); return;
      }
      setActivity(variantId, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  if (pathname === '/api/activity' && req.method === 'GET') {
    const active = {};
    for (const [vid, entry] of agentActivity) {
      active[vid] = entry.action;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active }));
    return;
  }

  // ── POST /api/duplicate — copy variant file + create node with correct lineage ID ──
  if (pathname === '/api/duplicate' && req.method === 'POST') {
    readBody(req, res, (body) => {
      let data;
      try { data = JSON.parse(body); } catch {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      const { sourceId } = data;
      if (!sourceId || !stateCache?.nodes?.[sourceId]) {
        res.writeHead(400); res.end('{"error":"sourceId not found"}'); return;
      }
      const sourceNode = stateCache.nodes[sourceId];

      // Derive next child ID using the variant ID scheme
      const existingChildren = Object.values(stateCache.nodes).filter(n => n.parentId === sourceId);
      const sourceEndsWithNumber = /\d$/.test(sourceId);
      let nextSuffix;
      if (sourceEndsWithNumber) {
        // Children use letters: v3 → v3a, v3b, ...
        const usedLetters = existingChildren.map(c => c.id.replace(sourceId, '')).filter(s => /^[a-z]$/.test(s));
        const nextCharCode = usedLetters.length > 0
          ? Math.max(...usedLetters.map(s => s.charCodeAt(0))) + 1
          : 97; // 'a'
        nextSuffix = String.fromCharCode(nextCharCode);
      } else {
        // Children use numbers: v3a → v3a1, v3a2, ...
        const usedNumbers = existingChildren.map(c => {
          const num = c.id.replace(sourceId, '');
          return /^\d+$/.test(num) ? parseInt(num) : 0;
        }).filter(n => n > 0);
        nextSuffix = String(usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1);
      }
      const newId = sourceId + nextSuffix;
      const ext = sourceNode.htmlFile?.endsWith('.tsx') ? '.tsx' : '.html';
      const newFile = newId + ext;

      // Copy the file
      const srcPath = join(VARIANTS_DIR, sourceNode.htmlFile);
      const dstPath = join(VARIANTS_DIR, newFile);
      readFile(srcPath, 'utf8', (readErr, content) => {
        if (readErr) {
          res.writeHead(500); res.end(`{"error":"Failed to read source: ${readErr.message}"}`); return;
        }
        // Replace function name if TSX (e.g., V3 → V3a)
        let newContent = content;
        if (ext === '.tsx') {
          const oldFn = sourceId.charAt(0).toUpperCase() + sourceId.slice(1);
          const newFn = newId.charAt(0).toUpperCase() + newId.slice(1);
          newContent = content.replace(new RegExp(`function ${oldFn}\\b`), `function ${newFn}`)
            .replace(new RegExp(`export default ${oldFn}\\b`), `export default ${newFn}`);
        }
        writeFile(dstPath, newContent, 'utf8', (writeErr) => {
          if (writeErr) {
            res.writeHead(500); res.end(`{"error":"Failed to write: ${writeErr.message}"}`); return;
          }
          // Create node + edge (the file watcher will also detect it, but we do it here for instant response)
          const newNode = {
            id: newId,
            label: `${sourceNode.label} (copy)`,
            parentId: sourceId,
            type: sourceNode.type || (ext === '.tsx' ? 'tsx' : 'html'),
            position: { x: sourceNode.position.x + 480, y: sourceNode.position.y },
            htmlFile: newFile,
            createdAt: new Date().toISOString(),
          };
          const existingEdges = stateCache?.edges || [];
          const partial = {
            nodes: { [newId]: newNode },
            edges: [...existingEdges, { from: sourceId, to: newId, label: 'duplicate' }],
          };
          const merged = deepMergeState(stateCache || {}, partial);
          stateCache = merged;
          const jsonStr = JSON.stringify(merged, null, 2);
          lastWrittenContent = jsonStr;
          const tmpFile = STATE_FILE + '.tmp';
          writeFile(tmpFile, jsonStr, 'utf8', (we) => {
            if (we) { lastWrittenContent = null; res.writeHead(500); res.end('Write error'); return; }
            rename(tmpFile, STATE_FILE, (re) => {
              if (re) { lastWrittenContent = null; res.writeHead(500); res.end('Write error'); return; }
              broadcast({ type: 'state-changed' });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, newId, newFile }));
            });
          });
        });
      });
    });
    return;
  }

  // ── POST /api/clipboard/upload — save pasted image to /tmp, return path ──
  if (pathname === '/api/clipboard/upload' && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) { req.destroy(); return; } // 10MB limit
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const boundary = req.headers['content-type']?.match(/boundary=(.+)/)?.[1];
      if (!boundary) { res.writeHead(400); res.end('Missing boundary'); return; }

      // Parse multipart — find the file data
      const boundaryBuf = Buffer.from('--' + boundary);
      const parts = [];
      let start = 0;
      while (true) {
        const idx = buf.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        if (start > 0) parts.push(buf.slice(start, idx - 2)); // -2 for \r\n
        start = idx + boundaryBuf.length + 2; // skip boundary + \r\n
      }

      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headers = part.slice(0, headerEnd).toString();
        if (!headers.includes('filename=')) continue;

        const fileData = part.slice(headerEnd + 4);
        const filenameMatch = headers.match(/filename="(.+?)"/);
        const ext = filenameMatch?.[1]?.match(/\.\w+$/)?.[0] || '.png';
        const tmpDir = '/tmp/protocanvas-clipboard';
        try { mkdirSync(tmpDir, { recursive: true }); } catch {}
        const filename = `paste-${Date.now()}${ext}`;
        const filePath = join(tmpDir, filename);

        writeFile(filePath, fileData, (err) => {
          if (err) { res.writeHead(500); res.end(`{"error":"${err.message}"}`); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, filePath }));
        });
        return;
      }
      res.writeHead(400); res.end('{"error":"No file found in upload"}');
    });
    return;
  }

  // ── GET /api/terminal/status ──
  if (pathname === '/api/terminal/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(termManager ? termManager.getStatus() : { available: false }));
    return;
  }

  // ── GET /variants/{id}.html — serve HTML variants ──
  if (pathname.startsWith('/variants/') && req.method === 'GET') {
    const filename = pathname.slice('/variants/'.length);
    const filePath = resolve(VARIANTS_DIR, normalize(filename));
    if (!filePath.startsWith(VARIANTS_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const isEmbed = url.searchParams.has('embed');
    readFile(filePath, 'utf8', (err, html) => {
      if (err) { res.writeHead(404); res.end('Variant not found'); return; }

      html = html
        .replace(/<div class="toggle-bar">[\s\S]*?<\/div>\s*(?=<div|<\/|$)/m, '')
        .replace(/<div class="variant-label">[\s\S]*?<\/div>/g, '')
        .replace(/<p class="variant-rationale">[\s\S]*?<\/p>/g, '')
        .replace(/<div class="feedback-box">[\s\S]*?<\/div>/g, '')
        .replace(/<div class="feedback-block">[\s\S]*?<\/div>\s*<\/div>/g, '')
        .replace(/body\s*\{([^}]*?)padding:\s*80px[^;]*;/g, 'body {$1padding: 16px;');

      const scripts = isEmbed ? INJECT_SCRIPTS_EMBED : INJECT_SCRIPTS_FULL;
      if (html.includes('</body>')) {
        html = html.replace('</body>', scripts + '\n</body>');
      } else {
        html += scripts;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // ── Serve canvas app from dist/ ──
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const absPath = resolve(CANVAS_DIST, normalize('.' + filePath));
  if (!absPath.startsWith(CANVAS_DIST)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  stat(absPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const serveIndex = () => {
        readFile(join(CANVAS_DIST, 'index.html'), 'utf8', (fallbackErr, html) => {
          if (fallbackErr) {
            // index.html may be temporarily missing during rebuild — retry once after 300ms
            setTimeout(() => {
              readFile(join(CANVAS_DIST, 'index.html'), 'utf8', (retryErr, retryHtml) => {
                if (retryErr) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                });
                res.end(retryHtml);
              });
            }, 300);
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          });
          res.end(html);
        });
      };
      serveIndex();
      return;
    }

    readFile(absPath, (readErr, data) => {
      if (readErr) { res.writeHead(500); res.end('Read error'); return; }
      const ext = extname(absPath);
      const mime = MIME[ext] || 'application/octet-stream';
      // HTML: no cache. JS/CSS with hashed names: cache forever
      const cacheHeader = ext === '.html'
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=31536000, immutable';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cacheHeader });
      res.end(data);
    });
  });
});

// WebSocket upgrade handler — routes /ws/terminal to terminal manager
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/ws/terminal' && termManager) {
    termManager.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Start Vite renderer first (if needed), then start main server
startViteRenderer()
  .catch(err => console.error('Vite start error:', err))
  .finally(async () => {
    const port = await listenOnPort(server, CANVAS_PORT);

    // Initialize terminal manager — pass linked Claude session if one exists
    let claudeSessionId = null;
    try {
      const { loadRegistry } = await import('./bin/registry.mjs');
      const reg = loadRegistry();
      const entry = reg.canvases[COMPONENT];
      if (entry?.sessions?.length > 0) {
        claudeSessionId = entry.sessions[0].sessionId;
      }
    } catch {}
    termManager = createTerminalManager(server, {
      projectDir: PROJECT_DIR,
      component: COMPONENT,
      claudeSessionId,
      variantsDir: VARIANTS_DIR_NAME,
    });
    console.log(`DESIGN_CANVAS_PORT=${port}`);
    console.log(`Canvas app: http://localhost:${port}`);
    console.log(`Component: ${COMPONENT}`);
    console.log(`Variants: ${VARIANTS_DIR}`);
    console.log(`State: ${STATE_FILE}`);

    // Auto-register in the protocanvas registry
    try {
      const { upsertCanvas } = await import('./bin/registry.mjs');
      upsertCanvas(COMPONENT, {
        component: COMPONENT,
        projectDir: PROJECT_DIR,
        variantsDir: VARIANTS_DIR_NAME,
        port,
        stateFile: STATE_FILE,
        lastOpenedAt: new Date().toISOString(),
      });
    } catch { /* registry not set up yet, fine */ }
  });
