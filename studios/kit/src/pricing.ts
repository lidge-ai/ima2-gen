/**
 * Money as screens print it. Which published price applies to a request is the server's decision
 * (POST /api/media/estimate, lib/providers/media/priceQuote.ts): the kit has no rule of its own.
 */
import type { CostEstimate } from "./types.ts";

function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "$" + usd.toFixed(4).replace(/0+$/, "");
  return "$" + usd.toFixed(usd < 1 ? 3 : 2).replace(/(\.\d\d)0$/, "$1");
}

export function formatUsd(estimate: CostEstimate): string {
  return estimate.usd === null ? "Price not published" : money(estimate.usd);
}

export function sumEstimates(parts: readonly CostEstimate[]): CostEstimate {
  if (parts.some((part) => part.usd === null)) {
    return { usd: null, basis: "At least one step has no published price" };
  }
  const usd = parts.reduce((total, part) => total + (part.usd ?? 0), 0);
  return { usd, basis: parts.length + " steps" };
}
