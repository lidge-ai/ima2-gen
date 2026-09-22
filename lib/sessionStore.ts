import { ulid } from "ulid";
import { getDb } from "./db.js";

function now() {
  return Date.now();
}

export function createSession({ title = "Untitled" } = {}) {
  const db = getDb();
  const id = "s_" + ulid();
  const t = now();
  db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, graph_version) VALUES (?, ?, ?, ?, 0)",
  ).run(id, title, t, t);
  return { id, title, createdAt: t, updatedAt: t, graphVersion: 0 };
}

type SessionRow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  graphVersion: number;
};
type NodeRow = { id: string; x: number; y: number; data: string };
type EdgeRow = { id: string; source: string; target: string; data: string };
type StyleSheetRow = { styleSheet: string | null; styleSheetEnabled: number | null };

export function listSessions() {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, graph_version AS graphVersion FROM sessions ORDER BY updated_at DESC",
    )
    .all() as SessionRow[];
  return rows.map((r) => ({
    ...r,
    nodeCount: (db
      .prepare("SELECT COUNT(*) AS c FROM nodes WHERE session_id = ?")
      .get(r.id) as { c: number } | undefined)?.c ?? 0,
  }));
}

export function getSession(id: string) {
  const db = getDb();
  const session = db
    .prepare(
      "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, graph_version AS graphVersion FROM sessions WHERE id = ?",
    )
    .get(id) as SessionRow | undefined;
  if (!session) return null;
  const nodes = (db
    .prepare("SELECT id, x, y, data FROM nodes WHERE session_id = ?")
    .all(id) as NodeRow[])
    .map((n) => ({ id: n.id, x: n.x, y: n.y, data: safeParse(n.data) }));
  const edges = (db
    .prepare("SELECT id, source, target, data FROM edges WHERE session_id = ? ORDER BY rowid")
    .all(id) as EdgeRow[])
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: safeParse(e.data),
    }));
  return { ...session, nodes, edges };
}

export function getSessionTitleMap(ids: string[] = []) {
  const cleanIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (cleanIds.length === 0) return new Map<string, string>();
  const placeholders = cleanIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(`SELECT id, title FROM sessions WHERE id IN (${placeholders})`)
    .all(...cleanIds) as Array<{ id: string; title: string }>;
  return new Map(rows.map((row) => [row.id, row.title]));
}

export function renameSession(id: string, title: string) {
  const db = getDb();
  const res = db
    .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, now(), id);
  return res.changes > 0;
}

export function deleteSession(id: string) {
  const db = getDb();
  const res = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return res.changes > 0;
}

const MAX_STR = 10_000;

function cleanStr(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
}

function cleanData(v: unknown): string {
  try {
    const json = JSON.stringify(v ?? {});
    return json.length > MAX_STR * 10 ? "{}" : json;
  } catch {
    return "{}";
  }
}

interface NodeInput {
  id?: unknown;
  x?: unknown;
  y?: unknown;
  data?: unknown;
  position?: { x?: unknown; y?: unknown };
  [k: string]: unknown;
}
interface EdgeInput {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  data?: unknown;
  [k: string]: unknown;
}
type GraphErr = Error & { code?: string; status?: number; currentVersion?: number };

function normalizeGraphPayload(nodes: NodeInput[], edges: EdgeInput[]) {
  const nodeIds = new Set(nodes.map((n) => n?.id).filter(Boolean).map(String));
  const cleanEdges = edges.filter(
    (e) => e?.id && e?.source && e?.target && nodeIds.has(String(e.source)) && nodeIds.has(String(e.target)),
  );
  const nodeDataById = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    if (!node?.id) continue;
    const data = node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? { ...(node.data as Record<string, unknown>) }
      : {};
    nodeDataById.set(String(node.id), data);
  }
  // Nhieu cha: ke thua that ra chi la lay ANH cua cha lam tham chieu, nen mot
  // node nhan duoc nhieu cha. Canh DAU TIEN la anh goc dem di sua; cac canh sau
  // duoc noi them vao danh sach tham chieu (extraParentServerNodeIds).
  // Thu tu lay theo thu tu canh do client gui len, nen keo canh truoc thi lam goc.
  const incomingByTarget = new Map<string, EdgeInput[]>();
  for (const edge of cleanEdges) {
    if (nodeDataById.get(String(edge.source))?.nodeType === "element-reference") continue;
    const target = String(edge.target);
    const list = incomingByTarget.get(target);
    if (list) list.push(edge);
    else incomingByTarget.set(target, [edge]);
  }

  const normalizedNodes = nodes.map((node) => {
    if (!node?.id) return node;
    const id = String(node.id);
    const data: Record<string, unknown> = { ...(nodeDataById.get(id) ?? {}) };
    const incoming = incomingByTarget.get(id);
    if (!incoming || incoming.length === 0) {
      data.parentServerNodeId = null;
      data.extraParentServerNodeIds = [];
    } else {
      const serverIdOf = (edge: EdgeInput | undefined) => {
        if (!edge) return null;
        const parentData = nodeDataById.get(String(edge.source)) ?? {};
        return typeof parentData.serverNodeId === "string" ? parentData.serverNodeId : null;
      };
      data.parentServerNodeId = serverIdOf(incoming[0]);
      // Cha phu: bo qua cai chua sinh (serverNodeId rong) va cai trung voi cha chinh.
      const seen = new Set<string>([String(data.parentServerNodeId ?? "")]);
      const extras: string[] = [];
      for (const edge of incoming.slice(1)) {
        const sid = serverIdOf(edge);
        if (!sid || seen.has(sid)) continue;
        seen.add(sid);
        extras.push(sid);
      }
      data.extraParentServerNodeIds = extras;
    }
    return { ...node, data };
  });

  return { nodes: normalizedNodes, edges: cleanEdges };
}

interface SaveGraphOptions {
  nodes?: NodeInput[];
  edges?: EdgeInput[];
  expectedVersion?: number | null;
}

export function saveGraph(sessionId: string, { nodes = [], edges = [], expectedVersion = null }: SaveGraphOptions = {}) {
  const db = getDb();
  const sessionExists = db
    .prepare("SELECT 1 FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!sessionExists) {
    const err = new Error(`Session not found: ${sessionId}`) as GraphErr;
    err.code = "SESSION_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const versionRow = db
    .prepare("SELECT graph_version AS graphVersion FROM sessions WHERE id = ?")
    .get(sessionId) as { graphVersion?: number } | undefined;
  const currentVersion = versionRow?.graphVersion ?? 0;
  if (
    typeof expectedVersion === "number" &&
    Number.isFinite(expectedVersion) &&
    expectedVersion !== currentVersion
  ) {
    const err = new Error(
      `Graph version conflict for session ${sessionId}: expected ${expectedVersion}, got ${currentVersion}`,
    ) as GraphErr;
    err.code = "GRAPH_VERSION_CONFLICT";
    err.status = 409;
    err.currentVersion = currentVersion;
    throw err;
  }

  const normalized = normalizeGraphPayload(nodes, edges);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM nodes WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM edges WHERE session_id = ?").run(sessionId);

    const insNode = db.prepare(
      "INSERT INTO nodes (session_id, id, x, y, data) VALUES (?, ?, ?, ?, ?)",
    );
    for (const n of normalized.nodes) {
      if (!n?.id) continue;
      const pos = (n.position ?? {}) as { x?: unknown; y?: unknown };
      const x = Number((n.x ?? pos.x ?? 0) as number);
      const y = Number((n.y ?? pos.y ?? 0) as number);
      insNode.run(
        sessionId,
        cleanStr(String(n.id)),
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0,
        cleanData(n.data),
      );
    }

    const insEdge = db.prepare(
      "INSERT INTO edges (session_id, id, source, target, data) VALUES (?, ?, ?, ?, ?)",
    );
    for (const e of normalized.edges) {
      insEdge.run(
        sessionId,
        cleanStr(String(e.id)),
        cleanStr(String(e.source)),
        cleanStr(String(e.target)),
        cleanData(e.data),
      );
    }

    db.prepare("UPDATE sessions SET updated_at = ?, graph_version = graph_version + 1 WHERE id = ?").run(
      now(),
      sessionId,
    );

    return (db
      .prepare("SELECT graph_version AS graphVersion FROM sessions WHERE id = ?")
      .get(sessionId) as { graphVersion: number }).graphVersion;
  });

  const nextVersion = tx();
  return { ok: true, graphVersion: nextVersion };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function ensureDefaultSession() {
  const sessions = listSessions();
  if (sessions.length > 0) return sessions[0];
  return createSession({ title: "My first graph" });
}

// ── Style sheet (0.10) ───────────────────────────────────────────────────
export function getStyleSheet(sessionId: string) {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT style_sheet AS styleSheet, style_sheet_enabled AS styleSheetEnabled FROM sessions WHERE id = ?",
    )
    .get(sessionId) as StyleSheetRow | undefined;
  if (!row) return null;
  let parsed = null;
  if (row.styleSheet) {
    try {
      parsed = JSON.parse(row.styleSheet);
    } catch {
      parsed = null;
    }
  }
  return { styleSheet: parsed, enabled: !!row.styleSheetEnabled };
}

export function setStyleSheet(sessionId: string, sheet: unknown) {
  const db = getDb();
  const json = sheet == null ? null : JSON.stringify(sheet);
  const res = db
    .prepare("UPDATE sessions SET style_sheet = ?, updated_at = ? WHERE id = ?")
    .run(json, now(), sessionId);
  return res.changes > 0;
}

export function setStyleSheetEnabled(sessionId: string, enabled: boolean) {
  const db = getDb();
  const res = db
    .prepare(
      "UPDATE sessions SET style_sheet_enabled = ?, updated_at = ? WHERE id = ?",
    )
    .run(enabled ? 1 : 0, now(), sessionId);
  return res.changes > 0;
}
