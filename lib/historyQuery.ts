/**
 * What GET /api/history is asked for and how the rows are chosen: filters, period, order, the page cut,
 * the count after filters, and the per-model counts. Every parameter is optional; with none of the newer
 * ones the answer is the newest-first page the endpoint always gave.
 */
import { getDb } from "./db.js";
import type { HistoryIndexRow } from "./historyIndex.js";

const MEDIA_TYPES = ["image", "video", "audio"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

export interface HistoryQuery {
  limit: number;
  order: "desc" | "asc";
  /** Cursor of a newest-first page: rows older than this one. */
  beforeTs: number;
  beforeFn: string | null;
  /** Cursor of an oldest-first page: rows newer than this one. */
  afterTs: number;
  afterFn: string | null;
  /** Period: created after since, and at or before until. */
  sinceTs: number;
  untilTs: number;
  sessionId: string | null;
  requestId: string | null;
  favoritesOnly: boolean;
  /** Audio rows are opt-in: the classic UI renders every non-video row as an image. */
  includeAudio: boolean;
  q: string | null;
  mediaTypes: readonly MediaType[] | null;
  model: string | null;
  workflow: string | null;
  folderId: string | null;
  facetModel: boolean;
}

export class HistoryQueryError extends Error {}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const int = (value: unknown): number => parseInt(typeof value === "string" ? value : "");
const flag = (value: unknown): boolean => value === "1" || value === "true";

function mediaTypesOf(value: unknown): readonly MediaType[] | null {
  const raw = str(value);
  if (!raw) return null;
  const asked = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const unknown = asked.find((part) => !(MEDIA_TYPES as readonly string[]).includes(part));
  if (unknown !== undefined) throw new HistoryQueryError("mediaType must be image, video or audio (comma separated); got " + unknown);
  return asked as MediaType[];
}

export function parseHistoryQuery(query: Record<string, unknown>, limits: { defaultPageSize: number; maxPageCap: number }): HistoryQuery {
  const limitRaw = int(query.limit);
  const order = str(query.order) ?? "desc";
  if (order !== "desc" && order !== "asc") throw new HistoryQueryError("order must be desc or asc; got " + order);
  const mediaTypes = mediaTypesOf(query.mediaType);
  return {
    limit: Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : limits.defaultPageSize, limits.maxPageCap),
    order,
    beforeTs: int(query.before), beforeFn: str(query.beforeFilename),
    afterTs: int(query.after), afterFn: str(query.afterFilename),
    sinceTs: int(query.since), untilTs: int(query.until),
    sessionId: str(query.sessionId), requestId: str(query.requestId),
    favoritesOnly: flag(query.favoritesOnly),
    includeAudio: flag(query.includeAudio) || (mediaTypes?.includes("audio") ?? false),
    q: str(query.q)?.trim().toLowerCase() || null,
    mediaTypes,
    model: str(query.model), workflow: str(query.workflow), folderId: str(query.folderId),
    facetModel: str(query.facets)?.split(",").includes("model") ?? false,
  };
}

/** The folder each filed result is in, by its path in the generated storage. The latest filing wins. */
export function folderByFilePath(): Map<string, string> {
  const rows = getDb()
    .prepare("SELECT file_path AS filePath, folder_id AS folderId FROM assets WHERE file_path IS NOT NULL AND folder_id IS NOT NULL ORDER BY updated_at ASC, id ASC")
    .all() as Array<{ filePath: string; folderId: string }>;
  return new Map(rows.map((row) => [row.filePath, row.folderId]));
}

type Scope = { favoriteSet: Set<string>; folders: Map<string, string> };

function searched(row: HistoryIndexRow, q: string): boolean {
  return [row.prompt, row.userPrompt, row.model, row.filename].some((text) => typeof text === "string" && text.toLowerCase().includes(q));
}

/** Every filter except the page cursor. skipModel leaves the model filter out, for the model counts. */
function matches(row: HistoryIndexRow, query: HistoryQuery, scope: Scope, skipModel = false): boolean {
  if (!query.includeAudio && row.mediaType === "audio") return false;
  if (query.mediaTypes && !(query.mediaTypes as readonly string[]).includes(row.mediaType)) return false;
  if (Number.isFinite(query.sinceTs) && row.createdAt <= query.sinceTs) return false;
  if (Number.isFinite(query.untilTs) && row.createdAt > query.untilTs) return false;
  if (query.sessionId && row.sessionId !== query.sessionId) return false;
  if (query.requestId && row.requestId !== query.requestId) return false;
  if (query.favoritesOnly && !scope.favoriteSet.has(row.filename)) return false;
  if (!skipModel && query.model && row.model !== query.model) return false;
  if (query.workflow && row.workflow !== query.workflow) return false;
  if (query.folderId && scope.folders.get(row.filename) !== query.folderId) return false;
  if (query.q && !searched(row, query.q)) return false;
  return true;
}

function pastCursor(row: HistoryIndexRow, query: HistoryQuery): boolean {
  if (query.order === "asc") {
    if (!Number.isFinite(query.afterTs)) return true;
    if (row.createdAt !== query.afterTs) return row.createdAt > query.afterTs;
    return Boolean(query.afterFn) && row.filename > query.afterFn!;
  }
  if (!Number.isFinite(query.beforeTs)) return true;
  if (row.createdAt !== query.beforeTs) return row.createdAt < query.beforeTs;
  return Boolean(query.beforeFn) && row.filename < query.beforeFn!;
}

function modelCounts(rows: readonly HistoryIndexRow[], query: HistoryQuery, scope: Scope) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.model !== "string" || !row.model || !matches(row, query, scope, true)) continue;
    counts.set(row.model, (counts.get(row.model) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
}

/** rows are newest first (lib/historyList.ts). Returns one page in the asked order with its cursor and counts. */
export function selectHistoryPage(rows: readonly HistoryIndexRow[], query: HistoryQuery, scope: Scope) {
  const matched = rows.filter((row) => matches(row, query, scope));
  const ordered = query.order === "asc" ? [...matched].reverse() : matched;
  const selected = ordered.filter((row) => pastCursor(row, query)).slice(0, query.limit + 1);
  const page = selected.slice(0, query.limit).map((row) => ({
    ...row, isFavorite: scope.favoriteSet.has(row.filename), folderId: scope.folders.get(row.filename) ?? null,
  }));
  const last = page[page.length - 1];
  const more = selected.length > query.limit && last;
  const nextCursor = !more ? null
    : query.order === "asc" ? { after: last.createdAt, afterFilename: last.filename }
      : { before: last.createdAt, beforeFilename: last.filename };
  return { page, nextCursor, matched: matched.length, ...(query.facetModel ? { facets: { model: modelCounts(rows, query, scope) } } : {}) };
}
