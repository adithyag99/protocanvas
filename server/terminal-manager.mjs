/**
 * Terminal Manager — manages a PTY process and bridges it to WebSocket clients.
 * Follows the official xterm.js pattern: raw text over WebSocket, resize via JSON.
 *
 * Usage:
 *   import { createTerminalManager } from './server/terminal-manager.mjs';
 *   const termManager = createTerminalManager(httpServer, { projectDir, component });
 *   // On shutdown: termManager.shutdown()
 */

import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Kill any existing Claude CLI processes resuming the given session ID.
 * Prevents dual-session auth token conflicts (login/logout loops).
 */
function killStaleClaudeSessions(sessionId) {
  if (!sessionId) return;
  try {
    // Find PIDs of claude processes with this exact session ID
    const out = execSync(
      `ps ax -o pid,command | grep -- '--resume ${sessionId}' | grep -v grep`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (!out) return;
    const pids = out.split('\n').map(line => parseInt(line.trim())).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[terminal] Killed stale Claude process PID ${pid} for session ${sessionId}`);
      } catch {}
    }
    // Give processes a moment to exit
    if (pids.length > 0) {
      execSync('sleep 0.5', { timeout: 2000 });
    }
  } catch {
    // grep returns exit code 1 when no matches — that's fine
  }
}

let pty;
try {
  pty = (await import('node-pty')).default;
} catch {
  pty = null;
}

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ projectDir: string, component: string, claudeSessionId?: string, variantsDir?: string }} options
 */
export function createTerminalManager(httpServer, options) {
  if (!pty) {
    console.log('node-pty not available — terminal feature disabled');
    return {
      shutdown() {},
      getStatus() { return { available: false, reason: 'node-pty not installed' }; },
      handleUpgrade(req, socket, head) { socket.destroy(); },
    };
  }

  const { projectDir, component, claudeSessionId, variantsDir } = options;

  let term = null;
  let killTimer = null;
  let isReconnect = false;
  let currentWs = null;
  let dataHandler = null;
  let writeBuf = '';
  let flushTimer = null;

  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat
  // Relaxed heartbeat — 2 minutes. Aggressive pings cause false disconnects
  // when Claude is doing heavy work (tool execution, file writes)
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 120000);

  wss.on('connection', (ws) => {
    // Only log errors, not routine connections (prevents cmux notifications)

    // Close previous connection if any (last writer wins)
    if (currentWs && currentWs !== ws && currentWs.readyState === 1) {
      currentWs.close(4001, 'Replaced by another connection');
    }
    currentWs = ws;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
      isReconnect = true;
      // console.log('[terminal] Reconnect: cancelled kill timer');
    }

    if (!term) {
      // Check for session ID in query params or use the linked session
      const url = new URL(ws._req?.url || '/', 'http://localhost');
      const requestedSession = url.searchParams.get('sessionId') || claudeSessionId;

      let cmd, args, spawnCwd = projectDir;
      if (requestedSession) {
        cmd = 'claude';
        args = ['--resume', requestedSession];
        // Claude sessions are scoped to the CWD they were created from.
        // Walk up from projectDir to find the matching session directory.
        let searchDir = resolve(projectDir);
        while (searchDir !== '/') {
          const encoded = searchDir.replace(/\//g, '-');
          const sessionPath = resolve(process.env.HOME, '.claude', 'projects', encoded, requestedSession + '.jsonl');
          if (existsSync(sessionPath)) {
            spawnCwd = searchDir;
            break;
          }
          searchDir = dirname(searchDir);
        }
        // Note: we intentionally do NOT kill other Claude processes here.
        // The user may have the same session open in cmux.
        console.log(`[terminal] Starting Claude with --resume ${requestedSession} in ${spawnCwd}`);
      } else {
        // No linked session — start a fresh Claude Code session
        cmd = 'claude';
        args = [];
        console.log(`[terminal] Starting fresh Claude session`);
      }

      try {
        term = pty.spawn(cmd, args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: spawnCwd,
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (err) {
        // If claude isn't found, fall back to shell
        console.error(`[terminal] Failed to spawn ${cmd}:`, err.message);
        term = pty.spawn('/bin/zsh', [], {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: projectDir,
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      }
      console.log(`[terminal] PTY spawned: PID ${term.pid}`);
      term.onExit(({ exitCode }) => {
        console.log(`[terminal] PTY exited: code ${exitCode}`);
        term = null;
        if (dataHandler) { dataHandler.dispose(); dataHandler = null; }
        // Close WebSocket with code 4002 to tell client not to reconnect
        if (currentWs && currentWs.readyState === 1) {
          currentWs.close(4002, `Process exited (code ${exitCode})`);
        }
      });

      // Send initial context message for fresh sessions (not resumed)
      if (!requestedSession) {
        let prompted = false;
        const readyWatcher = term.onData((chunk) => {
          // Claude Code shows ❯ when ready for input
          if (!prompted && chunk.includes('❯')) {
            prompted = true;
            readyWatcher.dispose();
            // Get the port from the server's address
            const addr = httpServer.address();
            const port = typeof addr === 'object' ? addr.port : addr;
            const variantsDirName = variantsDir || component.toLowerCase().replace(/\s+/g, '-') + '-variants';
            const msg = [
              `You are the Claude Code session for the "${component}" protocanvas canvas.`,
              `Canvas: http://localhost:${port} | Project: ${projectDir} | Variants: ${projectDir}/${variantsDirName}/`,
              `You are INSIDE the canvas — never create new canvas servers or run 'protocanvas open'.`,
              ``,
              `Read the protocanvas skill at ~/.claude/skills/protocanvas/SKILL.md and the gotchas at ~/.claude/skills/protocanvas/gotchas.md, then ask me what I'd like to design.`,
            ].join('\n');
            // Use bracketed paste mode so Claude Code treats newlines as part
            // of the message, not as separate Enter keypresses
            term.write('\x1b[200~' + msg + '\x1b[201~\r');
          }
        });
        // Safety: dispose watcher after 30s if Claude never shows prompt
        setTimeout(() => {
          if (!prompted) readyWatcher.dispose();
        }, 30000);
      }
    }

    // Dispose old handler, set up new one
    // 5ms write coalescing — buffer rapid PTY chunks into single WebSocket sends
    // to reduce xterm.js repaints. Same approach as VS Code's integrated terminal.
    if (dataHandler) dataHandler.dispose();
    dataHandler = term.onData((data) => {
      writeBuf += data;
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          if (currentWs && currentWs.readyState === 1) currentWs.send(writeBuf);
          writeBuf = '';
          flushTimer = null;
        }, 5);
      }
    });

    // WebSocket → PTY
    ws.on('message', (msg) => {
      const str = msg.toString();
      if (str.startsWith('{')) {
        try {
          const ctrl = JSON.parse(str);
          if (ctrl.type === 'resize' && term) {
            term.resize(ctrl.cols, ctrl.rows);
          }
          return;
        } catch {}
      }
      if (term) term.write(str);
    });

    ws.on('close', () => {
      // console.log('[terminal] WebSocket disconnected');
      if (currentWs === ws) currentWs = null;
      killTimer = setTimeout(() => {
        console.log('[terminal] Kill timer expired, destroying PTY');
        if (term) { term.kill(); term = null; }
        if (dataHandler) { dataHandler.dispose(); dataHandler = null; }
      }, IDLE_TIMEOUT);
    });

    ws.on('error', (err) => console.error('[terminal] WS error:', err.message));

    // Force TUI redraw on reconnect via SIGWINCH (resize trick)
    // Works for shells AND TUI apps like Claude Code (unlike Ctrl+L)
    if (isReconnect) {
      isReconnect = false;
      setTimeout(() => {
        if (term) {
          const cols = term.cols;
          const rows = term.rows;
          term.resize(cols - 1, rows);
          setTimeout(() => {
            if (term) term.resize(cols, rows);
          }, 50);
        }
      }, 200);
    }
  });

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._req = req; // Store request for query param access
      wss.emit('connection', ws, req);
    });
  }

  function shutdown() {
    clearInterval(heartbeat);
    if (killTimer) clearTimeout(killTimer);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    writeBuf = '';
    if (term) { term.kill(); term = null; }
    if (dataHandler) { dataHandler.dispose(); dataHandler = null; }
    wss.close();
    console.log('[terminal] Shutdown complete');
  }

  function getStatus() {
    return {
      available: true,
      active: !!term,
      pid: term?.pid ?? null,
      claudeSessionId: claudeSessionId ?? null,
    };
  }

  return { handleUpgrade, shutdown, getStatus };
}
