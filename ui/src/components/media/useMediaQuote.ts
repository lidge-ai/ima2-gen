import { useEffect, useState } from "react";
import { jsonFetch } from "../../lib/api-core";
import type { MediaRoute } from "../../lib/mediaCatalog";
import { estimateBody, quoteFromEstimate, type MediaQuote } from "../../lib/mediaEstimate";
import type { MediaSelection } from "../../lib/mediaSelection";

// One request per distinct estimate; the settings panel and the Generate hint ask for the same one.
const asked = new Map<string, Promise<MediaQuote>>();

function ask(key: string): Promise<MediaQuote> {
  let pending = asked.get(key);
  if (!pending) {
    pending = jsonFetch<unknown>("/api/media/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: key }).then(quoteFromEstimate);
    asked.set(key, pending);
    // A failed request is not an answer; let the next render ask again.
    pending.catch(() => asked.delete(key));
  }
  return pending;
}

export interface QuoteView {
  quote: MediaQuote;
  /** The amount to show when the quote is one figure. */
  usd: number | null;
}

/**
 * The server's estimate for the selected settings (POST /api/media/estimate). Nothing is priced here:
 * until the answer arrives the quote is "pending", and a request that fails leaves it "unknown".
 */
export function useMediaQuote(route: MediaRoute | undefined, selection: MediaSelection): QuoteView {
  const key = route ? JSON.stringify(estimateBody(selection, route.adapter)) : "";
  const [answer, setAnswer] = useState<{ key: string; quote: MediaQuote } | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      ask(key).then((quote) => { if (live) setAnswer({ key, quote }); }).catch(() => { if (live) setAnswer({ key, quote: { state: "unknown" } }); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);
  const quote: MediaQuote = !key ? { state: "unknown" } : answer && answer.key === key ? answer.quote : { state: "pending" };
  return { quote, usd: quote.state === "exact" || quote.state === "from" ? quote.usd : null };
}
