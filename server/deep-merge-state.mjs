/**
 * Deep-merge a partial state update into the existing canvas state.
 * Handles special keys: `nodes` (shallow-merge per node), `edges` (replace),
 * `viewport` (replace), and `removeNodes` (delete listed node IDs and their edges).
 * @param {Record<string, unknown>} existing - The current full state object
 * @param {Record<string, unknown>} partial - The partial update to apply
 * @returns {Record<string, unknown>} A new merged state object
 */
export function deepMergeState(existing, partial) {
  const result = { ...existing };

  for (const key of Object.keys(partial)) {
    if (key === 'removeNodes' && Array.isArray(partial.removeNodes)) {
      result.nodes = { ...(result.nodes || existing.nodes || {}) };
      for (const id of partial.removeNodes) {
        delete result.nodes[id];
      }
      if (result.edges) {
        result.edges = result.edges.filter(e => !partial.removeNodes.includes(e.from) && !partial.removeNodes.includes(e.to));
      }
    } else if (key === 'nodes' && typeof partial.nodes === 'object') {
      result.nodes = { ...(existing.nodes || {}) };
      for (const [id, nodeUpdate] of Object.entries(partial.nodes)) {
        if (result.nodes[id]) {
          result.nodes[id] = { ...result.nodes[id], ...nodeUpdate };
        } else {
          result.nodes[id] = nodeUpdate;
        }
      }
    } else if (key === 'edges') {
      result.edges = partial.edges;
    } else if (key === 'viewport') {
      result.viewport = partial.viewport;
    } else {
      result[key] = partial[key];
    }
  }

  return result;
}
