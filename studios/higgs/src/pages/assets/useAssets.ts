import { useCallback, useEffect, useState } from "react";
import type { HistoryItem, HistoryQuery, StudioClient } from "@ima2/studio-kit";

export function useAssetModels(client: StudioClient, history: readonly HistoryItem[], revision: number) {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    async function collect() {
      const found = new Set<string>();
      let next: string | null = null;
      do {
        const page = await client.history.list({ limit: 100, ...(next ? { cursor: next } : {}) });
        page.items.forEach((item) => found.add(item.model));
        next = page.nextCursor;
      } while (next && active);
      if (active) setModels([...found].sort());
    }
    void collect().catch(() => {
      if (active) setModels([]);
    });
    return () => {
      active = false;
    };
  }, [client, history, revision]);
  return models;
}

export function useAssetPages(client: StudioClient, query: HistoryQuery, history: readonly HistoryItem[]) {
  const [items, setItems] = useState<readonly HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const { kind, model, favorite } = query;
  useEffect(() => {
    let active = true;
    setLoading(true);
    client.history
      .list({ kind, model, favorite, limit: 40 })
      .then(
        (page) => {
          if (!active) return;
          setItems(page.items);
          setCursor(page.nextCursor);
          setError("");
        },
        (err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, kind, model, favorite, history, revision]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await client.history.list({ kind, model, favorite, cursor, limit: 40 });
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, cursor, kind, model, favorite]);
  return { items, cursor, error, loading, revision, loadMore, retry: () => setRevision((v) => v + 1) };
}
