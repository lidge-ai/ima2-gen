import type { WireHistoryRow } from "../wire.ts";

/** GET /api/history as the server answers it (lib/historyQuery.ts): the same filters, order, cursors and counts. */
export class History {
  readonly items: WireHistoryRow[] = [];
  readonly favorites = new Map<string, Set<string>>();
  list(query: URLSearchParams, browser: string) {
    const favorites = this.favorites.get(browser);
    const kinds = query.get("mediaType")?.split(",").filter(Boolean) ?? null;
    // As on the server, audio rows are left out unless asked for.
    const audio = query.get("includeAudio") === "1" || query.get("includeAudio") === "true" || (kinds?.includes("audio") ?? false);
    const q = query.get("q")?.trim().toLowerCase() || null;
    const num = (name: string) => (query.has(name) ? Number(query.get(name)) : NaN);
    const since = num("since"), until = num("until");
    const matches = (item: WireHistoryRow, withModel: boolean) =>
      (audio || item.mediaType !== "audio") &&
      (!kinds || kinds.includes(item.mediaType)) &&
      (!query.has("favoritesOnly") || (favorites?.has(item.filename) ?? false)) &&
      (!Number.isFinite(since) || item.createdAt > since) &&
      (!Number.isFinite(until) || item.createdAt <= until) &&
      (!withModel || !query.get("model") || item.model === query.get("model")) &&
      (!query.get("workflow") || item.workflow === query.get("workflow")) &&
      (!q || [item.prompt, item.model, item.filename].some((text) => text?.toLowerCase().includes(q)));
    const asc = query.get("order") === "asc";
    const matched = this.items.filter((item) => matches(item, true));
    matched.sort((a, b) => (b.createdAt - a.createdAt || b.filename.localeCompare(a.filename)) * (asc ? -1 : 1));
    const at = num(asc ? "after" : "before"), name = query.get(asc ? "afterFilename" : "beforeFilename") ?? "";
    const eligible = matched.filter((item) =>
      !Number.isFinite(at) || (asc
        ? item.createdAt > at || (item.createdAt === at && item.filename > name)
        : item.createdAt < at || (item.createdAt === at && item.filename < name)));
    const limit = Math.max(1, Math.min(100, Number(query.get("limit")) || 40));
    const page = eligible.slice(0, limit).map((item) => ({ ...item, isFavorite: favorites?.has(item.filename) ?? false, folderId: null }));
    const last = page.at(-1);
    const more = eligible.length > limit && last;
    return {
      items: page,
      total: this.items.length,
      matched: matched.length,
      nextCursor: !more ? null : asc ? { after: last.createdAt, afterFilename: last.filename } : { before: last.createdAt, beforeFilename: last.filename },
      ...(query.get("facets")?.split(",").includes("model") ? { facets: { model: this.modelCounts(matches) } } : {}),
    };
  }
  private modelCounts(matches: (item: WireHistoryRow, withModel: boolean) => boolean) {
    const counts = new Map<string, number>();
    for (const item of this.items) if (item.model && matches(item, false)) counts.set(item.model, (counts.get(item.model) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
  }
  toggle(filename: string, browser: string): boolean {
    const set = this.favorites.get(browser) ?? new Set<string>();
    this.favorites.set(browser, set);
    if (set.has(filename)) {
      set.delete(filename);
      return false;
    }
    set.add(filename);
    return true;
  }
}
