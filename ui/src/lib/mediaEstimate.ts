import type { MediaPrice } from "./mediaCatalog";
import type { MediaSelection } from "./mediaSelection";

/**
 * What a selection is expected to cost. The server works this out (lib/providers/media/priceQuote.ts:
 * which published price row applies to the settings) and every client shows its answer, so the screen,
 * the CLI and the tools never disagree. "pending" is this screen's own state while the answer is on its way.
 */
export type MediaQuote =
  | { state: "exact"; usd: number; unit: string; quantity: number; price: MediaPrice }
  /** The row is a published starting price, so the charge can be higher. */
  | { state: "from"; usd: number; unit: string; quantity: number; price: MediaPrice }
  | { state: "range"; min: number; max: number; unit: string; quantity: number }
  /** Priced per megapixel, token, minute or character: it depends on the output, so no figure is shown. */
  | { state: "usage"; unit: string }
  | { state: "unpriced" }
  /** The route runs on the user's own machine: there is no provider price to quote. */
  | { state: "local" }
  | { state: "unknown" }
  | { state: "pending" };

const STATES: readonly string[] = ["exact", "from", "range", "usage", "unpriced", "unknown", "local"];

/** The quote in a POST /api/media/estimate answer; "unknown" when the answer carries none. */
export function quoteFromEstimate(answer: unknown): MediaQuote {
  const quote = (answer as { quote?: { state?: unknown } } | null)?.quote;
  return quote && typeof quote.state === "string" && STATES.includes(quote.state) ? quote as MediaQuote : { state: "unknown" };
}

/** POST /api/media/estimate body: the settings the job will send. The server chooses the price row. */
export function estimateBody(selection: MediaSelection, adapter: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model: selection.model, adapter, task: selection.task };
  if (selection.durationSec !== undefined) body.durationSec = selection.durationSec;
  if (selection.resolution !== undefined) body.resolution = selection.resolution;
  if (selection.quality !== undefined) body.quality = selection.quality;
  if (selection.aspectRatio !== undefined) body.aspectRatio = selection.aspectRatio;
  if (selection.audio !== undefined) body.audio = selection.audio;
  if (selection.kind === "image") body.count = 1;
  return body;
}
