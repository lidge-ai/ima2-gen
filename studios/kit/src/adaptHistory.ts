/** History rows (GET /api/history) as kit HistoryItems, with an opaque string cursor. */
import type { HistoryItem, HistoryPage, HistoryQuery, MediaKind } from "./types.ts";
import type { WireHistoryPage, WireHistoryRow } from "./wire.ts";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
};

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function kindOf(row: WireHistoryRow): MediaKind {
  if (row.mediaType === "video" || row.mediaType === "audio" || row.mediaType === "image") return row.mediaType;
  return mimeFor(row.filename).split("/")[0] === "video" ? "video" : "image";
}

export function toHistoryItem(row: WireHistoryRow): HistoryItem {
  const provider = row.provider?.startsWith("media:") ? row.provider.slice(6) : row.provider ?? undefined;
  const item: HistoryItem = {
    historyId: row.filename,
    jobId: row.requestId ?? row.filename,
    kind: kindOf(row),
    mimeType: mimeFor(row.filename),
    url: row.url,
    model: row.model ?? provider ?? "unknown",
    createdAt: new Date(row.createdAt).toISOString(),
    favorite: row.isFavorite === true,
  };
  if (row.thumb) item.thumbUrl = row.thumb;
  if (provider) item.provider = provider;
  if (row.workflow) item.workflow = row.workflow;
  if (row.prompt) item.prompt = row.prompt;
  if (row.width) item.width = row.width;
  if (row.height) item.height = row.height;
  if (row.duration) item.durationSec = row.duration;
  return item;
}

export function encodeCursor(cursor: WireHistoryPage["nextCursor"]): string | null {
  if (!cursor) return null;
  return "after" in cursor ? "a:" + cursor.after + "|" + cursor.afterFilename : cursor.before + "|" + cursor.beforeFilename;
}

/**
 * Query string for GET /api/history. The server filters, orders and counts. The studio shows audio like any
 * other result, so audio rows are always asked for (the server leaves them out by default).
 */
export function historyParams(query: HistoryQuery): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = { limit: query.limit ?? 40, includeAudio: "1" };
  if (query.favorite) params.favoritesOnly = "1";
  if (query.kind) params.mediaType = query.kind;
  if (query.model) params.model = query.model;
  if (query.workflow) params.workflow = query.workflow;
  if (query.q?.trim()) params.q = query.q.trim();
  if (query.order === "oldest") params.order = "asc";
  if (query.sinceMs !== undefined) params.since = query.sinceMs;
  if (query.untilMs !== undefined) params.until = query.untilMs;
  if (query.models) params.facets = "model";
  if (query.cursor) {
    const asc = query.cursor.startsWith("a:");
    const cursor = asc ? query.cursor.slice(2) : query.cursor;
    const cut = cursor.indexOf("|");
    params[asc ? "after" : "before"] = cursor.slice(0, cut);
    params[asc ? "afterFilename" : "beforeFilename"] = cursor.slice(cut + 1);
  }
  return params;
}

/** The kind, model and workflow checks repeat what the server was asked, so a server from before those filters still gives a correct page. */
export function toHistoryPage(wire: WireHistoryPage, query: HistoryQuery): HistoryPage {
  const items = wire.items.map(toHistoryItem).filter(
    (item) =>
      (!query.kind || item.kind === query.kind) &&
      (!query.model || item.model === query.model) &&
      (!query.workflow || item.workflow === query.workflow),
  );
  const models = wire.facets?.model?.map((entry) => ({ id: entry.value, count: entry.count }));
  return {
    items, nextCursor: encodeCursor(wire.nextCursor),
    ...(wire.matched !== undefined ? { matched: wire.matched } : {}),
    ...(models ? { models } : {}),
  };
}
