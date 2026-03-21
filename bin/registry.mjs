#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Stable port derivation (same as .protocanvas-server.mjs) ──
export function stablePort(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return 10000 + (Math.abs(hash) % 50000);
}

export function getRegistryPath() {
  return join(__dirname, '..', 'registry.json');
}

export function loadRegistry() {
  try {
    return JSON.parse(readFileSync(getRegistryPath(), 'utf8'));
  } catch {
    return { canvases: {} };
  }
}

export function saveRegistry(registry) {
  const p = getRegistryPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

export function upsertCanvas(component, data) {
  const registry = loadRegistry();
  registry.canvases[component] = {
    ...registry.canvases[component],
    ...data,
  };
  saveRegistry(registry);
  return registry;
}

export function resolveCanvas(nameOrIndex, registry) {
  if (!registry) registry = loadRegistry();
  const sorted = Object.values(registry.canvases).sort((a, b) =>
    (a.component || '').localeCompare(b.component || '')
  );

  // Try numeric index (1-based)
  const idx = parseInt(nameOrIndex, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sorted.length) {
    return sorted[idx - 1];
  }

  // Try exact name match (case-insensitive)
  const lower = String(nameOrIndex).toLowerCase();
  return sorted.find(c => (c.component || '').toLowerCase() === lower) || null;
}
