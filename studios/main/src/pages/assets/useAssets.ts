import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryItem, HistoryQuery, StudioClient } from "@ima2/studio-kit";

type Filters = Pick<HistoryQuery, "kind" | "model" | "favorite" | "q" | "order" | "sinceMs">;

/**
 * Pages of results for one set of filters. The server filters, orders and counts, so a page holds 40 results
 * of what was asked for, and the first page brings the models to offer in the model filter.
 */
export function useAssetPages(client: StudioClient, query: Filters, history: readonly HistoryItem[]) {
  const [items, setItems] = useState<readonly HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [matched, setMatched] = useState<number | null>(null);
  const [models, setModels] = useState<readonly string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const { kind, model, favorite, q, order, sinceMs } = query;
  // Results belong to one filter: a new filter starts empty, and a page that arrives for an
  // older filter (a slow first page or load-more) is dropped instead of mixed in.
  const key = JSON.stringify([kind, model, favorite, q, order, sinceMs]);
  const current = useRef(key);
  useEffect(() => {
    let active = true;
    if (current.current !== key) {
      current.current = key;
      setItems([]);
      setCursor(null);
      setMatched(null);
    }
    setLoading(true);
    client.history
      .list({ kind, model, favorite, q, order, sinceMs, models: true, limit: 40 })
      .then(
        (page) => {
          if (!active) return;
          setItems(page.items);
          setCursor(page.nextCursor);
          setMatched(page.matched ?? null);
          setModels((page.models ?? []).map((entry) => entry.id).sort());
          setError("");
        },
        (err: unknown) => {
          if (!active) return;
          setItems([]);
          setCursor(null);
          setMatched(null);
          setError(err instanceof Error ? err.message : String(err));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, key, kind, model, favorite, q, order, sinceMs, history, revision]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const requested = key;
    setLoading(true);
    try {
      const page = await client.history.list({ kind, model, favorite, q, order, sinceMs, cursor, limit: 40 });
      if (current.current !== requested) return;
      setItems((shown) => [...shown, ...page.items]);
      setCursor(page.nextCursor);
      setError("");
    } catch (err) {
      if (current.current === requested) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, cursor, key, kind, model, favorite, q, order, sinceMs]);
  return { items, cursor, matched, models, error, loading, loadMore, retry: () => setRevision((v) => v + 1) };
}
