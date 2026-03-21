#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, openSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRegistry, saveRegistry, upsertCanvas, resolveCanvas, stablePort, getRegistryPath } from './registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER_PATH = join(ROOT, '.protocanvas-server.mjs');
const DIST_PATH = join(ROOT, 'dist');
const LOGS_DIR = join(ROOT, 'logs');

const [,, command, ...args] = process.argv;

// ── Helpers ──

async function isRunning(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`http://localhost:${port}/api/config`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function relPath(abs) {
  const home = process.env.HOME || '/';
  if (abs.startsWith(home)) return '~' + abs.slice(home.length);
  return abs;
}

function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function countVariants(variantsDir) {
  try {
    return readdirSync(variantsDir).filter(f => f.endsWith('.tsx') || f.endsWith('.html')).length;
  } catch {
    return 0;
  }
}

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// ── Commands ──

async function cmdList() {
  const registry = loadRegistry();
  const canvases = Object.values(registry.canvases).sort((a, b) =>
    (a.component || '').localeCompare(b.component || '')
  );

  if (canvases.length === 0) {
    console.log('No canvases registered. Run: protocanvas scan <directory>');
    return;
  }

  // Check status in parallel
  const statuses = await Promise.all(canvases.map(c => isRunning(c.port)));

  // Get variant counts and modification times
  const rows = canvases.map((c, i) => {
    const varDir = c.variantsDir ? join(c.projectDir, c.variantsDir) : null;
    const count = varDir ? countVariants(varDir) : 0;
    let modified = '-';
    try {
      const st = statSync(c.stateFile);
      modified = timeAgo(st.mtime.toISOString());
    } catch { /* */ }

    return {
      idx: i + 1,
      name: c.component,
      status: statuses[i] ? '\x1b[32m●\x1b[0m running' : '\x1b[90m○\x1b[0m stopped',
      port: `:${c.port}`,
      variants: `${count}`,
      modified,
      dir: relPath(c.projectDir),
    };
  });

  // Print header
  console.log(
    `\x1b[90m${pad('#', 4)}${pad('Component', 24)}${pad('Status', 18)}${pad('Port', 8)}${pad('Vars', 6)}${pad('Modified', 12)}Dir\x1b[0m`
  );

  for (const r of rows) {
    console.log(
      `${pad(r.idx, 4)}${pad(r.name, 24)}${pad(r.status, 27)}${pad(r.port, 8)}${pad(r.variants, 6)}${pad(r.modified, 12)}${r.dir}`
    );
  }
}

async function cmdOpen(nameOrIndex) {
  if (!nameOrIndex) { console.error('Usage: protocanvas open <name|#>'); process.exit(1); }
  const canvas = resolveCanvas(nameOrIndex);
  if (!canvas) { console.error(`Canvas not found: ${nameOrIndex}`); process.exit(1); }

  const running = await isRunning(canvas.port);
  if (running) {
    console.log(`Already running: ${canvas.component} at http://localhost:${canvas.port}`);
    execSync(`open http://localhost:${canvas.port}`);
    return;
  }

  console.log(`Starting ${canvas.component}...`);

  // Ensure logs dir exists
  try { readdirSync(LOGS_DIR); } catch { execSync(`mkdir -p "${LOGS_DIR}"`); }

  const logFile = join(LOGS_DIR, `${canvas.component.replace(/[^a-zA-Z0-9-_ ]/g, '')}.log`);
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const child = spawn('node', [
    SERVER_PATH,
    canvas.projectDir,
    canvas.component,
    canvas.variantsDir || `${canvas.component}-variants`,
    DIST_PATH,
  ], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: canvas.projectDir,
  });
  child.unref();

  // Poll until ready
  const start = Date.now();
  const timeout = 15000;
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 300));
    if (await isRunning(canvas.port)) {
      console.log(`\x1b[32m●\x1b[0m ${canvas.component} running at http://localhost:${canvas.port}`);
      execSync(`open http://localhost:${canvas.port}`);
      return;
    }
  }

  console.error(`Timed out waiting for server. Check logs: ${logFile}`);
  process.exit(1);
}

async function cmdStop(nameOrIndex) {
  if (!nameOrIndex) { console.error('Usage: protocanvas stop <name|#>'); process.exit(1); }
  const canvas = resolveCanvas(nameOrIndex);
  if (!canvas) { console.error(`Canvas not found: ${nameOrIndex}`); process.exit(1); }

  try {
    const pid = execSync(`lsof -ti :${canvas.port}`, { encoding: 'utf8' }).trim();
    if (pid) {
      execSync(`kill ${pid}`);
      console.log(`Stopped ${canvas.component} (port ${canvas.port}, pid ${pid})`);
    }
  } catch {
    console.log(`${canvas.component} is not running`);
  }
}

async function cmdStopAll() {
  const registry = loadRegistry();
  const canvases = Object.values(registry.canvases);
  let stopped = 0;
  for (const c of canvases) {
    if (await isRunning(c.port)) {
      try {
        const pid = execSync(`lsof -ti :${c.port}`, { encoding: 'utf8' }).trim();
        if (pid) { execSync(`kill ${pid}`); stopped++; console.log(`Stopped ${c.component}`); }
      } catch { /* */ }
    }
  }
  if (stopped === 0) console.log('No running canvases');
}

async function cmdScan(dir) {
  dir = resolve(dir || process.cwd());
  console.log(`Scanning ${relPath(dir)} for canvases...`);

  // Find all canvas state files
  const stateFiles = [];
  function walk(d, depth = 0) {
    if (depth > 8) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.name.endsWith('-canvas-state.json')) {
          stateFiles.push(full);
        }
      }
    } catch { /* permission errors etc */ }
  }
  walk(dir);

  if (stateFiles.length === 0) {
    console.log('No canvas state files found.');
    return;
  }

  let added = 0;
  for (const sf of stateFiles) {
    try {
      const state = JSON.parse(readFileSync(sf, 'utf8'));
      const component = state.component;
      if (!component) continue;

      const projectDir = dirname(sf);
      const port = stablePort(component);

      // Infer variants directory
      let variantsDir = null;
      const nodeFiles = Object.values(state.nodes || {}).map(n => n.htmlFile).filter(Boolean);

      // Check sibling directories ending in -variants
      try {
        const siblings = readdirSync(projectDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name.includes('variant'));

        for (const sib of siblings) {
          const sibPath = join(projectDir, sib.name);
          const sibFiles = readdirSync(sibPath);
          // Check if this dir contains the variant files
          const matchCount = nodeFiles.filter(f => sibFiles.includes(f)).length;
          if (matchCount > 0 && matchCount >= nodeFiles.length * 0.5) {
            variantsDir = sib.name;
            break;
          }
        }
      } catch { /* */ }

      // Fallback: slugify component name
      if (!variantsDir) {
        variantsDir = component.toLowerCase().replace(/\s+/g, '-') + '-variants';
      }

      upsertCanvas(component, {
        component,
        projectDir,
        variantsDir,
        port,
        stateFile: sf,
      });
      added++;
      console.log(`  + ${component} (${relPath(projectDir)}, :${port})`);
    } catch (e) {
      console.error(`  ! Error reading ${basename(sf)}: ${e.message}`);
    }
  }

  console.log(`\nRegistered ${added} canvas(es). Run \`protocanvas ls\` to see them.`);
}

async function cmdResume(nameOrIndex) {
  if (!nameOrIndex) { console.error('Usage: protocanvas resume <name|#>'); process.exit(1); }
  const canvas = resolveCanvas(nameOrIndex);
  if (!canvas) { console.error(`Canvas not found: ${nameOrIndex}`); process.exit(1); }

  const sessions = canvas.sessions || [];
  if (sessions.length > 0) {
    const sid = sessions[0].sessionId;
    console.log(`Resuming session for ${canvas.component}...`);
    // Replace current process with claude
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('claude', ['--resume', sid], { stdio: 'inherit' });
    } catch {
      console.error(`Failed to resume session ${sid}. Starting fresh.`);
      execFileSync('claude', ['--name', `protocanvas: ${canvas.component}`], { stdio: 'inherit' });
    }
  } else {
    console.log(`No linked session for ${canvas.component}. Starting fresh.`);
    const { execFileSync } = await import('node:child_process');
    execFileSync('claude', ['--name', `protocanvas: ${canvas.component}`], { stdio: 'inherit' });
  }
}

async function cmdUrl(nameOrIndex) {
  if (!nameOrIndex) { console.error('Usage: protocanvas url <name|#>'); process.exit(1); }
  const canvas = resolveCanvas(nameOrIndex);
  if (!canvas) { console.error(`Canvas not found: ${nameOrIndex}`); process.exit(1); }
  console.log(`http://localhost:${canvas.port}`);
}

function cmdHelp() {
  console.log(`\x1b[1mprotocanvas\x1b[0m — manage your design canvases

\x1b[1mCommands:\x1b[0m
  ls                    List all canvases with status
  open <name|#>         Start server + open browser
  stop <name|#>         Stop a canvas server
  stop-all              Stop all running servers
  scan [dir]            Discover canvases under a directory
  resume <name|#>       Resume the linked Claude Code session
  url <name|#>          Print the canvas URL

\x1b[1mExamples:\x1b[0m
  protocanvas scan ~/SUStuff
  protocanvas ls
  protocanvas open "Chart v2"
  protocanvas open 1
  protocanvas stop 1
  protocanvas resume "Chart v2"
`);
}

// ── Main ──
switch (command) {
  case 'ls': case 'list': await cmdList(); break;
  case 'open': await cmdOpen(args[0]); break;
  case 'stop': await cmdStop(args[0]); break;
  case 'stop-all': await cmdStopAll(); break;
  case 'scan': await cmdScan(args[0]); break;
  case 'resume': await cmdResume(args[0]); break;
  case 'url': await cmdUrl(args[0]); break;
  default: cmdHelp(); break;
}
