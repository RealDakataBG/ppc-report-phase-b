/* Shared case-insensitive/trimmed client-name matcher, used by both
 * ingest-performance (matching Excel Entity names) and the to-do sync
 * (matching Sheet client names) against the same `clients` table.
 */
function normalizeClientName(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

// clients: array of {id, name, ...}. Returns the matching row or null.
function matchClientName(clients, name) {
  const norm = normalizeClientName(name);
  if (!norm) return null;
  for (let i = 0; i < clients.length; i++) {
    if (normalizeClientName(clients[i].name) === norm) return clients[i];
  }
  return null;
}

module.exports = { matchClientName, normalizeClientName };
