import { useEffect, useState } from "react";
import { jsonFetch } from "../../lib/api-core";
import type { MediaRoute } from "../../lib/mediaCatalog";
import { estimateBody, quoteFor, type MediaQuote } from "../../lib/mediaEstimate";
import type { MediaSelection } from "../../lib/mediaSelection";

// One request per distinct estimate; the settings panel and the Generate hint ask for the same one.
const confirmed = new Map<string, Promise<number | null>>();

function confirm(body: Record<string, unknown>): Promise<number | null> {
  const key = JSON.stringify(body);
  let pending = confirmed.get(key);
  if (!pending) {
    pending = jsonFetch<{ usd: number | null }>("/api/media/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((result) => (typeof result.usd === "number" ? result.usd : null));
    confirmed.set(key, pending);
    // A failed request is not an answer; let the next render ask again.
    pending.catch(() => confirmed.delete(key));
  }
  return pending;
}

export interface QuoteView {
  quote: MediaQuote;
  /** The amount to show: the server's figure once it answers, the price-list figure until then. */
  usd: number | null;
}

/**
 * The estimate for the selected settings. The price list gives a figure at once; POST /api/media/estimate
 * then confirms it for the exact route, and the confirmed figure replaces it when the two differ.
 */
export function useMediaQuote(route: MediaRoute | undefined, selection: MediaSelection): QuoteView {
  const quote: MediaQuote = route ? quoteFor(route, selection) : { state: "unknown" };
  const priced = quote.state === "exact" || quote.state === "from";
  const body = route && priced ? estimateBody(selection, route.adapter, quote.price) : null;
  const key = body ? JSON.stringify(body) : "";
  const [answer, setAnswer] = useState<{ key: string; usd: number | null } | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      confirm(JSON.parse(key) as Record<string, unknown>).then((usd) => { if (live) setAnswer({ key, usd }); }).catch(() => { /* keep the price-list figure */ });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);
  const server = answer && answer.key === key ? answer.usd : null;
  // The server figure wins when it really differs; a difference below two hundredths of a cent is rounding, not a price.
  return { quote, usd: priced ? (server !== null && Math.abs(server - quote.usd) > 0.0002 ? server : quote.usd) : null };
}
