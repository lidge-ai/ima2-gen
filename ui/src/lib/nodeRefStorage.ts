const STORAGE_KEY = "ima2.nodeRefs.v1";

type StoredRefs = Record<string, Record<string, string[]>>;

function readAll(): StoredRefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as StoredRefs : {};
  } catch {
    return {};
  }
}

function writeAll(data: StoredRefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* best-effort: storage may be unavailable or over quota */ }
}

export function loadNodeRefs(sessionId: string | null, clientId: string): string[] {
  if (!sessionId) return [];
  const refs = readAll()[sessionId]?.[clientId];
  return Array.isArray(refs) ? refs.filter((ref) => typeof ref === "string") : [];
}

export function saveNodeRefs(sessionId: string | null, clientId: string, refs: string[]): void {
  if (!sessionId) return;
  const all = readAll();
  const sessionRefs = { ...(all[sessionId] ?? {}) };
  if (refs.length === 0) delete sessionRefs[clientId];
  else sessionRefs[clientId] = refs;
  all[sessionId] = sessionRefs;
  writeAll(all);
}

export function clearNodeRefs(sessionId: string | null, clientId: string): void {
  saveNodeRefs(sessionId, clientId, []);
}

export function pruneNodeRefs(sessionId: string | null, liveClientIds: string[]): void {
  if (!sessionId) return;
  const all = readAll();
  const sessionRefs = all[sessionId];
  if (!sessionRefs) return;
  const live = new Set(liveClientIds);
  for (const clientId of Object.keys(sessionRefs)) {
    if (!live.has(clientId)) delete sessionRefs[clientId];
  }
  all[sessionId] = sessionRefs;
  writeAll(all);
}

