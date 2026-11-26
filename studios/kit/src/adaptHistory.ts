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
  return cursor ? cursor.before + "|" + cursor.beforeFilename : null;
}

/** Query string for GET /api/history. Kind, model and workflow filters are applied client-side. */
export function historyParams(query: HistoryQuery): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = { limit: query.limit ?? 40 };
  if (query.favorite) params.favoritesOnly = "1";
  if (query.cursor) {
    const cut = query.cursor.indexOf("|");
    params.before = query.cursor.slice(0, cut);
    params.beforeFilename = query.cursor.slice(cut + 1);
  }
  return params;
}

export function toHistoryPage(wire: WireHistoryPage, query: HistoryQuery): HistoryPage {
  const items = wire.items.map(toHistoryItem).filter(
    (item) =>
      (!query.kind || item.kind === query.kind) &&
      (!query.model || item.model === query.model) &&
      (!query.workflow || item.workflow === query.workflow),
  );
  return { items, nextCursor: encodeCursor(wire.nextCursor) };
}
