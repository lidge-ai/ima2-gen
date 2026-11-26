import type { WireHistoryRow } from "../wire.ts";
export class History {
  readonly items: WireHistoryRow[] = [];
  readonly favorites = new Map<string, Set<string>>();
  list(query: URLSearchParams, browser: string) {
    const favorites = this.favorites.get(browser),
      before = Number(query.get("before"));
    const filtered = this.items.filter((item) => !query.has("favoritesOnly") || favorites?.has(item.filename));
    filtered.sort((a, b) => b.createdAt - a.createdAt || b.filename.localeCompare(a.filename));
    const total = filtered.length;
    const eligible = filtered.filter(
      (item) =>
        !query.has("before") ||
        item.createdAt < before ||
        (item.createdAt === before && item.filename < (query.get("beforeFilename") ?? "")),
    );
    const limit = Math.max(1, Math.min(100, Number(query.get("limit")) || 40));
    const page = eligible
      .slice(0, limit)
      .map((item) => ({ ...item, isFavorite: favorites?.has(item.filename) ?? false }));
    const last = page.at(-1);
    return {
      items: page,
      total,
      nextCursor: eligible.length > limit && last ? { before: last.createdAt, beforeFilename: last.filename } : null,
    };
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
